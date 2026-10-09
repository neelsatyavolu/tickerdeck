import { periodReturns } from "./performance";
import type { PricePoint } from "./types";

export type Overview = {
  /** Last ~3 months of closes, for a sparkline. */
  spark: number[];
  r1m: number | null;
  r3m: number | null;
  ytd: number | null;
  r1y: number | null;
  high52: number | null;
  low52: number | null;
};

const SPARK_DAYS = 63;

/** Row figures for a watchlist from a year of daily closes. */
export function summarize(points: PricePoint[]): Overview {
  const byLabel = Object.fromEntries(periodReturns(points).map((r) => [r.label, r.value]));
  const closes = points.map((p) => p.close);
  return {
    spark: closes.slice(-SPARK_DAYS),
    r1m: byLabel["1M"] ?? null,
    r3m: byLabel["3M"] ?? null,
    ytd: byLabel.YTD ?? null,
    r1y: byLabel["1Y"] ?? null,
    high52: closes.length ? Math.max(...closes) : null,
    low52: closes.length ? Math.min(...closes) : null,
  };
}
