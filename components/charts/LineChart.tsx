"use client";

import { useState } from "react";
import { nearestIndex, niceTicks, scale, tickLabel } from "@/lib/chart";
import { shortDate, usd } from "@/lib/format";
import { useWidth } from "./useWidth";

export type SeriesPoint = { t: number; v: number };

type Props = { points: SeriesPoint[]; height?: number; label: string };

const PAD = { top: 12, right: 12, bottom: 24, left: 56 };

/** Single-series price/value line with an area wash, crosshair and tooltip. */
export function LineChart({ points, height = 260, label }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) return <div className="notice">Not enough history to chart.</div>;

  const vs = points.map((p) => p.v);
  const ticks = niceTicks(Math.min(...vs), Math.max(...vs), 4);
  const x = scale(points[0].t, points[points.length - 1].t, PAD.left, width - PAD.right);
  const y = scale(ticks[0], ticks[ticks.length - 1], height - PAD.bottom, PAD.top);
  const xs = points.map((p) => x(p.t));
  const line = points.map((p, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = `${line}L${xs[xs.length - 1].toFixed(1)},${height - PAD.bottom}L${xs[0].toFixed(1)},${height - PAD.bottom}Z`;
  const first = points[0];
  const last = points[points.length - 1];
  const h = hover === null ? null : points[hover];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(nearestIndex(xs, e.clientX - rect.left));
  };

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={`${label}: ${usd(first.v)} on ${shortDate(first.t)} to ${usd(last.v)} on ${shortDate(last.t)}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <g className="grid">
          {ticks.map((t) => (
            <line key={t} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
          ))}
        </g>
        <g className="axis">
          {ticks.map((t) => (
            <text key={t} x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{tickLabel(t)}</text>
          ))}
          <text x={PAD.left} y={height - 6}>{shortDate(first.t)}</text>
          <text x={width - PAD.right} y={height - 6} textAnchor="end">{shortDate(last.t)}</text>
        </g>
        <path d={area} fill="var(--accent-wash)" />
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
          <div>{usd(h.v)}</div>
        </div>
      )}
    </div>
  );
}
