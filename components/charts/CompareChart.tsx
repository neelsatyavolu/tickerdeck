"use client";

import { niceTicks, scale } from "@/lib/chart";
import { pct, shortDate, tone } from "@/lib/format";
import type { PricePoint } from "@/lib/market/types";
import { useDragMeasure } from "./useDragMeasure";
import { useWidth } from "./useWidth";

type Series = { symbol: string; points: PricePoint[] };

const PAD = { top: 12, right: 88, bottom: 24, left: 48 };
const MIN_LABEL_GAP = 13;

const colorOf = (i: number) => `var(--series-${(i % 8) + 1})`;

/** % change from the first close in range, per series, on shared dates. */
export function normalize(series: Series[]): { dates: number[]; lines: { symbol: string; values: (number | null)[] }[] } {
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);
  const lines = series.map((s) => {
    const byT = new Map(s.points.map((p) => [p.t, p.close]));
    const base = s.points[0]?.close;
    let last: number | null = null;
    // Carry the last close across another series' extra dates (e.g. weekly vs daily).
    const values = dates.map((t) => {
      const c = byT.get(t);
      if (c !== undefined) last = c;
      return last === null || !base ? null : last / base - 1;
    });
    return { symbol: s.symbol, values };
  });
  return { dates, lines };
}

/** Spread end labels apart vertically so they don't overlap. */
function spreadLabels(ys: { i: number; y: number }[], top: number, bottom: number) {
  const sorted = [...ys].sort((a, b) => a.y - b.y);
  for (let k = 1; k < sorted.length; k++) sorted[k].y = Math.max(sorted[k].y, sorted[k - 1].y + MIN_LABEL_GAP);
  const overflow = sorted.length ? sorted[sorted.length - 1].y - bottom : 0;
  if (overflow > 0) for (const s of sorted) s.y = Math.max(top, s.y - overflow);
  return new Map(sorted.map((s) => [s.i, s.y]));
}

/** Each series' change between two dates, from their values relative to the start. */
export function spanChanges(lines: { symbol: string; values: (number | null)[] }[], lo: number, hi: number) {
  return lines.map((l, i) => {
    const a = l.values[lo];
    const b = l.values[hi];
    return { symbol: l.symbol, i, change: a === null || b === null ? null : (1 + b) / (1 + a) - 1 };
  });
}

export function CompareChart({ series, height = 260 }: { series: Series[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const usable = series.filter((s) => s.points.length > 1);
  const { dates, lines } = normalize(usable);
  const x = scale(dates[0] ?? 0, dates[dates.length - 1] ?? 1, PAD.left, width - PAD.right);
  const xs = dates.map(x);
  const { hover, anchor, measuring, handlers } = useDragMeasure(xs);
  if (usable.length === 0) return <div className="notice">No history to compare.</div>;

  const all = lines.flatMap((l) => l.values.filter((v): v is number => v !== null));
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4);
  const y = scale(ticks[0], ticks[ticks.length - 1], height - PAD.bottom, PAD.top);
  const ends = lines.map((l, i) => ({ i, y: y([...l.values].reverse().find((v) => v !== null) ?? 0) }));
  const labelY = spreadLabels(ends, PAD.top + 4, height - PAD.bottom);

  const path = (values: (number | null)[]) => {
    let d = "";
    let pen = false;
    values.forEach((v, k) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${xs[k].toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const span = measuring && anchor !== null && hover !== null ? { lo: Math.min(anchor, hover), hi: Math.max(anchor, hover) } : null;
  const finals = lines.map((l) => [...l.values].reverse().find((v) => v !== null) ?? null);

  return (
    <div>
      <div className="chart" ref={ref}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Change since ${shortDate(dates[0])}: ${lines.map((l, i) => `${l.symbol} ${pct(finals[i], 1)}`).join(", ")}`}
          {...handlers}
          style={{ cursor: "crosshair" }}
        >
          <g className="grid">
            {ticks.map((t) => <line key={t} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} style={t === 0 ? { stroke: "var(--border-strong)" } : undefined} />)}
          </g>
          <g className="axis">
            {ticks.map((t) => <text key={t} x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{`${t > 0 ? "+" : ""}${Math.round(t * 100)}%`}</text>)}
            <text x={PAD.left} y={height - 6}>{shortDate(dates[0])}</text>
            <text x={width - PAD.right} y={height - 6} textAnchor="end">{shortDate(dates[dates.length - 1])}</text>
          </g>
          {lines.map((l, i) => (
            <path key={l.symbol} d={path(l.values)} fill="none" stroke={colorOf(i)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={hover === null ? 1 : 0.9} />
          ))}
          <g className="axis">
            {lines.map((l, i) => (
              <text key={l.symbol} x={width - PAD.right + 8} y={labelY.get(i)} dy="0.32em" style={{ fill: "var(--fg)" }}>
                <tspan style={{ fill: colorOf(i) }}>■ </tspan>
                {l.symbol} {pct(finals[i], 0)}
              </text>
            ))}
          </g>
          {span && (
            <g aria-hidden="true">
              <rect x={xs[span.lo]} y={PAD.top} width={Math.max(1, xs[span.hi] - xs[span.lo])} height={height - PAD.bottom - PAD.top} fill="var(--fg)" opacity={0.06} />
              <line x1={xs[span.lo]} x2={xs[span.lo]} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--border-strong)" />
              <line x1={xs[span.hi]} x2={xs[span.hi]} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--border-strong)" />
            </g>
          )}
          {!span && hover !== null && <line x1={xs[hover]} x2={xs[hover]} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--border-strong)" />}
        </svg>
        {anchor === null && hover !== null && <div className="chart-hint" aria-hidden="true">drag to measure</div>}
        {span && (
          <div className="tooltip measure-tip" style={{ left: (xs[span.lo] + xs[span.hi]) / 2, top: PAD.top + 4 }} role="status">
            <div className="t-label">{shortDate(dates[span.lo])} → {shortDate(dates[span.hi])}</div>
            {spanChanges(lines, span.lo, span.hi)
              .sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity))
              .map((c) => (
                <div key={c.symbol}>
                  <span style={{ color: colorOf(c.i) }}>■</span> {c.symbol} <span className={tone(c.change)}>{pct(c.change, 1)}</span>
                </div>
              ))}
          </div>
        )}
        {!span && hover !== null && (
          <div className="tooltip" style={{ left: xs[hover], top: PAD.top + 40 }}>
            <div className="t-label">{shortDate(dates[hover])}</div>
            {lines
              .map((l, i) => ({ l, i, v: l.values[hover] }))
              .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity))
              .map(({ l, i, v }) => (
                <div key={l.symbol}>
                  <span style={{ color: colorOf(i) }}>■</span> {l.symbol} {pct(v, 1)}
                </div>
              ))}
          </div>
        )}
      </div>
      <div className="legend" aria-hidden="true">
        {lines.map((l, i) => (
          <span key={l.symbol}><span className="sw" style={{ background: colorOf(i), height: 3 }} />{l.symbol}</span>
        ))}
      </div>
    </div>
  );
}
