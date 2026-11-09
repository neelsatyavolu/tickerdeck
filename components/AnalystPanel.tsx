"use client";

import { usd } from "@/lib/format";
import type { AnalystTargets, Recommendation } from "@/lib/market/types";

/** Low–high analyst target range with the mean and the current price marked on it. */
export function TargetRange({ targets, price }: { targets: AnalystTargets; price: number | null }) {
  const { low, high, mean } = targets;
  if (low === null || high === null) return <div className="notice">No price target range.</div>;
  const lo = Math.min(low, price ?? low);
  const hi = Math.max(high, price ?? high);
  const at = (v: number) => `${((v - lo) / (hi - lo || 1)) * 100}%`;
  const upside = price && mean ? mean / price - 1 : null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div style={{ position: "relative", height: 36, margin: "8px 6px 0" }} role="img" aria-label={`Analyst targets from ${usd(low)} to ${usd(high)}, mean ${usd(mean)}, current price ${usd(price)}`}>
        <div style={{ position: "absolute", top: 14, height: 8, left: at(low), width: `calc(${at(high)} - ${at(low)})`, background: "var(--accent-wash-2)" }} />
        {mean !== null && <div style={{ position: "absolute", top: 8, height: 20, width: 2, left: at(mean), background: "var(--accent)" }} />}
        {price !== null && (
          <div style={{ position: "absolute", top: 12, width: 12, height: 12, borderRadius: "50%", left: `calc(${at(price)} - 6px)`, background: "var(--fg)", border: "2px solid var(--bg)" }} />
        )}
      </div>
      <div className="spread mono" style={{ fontSize: 12 }}>
        <span className="faint">low {usd(low, { digits: 0 })}</span>
        <span>mean {usd(mean, { digits: 0 })}{upside !== null && <span className="faint"> ({upside >= 0 ? "+" : "−"}{Math.abs(upside * 100).toFixed(1)}% vs price)</span>}</span>
        <span className="faint">high {usd(high, { digits: 0 })}</span>
      </div>
      <div className="legend" aria-hidden="true" style={{ marginTop: 0 }}>
        <span><span className="sw" style={{ background: "var(--fg)", width: 8, borderRadius: "50%" }} />current price</span>
        <span><span className="sw" style={{ background: "var(--accent)", width: 2 }} />mean target</span>
        <span>{targets.analysts ?? "?"} analysts{targets.rating ? ` · consensus ${targets.rating}` : ""}</span>
      </div>
    </div>
  );
}

const RATING_ROWS: { key: keyof Omit<Recommendation, "period">; label: string }[] = [
  { key: "strongBuy", label: "Strong buy" },
  { key: "buy", label: "Buy" },
  { key: "hold", label: "Hold" },
  { key: "sell", label: "Sell" },
  { key: "strongSell", label: "Strong sell" },
];

/** Latest month's rating counts as single-hue bars with the count at the tip. */
export function Ratings({ rec }: { rec: Recommendation }) {
  const max = Math.max(...RATING_ROWS.map((r) => rec[r.key]), 1);
  return (
    <div className="stack" style={{ gap: 6 }}>
      {RATING_ROWS.map((r) => (
        <div key={r.key} style={{ display: "grid", gridTemplateColumns: "92px 1fr", alignItems: "center", gap: 8 }}>
          <span className="mono faint" style={{ fontSize: 12 }}>{r.label}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", height: 12, width: `${(rec[r.key] / max) * 80}%`, minWidth: rec[r.key] ? 2 : 0, background: "var(--fg-3)" }} />
            <span className="num" style={{ fontSize: 12 }}>{rec[r.key]}</span>
          </span>
        </div>
      ))}
      <div className="notice">Ratings as of {rec.period}</div>
    </div>
  );
}
