"use client";

import { useEffect, useState } from "react";

export type LoadStep = { label: string; done: boolean; blocking?: boolean };

type Props = {
  title: string;
  steps: LoadStep[];
  children: React.ReactNode;
  /** Reveal anyway after this long, so one slow source never blocks the page. */
  maxWaitMs?: number;
};

// Keeps the page laid out (so charts measure their width) but invisible until
// essential steps are done, showing a completion bar meanwhile. Once revealed it
// stays revealed; give it a `key` to run again for a different page.
const HIDDEN: React.CSSProperties = { visibility: "hidden", maxHeight: 0, overflow: "hidden" };

export function PageGate({ title, steps, children, maxWaitMs = 20_000 }: Props) {
  const done = steps.filter((s) => s.done).length;
  const allDone = steps.every((s) => s.blocking === false || s.done);
  const [revealed, setRevealed] = useState(allDone);
  const [timedOut, setTimedOut] = useState(false);
  if (allDone && !revealed) setRevealed(true);

  useEffect(() => {
    if (revealed) return;
    const t = setTimeout(() => setTimedOut(true), maxWaitMs);
    return () => clearTimeout(t);
  }, [maxWaitMs, revealed]);

  const show = revealed || timedOut;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 100;

  return (
    <>
      {!show && (
        <div className="loader" role="progressbar" aria-label={`Loading ${title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="spread">
            <div className="label" style={{ color: "var(--fg)" }}>Loading {title}<span className="caret" aria-hidden="true" /></div>
            <div className="num faint" style={{ fontSize: 12 }}>{pct}%</div>
          </div>
          <div className="loader-track">
            <div className="loader-fill" style={{ width: `${Math.max(pct, 4)}%` }} />
          </div>
          <ul className="loader-steps">
            {steps.map((s) => (
              <li key={s.label} data-done={s.done}>
                <span className={`dot ${s.done ? "live" : ""}`} aria-hidden="true" />
                {s.label}
                <span className="faint">{s.done ? "done" : "…"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div style={show ? undefined : HIDDEN} aria-hidden={!show}>
        {children}
      </div>
    </>
  );
}
