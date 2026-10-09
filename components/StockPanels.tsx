"use client";

import Link from "next/link";
import { niceTicks, scale } from "@/lib/chart";
import { pct, plainPct, tone, usd } from "@/lib/format";
import { prefetchStock } from "@/lib/client/prefetch";
import { YAHOO_PAGES, yahooUrl } from "@/lib/links";
import type { PeriodReturn } from "@/lib/market/performance";
import type { EarningsPoint, KeyStats } from "@/lib/market/types";
import { useWidth } from "./charts/useWidth";

const num = (v: number | null, digits = 2) => (v === null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: digits }));
const big = (v: number | null) => (v === null ? "—" : `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v)}`);
const count = (v: number | null) => (v === null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v));

/** Return over each standard window, signed and coloured. */
export function PerformanceStrip({ rows }: { rows: PeriodReturn[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="grid-cells" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }} role="list" aria-label="Price performance">
      {rows.map((r) => (
        <div key={r.label} role="listitem" style={{ padding: "10px 12px" }}>
          <div className="label">{r.label}</div>
          <div className={`num ${tone(r.value)}`} style={{ marginTop: 4, fontSize: 14 }}>{pct(r.value, 1)}</div>
        </div>
      ))}
    </div>
  );
}

/** Where the price sits between the 52-week low and high. */
function RangeBar({ low, high, price }: { low: number | null; high: number | null; price: number | null }) {
  if (low === null || high === null || high <= low) return <>—</>;
  const at = price === null ? null : Math.min(1, Math.max(0, (price - low) / (high - low)));
  return (
    <div>
      <div style={{ position: "relative", height: 8, background: "var(--accent-wash-2)", marginTop: 8 }} role="img" aria-label={`52-week range ${usd(low)} to ${usd(high)}${price !== null ? `, now ${usd(price)}` : ""}`}>
        {at !== null && <div style={{ position: "absolute", top: -3, left: `calc(${at * 100}% - 5px)`, width: 10, height: 14, background: "var(--fg)", border: "2px solid var(--bg)" }} />}
      </div>
      <div className="spread mono faint" style={{ fontSize: 11, marginTop: 4 }}>
        <span>{usd(low)}</span>
        <span>{usd(high)}</span>
      </div>
    </div>
  );
}

