"use client";

import { useEffect, useState } from "react";
import { pct, points, signedUsd, timeAgo, tone } from "@/lib/format";
import { session } from "@/lib/marketHours";
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
export function Change({ amount, percent, money = true }: { amount?: number | null; percent?: number | null; money?: boolean }) {
  const basis = amount ?? percent;
  const signed = (n: number | null) => (money ? signedUsd(n) : n === null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${points(Math.abs(n))}`);
  return (
    <span className={`num ${tone(basis)}`}>
      {amount !== undefined && signed(amount)}
      {amount !== undefined && percent !== undefined && " "}
      {percent !== undefined && (amount !== undefined ? `(${pct(percent)})` : pct(percent))}
    </span>
  );
}

/**
 * Feed status, tied to the market clock: "Live" only during the regular session.
 * Outside it, trades from pre-market or after hours don't count as live.
 */
export function FeedBadge() {
  const { status, lastTrade } = useFeedStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  const s = session(new Date(now));
  const trading = status === "live";

  let text: string;
  let dot = "";
  let title: string;
  if (s === "regular") {
    if (status === "offline") {
      text = "updates every min";
      title = "Live stream disconnected; prices refresh every minute.";
    } else if (trading) {
      text = "live";
      dot = "live";
      title = lastTrade ? `Last trade ${timeAgo(lastTrade)}` : "Streaming trades";
    } else {
      text = status === "connecting" ? "connecting" : "market quiet";
      title = "Connected; no recent trades.";
    }
  } else if ((s === "pre" || s === "after") && trading) {
    text = s === "pre" ? "pre-market" : "after hours";
    title = `Extended-hours trading${lastTrade ? `; last trade ${timeAgo(lastTrade)}` : ""}. Regular session is 9:30 AM–4:00 PM ET.`;
  } else {
    text = "market closed";
    title = "Showing the last prices. Regular session is 9:30 AM–4:00 PM ET, Monday to Friday.";
  }

  return (
    <span className="status" title={title} aria-live="polite">
      <span className={`dot ${dot}`} />
      {text}
      {dot === "live" && <span className="caret" aria-hidden="true" />}
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
