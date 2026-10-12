"use client";

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

/** Calls one of our API routes and unwraps the { ok, data | error } envelope. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Network error. Check your connection.");
  }
  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    /* non-JSON */
  }
  if (res.status === 401) {
    // Full reload on purpose: /login lives outside the signed-in app shell.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new Error("Signed out.");
  }
  if (!body) throw new Error(`Request failed (${res.status}).`);
  if (!body.ok) throw new Error(body.error);
  return body.data;
}

export function postJson<T>(url: string, payload: unknown): Promise<T> {
  return api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}

type CacheEntry = { expires: number; value: Promise<unknown>; data?: unknown; pending: boolean };
const getCache = new Map<string, CacheEntry>();

/**
 * GET with a short browser-side cache and in-flight de-duplication, so moving
 * between pages (or two panels asking for the same thing) doesn't refetch.
 * Errors aren't cached.
 */
export function cachedApi<T>(url: string, ttlMs: number): Promise<T> {
  const now = Date.now();
  const hit = getCache.get(url);
  if (hit && (hit.pending || hit.expires > now)) return hit.value as Promise<T>;
  const value = api<T>(url);
  const entry: CacheEntry = { expires: 0, value, pending: true };
  getCache.set(url, entry);
  value.then((data) => {
    entry.data = data;
    entry.pending = false;
    entry.expires = Date.now() + ttlMs;
  }, () => {
    if (getCache.get(url)?.value === value) getCache.delete(url);
  });
  return value;
}

/** Synchronous peek at a cached GET, so a revisited page can render immediately. */
export function peekCached<T>(url: string): Promise<T> | null {
  const hit = getCache.get(url);
  return hit && (hit.pending || hit.expires > Date.now()) ? (hit.value as Promise<T>) : null;
}

/** A resolved, unexpired GET, without waiting for its promise. */
export function readCached<T>(url: string): T | undefined {
  const hit = getCache.get(url);
  return hit && !hit.pending && hit.expires > Date.now() ? hit.data as T : undefined;
}
