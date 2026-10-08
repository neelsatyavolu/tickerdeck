"use client";

import { useEffect, useState } from "react";
import { pct, signedUsd, timeAgo, tone } from "@/lib/format";
import { useFeedStatus } from "./LivePrices";

export function Tile({ label, value, sub, subTone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; subTone?: string }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub !== undefined && <div className={`sub ${subTone ?? ""}`}>{sub}</div>}
    </div>
  );
}

/** "+$12.30 (+1.20%)" coloured by sign; the sign carries meaning without colour. */
export function Change({ amount, percent }: { amount?: number | null; percent?: number | null }) {
  const basis = amount ?? percent;
  return (
    <span className={`num ${tone(basis)}`}>
      {amount !== undefined && signedUsd(amount)}
      {amount !== undefined && percent !== undefined && " "}
      {percent !== undefined && (amount !== undefined ? `(${pct(percent)})` : pct(percent))}
    </span>
  );
}

const STATUS_TEXT = { connecting: "connecting", live: "live", quiet: "market quiet", offline: "updates every min" } as const;

export function FeedBadge() {
  const { status, lastTrade } = useFeedStatus();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  const title =
    status === "offline"
      ? "Live stream disconnected; prices refresh every minute."
      : status === "quiet"
        ? "Connected; no trades recently (market may be closed). Showing last price."
        : lastTrade
          ? `Last trade ${timeAgo(lastTrade)}`
          : undefined;
  return (
    <span className="status" title={title} aria-live="polite">
      <span className={`dot ${status === "live" ? "live" : ""}`} />
      {STATUS_TEXT[status]}
      {status === "live" && <span className="caret" aria-hidden="true" />}
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? <div className="error" role="alert">{error}</div> : null;
}
