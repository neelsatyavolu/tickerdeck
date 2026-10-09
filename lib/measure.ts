/** Change between two points on a series, always measured earlier → later. */
export function measure(points: { t: number; v: number }[], a: number, b: number) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const from = points[lo];
  const to = points[hi];
  const change = to.v - from.v;
  return {
    lo,
    hi,
    from,
    to,
    change,
    pct: from.v ? change / from.v : null,
    days: Math.round((to.t - from.t) / 86_400_000),
  };
}
