"use client";

import { useState } from "react";
import { addTradingDays, nearestIndex, niceTicks, scale, tickLabel } from "@/lib/chart";
import { points as fmtPoints, shortDate, usd } from "@/lib/format";
import type { Forecast } from "@/lib/forecast/montecarlo";
import type { SeriesPoint } from "./LineChart";
import { useWidth } from "./useWidth";

type Props = { history: SeriesPoint[]; forecast: Forecast; height?: number; money?: boolean };

const PAD = { top: 12, right: 64, bottom: 24, left: 56 };

/** Recent history, then the forecast's 50% and 90% ranges and median fanning out. */
export function FanChart({ history, forecast, height = 260, money = true }: Props) {
  const fmt = (n: number) => (money ? usd(n) : fmtPoints(n));
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [mountedAt] = useState(() => Date.now());

  const t0 = history.length ? history[history.length - 1].t : mountedAt;
  const bands = forecast.bands.map((b) => ({ ...b, t: addTradingDays(t0, b.day) }));
  const allV = [...history.map((p) => p.v), ...bands.flatMap((b) => [b.p5, b.p95])];
  const ticks = niceTicks(Math.min(...allV), Math.max(...allV), 4);
  const tStart = history.length ? history[0].t : t0;
  const tEnd = bands[bands.length - 1].t;
  const x = scale(tStart, tEnd, PAD.left, width - PAD.right);
  const y = scale(ticks[0], ticks[ticks.length - 1], height - PAD.bottom, PAD.top);

  const path = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join("");
  const band = (lo: "p5" | "p25", hi: "p75" | "p95") =>
    path([...bands.map((b) => [x(b.t), y(b[hi])] as [number, number]), ...[...bands].reverse().map((b) => [x(b.t), y(b[lo])] as [number, number])]) + "Z";
  const hist = path(history.map((p) => [x(p.t), y(p.v)]));
  const median = path(bands.map((b) => [x(b.t), y(b.p50)]));
  const bx = bands.map((b) => x(b.t));
  const end = bands[bands.length - 1];
  const h = hover === null ? null : bands[hover];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    setHover(px < bx[0] ? null : nearestIndex(bx, px));
  };

  return (
    <div>
      <div className="chart" ref={ref}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Forecast range: median ${fmt(end.p50)}, 90% range ${fmt(end.p5)} to ${fmt(end.p95)} by ${shortDate(end.t)}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <g className="grid">
            {ticks.map((t) => (
              <line key={t} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            ))}
          </g>
          <g className="axis">
            {ticks.map((t) => (
              <text key={t} x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{tickLabel(t, money)}</text>
            ))}
            {history.length > 1 && <text x={PAD.left} y={height - 6}>{shortDate(tStart)}</text>}
            <text x={x(t0)} y={height - 6} textAnchor={history.length > 1 ? "middle" : "start"}>today</text>
            <text x={width - PAD.right} y={height - 6} textAnchor="end">{shortDate(tEnd)}</text>
          </g>
          <line x1={x(t0)} x2={x(t0)} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--border-strong)" />
          <path d={band("p5", "p95")} fill="var(--accent-wash)" />
          <path d={band("p25", "p75")} fill="var(--accent-wash-2)" />
          {history.length > 1 && <path d={hist} fill="none" stroke="var(--fg-2)" strokeWidth={2} strokeLinejoin="round" />}
          <path d={median} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
          <g className="axis">
            <text x={width - PAD.right + 6} y={y(end.p95)} dy="0.32em">{tickLabel(end.p95, money)}</text>
            <text x={width - PAD.right + 6} y={y(end.p50)} dy="0.32em" style={{ fill: "var(--fg)" }}>{tickLabel(end.p50, money)}</text>
            <text x={width - PAD.right + 6} y={y(end.p5)} dy="0.32em">{tickLabel(end.p5, money)}</text>
          </g>
          {h && hover !== null && <line x1={bx[hover]} x2={bx[hover]} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--border-strong)" />}
        </svg>
        {h && hover !== null && (
          <div className="tooltip" style={{ left: bx[hover], top: y(h.p95) }}>
            <div className="t-label">{shortDate(h.t)} · day {h.day}</div>
            <div>95th {fmt(h.p95)}</div>
            <div>75th {fmt(h.p75)}</div>
            <div>median {fmt(h.p50)}</div>
            <div>25th {fmt(h.p25)}</div>
            <div>5th {fmt(h.p5)}</div>
          </div>
        )}
      </div>
      <div className="legend" aria-hidden="true">
        <span><span className="sw" style={{ background: "var(--fg-2)", height: 2 }} />history</span>
        <span><span className="sw" style={{ background: "var(--accent)", height: 2 }} />median</span>
        <span><span className="sw" style={{ background: "var(--accent-wash-2)" }} />50% of outcomes</span>
        <span><span className="sw" style={{ background: "var(--accent-wash)" }} />90% of outcomes</span>
      </div>
    </div>
  );
}
