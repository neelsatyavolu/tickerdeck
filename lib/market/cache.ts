import { getCache } from "@vercel/functions";

// Two-tier cache for market data:
//  1. this instance's memory (instant; also de-duplicates in-flight loads), then
//  2. Vercel's Runtime Cache, shared by every function instance in the region,
//     so a cold instance doesn't have to hit Finnhub/Nasdaq again.
// Locally the Runtime Cache falls back to in-memory. Failures are never cached,
// and a broken shared cache only costs speed, never correctness.

type Entry = { expires: number; value: Promise<unknown> };

const MAX_ENTRIES = 2000;
const store = new Map<string, Entry>();

let shared: ReturnType<typeof getCache> | null | undefined;
function sharedCache() {
  if (shared === undefined) {
    try {
      shared = getCache({ namespace: "td" });
    } catch {
      shared = null;
    }
  }
  return shared;
}

async function loadThrough<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const cache = sharedCache();
  if (cache) {
    try {
      const hit = await cache.get(key);
      if (hit !== undefined && hit !== null) return hit as T;
    } catch {
      /* fall through to the source */
    }
  }
  const fresh = await load();
  if (cache && fresh !== null && fresh !== undefined) {
    cache.set(key, fresh, { ttl: Math.max(1, Math.round(ttlMs / 1000)), name: key.split(":").slice(0, 2).join(":") }).catch(() => {});
  }
  return fresh;
}

export function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;

  const value = loadThrough(key, ttlMs, load);
  store.set(key, { expires: now + ttlMs, value });
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  if (store.size > MAX_ENTRIES) {
    for (const [k, e] of store) if (e.expires <= now || store.size > MAX_ENTRIES) store.delete(k);
  }
  return value;
}

export function clearMemo(): void {
  store.clear();
}