export function KeyStatsGrid({ stats, price }: { stats: KeyStats; price: number | null }) {
  // Funds have no company financials; hide the cells that would all be blank.
  const isFund = stats.assetClass === "etf" || stats.assetClass === "mutualfunds";
  const cells: [string, React.ReactNode][] = [
    ["Market cap", big(stats.marketCap)],
    ["P/E (TTM)", num(stats.peTTM, 1)],
    ["EPS (TTM)", stats.epsTTM === null ? "—" : usd(stats.epsTTM)],
    ["PEG", num(stats.pegTTM, 2)],
    ["P/S (TTM)", num(stats.psTTM, 1)],
    ["P/B", num(stats.pb, 1)],
    ["Beta", num(stats.beta, 2)],
    ["Avg volume (10d)", count(stats.avgVolume10d)],
    ["Dividend yield", plainPct(stats.dividendYield, 2)],
    ["Annual dividend", stats.annualDividend === null ? "—" : usd(stats.annualDividend)],
    ["Ex-dividend", stats.exDividendDate ?? "—"],
    ["Debt / equity", num(stats.debtToEquity, 2)],
    ["Gross margin", plainPct(stats.grossMargin, 1)],
    ["Operating margin", plainPct(stats.operatingMargin, 1)],
    ["Net margin", plainPct(stats.netMargin, 1)],
    ["Return on equity", plainPct(stats.roe, 1)],
    ["Revenue growth (YoY)", <span key="rg" className={tone(stats.revenueGrowthYoy)}>{pct(stats.revenueGrowthYoy, 1)}</span>],
    ["EPS growth (YoY)", <span key="eg" className={tone(stats.epsGrowthYoy)}>{pct(stats.epsGrowthYoy, 1)}</span>],
    ["YTD vs S&P 500", <span key="rel" className={tone(stats.relativeToSP500Ytd)}>{pct(stats.relativeToSP500Ytd, 1)}</span>],
  ];
  const shown = isFund ? cells.filter(([, v]) => v !== "—") : cells;
  return (
    <div className="grid-cells cols-4">
      <div style={{ gridColumn: "span 2" }}>
        <div className="label">52-week range</div>
        <RangeBar low={stats.low52} high={stats.high52} price={price} />
      </div>
      {shown.map(([label, value]) => (
        <div key={label}>
          <div className="label">{label}</div>
          <div className="num" style={{ marginTop: 6, fontSize: 15 }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

const E_PAD = { top: 16, right: 16, bottom: 40, left: 48 };

/** Reported EPS against the estimate for recent quarters, with the surprise underneath. */
export function EarningsChart({ rows }: { rows: EarningsPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const usable = rows.filter((r) => r.actual !== null || r.estimate !== null);
  if (usable.length === 0) return <div className="notice">No earnings history.</div>;
  const height = 200;
  const vs = usable.flatMap((r) => [r.actual, r.estimate]).filter((v): v is number => v !== null);
  const ticks = niceTicks(Math.min(...vs), Math.max(...vs), 3);
  const band = (width - E_PAD.left - E_PAD.right) / usable.length;
  const cx = (i: number) => E_PAD.left + band * (i + 0.5);
  const y = scale(ticks[0], ticks[ticks.length - 1], height - E_PAD.bottom, E_PAD.top);
  return (
    <div>
      <div className="chart" ref={ref}>
        <svg width={width} height={height} role="img" aria-label={`Earnings per share, last ${usable.length} quarters, actual versus estimate`}>
          <g className="grid">{ticks.map((t) => <line key={t} x1={E_PAD.left} x2={width - E_PAD.right} y1={y(t)} y2={y(t)} />)}</g>
          <g className="axis">
            {ticks.map((t) => <text key={t} x={E_PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">${t.toFixed(2)}</text>)}
            {usable.map((r, i) => (
              <text key={r.period} x={cx(i)} y={height - 22} textAnchor="middle">{r.period.slice(0, 7)}</text>
            ))}
          </g>
          {usable.map((r, i) => (
            <g key={r.period}>
              {r.estimate !== null && <circle cx={cx(i)} cy={y(r.estimate)} r={6} fill="none" stroke="var(--fg-3)" strokeWidth={2}><title>Estimate {usd(r.estimate)}</title></circle>}
              {r.actual !== null && <circle cx={cx(i)} cy={y(r.actual)} r={5} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2}><title>Actual {usd(r.actual)}</title></circle>}
              {r.surprisePercent !== null && (
                <text x={cx(i)} y={height - 6} textAnchor="middle" className="num" style={{ fontSize: 11, fill: r.surprisePercent >= 0 ? "var(--ok)" : "var(--danger)" }}>
                  {r.surprisePercent >= 0 ? "beat " : "miss "}{pct(r.surprisePercent / 100, 1)}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <div className="legend" aria-hidden="true">
        <span><span className="sw" style={{ background: "var(--accent)", borderRadius: "50%", width: 8 }} />actual EPS</span>
        <span><span className="sw" style={{ border: "2px solid var(--fg-3)", borderRadius: "50%", width: 10, height: 10 }} />estimate</span>
      </div>
    </div>
  );
}

export function YahooLinks({ symbol }: { symbol: string }) {
  return (
    <nav className="row" aria-label={`${symbol} on Yahoo Finance`} style={{ gap: 4 }}>
      {YAHOO_PAGES.map(([label, page]) => (
        <a key={label} className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 13 }} href={yahooUrl(symbol, page)} target="_blank" rel="noopener noreferrer">
          {label} <span aria-hidden="true">↗</span>
        </a>
      ))}
    </nav>
  );
}

export function Peers({ symbols }: { symbols: string[] }) {
  if (symbols.length === 0) return <div className="notice">No peers listed.</div>;
  return (
    <div className="row" style={{ gap: 6 }}>
      {symbols.map((s) => (
        <Link key={s} href={`/s/${encodeURIComponent(s)}`} className="btn btn-ghost mono" style={{ padding: "4px 10px", fontSize: 13 }} onMouseEnter={() => prefetchStock(s)}>{s}</Link>
      ))}
    </div>
  );
}
