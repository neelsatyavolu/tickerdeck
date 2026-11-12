import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import type { XanomConfig } from "./config";

// The OIDC client side of Xanom sign-in (SPEC.md §2 to §4), adapted from the
// helper in xanom-accounts/docs/INTEGRATING.md so config and keys can be
// injected in tests. The wire protocol is unchanged.

export const FLOW_COOKIE = "xanom_flow";
export const FLOW_COOKIE_MAX_AGE = 600;
const FLOW_AUDIENCE_SUFFIX = ":xanom-flow";
const CONVERT_TICKET_SECONDS = 300;

export const INTENTS = ["signin", "link", "convert"] as const;
export type Intent = (typeof INTENTS)[number];
export type XanomUser = { sub: string; email: string; name: string };

/** What the start step remembers for the callback, in a signed cookie. */
export type Flow = {
  state: string;
  nonce: string;
  verifier: string;
  intent: Intent;
  returnTo: string;
  redirectUri: string;
  /** The TickerQuill user who started a link or convert; the callback must see the same one. */
  userId: string | null;
};

export class XanomError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "XanomError";
  }
}

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s: string) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
const secretKey = (config: XanomConfig) => enc.encode(config.clientSecret);

export function isIntent(value: string | null): value is Intent {
  return (INTENTS as readonly string[]).includes(value ?? "");
}

/** Only same-site paths, so `return` can't send people off-site. */
export function safeReturn(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(path)) return "/";
  // Parse it the way the redirect will, so nothing the URL parser strips can turn it into //host.
  const base = "https://return.invalid";
  try {
    const url = new URL(path, base);
    if (url.origin !== base || url.pathname.startsWith("//")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

const jwksCache = new Map<string, JWTVerifyGetKey>();
/** The issuer's signing keys, cached by jose for about ten minutes (spec §4). */
export function issuerKeys(config: XanomConfig): JWTVerifyGetKey {
  let keys = jwksCache.get(config.issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${config.issuer}/oauth/jwks`), { cacheMaxAge: 10 * 60_000, timeoutDuration: 1_500 });
    jwksCache.set(config.issuer, keys);
  }
  return keys;
}

export type ConvertUser = { email: string; name: string; emailVerified: boolean };

/** Spec §3: HS256 compact JWS keyed with the client secret, 300 s lifetime, single-use jti. */
export function createConvertTicket(config: XanomConfig, user: ConvertUser, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new SignJWT({ email: user.email, name: user.name, email_verified: user.emailVerified === true, jti: random(16) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(config.clientId)
    .setAudience(config.issuer)
    .setIssuedAt(iat)
    .setExpirationTime(iat + CONVERT_TICKET_SECONDS)
    .sign(secretKey(config));
}

/** Builds the authorize URL and the signed flow cookie (state, PKCE verifier, nonce). */
export async function startSignIn(
  config: XanomConfig,
  opts: { redirectUri: string; intent: Intent; returnTo?: string | null; userId?: string | null; convert?: ConvertUser },
): Promise<{ url: string; cookie: string }> {
  const flow: Flow = {
    state: random(),
    nonce: random(),
    verifier: random(48),
    intent: opts.intent,
    returnTo: safeReturn(opts.returnTo),
    redirectUri: opts.redirectUri,
    userId: opts.userId ?? null,
  };
  const cookie = await new SignJWT({ ...flow })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(`${config.clientId}${FLOW_AUDIENCE_SUFFIX}`)
    .setIssuedAt()
    .setExpirationTime(`${FLOW_COOKIE_MAX_AGE}s`)
    .sign(secretKey(config));

  const url = new URL(`${config.issuer}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: opts.redirectUri,
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: await sha256(flow.verifier),
    code_challenge_method: "S256",
  }).toString();
  if (opts.intent === "convert") {
    if (!opts.convert) throw new XanomError("convert_needs_user");
    url.searchParams.set("convert", await createConvertTicket(config, opts.convert));
  }
  return { url: url.toString(), cookie };
}

/** Reads the flow cookie back; throws when it is missing, forged or expired. */
export async function readFlow(config: XanomConfig, cookie: string | undefined): Promise<Flow> {
  if (!cookie) throw new XanomError("no_flow", "The sign-in took too long or started in another browser.");
  try {
    const { payload } = await jwtVerify(cookie, secretKey(config), {
      algorithms: ["HS256"],
      audience: `${config.clientId}${FLOW_AUDIENCE_SUFFIX}`,
    });
    const p = payload as Partial<Flow>;
    if (typeof p.state !== "string" || typeof p.nonce !== "string" || typeof p.verifier !== "string" || !isIntent(p.intent ?? null)) {
      throw new XanomError("bad_flow");
    }
    return {
      state: p.state,
      nonce: p.nonce,
      verifier: p.verifier,
      intent: p.intent as Intent,
      returnTo: safeReturn(p.returnTo),
      redirectUri: String(p.redirectUri ?? ""),
      userId: typeof p.userId === "string" ? p.userId : null,
    };
  } catch (err) {
    if (err instanceof XanomError) throw err;
    throw new XanomError("bad_flow", "The sign-in took too long or started in another browser.");
  }
}

type TokenFetch = (input: string, init: RequestInit) => Promise<Response>;

/** Checks state, exchanges the code (client_secret_basic + PKCE) and verifies the id_token. */
export async function finishSignIn(
  config: XanomConfig,
  flow: Flow,
  query: URLSearchParams,
  deps: { keys: JWTVerifyGetKey; fetch: TokenFetch },
): Promise<XanomUser> {
  if (query.get("state") !== flow.state) throw new XanomError("bad_state");
  const error = query.get("error");
  if (error) throw new XanomError(error.slice(0, 64), query.get("error_description")?.slice(0, 200) ?? undefined);
  const code = query.get("code");
  if (!code) throw new XanomError("no_code");

  const basic = Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString("base64");
  const res = await deps.fetch(`${config.issuer}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: flow.redirectUri, code_verifier: flow.verifier }),
    signal: AbortSignal.timeout(5_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !body.id_token) throw new XanomError(String(body.error ?? "token_failed").slice(0, 64));
  return verifyIdToken(config, body.id_token, flow.nonce, deps.keys);
}

/** Checks signature (JWKS), iss, aud, exp and nonce. */
export async function verifyIdToken(config: XanomConfig, idToken: string, nonce: string, keys: JWTVerifyGetKey): Promise<XanomUser> {
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, keys, { issuer: config.issuer, audience: config.clientId, algorithms: ["RS256"] }));
  } catch {
    throw new XanomError("bad_id_token");
  }
  if (payload.nonce !== nonce) throw new XanomError("bad_nonce");
  if (typeof payload.sub !== "string" || !payload.sub || typeof payload.email !== "string" || !payload.email) throw new XanomError("bad_id_token");
  if (payload.email_verified !== true) throw new XanomError("email_unverified");
  return { sub: payload.sub, email: payload.email.trim().toLowerCase(), name: typeof payload.name === "string" ? payload.name : "" };
}

/** Spec §4: the Xanom sub from a summary request's bearer JWT, or null. */
export async function verifySummaryRequest(config: XanomConfig, authorization: string | null, keys: JWTVerifyGetKey): Promise<string | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(authorization.slice(7), keys, {
      issuer: config.issuer,
      audience: config.clientId,
      algorithms: ["RS256"],
      maxTokenAge: "70s",
    });
    return payload.scope === "summary" && typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}
