import type { PricePoint } from "./types";

const DAY = 86_400_000;

/** Monday 00:00 UTC of the week containing t (weeks are what the market trades in). */
function weekStart(t: number): number {
  const d = new Date(t);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - daysSinceMonday * DAY;
}

/**
 * Keep daily points from `cutoff` on; before it, keep each week's last close
 * (with the week's total volume). Ten years becomes ~2 years daily + ~8 years
 * weekly: fewer points than 5 years daily, and long charts look the same.
 */
export function weeklyBefore(points: PricePoint[], cutoff: number): PricePoint[] {
  const out: PricePoint[] = [];
  let week: number | null = null;
  for (const p of points) {
    if (p.t >= cutoff) {
      out.push(p);
      continue;
    }
    const w = weekStart(p.t);
    const last = out[out.length - 1];
    if (w === week && last) {
      out[out.length - 1] = { t: p.t, close: p.close, volume: (last.volume ?? 0) + (p.volume ?? 0) || undefined };
    } else {
      out.push(p);
      week = w;
    }
  }
  return out;
}
