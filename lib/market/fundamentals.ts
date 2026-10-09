import "server-only";
import { metrics } from "./finnhub";
import { indexInfo } from "./indexes";
import { summary } from "./nasdaq";
import { history, quotes } from "./sources";
import { buildKeyStats, withHistoryVolume } from "./stats";

/** One row of a "stock look-up" table. */
export type Fundamentals = {
  symbol: string;
  name: string | null;
  exchange: string | null;
  price: number | null;
  prevClose: number | null;
  low52: number | null;
  high52: number | null;
  volume: number | null;
  avgVolume: number | null;
  annualDividend: number | null;
  dividendYield: number | null;
  peTTM: number | null;
};

const CONCURRENCY = 6;

export async function fundamentals(symbols: string[]): Promise<Fundamentals[]> {
  const { quotes: snap } = await quotes(symbols).catch(() => ({ quotes: [] as { symbol: string; price: number; prevClose: number }[] }));
  const price = new Map(snap.map((q) => [q.symbol, q]));
  const rows = new Map<string, Fundamentals>();
  let next = 0;
  async function worker() {
    while (next < symbols.length) {
      const symbol = symbols[next++];
      const q = price.get(symbol);
      const index = indexInfo(symbol);
      const [m, s, hist] = index
        ? [null, null, null]
        : await Promise.all([metrics(symbol).catch(() => null), summary(symbol).catch(() => null), history(symbol, "3mo").catch(() => null)]);
      const st = withHistoryVolume(buildKeyStats(m ?? {}, s), hist);
      rows.set(symbol, {
        symbol,
        name: index?.name ?? st.name,
        exchange: index ? "Index" : st.exchange,
        price: q?.price ?? null,
        prevClose: q?.prevClose ?? null,
        low52: st.low52,
        high52: st.high52,
        volume: st.volume,
        avgVolume: st.avgVolume ?? st.avgVolume10d,
        annualDividend: st.annualDividend,
        dividendYield: st.dividendYield,
        peTTM: st.peTTM,
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, worker));
  return symbols.map((s) => rows.get(s)!).filter(Boolean);
}
