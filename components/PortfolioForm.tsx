"use client";

import { useState } from "react";
import { PORTFOLIO_KINDS, type Portfolio, type PortfolioKind } from "@/lib/portfolio/types";
import { firstIssue, portfolioInputSchema } from "@/lib/validation";
import { todayIso } from "@/lib/format";
import { ErrorText } from "./ui";

const KIND_HELP: Record<PortfolioKind, string> = {
  holdings: "What you actually own: shares and cost basis.",
  watchlist: "Symbols to follow. Shares are optional.",
  paper: "A what-if basket with starting cash and a start date.",
};

type Props = {
  initial?: Pick<Portfolio, "name" | "kind" | "starting_cash" | "start_date">;
  submitLabel: string;
  onSubmit: (values: ReturnType<typeof portfolioInputSchema.parse>) => Promise<void>;
  onCancel?: () => void;
};

export function PortfolioForm({ initial, submitLabel, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<PortfolioKind>(initial?.kind ?? "holdings");
  const [cash, setCash] = useState(initial?.starting_cash?.toString() ?? "10000");
  const [start, setStart] = useState(initial?.start_date ?? todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = portfolioInputSchema.safeParse({
      name,
      kind,
      starting_cash: kind === "paper" && cash ? cash : null,
      start_date: kind === "paper" && start ? start : null,
    });
    if (!parsed.success) return setError(firstIssue(parsed.error));
    setBusy(true);
    setError(null);
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <div className="form-grid">
        <label className="field" style={{ gridColumn: "span 2" }}>
          <span className="label">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
        </label>
        <label className="field">
          <span className="label">Type</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as PortfolioKind)}>
            {PORTFOLIO_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        {kind === "paper" && (
          <>
            <label className="field">
              <span className="label">Starting cash</span>
              <input className="input num" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Start date</span>
              <input className="input num" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
          </>
        )}
      </div>
      <div className="notice">{KIND_HELP[kind]}</div>
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Saving" : submitLabel}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
      <ErrorText error={error} />
    </form>
  );
}
