"use client";
import { cachedApi } from "./api";

const STOCK_TTL = 2 * 60_000;
const HISTORY_TTL = 10 * 60_000;
const recent = new Map<string, number>();

/**
 * Warm the browser cache for a stock page (details + 5-year history) before
 * the user clicks, e.g. while a search result is highlighted or a link is
 * hovered. Uses the same URLs and TTLs as the page, so the page reuses them.
 */
export function prefetchStock(symbol: string): void {
  if (!symbol) return;
  const now = Date.now();
  if ((recent.get(symbol) ?? 0) > now - 30_000) return;
  recent.set(symbol, now);
  const enc = encodeURIComponent(symbol);
  cachedApi(`/api/market/stock/${enc}`, STOCK_TTL).catch(() => {});
  cachedApi(`/api/market/history?symbol=${enc}&range=5y`, HISTORY_TTL).catch(() => {});
}
