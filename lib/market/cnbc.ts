import "server-only";
import { memo } from "./cache";
import { fetchJson, UpstreamError } from "./http";
import { indexInfo } from "./indexes";
import type { PricePoint, QuoteSnapshot } from "./types";

// CNBC's public quote and chart feeds, used for market indexes (the S&P 500
// and Dow aren't on Finnhub's free plan or Nasdaq's API). Unofficial.

const HEADERS = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" };
// Index levels on CNBC move every 10 to 15 seconds; browsers ask every 5.
const QUOTE_TTL = 5_000;
const HISTORY_TTL = 60 * 60_000;
const BARS_TTL = 30_000;
const DAY = 86_400_000;

type RawQuote = { symbol: string; last?: string; previous_day_closing?: string; last_time?: string };
type RawQuotes = { FormattedQuoteResult?: { FormattedQuote?: RawQuote[] } };

const num = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(/[,%+\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** CNBC quotes keyed by CNBC symbol (".SPX" → snapshot). */
export function parseQuotes(raw: RawQuotes, cnbcToSymbol: Map<string, string>): QuoteSnapshot[] {
  const out: QuoteSnapshot[] = [];
  for (const q of raw.FormattedQuoteResult?.FormattedQuote ?? []) {
    const symbol = cnbcToSymbol.get(q.symbol);
    const price = num(q.last);
    const prevClose = num(q.previous_day_closing);
    const time = q.last_time ? Date.parse(q.last_time.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : NaN;
    if (symbol && price !== null && prevClose !== null) out.push({ symbol, price, prevClose, time: Number.isFinite(time) ? time : Date.now() });
  }
  return out;
}

type RawBars = { barData?: { priceBars?: { close: string; volume?: number; tradeTimeinMills: number }[] } };

export function parseBars(raw: RawBars): PricePoint[] {
  return (raw.barData?.priceBars ?? [])
    .map((b) => ({ t: b.tradeTimeinMills, close: Number(b.close), volume: b.volume || undefined }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.close) && p.close > 0)
    .sort((a, b) => a.t - b.t);
}

/** Weekly bars before the first daily bar, then the daily bars. */
export function stitch(daily: PricePoint[], weekly: PricePoint[]): PricePoint[] {
  if (daily.length === 0) return weekly;
  return [...weekly.filter((p) => p.t < daily[0].t), ...daily];
}

export async function quotes(symbols: string[]): Promise<QuoteSnapshot[]> {
  const known = symbols.map((s) => [s, indexInfo(s)?.cnbc] as const).filter((x): x is readonly [string, string] => Boolean(x[1]));
  if (known.length === 0) return [];
  const key = known.map(([, c]) => c).sort().join("|");
  return memo(`cnbc:quotes:${key}`, QUOTE_TTL, async () => {
    const qs = new URLSearchParams({ symbols: key, requestMethod: "itv", noform: "1", partnerId: "2", fund: "1", exthrs: "1", output: "json" });
    const raw = await fetchJson<RawQuotes>("cnbc", `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?${qs}`, { headers: HEADERS });
    return parseQuotes(raw, new Map(known.map(([s, c]) => [c, s])));
  });
}

/** One- or five-minute bars, extended hours included, for a CNBC symbol (".SPX", "AAPL"). */
export function intraday(cnbcSymbol: string, minutes: 1 | 5, lookbackDays: number): Promise<PricePoint[]> {
  return memo(`cnbc:bars:${cnbcSymbol}:${minutes}:${lookbackDays}`, BARS_TTL, async () => {
    const stamp = (t: number) => new Date(t).toISOString().replace(/\D/g, "").slice(0, 14);
    const now = Date.now();
    const url = `https://ts-api.cnbc.com/harmony/app/bars/${encodeURIComponent(cnbcSymbol)}/${minutes}M/${stamp(now - lookbackDays * DAY)}/${stamp(now + DAY)}/adjusted/EST5EDT.json`;
    return parseBars(await fetchJson<RawBars>("cnbc", url, { headers: HEADERS }));
  });
}

/** About two years of daily closes plus weekly closes back ten years. */
export function history(symbol: string): Promise<PricePoint[]> {
  const cnbc = indexInfo(symbol)?.cnbc;
  if (!cnbc) return Promise.reject(new UpstreamError("cnbc", 404, `No price history for ${symbol}`));
  return memo(`cnbc:history:${cnbc}`, HISTORY_TTL, async () => {
    const url = (tf: string) => `https://ts-api.cnbc.com/harmony/app/charts/${tf}.json?symbol=${encodeURIComponent(cnbc)}`;
    const [daily, weekly] = await Promise.all([
      fetchJson<RawBars>("cnbc", url("1Y"), { headers: HEADERS }).then(parseBars),
      fetchJson<RawBars>("cnbc", url("5Y"), { headers: HEADERS }).then(parseBars, () => []),
    ]);
    const points = stitch(daily, weekly);
    if (points.length === 0) throw new UpstreamError("cnbc", 404, `No price history for ${symbol}`);
    return points;
  });
}
