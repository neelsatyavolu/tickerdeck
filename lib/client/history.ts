"use client";

import { lastDays } from "../market/performance";
import { HISTORY_RANGES, type HistoryRange, type PricePoint } from "../market/types";
import { cachedApi, peekCached, readCached } from "./api";

const DAYS: Record<HistoryRange, number> = { "1mo": 31, "3mo": 92, "6mo": 183, "1y": 366, "2y": 731, "5y": 1827, "10y": 3653 };
const TTL = 10 * 60_000;
const url = (symbol: string, range: HistoryRange) => `/api/market/history?symbol=${encodeURIComponent(symbol)}&range=${range}`;

/** Already-resolved chart data for an immediate revisit or range change. */
export function readHistory(symbol: string, range: HistoryRange): PricePoint[] | undefined {
  for (const r of HISTORY_RANGES) {
    if (DAYS[r] < DAYS[range]) continue;
    const hit = readCached<PricePoint[]>(url(symbol, r));
    if (hit) return r === range ? hit : lastDays(hit, DAYS[range]);
  }
}

/** Fetch only the requested window; reuse a wider cached/in-flight series. */
export function loadHistory(symbol: string, range: HistoryRange): Promise<PricePoint[]> {
  for (const r of HISTORY_RANGES) {
    if (DAYS[r] < DAYS[range]) continue;
    const hit = peekCached<PricePoint[]>(url(symbol, r));
    if (hit) return hit.then((points) => r === range ? points : lastDays(points, DAYS[range]));
  }
  return cachedApi<PricePoint[]>(url(symbol, range), TTL);
}
