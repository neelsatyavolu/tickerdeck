import type { PricePoint } from "../market/types";

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * What today's holdings would have been worth on each past trading day:
 * Σ shares × close, over the days every symbol has a price.
 */
export function holdingsValueSeries(history: Record<string, PricePoint[]>, shares: Record<string, number>): { t: number; v: number }[] {
  const symbols = Object.keys(shares).filter((s) => shares[s] > 0 && history[s]?.length);
  if (symbols.length === 0) return [];
  const maps = symbols.map((s) => new Map(history[s].map((p) => [dayKey(p.t), p])));
  const days = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d))).sort();
  return days.map((d) => ({
    t: maps[0].get(d)!.t,
    v: symbols.reduce((sum, s, i) => sum + shares[s] * maps[i].get(d)!.close, 0),
  }));
}
