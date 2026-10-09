import "server-only";
import { cookies } from "next/headers";
import { type Provider, type Tokens, refreshTokens } from "./providers";
import { deriveKey, seal, unseal } from "./seal";

// Per-browser token storage in httpOnly cookies, encrypted (AES-GCM) and bound
// to the signed-in user. Tokens can exceed a single cookie's size, so they are
// chunked. Cookies are scoped to /api/ai so pages and assets never carry them.
// Provider credentials stay in the user's browser and are never written to
// the database.

const SESSION_TTL_DAYS = 30;
const PKCE_TTL_SECONDS = 10 * 60;
const CHUNK_SIZE = 3500;
const MAX_CHUNKS = 6;

const COOKIE_PATH = "/api/ai";
const sessionPrefix = (p: Provider) => `${p}_s`;
const pkceCookie = (p: Provider) => `${p}_pkce`;
// Before encryption, sessions were plaintext JSON on path "/"; read once, then replaced.
const legacyPrefix = (p: Provider) => `${p}_session`;

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: COOKIE_PATH,
  maxAge,
});

let cachedKey: Buffer | null = null;
function key(): Buffer {
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!secret) throw new Error("NEON_AUTH_COOKIE_SECRET is not set");
  cachedKey ??= deriveKey(secret, "ai-session-cookies");
  return cachedKey;
}

type PkceCookie = { verifier: string; state: string };

export async function writePkce(provider: Provider, value: PkceCookie): Promise<void> {
  const jar = await cookies();
  jar.set(pkceCookie(provider), seal(key(), JSON.stringify(value), `${provider}:pkce`), cookieOptions(PKCE_TTL_SECONDS));
}

export async function readPkce(provider: Provider): Promise<PkceCookie | null> {
  const jar = await cookies();
  const sealed = jar.get(pkceCookie(provider))?.value;
  const raw = sealed ? unseal(key(), sealed, `${provider}:pkce`) : null;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.verifier === "string" && typeof parsed.state === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function clearPkce(provider: Provider): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: pkceCookie(provider), path: COOKIE_PATH });
}

function chunkString(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

// Each session is sealed to the user it belongs to (and records it), so a
// different account signing in on the same browser can't use it.
type StoredSession = Tokens & { userId: string };
const sessionAad = (provider: Provider, userId: string) => `${provider}:${userId}`;

export async function writeSession(provider: Provider, userId: string, tokens: Tokens): Promise<void> {
  const json = JSON.stringify({ ...tokens, userId } satisfies StoredSession);
  const chunks = chunkString(seal(key(), json, sessionAad(provider, userId)), CHUNK_SIZE);
  if (chunks.length > MAX_CHUNKS) {
    throw new Error(`${provider} session too large to fit in ${MAX_CHUNKS} cookies.`);
  }
  const jar = await cookies();
  const opts = cookieOptions(SESSION_TTL_DAYS * 24 * 60 * 60);
  const prefix = sessionPrefix(provider);
  chunks.forEach((chunk, i) => jar.set(`${prefix}_${i}`, chunk, opts));
  for (let i = chunks.length; i < MAX_CHUNKS; i++) jar.delete({ name: `${prefix}_${i}`, path: COOKIE_PATH });
  await clearLegacy(provider);
}

async function clearLegacy(provider: Provider): Promise<void> {
  const jar = await cookies();
  for (let i = 0; i < MAX_CHUNKS; i++) if (jar.has(`${legacyPrefix(provider)}_${i}`)) jar.delete({ name: `${legacyPrefix(provider)}_${i}`, path: "/" });
  if (jar.has(pkceCookie(provider))) jar.delete({ name: pkceCookie(provider), path: "/" });
}

export async function clearSession(provider: Provider): Promise<void> {
  const jar = await cookies();
  const prefix = sessionPrefix(provider);
  for (let i = 0; i < MAX_CHUNKS; i++) jar.delete({ name: `${prefix}_${i}`, path: COOKIE_PATH });
  await clearLegacy(provider);
}

async function joinChunks(prefix: string): Promise<string> {
  const jar = await cookies();
  let joined = "";
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const v = jar.get(`${prefix}_${i}`)?.value;
    if (!v) break;
    joined += v;
  }
  return joined;
}

async function readSessionRaw(provider: Provider, userId: string): Promise<(Tokens & { legacy: boolean }) | null> {
  const sealed = await joinChunks(sessionPrefix(provider));
  const legacy = sealed ? "" : await joinChunks(legacyPrefix(provider));
  const joined = sealed ? unseal(key(), sealed, sessionAad(provider, userId)) : legacy;
  if (!joined) return null;
  try {
    const parsed = JSON.parse(joined);
    if (typeof parsed.accessToken !== "string" || typeof parsed.refreshToken !== "string" || parsed.userId !== userId) {
      return null;
    }
    const stored = parsed as StoredSession;
    return { accessToken: stored.accessToken, refreshToken: stored.refreshToken, expiresAt: stored.expiresAt, idToken: stored.idToken, accountId: stored.accountId, legacy: !sealed };
  } catch {
    return null;
  }
}

// Presence check only (no refresh) — used by the status endpoint.
export async function hasSession(provider: Provider, userId: string): Promise<boolean> {
  return (await readSessionRaw(provider, userId)) !== null;
}

// Returns a valid token, refreshing (and re-persisting) when near expiry.
export async function getActiveSession(provider: Provider, userId: string): Promise<Tokens | null> {
  const stored = await readSessionRaw(provider, userId);
  if (!stored) return null;
  const { legacy, ...session } = stored;
  if (legacy) await writeSession(provider, userId, session);
  if (session.expiresAt > Date.now() + 30_000) return session;
  try {
    const refreshed = await refreshTokens(provider, session.refreshToken, session);
    await writeSession(provider, userId, refreshed);
    return refreshed;
  } catch (err) {
    console.error(`[ai-session] ${provider} refresh failed:`, err instanceof Error ? err.message : err);
    // Only a rejected refresh token ends the session; network blips keep it for a retry.
    if (isRejected(err)) await clearSession(provider);
    return null;
  }
}

function isRejected(err: unknown): boolean {
  return err instanceof Error && /\((400|401)\)/.test(err.message);
}

export async function clearAllSessions(): Promise<void> {
  for (const p of ["codex", "grok"] as const) {
    await clearSession(p);
    await clearPkce(p);
  }
}
