"use client";

import { niceTicks, scale, tickLabel } from "@/lib/chart";
import { measure } from "@/lib/measure";
import { pct, points as fmtPoints, shortDate, shortTime, usd } from "@/lib/format";
import { span } from "@/lib/market/intraday";
import { useDragMeasure } from "./useDragMeasure";
import { useWidth } from "./useWidth";

export type SeriesPoint = { t: number; v: number; volume?: number };

type Overlay = { label: string; points: { t: number; v: number }[] };

type Props = {
  points: SeriesPoint[];
  height?: number;
  label: string;
  /** Second series drawn as a step line (e.g. the analyst mean target over time). */
  overlay?: Overlay;
  /** Draw a volume strip under the price when points carry volume. */
  showVolume?: boolean;
  /** Dollars (default) or plain points, for indexes. */
  money?: boolean;
  /** Minute bars: space points evenly so nights and weekends take no room, and label them with the time. */
  intraday?: boolean;
};

const PAD = { top: 12, right: 12, bottom: 24, left: 56 };
const VOLUME_H = 44;

const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** Price/value line with an area wash, crosshair and tooltip; optional overlay and volume. */
export function LineChart({ points, height = 260, label, overlay, showVolume, money = true, intraday = false }: Props) {
  const when = intraday ? shortTime : shortDate;
  const fmt = (n: number) => (money ? usd(n) : fmtPoints(n));
  const [ref, width] = useWidth<HTMLDivElement>();
  const enough = points.length >= 2;
  const t0 = enough ? points[0].t : 0;
  const t1 = enough ? points[points.length - 1].t : 1;
  const x = scale(t0, t1, PAD.left, width - PAD.right);
  const byIndex = scale(0, Math.max(1, points.length - 1), PAD.left, width - PAD.right);
  const xs = points.map((p, i) => (intraday ? byIndex(i) : x(p.t)));
  const { hover, anchor, measuring, handlers } = useDragMeasure(xs);

  if (!enough) return <div className="notice">Not enough history to chart.</div>;

  const over = overlay?.points.filter((p) => p.t >= t0 - 40 * 86_400_000 && p.t <= t1) ?? [];
  const hasVolume = Boolean(showVolume && points.some((p) => p.volume));
  const plotBottom = height - PAD.bottom - (hasVolume ? VOLUME_H + 8 : 0);

  const vs = [...points.map((p) => p.v), ...over.map((p) => p.v)];
  const ticks = niceTicks(Math.min(...vs), Math.max(...vs), 4);
  const y = scale(ticks[0], ticks[ticks.length - 1], plotBottom, PAD.top);
  const line = points.map((p, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = `${line}L${xs[xs.length - 1].toFixed(1)},${plotBottom}L${xs[0].toFixed(1)},${plotBottom}Z`;

  // Step line: each target holds until the next one, clipped to the chart.
  let overlayPath = "";
  if (over.length) {
    const steps = over.map((p, i) => {
      const xa = Math.max(PAD.left, x(p.t));
      const xb = i + 1 < over.length ? x(over[i + 1].t) : width - PAD.right;
      return `${i ? "L" : "M"}${xa.toFixed(1)},${y(p.v).toFixed(1)}H${Math.min(xb, width - PAD.right).toFixed(1)}`;
    });
    overlayPath = steps.join("");
  }

  // The opening and closing auctions dwarf every other minute, so minute bars scale to the 98th percentile.
  const volumes = hasVolume ? points.map((p) => p.volume ?? 0).sort((a, b) => a - b) : [];
  const maxVol = hasVolume ? (intraday && volumes[Math.floor(volumes.length * 0.98)]) || volumes[volumes.length - 1] : 0;
  const volH = (v: number) => Math.min(1, v / maxVol) * VOLUME_H;
  const barW = Math.max(1, (width - PAD.left - PAD.right) / points.length - 1);
  const first = points[0];
  const last = points[points.length - 1];
  const h = hover === null ? null : points[hover];
  const hTarget = h ? [...over].reverse().find((p) => p.t <= h.t) : undefined;

  const m = measuring && anchor !== null && hover !== null ? measure(points, anchor, hover) : null;
  const mColor = m && m.change < 0 ? "var(--danger)" : "var(--ok)";

  return (
    <div>
      <div className="chart" ref={ref}>
        <svg width={width} height={height} role="img" aria-label={`${label}: ${fmt(first.v)} on ${when(first.t)} to ${fmt(last.v)} on ${when(last.t)}`} {...handlers} style={{ cursor: "crosshair" }}>
          <g className="grid">
            {ticks.map((t) => (
              <line key={t} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            ))}
          </g>
          <g className="axis">
            {ticks.map((t) => (
              <text key={t} x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{tickLabel(t, money)}</text>
            ))}
            <text x={PAD.left} y={height - 6}>{when(first.t)}</text>
            <text x={width - PAD.right} y={height - 6} textAnchor="end">{when(last.t)}</text>
            {hasVolume && <text x={PAD.left - 8} y={plotBottom + 8 + VOLUME_H / 2} dy="0.32em" textAnchor="end">vol</text>}
          </g>
          {hasVolume && (
            <g aria-hidden="true">
              {points.map((p, i) =>
                p.volume ? (
                  <rect key={p.t} x={xs[i] - barW / 2} width={barW} y={height - PAD.bottom - volH(p.volume)} height={volH(p.volume)} fill={hover === i ? "var(--fg-2)" : "var(--fg-4)"} />
                ) : null,
              )}
            </g>
          )}
          <path d={area} fill="var(--accent-wash)" />
          {overlayPath && <path d={overlayPath} fill="none" stroke="var(--fg-2)" strokeWidth={2} strokeLinejoin="round" />}
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={xs[xs.length - 1]} cy={y(last.v)} r={4} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />
          {m && (
            <g aria-hidden="true">
              <rect x={xs[m.lo]} y={PAD.top} width={Math.max(1, xs[m.hi] - xs[m.lo])} height={plotBottom - PAD.top} fill={mColor} opacity={0.12} />
              {[m.lo, m.hi].map((i) => (
                <g key={i}>
                  <line x1={xs[i]} x2={xs[i]} y1={PAD.top} y2={plotBottom} stroke={mColor} strokeWidth={1} />
                  <circle cx={xs[i]} cy={y(points[i].v)} r={4} fill={mColor} stroke="var(--bg)" strokeWidth={2} />
                </g>
              ))}
            </g>
          )}
          {anchor === null && hover !== null && <div className="chart-hint" aria-hidden="true">drag to measure</div>}
        {!m && h && hover !== null && (
            <g>
              <line x1={xs[hover]} x2={xs[hover]} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--border-strong)" />
              <circle cx={xs[hover]} cy={y(h.v)} r={4} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {m && (
          <div className="tooltip measure-tip" style={{ left: (xs[m.lo] + xs[m.hi]) / 2, top: PAD.top + 4 }} role="status">
            <div className="t-label">{when(m.from.t)} → {when(m.to.t)} · {intraday ? span(m.to.t - m.from.t) : `${m.days} day${m.days === 1 ? "" : "s"}`}</div>
            <div style={{ color: mColor }}>
              {m.change >= 0 ? "+" : "−"}{fmt(Math.abs(m.change))} ({pct(m.pct)})
            </div>
            <div className="t-label">{fmt(m.from.v)} → {fmt(m.to.v)}</div>
          </div>
        )}
        {anchor === null && hover !== null && <div className="chart-hint" aria-hidden="true">drag to measure</div>}
        {!m && h && hover !== null && (
          <div className="tooltip" style={{ left: xs[hover], top: y(h.v) }}>
            <div className="t-label">{when(h.t)}</div>
            <div>{fmt(h.v)}</div>
            {h.volume ? <div className="t-label">vol {compact(h.volume)}</div> : null}
            {hTarget && <div className="t-label">{overlay?.label} {fmt(hTarget.v)}</div>}
          </div>
        )}
      </div>
      {over.length > 0 && (
        <div className="legend" aria-hidden="true">
          <span><span className="sw" style={{ background: "var(--accent)", height: 2 }} />{label}</span>
          <span><span className="sw" style={{ background: "var(--fg-2)", height: 2 }} />{overlay?.label}</span>
        </div>
      )}
    </div>
  );
}
