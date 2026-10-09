import { lastDays, periodReturns } from "./performance";
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

/**
 * Row figures for a watchlist. Pass more than a year of daily closes so the
 * 1Y return has a starting point; the 52-week range uses the last 365 days.
 */
export function summarize(points: PricePoint[]): Overview {
  const byLabel = Object.fromEntries(periodReturns(points).map((r) => [r.label, r.value]));
  const year = lastDays(points, 365).map((p) => p.close);
  return {
    spark: points.slice(-SPARK_DAYS).map((p) => p.close),
    r1m: byLabel["1M"] ?? null,
    r3m: byLabel["3M"] ?? null,
    ytd: byLabel.YTD ?? null,
    r1y: byLabel["1Y"] ?? null,
    high52: year.length ? Math.max(...year) : null,
    low52: year.length ? Math.min(...year) : null,
  };
}
