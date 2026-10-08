"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { todayIso } from "@/lib/format";
import type { QuoteSnapshot } from "@/lib/market/types";
import type { Holding, PortfolioKind } from "@/lib/portfolio/types";
import { firstIssue, holdingInputSchema } from "@/lib/validation";
import { SymbolSearch } from "./SymbolSearch";
import { ErrorText } from "./ui";

type Props = {
  kind: PortfolioKind;
  initial?: Holding;
  fixedSymbol?: string;
  submitLabel: string;
  onSubmit: (values: ReturnType<typeof holdingInputSchema.parse>) => Promise<void>;
  onCancel?: () => void;
};

/** Add or edit one lot. Cost defaults to the current price for new lots. */
export function HoldingForm({ kind, initial, fixedSymbol, submitLabel, onSubmit, onCancel }: Props) {
  const [symbol, setSymbol] = useState(initial?.symbol ?? fixedSymbol ?? "");
  const [sharesText, setShares] = useState(initial?.shares?.toString() ?? (kind === "watchlist" ? "0" : ""));
  const [cost, setCost] = useState(initial?.cost_basis?.toString() ?? "");
  const [boughtAt, setBoughtAt] = useState(initial?.bought_at ?? (kind === "watchlist" ? "" : todayIso()));
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costTouched, setCostTouched] = useState(Boolean(initial));
  // Bumped after each add so the symbol box remounts empty.
  const [resetCount, setResetCount] = useState(0);

  // Prefill the cost with today's price when a symbol is picked.
  useEffect(() => {
    if (!symbol || costTouched) return;
    let cancelled = false;
    api<{ quotes: QuoteSnapshot[] }>(`/api/market/quotes?symbols=${encodeURIComponent(symbol)}`)
      .then(({ quotes }) => {
        if (!cancelled && quotes[0]) setCost(quotes[0].price.toFixed(2));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [symbol, costTouched]);

  const submit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = holdingInputSchema.safeParse({
      symbol,
      shares: sharesText || 0,
      cost_basis: cost || 0,
      bought_at: boughtAt || null,
      note: note.trim() || null,
    });
    if (!parsed.success) return setError(firstIssue(parsed.error));
    setBusy(true);
    setError(null);
    try {
      await onSubmit(parsed.data);
      if (!initial) {
        setSymbol(fixedSymbol ?? "");
        setShares(kind === "watchlist" ? "0" : "");
        setCost("");
        setNote("");
        setCostTouched(false);
        setResetCount((n) => n + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        {!initial && !fixedSymbol && (
          <div className="field">
            <label className="label" htmlFor="holding-symbol">Symbol</label>
            <SymbolSearch key={resetCount} inputId="holding-symbol" keepValue width="100%" placeholder="AAPL" onSelect={(s) => setSymbol(s)} />
          </div>
        )}
        <label className="field">
          <span className="label">Shares</span>
          <input className="input num" inputMode="decimal" value={sharesText} onChange={(e) => setShares(e.target.value)} placeholder="10" />
        </label>
        <label className="field">
          <span className="label">Cost / share</span>
          <input className="input num" inputMode="decimal" value={cost} onChange={(e) => { setCost(e.target.value); setCostTouched(true); }} placeholder="0.00" />
        </label>
        <label className="field">
          <span className="label">Bought</span>
          <input className="input num" type="date" value={boughtAt} onChange={(e) => setBoughtAt(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Note</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </label>
      </div>
      <div className="row">
        <button className="btn btn-primary" disabled={busy || !symbol}>{busy ? "Saving" : submitLabel}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
      <ErrorText error={error} />
    </form>
  );
}
