import "server-only";
import * as finnhub from "./finnhub";
import * as nasdaq from "./nasdaq";
import * as yahoo from "./yahoo";
import { UpstreamError } from "./http";
import type { AnalystTargets, HistoryRange, PricePoint, QuoteSnapshot, SymbolMatch, TargetPoint } from "./types";

// Which provider answers what:
// - quotes and search: Finnhub first; Nasdaq for what Finnhub's free plan
//   can't price or find (mutual funds).
// - history and analyst targets: Nasdaq first (it works from Vercel), Yahoo as
//   the fallback (it returns 429 to cloud hosts but works from home connections).

const FALLBACK_CONCURRENCY = 4;

export async function quote(symbol: string): Promise<QuoteSnapshot | null> {
  return (await finnhub.quote(symbol).catch(() => null)) ?? (await nasdaq.quote(symbol).catch(() => null));
}

export async function quotes(symbols: string[]): Promise<{ quotes: QuoteSnapshot[]; failed: string[] }> {
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
  const seen = new Set<string>();
  const merged = [...b, ...a].filter((m) => !seen.has(m.symbol) && seen.add(m.symbol));
  // An exact ticker match goes first.
  const q = query.trim().toUpperCase();
  return merged.sort((x, y) => Number(y.symbol === q) - Number(x.symbol === q)).slice(0, 8);
}

export async function history(symbol: string, range: HistoryRange): Promise<PricePoint[]> {
  try {
    return await nasdaq.history(symbol, range);
  } catch (first) {
    try {
      return await yahoo.history(symbol, range);
    } catch {
      throw first instanceof UpstreamError ? first : new UpstreamError("nasdaq", 0, `No price history for ${symbol}`);
    }
  }
}

export async function analystTargets(symbol: string): Promise<{ targets: AnalystTargets; history: TargetPoint[] } | null> {
  const fromNasdaq = await nasdaq.analystTargets(symbol).catch(() => null);
  if (fromNasdaq) return fromNasdaq;
  const fromYahoo = await yahoo.analystTargets(symbol).catch(() => null);
  return fromYahoo ? { targets: fromYahoo, history: [] } : null;
}
