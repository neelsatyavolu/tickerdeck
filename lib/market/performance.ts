import type { PricePoint } from "./types";

export type PeriodReturn = { label: string; value: number | null };

const DAY = 86_400_000;
const WINDOWS: [string, number][] = [["1W", 7], ["1M", 30], ["3M", 91], ["6M", 182], ["1Y", 365], ["3Y", 1095], ["5Y", 1826], ["10Y", 3652]];

/** Last close at or before time t (points ascending), or null if t is before the series. */
function closeAt(points: PricePoint[], t: number): number | null {
  let found: number | null = null;
  for (const p of points) {
    if (p.t > t) break;
    found = p.close;
  }
  return found;
}

/**
 * Price return over standard windows, measured from the latest point (or a
 * live price when given). Windows longer than the history are null.
 */
export function periodReturns(points: PricePoint[], livePrice?: number | null): PeriodReturn[] {
  if (points.length < 2) return [];
  const last = points[points.length - 1];
  const now = livePrice ?? last.close;
  const ret = (base: number | null) => (base && base > 0 ? now / base - 1 : null);
  const yearStart = Date.UTC(new Date(last.t).getUTCFullYear(), 0, 1);
  const rows: PeriodReturn[] = WINDOWS.map(([label, days]) => {
    const t = last.t - days * DAY;
    // Weekly closes in older history: allow a week of slack when matching the start.
    return { label, value: t < points[0].t - 7 * DAY ? null : ret(closeAt(points, t)) };
  });
  rows.splice(4, 0, { label: "YTD", value: yearStart <= points[0].t ? null : ret(closeAt(points, yearStart - 1)) });
  return rows;
}

/** Points within the last `days` calendar days of the series. */
export function lastDays(points: PricePoint[], days: number): PricePoint[] {
  if (points.length === 0) return points;
  const from = points[points.length - 1].t - days * DAY;
  return points.filter((p) => p.t >= from);
}
