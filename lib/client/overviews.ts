"use client";

import type { Overview } from "../market/overview";
import { api } from "./api";

const TTL = 5 * 60_000;
const BATCH = 50;
type Entry = { expires: number; value: Promise<Overview | null> };
const cache = new Map<string, Entry>();

/** Share trends across overlapping panels, fetching only missing symbols. */
export async function loadOverviews(symbols: string[]): Promise<Record<string, Overview | null>> {
  const unique = [...new Set(symbols)].sort();
  const missing = unique.filter((s) => !cache.has(s) || cache.get(s)!.expires <= Date.now());
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const request = api<Record<string, Overview | null>>(`/api/market/overview?symbols=${encodeURIComponent(batch.join(","))}`);
    for (const symbol of batch) {
      const entry: Entry = { expires: Infinity, value: request.then((map) => {
        entry.expires = Date.now() + TTL;
        return map[symbol] ?? null;
      }) };
      cache.set(symbol, entry);
      entry.value.catch(() => {
        if (cache.get(symbol) === entry) cache.delete(symbol);
      });
    }
  }
  const entries = await Promise.all(unique.map(async (s) => [s, await cache.get(s)!.value] as const));
  return Object.fromEntries(entries);
}
