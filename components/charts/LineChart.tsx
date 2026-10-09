"use client";

import { useState } from "react";
import { nearestIndex, niceTicks, scale, tickLabel } from "@/lib/chart";
import { points as fmtPoints, shortDate, usd } from "@/lib/format";
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
};

const PAD = { top: 12, right: 12, bottom: 24, left: 56 };
const VOLUME_H = 44;

const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** Price/value line with an area wash, crosshair and tooltip; optional overlay and volume. */
export function LineChart({ points, height = 260, label, overlay, showVolume, money = true }: Props) {
  const fmt = (n: number) => (money ? usd(n) : fmtPoints(n));
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) return <div className="notice">Not enough history to chart.</div>;

  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const over = overlay?.points.filter((p) => p.t >= t0 - 40 * 86_400_000 && p.t <= t1) ?? [];
  const hasVolume = Boolean(showVolume && points.some((p) => p.volume));
  const plotBottom = height - PAD.bottom - (hasVolume ? VOLUME_H + 8 : 0);

  const vs = [...points.map((p) => p.v), ...over.map((p) => p.v)];
  const ticks = niceTicks(Math.min(...vs), Math.max(...vs), 4);
  const x = scale(t0, t1, PAD.left, width - PAD.right);
  const y = scale(ticks[0], ticks[ticks.length - 1], plotBottom, PAD.top);
  const xs = points.map((p) => x(p.t));
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

  const maxVol = hasVolume ? Math.max(...points.map((p) => p.volume ?? 0)) : 0;
  const barW = Math.max(1, (width - PAD.left - PAD.right) / points.length - 1);
  const first = points[0];
  const last = points[points.length - 1];
  const h = hover === null ? null : points[hover];
  const hTarget = h ? [...over].reverse().find((p) => p.t <= h.t) : undefined;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(nearestIndex(xs, e.clientX - rect.left));
  };

  return (
    <div>
      <div className="chart" ref={ref}>
        <svg width={width} height={height} role="img" aria-label={`${label}: ${fmt(first.v)} on ${shortDate(first.t)} to ${fmt(last.v)} on ${shortDate(last.t)}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <g className="grid">
            {ticks.map((t) => (
              <line key={t} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            ))}
          </g>
          <g className="axis">
            {ticks.map((t) => (
              <text key={t} x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{tickLabel(t, money)}</text>
            ))}
            <text x={PAD.left} y={height - 6}>{shortDate(first.t)}</text>
            <text x={width - PAD.right} y={height - 6} textAnchor="end">{shortDate(last.t)}</text>
            {hasVolume && <text x={PAD.left - 8} y={plotBottom + 8 + VOLUME_H / 2} dy="0.32em" textAnchor="end">vol</text>}
          </g>
          {hasVolume && (
            <g aria-hidden="true">
              {points.map((p, i) =>
                p.volume ? (
                  <rect key={p.t} x={xs[i] - barW / 2} width={barW} y={height - PAD.bottom - (p.volume / maxVol) * VOLUME_H} height={(p.volume / maxVol) * VOLUME_H} fill={hover === i ? "var(--fg-2)" : "var(--fg-4)"} />
                ) : null,
              )}
            </g>
          )}
          <path d={area} fill="var(--accent-wash)" />
          {overlayPath && <path d={overlayPath} fill="none" stroke="var(--fg-2)" strokeWidth={2} strokeLinejoin="round" />}
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={xs[xs.length - 1]} cy={y(last.v)} r={4} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />
          {h && hover !== null && (
            <g>
              <line x1={xs[hover]} x2={xs[hover]} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--border-strong)" />
              <circle cx={xs[hover]} cy={y(h.v)} r={4} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {h && hover !== null && (
          <div className="tooltip" style={{ left: xs[hover], top: y(h.v) }}>
            <div className="t-label">{shortDate(h.t)}</div>
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
