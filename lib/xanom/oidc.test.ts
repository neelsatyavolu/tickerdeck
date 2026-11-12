import { beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createLocalJWKSet, decodeProtectedHeader, exportJWK, generateKeyPair, jwtVerify, SignJWT, type CryptoKey, type JWTVerifyGetKey } from "jose";
import type { XanomConfig } from "./config";
import { createConvertTicket, finishSignIn, readFlow, safeReturn, startSignIn, verifyIdToken, verifySummaryRequest, XanomError, type Flow } from "./oidc";

// A local fake issuer: an RS256 key pair and its JWKS, standing in for accounts.xanom.co.

const config: XanomConfig = { issuer: "https://accounts.example", clientId: "tickerquill", clientSecret: "test-client-secret-0123456789abcdef" };
const REDIRECT = "https://tickerquill.example/api/xanom/callback";

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let keys: JWTVerifyGetKey;

beforeAll(async () => {
  const issuer = await generateKeyPair("RS256", { extractable: true });
  signingKey = issuer.privateKey;
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(issuer.publicKey)), kid: "k1", alg: "RS256" }] });
  ({ privateKey: otherKey } = await generateKeyPair("RS256"));
});

type Claims = Record<string, unknown>;
const nowSec = () => Math.floor(Date.now() / 1000);

function idToken(claims: Claims = {}, opts: { key?: CryptoKey; aud?: string; iss?: string; exp?: number } = {}) {
  return new SignJWT({ email: "ada@example.com", email_verified: true, name: "Ada", nonce: "n-1", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? config.issuer)
    .setAudience(opts.aud ?? config.clientId)
    .setSubject("xa_01HXANOMUSER")
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? nowSec() + 600)
    .sign(opts.key ?? signingKey);
}

function summaryJwt(opts: { key?: CryptoKey; aud?: string; scope?: string; iat?: number; exp?: number } = {}) {
  const iat = opts.iat ?? nowSec();
  return new SignJWT({ scope: opts.scope ?? "summary" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(config.issuer)
    .setAudience(opts.aud ?? config.clientId)
    .setSubject("xa_01HXANOMUSER")
    .setIssuedAt(iat)
    .setExpirationTime(opts.exp ?? iat + 60)
    .sign(opts.key ?? signingKey);
}

const flow = (over: Partial<Flow> = {}): Flow => ({
  state: "s-1", nonce: "n-1", verifier: "v".repeat(64), intent: "signin", returnTo: "/", redirectUri: REDIRECT, userId: null, ...over,
});

function tokenEndpoint(body: unknown, status = 200) {
  return vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json(body, { status }));
}

describe("startSignIn", () => {
  it("builds the authorize URL with state, nonce and an S256 challenge of the stored verifier", async () => {
    const { url, cookie } = await startSignIn(config, { redirectUri: REDIRECT, intent: "signin", returnTo: "/p/1" });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://accounts.example/oauth/authorize");
    const q = u.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe("tickerquill");
    expect(q.get("redirect_uri")).toBe(REDIRECT);
    expect(q.get("scope")).toBe("openid email profile");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.has("convert")).toBe(false);

    const stored = await readFlow(config, cookie);
    expect(stored.state).toBe(q.get("state"));
    expect(stored.nonce).toBe(q.get("nonce"));
    expect(q.get("code_challenge")).toBe(createHash("sha256").update(stored.verifier).digest("base64url"));
    expect(stored.returnTo).toBe("/p/1");
  });

  it("uses fresh state, nonce and verifier every time", async () => {
    const a = new URL((await startSignIn(config, { redirectUri: REDIRECT, intent: "signin" })).url).searchParams;
    const b = new URL((await startSignIn(config, { redirectUri: REDIRECT, intent: "signin" })).url).searchParams;
    expect(a.get("state")).not.toBe(b.get("state"));
    expect(a.get("nonce")).not.toBe(b.get("nonce"));
    expect(a.get("code_challenge")).not.toBe(b.get("code_challenge"));
  });

  it("adds a convert ticket for intent=convert and remembers who started it", async () => {
    const { url, cookie } = await startSignIn(config, {
      redirectUri: REDIRECT, intent: "convert", userId: "user-1", convert: { email: "ada@example.com", name: "ada", emailVerified: true },
    });
    expect(new URL(url).searchParams.get("convert")).toBeTruthy();
    expect((await readFlow(config, cookie)).userId).toBe("user-1");
  });

  it("only keeps same-site return paths", () => {
    expect(safeReturn("/settings")).toBe("/settings");
    for (const bad of ["https://evil.example/", "//evil.example", "/\\evil.example", "settings", null]) expect(safeReturn(bad)).toBe("/");
  });
});

