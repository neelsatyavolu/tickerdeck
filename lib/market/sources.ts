import "server-only";
import * as cnbc from "./cnbc";
import * as finnhub from "./finnhub";
import { isIndex, searchIndexes } from "./indexes";
import * as nasdaq from "./nasdaq";
import * as yahoo from "./yahoo";
import { UpstreamError } from "./http";
import type { AnalystTargets, HistoryRange, PricePoint, QuoteSnapshot, SymbolMatch, TargetPoint } from "./types";

// Which provider answers what (market indexes like ^GSPC always go to CNBC):
// - quotes and search: Finnhub first; Nasdaq for what Finnhub's free plan
//   can't price or find (mutual funds).
// - history and analyst targets: Nasdaq first (it works from Vercel), Yahoo as
//   the fallback (it returns 429 to cloud hosts but works from home connections).

const FALLBACK_CONCURRENCY = 4;

export async function quote(symbol: string): Promise<QuoteSnapshot | null> {
  if (isIndex(symbol)) return (await cnbc.quotes([symbol]).catch(() => []))[0] ?? null;
  return (await finnhub.quote(symbol).catch(() => null)) ?? (await nasdaq.quote(symbol).catch(() => null));
}

export async function quotes(symbols: string[]): Promise<{ quotes: QuoteSnapshot[]; failed: string[] }> {
  const indexes = symbols.filter(isIndex);
  const [indexQuotes, rest] = await Promise.all([
    indexes.length ? cnbc.quotes(indexes).catch(() => []) : Promise.resolve([]),
    tickerQuotes(symbols.filter((s) => !isIndex(s))),
  ]);
  const gotIndex = new Set(indexQuotes.map((q) => q.symbol));
  return { quotes: [...indexQuotes, ...rest.quotes], failed: [...indexes.filter((s) => !gotIndex.has(s)), ...rest.failed] };
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
  const indexes = searchIndexes(query).map((i) => ({ symbol: i.symbol, name: i.name, type: "Index" }));
  // Indexes first: "dow" or "s&p" almost always means the index.
  return [...indexes, ...mergeSearch(query, a, b).filter((m) => !indexes.some((i) => i.symbol === m.symbol))].slice(0, 8);
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

const RANGE_DAYS: Record<HistoryRange, number> = { "1mo": 31, "3mo": 92, "6mo": 183, "1y": 366, "2y": 731, "5y": 1827 };

/**
 * Every range is cut from one cached 5-year series, so a symbol costs one
 * upstream call per hour no matter how many charts and ranges ask for it.
 */
export async function history(symbol: string, range: HistoryRange): Promise<PricePoint[]> {
  let full: PricePoint[];
  if (isIndex(symbol)) {
    full = await cnbc.history(symbol);
    const from = full[full.length - 1].t - RANGE_DAYS[range] * 86_400_000;
    return full.filter((p) => p.t >= from);
  }
  try {
    full = await nasdaq.history(symbol, "5y");
  } catch (first) {
    try {
      full = await yahoo.history(symbol, "5y");
    } catch {
      throw first instanceof UpstreamError ? first : new UpstreamError("nasdaq", 0, `No price history for ${symbol}`);
    }
  }
  if (range === "5y" || full.length === 0) return full;
  const from = full[full.length - 1].t - RANGE_DAYS[range] * 86_400_000;
  return full.filter((p) => p.t >= from);
}

export async function analystTargets(symbol: string): Promise<{ targets: AnalystTargets; history: TargetPoint[] } | null> {
  const fromNasdaq = await nasdaq.analystTargets(symbol).catch(() => null);
  if (fromNasdaq) return fromNasdaq;
  const fromYahoo = await yahoo.analystTargets(symbol).catch(() => null);
  return fromYahoo ? { targets: fromYahoo, history: [] } : null;
}
