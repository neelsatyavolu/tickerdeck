import "server-only";
import * as cnbc from "./cnbc";
import * as coinbase from "./coinbase";
import { isCrypto, searchCrypto } from "./crypto";
import * as finnhub from "./finnhub";
import { isIndex, searchIndexes } from "./indexes";
import * as nasdaq from "./nasdaq";
import * as yahoo from "./yahoo";
import { weeklyBefore } from "./downsample";
import { UpstreamError } from "./http";
import type { AnalystTargets, HistoryRange, PricePoint, QuoteSnapshot, SymbolMatch, TargetPoint } from "./types";

// Which provider answers what (market indexes like ^GSPC always go to CNBC,
// crypto like BTC-USD always to Coinbase):
// - quotes and search: Finnhub first; Nasdaq for what Finnhub's free plan
//   can't price or find (mutual funds).
// - history and analyst targets: Nasdaq first (it works from Vercel), Yahoo as
//   the fallback (it returns 429 to cloud hosts but works from home connections).

const FALLBACK_CONCURRENCY = 4;

export async function quote(symbol: string): Promise<QuoteSnapshot | null> {
  if (isIndex(symbol)) return (await cnbc.quotes([symbol]).catch(() => []))[0] ?? null;
  if (isCrypto(symbol)) return (await coinbase.quotes([symbol]))[0] ?? null;
  return (await finnhub.quote(symbol).catch(() => null)) ?? (await nasdaq.quote(symbol).catch(() => null));
}

export async function quotes(symbols: string[]): Promise<{ quotes: QuoteSnapshot[]; failed: string[] }> {
  const indexes = symbols.filter(isIndex);
  const coins = symbols.filter(isCrypto);
  const [indexQuotes, coinQuotes, rest] = await Promise.all([
    indexes.length ? cnbc.quotes(indexes).catch(() => []) : Promise.resolve([]),
    coinbase.quotes(coins),
    tickerQuotes(symbols.filter((s) => !isIndex(s) && !isCrypto(s))),
  ]);
  const direct = [...indexQuotes, ...coinQuotes];
  const got = new Set(direct.map((q) => q.symbol));
  return { quotes: [...direct, ...rest.quotes], failed: [...[...indexes, ...coins].filter((s) => !got.has(s)), ...rest.failed] };
}

async function tickerQuotes(symbols: string[]): Promise<{ quotes: QuoteSnapshot[]; failed: string[] }> {
  if (symbols.length === 0) return { quotes: [], failed: [] };
  const first = await finnhub.quotes(symbols);
  const retry = first.failed;
  const recovered: QuoteSnapshot[] = [];
  let next = 0;
  async function worker() {
    while (next < retry.length) {
      const q = await nasdaq.quote(retry[next++]).catch(() => null);
      if (q) recovered.push(q);
    }
  }
  await Promise.all(Array.from({ length: Math.min(FALLBACK_CONCURRENCY, retry.length) }, worker));
  const got = new Set(recovered.map((q) => q.symbol));
  return { quotes: [...first.quotes, ...recovered], failed: retry.filter((s) => !got.has(s)) };
}

export async function search(query: string): Promise<SymbolMatch[]> {
  const [a, b] = await Promise.all([finnhub.search(query).catch(() => []), nasdaq.search(query).catch(() => [])]);
  // Indexes and coins first: "dow", "s&p" or "bitcoin" almost always means the index or the coin.
  const direct = [
    ...searchIndexes(query).map((i) => ({ symbol: i.symbol, name: i.name, type: "Index" })),
    ...searchCrypto(query).map((c) => ({ symbol: c.symbol, name: c.name, type: "Crypto" })),
  ];
  return [...direct, ...mergeSearch(query, a, b).filter((m) => !direct.some((d) => d.symbol === m.symbol))].slice(0, 8);
}

/**
 * Exact ticker first, then Finnhub's matches, then Nasdaq's. Nasdaq also
 * matches the query anywhere inside obscure fund tickers, so only keep its
 * results whose ticker starts with the query or whose name contains it.
 */
export function mergeSearch(query: string, finnhubHits: SymbolMatch[], nasdaqHits: SymbolMatch[]): SymbolMatch[] {
  const upper = query.trim().toUpperCase();
  const lower = query.trim().toLowerCase();
  const relevant = nasdaqHits.filter((m) => m.symbol.startsWith(upper) || m.name.toLowerCase().includes(lower));
  const seen = new Set<string>();
  const merged = [...finnhubHits, ...relevant].filter((m) => !seen.has(m.symbol) && Boolean(seen.add(m.symbol)));
  return merged.sort((x, y) => Number(y.symbol === upper) - Number(x.symbol === upper)).slice(0, 8);
}

const DAY = 86_400_000;
const RANGE_DAYS: Record<HistoryRange, number> = { "1mo": 31, "3mo": 92, "6mo": 183, "1y": 366, "2y": 731, "5y": 1827, "10y": 3653 };
const DAILY_DAYS = 731; // older than ~2 years is kept weekly

/** Ten years: daily for the last two, weekly before. Cached via the source adapters. */
async function fullHistory(symbol: string): Promise<PricePoint[]> {
  let full: PricePoint[];
  if (isIndex(symbol)) full = await cnbc.history(symbol);
  else if (isCrypto(symbol)) full = await coinbase.history(symbol);
  else {
    try {
      full = await nasdaq.history(symbol, "10y");
    } catch (first) {
      try {
        full = await yahoo.history(symbol, "10y");
      } catch {
        throw first instanceof UpstreamError ? first : new UpstreamError("nasdaq", 0, `No price history for ${symbol}`);
      }
    }
  }
  if (full.length === 0) return full;
  return weeklyBefore(full, full[full.length - 1].t - DAILY_DAYS * DAY);
}

/**
 * Every range is cut from one cached 10-year series, so a symbol costs one
 * upstream call per hour no matter how many charts and ranges ask for it.
 */
export async function history(symbol: string, range: HistoryRange): Promise<PricePoint[]> {
  const full = await fullHistory(symbol);
  if (range === "10y" || full.length === 0) return full;
  const from = full[full.length - 1].t - RANGE_DAYS[range] * DAY;
  return full.filter((p) => p.t >= from);
}

export async function analystTargets(symbol: string): Promise<{ targets: AnalystTargets; history: TargetPoint[] } | null> {
  const fromNasdaq = await nasdaq.analystTargets(symbol).catch(() => null);
  if (fromNasdaq) return fromNasdaq;
  const fromYahoo = await yahoo.analystTargets(symbol).catch(() => null);
  return fromYahoo ? { targets: fromYahoo, history: [] } : null;
}
