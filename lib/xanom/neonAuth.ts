import "server-only";
import { randomBytes } from "node:crypto";
import {
  handleAuthResponse,
  NEON_AUTH_HEADER_MIDDLEWARE_NAME,
  NEON_AUTH_SESSION_COOKIE_NAME,
  parseSetCookies,
} from "@neondatabase/auth/server";
import { required } from "../env";
import { createHandoff, dropHandoff, HANDOFF_PARAM, takeToken, type HandoffPurpose } from "./handoff";

// Server-side calls to Neon Auth for the Xanom callback, made the way the SDK's
// own /api/auth proxy makes them, and its cookie handling (handleAuthResponse)
// for whatever session cookies come back.

/** Neon's query parameter for finishing a cross-domain sign-in (see the SDK's middleware). */
const VERIFIER_PARAM = "neon_auth_session_verifier";
const UPSTREAM_TIMEOUT_MS = 8_000;

export class NeonAuthError extends Error {
  constructor(public readonly step: string, public readonly status: number) {
    super(`Neon Auth ${step} failed (HTTP ${status})`);
    this.name = "NeonAuthError";
  }
}

type Upstream = { baseUrl: string; origin: string; cookieSecret: string };

function upstream(origin: string): Upstream {
  return {
    baseUrl: required("NEON_AUTH_BASE_URL").replace(/\/+$/, ""),
    origin,
    cookieSecret: required("NEON_AUTH_COOKIE_SECRET"),
  };
}

function call(u: Upstream, path: string, init: { method: "GET" | "POST"; body?: unknown; cookie?: string }): Promise<Response> {
  const headers = new Headers({ Origin: u.origin, [NEON_AUTH_HEADER_MIDDLEWARE_NAME]: "true" });
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  return fetch(`${u.baseUrl}/${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: "manual",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

async function expectOk(step: string, res: Response): Promise<void> {
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new NeonAuthError(step, res.status);
  }
}

/** `name=value` pairs from Set-Cookie headers, for sending back upstream. */
function cookiePairs(setCookies: string[]): string {
  return setCookies.flatMap((h) => parseSetCookies(h).map((c) => `${c.name}=${encodeURIComponent(c.value)}`)).join("; ");
}

const hasSessionToken = (setCookies: string[]) =>
  setCookies.some((h) => parseSetCookies(h).some((c) => c.name === NEON_AUTH_SESSION_COOKIE_NAME && c.value !== ""));

/** Asks Neon for a link of this kind and takes its token from the webhook (lib/xanom/handoff.ts). */
async function linkToken(u: Upstream, email: string, purpose: HandoffPurpose, request: (callbackUrl: string) => Promise<Response>) {
  const id = await createHandoff(email, purpose);
  try {
    const callbackUrl = new URL(purpose === "sign-in" ? "/" : "/login/reset", u.origin);
    callbackUrl.searchParams.set(HANDOFF_PARAM, id);
    // The webhook is blocking: by the time Neon answers, it has handed us the token.
    await expectOk(purpose, await request(callbackUrl.toString()));
    const token = await takeToken(id);
    if (!token) throw new NeonAuthError(`${purpose} handoff`, 0);
    return token;
  } catch (err) {
    await dropHandoff(id).catch(() => {});
    throw err;
  }
}

export type SessionCookies = string[];

/**
 * Signs `email` in through a magic link Neon hands to our webhook. Neon creates the
 * user (with `name`) if there is none, and marks the email verified. Returns the
 * Set-Cookie headers for the browser.
 */
export async function signInAs(origin: string, email: string, name: string): Promise<SessionCookies> {
  const u = upstream(origin);
  const token = await linkToken(u, email, "sign-in", (callbackURL) =>
    call(u, "sign-in/magic-link", { method: "POST", body: { email, name, callbackURL } }),
  );
  const verified = await call(u, `magic-link/verify?token=${encodeURIComponent(token)}`, { method: "GET" });
  if (verified.status >= 400) throw new NeonAuthError("magic-link verify", verified.status);
  let cookies = (await handleAuthResponse(verified, u.baseUrl, { secret: u.cookieSecret })).headers.getSetCookie();

  // Neon may answer the way it does for OAuth: a redirect carrying a one-time verifier
  // plus a challenge cookie, which get-session trades for the session cookie.
  const location = verified.headers.get("location");
  if (!hasSessionToken(cookies) && location) {
    const verifier = new URL(location, u.origin).searchParams.get(VERIFIER_PARAM);
    if (verifier) {
      const exchanged = await call(u, `get-session?${VERIFIER_PARAM}=${encodeURIComponent(verifier)}`, { method: "GET", cookie: cookiePairs(cookies) });
      await expectOk("session exchange", exchanged.clone());
      cookies = [...cookies, ...(await handleAuthResponse(exchanged, u.baseUrl, { secret: u.cookieSecret })).headers.getSetCookie()];
    }
  }
  if (!hasSessionToken(cookies)) throw new NeonAuthError("magic-link session", verified.status);
  return cookies;
}

/**
 * Pre-hijacking guard (SPEC.md §2 rule 3): replaces the password on an account whose
 * email was never confirmed with a random one nobody knows. The owner can set their
 * own through "Forgot password".
 */
export async function scramblePassword(origin: string, email: string): Promise<void> {
  const u = upstream(origin);
  const token = await linkToken(u, email, "forget-password", (redirectTo) =>
    call(u, "request-password-reset", { method: "POST", body: { email, redirectTo } }),
  );
  const newPassword = randomBytes(48).toString("base64url");
  await expectOk("reset-password", await call(u, "reset-password", { method: "POST", body: { token, newPassword } }));
}

/** Ends every other session of the user who owns these (fresh) session cookies. */
export async function revokeOtherSessions(origin: string, cookies: SessionCookies): Promise<void> {
  const u = upstream(origin);
  const session = cookies
    .flatMap((h) => parseSetCookies(h))
    .filter((c) => c.name === NEON_AUTH_SESSION_COOKIE_NAME)
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join("; ");
  await expectOk("revoke-other-sessions", await call(u, "revoke-other-sessions", { method: "POST", body: {}, cookie: session }));
}