describe("readFlow", () => {
  it("rejects a missing, forged or expired flow cookie", async () => {
    await expect(readFlow(config, undefined)).rejects.toMatchObject({ code: "no_flow" });
    const { cookie } = await startSignIn(config, { redirectUri: REDIRECT, intent: "signin" });
    await expect(readFlow({ ...config, clientSecret: "another-secret-another-secret-00" }, cookie)).rejects.toMatchObject({ code: "bad_flow" });
    const tampered = cookie.slice(0, -4) + (cookie.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(readFlow(config, tampered)).rejects.toMatchObject({ code: "bad_flow" });

    vi.useFakeTimers({ now: Date.now() + 11 * 60_000 });
    try {
      await expect(readFlow(config, cookie)).rejects.toMatchObject({ code: "bad_flow" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("finishSignIn", () => {
  const query = (over: Record<string, string> = {}) => new URLSearchParams({ state: "s-1", code: "c-1", ...over });

  it("exchanges the code with the PKCE verifier and client_secret_basic, then returns the verified user", async () => {
    const fetch = tokenEndpoint({ id_token: await idToken() });
    const user = await finishSignIn(config, flow(), query(), { keys, fetch });
    expect(user).toEqual({ sub: "xa_01HXANOMUSER", email: "ada@example.com", name: "Ada" });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://accounts.example/oauth/token");
    const body = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(body)).toEqual({ grant_type: "authorization_code", code: "c-1", redirect_uri: REDIRECT, code_verifier: "v".repeat(64) });
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(Buffer.from(auth.replace("Basic ", ""), "base64").toString()).toBe(`tickerquill:${config.clientSecret}`);
  });

  it("refuses a state that doesn't match before calling the token endpoint", async () => {
    const fetch = tokenEndpoint({});
    await expect(finishSignIn(config, flow(), query({ state: "s-2" }), { keys, fetch })).rejects.toMatchObject({ code: "bad_state" });
    await expect(finishSignIn(config, flow(), new URLSearchParams({ code: "c-1" }), { keys, fetch })).rejects.toMatchObject({ code: "bad_state" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("passes the issuer's error through", async () => {
    const fetch = tokenEndpoint({});
    await expect(finishSignIn(config, flow(), new URLSearchParams({ state: "s-1", error: "access_denied" }), { keys, fetch })).rejects.toMatchObject({ code: "access_denied" });
  });

  it("fails when the token endpoint refuses the code", async () => {
    await expect(finishSignIn(config, flow(), query(), { keys, fetch: tokenEndpoint({ error: "invalid_grant" }, 400) })).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("refuses an id_token whose nonce doesn't match", async () => {
    const fetch = tokenEndpoint({ id_token: await idToken({ nonce: "n-other" }) });
    await expect(finishSignIn(config, flow(), query(), { keys, fetch })).rejects.toMatchObject({ code: "bad_nonce" });
  });
});

describe("verifyIdToken", () => {
  it("checks signature, issuer, audience and expiry", async () => {
    const cases = [
      await idToken({}, { key: otherKey }),
      await idToken({}, { aud: "mullwell" }),
      await idToken({}, { iss: "https://evil.example" }),
      await idToken({}, { exp: nowSec() - 120 }),
    ];
    for (const token of cases) await expect(verifyIdToken(config, token, "n-1", keys)).rejects.toMatchObject({ code: "bad_id_token" });
  });

  it("refuses an id_token without a nonce when one was sent, or with an unverified email", async () => {
    await expect(verifyIdToken(config, await idToken({ nonce: undefined }), "n-1", keys)).rejects.toMatchObject({ code: "bad_nonce" });
    await expect(verifyIdToken(config, await idToken({ email_verified: false }), "n-1", keys)).rejects.toMatchObject({ code: "email_unverified" });
  });

  it("lowercases the email", async () => {
    const user = await verifyIdToken(config, await idToken({ email: "Ada@Example.COM" }), "n-1", keys);
    expect(user.email).toBe("ada@example.com");
  });
});

describe("createConvertTicket", () => {
  it("is an HS256 JWS keyed with the client secret, aimed at the issuer, valid for 300 s", async () => {
    const now = Date.UTC(2026, 10, 12, 12);
    const ticket = await createConvertTicket(config, { email: "ada@example.com", name: "Ada", emailVerified: true }, now);
    expect(decodeProtectedHeader(ticket)).toEqual({ alg: "HS256", typ: "JWT" });
    const { payload } = await jwtVerify(ticket, new TextEncoder().encode(config.clientSecret), {
      issuer: "tickerquill", audience: "https://accounts.example", currentDate: new Date(now),
    });
    expect(payload).toMatchObject({ email: "ada@example.com", name: "Ada", email_verified: true });
    expect(payload.exp! - payload.iat!).toBe(300);
    expect(payload.iat).toBe(now / 1000);
    expect(typeof payload.jti).toBe("string");
  });

  it("uses a new jti each time and says false unless the app verified the email", async () => {
    const a = await createConvertTicket(config, { email: "a@example.com", name: "A", emailVerified: false });
    const b = await createConvertTicket(config, { email: "a@example.com", name: "A", emailVerified: false });
    const key = new TextEncoder().encode(config.clientSecret);
    const pa = (await jwtVerify(a, key)).payload;
    const pb = (await jwtVerify(b, key)).payload;
    expect(pa.jti).not.toBe(pb.jti);
    expect(pa.email_verified).toBe(false);
  });

  it("cannot be verified with another secret", async () => {
    const ticket = await createConvertTicket(config, { email: "a@example.com", name: "A", emailVerified: true });
    await expect(jwtVerify(ticket, new TextEncoder().encode("wrong-secret-wrong-secret-wrong"))).rejects.toThrow();
  });
});

describe("verifySummaryRequest", () => {
  it("accepts a fresh summary JWT signed by the issuer and returns the sub", async () => {
    expect(await verifySummaryRequest(config, `Bearer ${await summaryJwt()}`, keys)).toBe("xa_01HXANOMUSER");
  });

  it("rejects the wrong audience, an expired token, a bad signature and the wrong scope", async () => {
    const bad = [
      await summaryJwt({ aud: "mullwell" }),
      await summaryJwt({ iat: nowSec() - 600, exp: nowSec() - 540 }),
      await summaryJwt({ key: otherKey }),
      await summaryJwt({ scope: "openid" }),
    ];
    for (const token of bad) expect(await verifySummaryRequest(config, `Bearer ${token}`, keys)).toBeNull();
  });

  it("rejects a missing, unsigned or malformed header", async () => {
    const unsigned = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ iss: config.issuer, aud: "tickerquill", sub: "xa_1", scope: "summary" })).toString("base64url")}.`;
    for (const header of [null, "", "Basic abc", `Bearer ${unsigned}`, "Bearer not-a-jwt"]) {
      expect(await verifySummaryRequest(config, header, keys)).toBeNull();
    }
  });

  it("XanomError carries its code", () => {
    expect(new XanomError("bad_state").code).toBe("bad_state");
  });
});
