"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { importHoldings } from "@/lib/client/portfolios";
import { shares, usd } from "@/lib/format";
import type { QuoteSnapshot } from "@/lib/market/types";
import { importCsv, type ImportResult } from "@/lib/portfolio/importCsv";
import { PORTFOLIO_KINDS, type PortfolioKind } from "@/lib/portfolio/types";
import { usePortfolios } from "./Portfolios";
import { ErrorText } from "./ui";

type Props = {
  /** Import into this portfolio; omit to create a new one. */
  portfolioId?: string;
  onDone: (portfolioId: string) => void;
  onCancel: () => void;
};

const PREVIEW_ROWS = 50;

/** Symbols the quote service doesn't recognise get skipped instead of saved as unpriceable rows. */
async function dropUnpriced(result: ImportResult): Promise<ImportResult> {
  const symbols = [...new Set(result.holdings.map((h) => h.symbol))];
  const priced = new Set<string>();
  for (let i = 0; i < symbols.length; i += 50) {
    const batch = symbols.slice(i, i + 50);
    const { quotes } = await api<{ quotes: QuoteSnapshot[] }>(`/api/market/quotes?symbols=${encodeURIComponent(batch.join(","))}`);
    quotes.forEach((q) => priced.add(q.symbol));
  }
  const unpriced = result.holdings.filter((h) => !priced.has(h.symbol));
  return {
    ...result,
    holdings: result.holdings.filter((h) => priced.has(h.symbol)),
    skipped: [...result.skipped, ...[...new Set(unpriced.map((h) => h.symbol))].map((symbol) => ({ line: 0, symbol, reason: "No US price found" }))],
  };
}

function defaultName(fileName: string, format: ImportResult["format"]): string {
  const base = fileName.replace(/\.csv$/i, "").trim();
  if (!base || /^quotes( \(\d+\))?$/i.test(base)) return format === "yahoo" ? "Imported from Yahoo" : "Imported portfolio";
  return base.slice(0, 80);
}

export function ImportCsv({ portfolioId, onDone, onCancel }: Props) {
  const { mutate } = usePortfolios();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PortfolioKind>("holdings");
  const [busy, setBusy] = useState<"reading" | "importing" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    if (file.size > 2_000_000) return setError("That file is over 2 MB. Export a single portfolio instead.");
    setBusy("reading");
    try {
      const parsed = importCsv(await file.text());
      const checked = await dropUnpriced(parsed);
      setResult(checked);
      setName(defaultName(file.name, parsed.format));
      setKind(checked.holdings.length > 0 && checked.holdings.every((h) => h.shares === 0) ? "watchlist" : "holdings");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that file.");
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!result?.holdings.length) return;
    setBusy("importing");
    setError(null);
    try {
      const target = portfolioId ? { portfolioId } : { portfolio: { name: name.trim() || "Imported portfolio", kind } };
      const { id } = await mutate(() => importHoldings(target, result.holdings));
      onDone(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  };

  const symbolCount = result ? new Set(result.holdings.map((h) => h.symbol)).size : 0;

  return (
    <div className="card stack">
      <div className="spread">
        <div className="label" style={{ color: "var(--fg)" }}>Import from CSV</div>
        <button className="btn-text" onClick={onCancel}>Cancel</button>
      </div>
      <p className="serif muted" style={{ margin: 0, fontSize: 17, maxWidth: "64ch" }}>
        In Yahoo Finance, open a portfolio and choose <strong>Export</strong> to download <span className="mono" style={{ fontSize: 14 }}>quotes.csv</span>. Broker files with symbol, quantity, cost and date columns work too.
      </p>
      <label className="field" style={{ maxWidth: 420 }}>
        <span className="label">CSV file</span>
        <input className="input" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} disabled={busy !== null} />
      </label>
      {busy === "reading" && <div className="notice">Reading and checking prices<span className="caret" aria-hidden="true" /></div>}

      {result && (
        <>
          <div className="mono" style={{ fontSize: 13 }}>
            {result.holdings.length} lot{result.holdings.length === 1 ? "" : "s"} across {symbolCount} symbol{symbolCount === 1 ? "" : "s"}
            <span className="faint"> · {result.format === "yahoo" ? "Yahoo Finance export" : "generic CSV"}</span>
            {result.skipped.length > 0 && <span className="faint"> · {result.skipped.length} skipped</span>}
          </div>

          {result.holdings.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 320, overflowY: "auto" }}>
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Symbol</th>
                    <th scope="col">Shares</th>
                    <th scope="col">Cost / share</th>
                    <th scope="col">Bought</th>
                    <th scope="col">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {result.holdings.slice(0, PREVIEW_ROWS).map((h, i) => (
                    <tr key={i}>
                      <td>{h.symbol}</td>
                      <td>{shares(h.shares)}</td>
                      <td>{h.cost_basis ? usd(h.cost_basis) : "—"}</td>
                      <td>{h.bought_at ?? "—"}</td>
                      <td style={{ textAlign: "left", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{h.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.holdings.length > PREVIEW_ROWS && <div className="notice" style={{ padding: 8 }}>…and {result.holdings.length - PREVIEW_ROWS} more</div>}
            </div>
          )}

          {result.skipped.length > 0 && (
            <details>
              <summary className="notice" style={{ cursor: "pointer" }}>Skipped rows ({result.skipped.length})</summary>
              <ul className="mono" style={{ fontSize: 12, color: "var(--fg-2)", margin: "8px 0 0", paddingLeft: 18 }}>
                {result.skipped.map((s, i) => (
                  <li key={i}>{s.line ? `line ${s.line}: ` : ""}{s.symbol || "(blank)"} — {s.reason}</li>
                ))}
              </ul>
            </details>
          )}

          {!portfolioId && result.holdings.length > 0 && (
            <div className="form-grid">
              <label className="field" style={{ gridColumn: "span 2" }}>
                <span className="label">New portfolio name</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              </label>
              <label className="field">
                <span className="label">Type</span>
                <select className="input" value={kind} onChange={(e) => setKind(e.target.value as PortfolioKind)}>
                  {PORTFOLIO_KINDS.filter((k) => k !== "paper").map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
            </div>
          )}

          <div className="row">
            <button className="btn btn-primary" onClick={submit} disabled={busy !== null || result.holdings.length === 0}>
              {busy === "importing" ? "Importing" : `Import ${result.holdings.length} lot${result.holdings.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}
      <ErrorText error={error} />
    </div>
  );
}
