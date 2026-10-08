// Per-instance memo with TTL and in-flight de-duplication. Serverless instances
// are short-lived, so this only smooths bursts (many tabs, many symbols) and
// keeps us under Finnhub's 60 calls/minute.

type Entry = { expires: number; value: Promise<unknown> };

const MAX_ENTRIES = 2000;
const store = new Map<string, Entry>();

export function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;

  const value = load();
  store.set(key, { expires: now + ttlMs, value });
  // Failures are not cached.
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
