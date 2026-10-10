import "server-only";
import { memo } from "./cache";
import { isCrypto } from "./crypto";
import { fetchJson, UpstreamError } from "./http";
import type { PricePoint, QuoteSnapshot } from "./types";

// Coinbase Exchange's public market-data API, used for crypto (BTC-USD and the
// other pairs in crypto.ts). Official, and needs no key.

const BASE = "https://api.exchange.coinbase.com";
const QUOTE_TTL = 10_000;
const HISTORY_TTL = 60 * 60_000;
const DAY = 86_400_000;
const HISTORY_DAYS = 3653; // ten years, like the other history sources
const PAGE_CANDLES = 300; // the most Coinbase returns per request
const PAGE_CONCURRENCY = 4;
const REQUEST_GAP = 125; // Coinbase allows ten public requests a second per IP

type RawStats = { open?: string; last?: string };

const positive = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Crypto never closes, so "previous close" is the price 24 hours ago. */
export function parseStats(symbol: string, raw: RawStats, now: number): QuoteSnapshot | null {
  const price = positive(raw.last);
  const prevClose = positive(raw.open);
  return price !== null && prevClose !== null ? { symbol, price, prevClose, time: now } : null;
}

/** Daily candles arrive newest first as [time (s), low, high, open, close, volume]. */
export function parseCandles(raw: unknown): PricePoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((row): PricePoint[] => {
      if (!Array.isArray(row)) return [];
      const t = positive(row[0]);
      const close = positive(row[4]);
      const volume = positive(row[5]);
      return t !== null && close !== null ? [{ t: t * 1000, close, volume: volume ?? undefined }] : [];
    })
    .sort((a, b) => a.t - b.t);
}

/**
 * Request windows covering `days` back from `end`, newest first, each within
 * the per-request limit. Daily candles start at UTC midnight, so the windows
 * are snapped to it; otherwise the day between two windows could be missed.
 */
export function candlePages(end: number, days: number): { start: number; end: number }[] {
  const newest = Math.floor(end / DAY) * DAY;
  const oldest = newest - days * DAY;
  const pages: { start: number; end: number }[] = [];
  for (let pageEnd = newest; pageEnd >= oldest; pageEnd -= PAGE_CANDLES * DAY) {
    pages.push({ start: Math.max(oldest, pageEnd - (PAGE_CANDLES - 1) * DAY), end: pageEnd });
  }
  return pages;
}

/**
 * Starts calls at least `gapMs` apart. A board of coins refreshing together,
 * or several ten-year histories on a cold cache, would otherwise trip the
 * rate limit and come back blank.
 */
export function spacer(gapMs: number) {
  let nextStart = 0;
  return <T>(run: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    const start = Math.max(now, nextStart);
    nextStart = start + gapMs;
    if (start === now) return run();
    return new Promise<T>((resolve, reject) => setTimeout(() => run().then(resolve, reject), start - now));
  };
}

const spaced = spacer(REQUEST_GAP);
const get = <T>(path: string) => spaced(() => fetchJson<T>("coinbase", `${BASE}${path}`));

async function quote(symbol: string): Promise<QuoteSnapshot | null> {
  return memo(`cb:quote:${symbol}`, QUOTE_TTL, async () => parseStats(symbol, await get<RawStats>(`/products/${symbol}/stats`), Date.now()));
}

/** Snapshots for the crypto symbols in the list; ones Coinbase can't price are left out. */
export async function quotes(symbols: string[]): Promise<QuoteSnapshot[]> {
  const results = await Promise.all(symbols.filter(isCrypto).map((s) => quote(s).catch(() => null)));
  return results.filter((q): q is QuoteSnapshot => q !== null);
}

/** Up to ten years of daily closes, or as far back as the coin has traded on Coinbase. */
export function history(symbol: string): Promise<PricePoint[]> {
  if (!isCrypto(symbol)) return Promise.reject(new UpstreamError("coinbase", 404, `No price history for ${symbol}`));
  return memo(`cb:history:${symbol}`, HISTORY_TTL, async () => {
    const page = ({ start, end }: { start: number; end: number }) => {
      const qs = new URLSearchParams({ granularity: "86400", start: new Date(start).toISOString(), end: new Date(end).toISOString() });
      return get<unknown>(`/products/${symbol}/candles?${qs}`).then(parseCandles);
    };
    const pages = candlePages(Date.now(), HISTORY_DAYS);
    let points: PricePoint[] = [];
    for (let i = 0; i < pages.length; i += PAGE_CONCURRENCY) {
      const batch = await Promise.all(pages.slice(i, i + PAGE_CONCURRENCY).map(page));
      points = [...points, ...batch.flat()];
      if (batch.some((rows) => rows.length === 0)) break; // older than the coin's listing
    }
    if (points.length === 0) throw new UpstreamError("coinbase", 404, `No price history for ${symbol}`);
    return points.sort((a, b) => a.t - b.t);
  });
}
