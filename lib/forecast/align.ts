import type { PricePoint } from "../market/types";

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Closes for each series, restricted to the trading days every series has. */
export function alignCloses(series: PricePoint[][]): number[][] {
  if (series.length === 0) return [];
  const maps = series.map((points) => new Map(points.map((p) => [dayKey(p.t), p.close])));
  const shared = [...maps[0].keys()].filter((day) => maps.every((m) => m.has(day))).sort();
  return maps.map((m) => shared.map((day) => m.get(day)!));
}
