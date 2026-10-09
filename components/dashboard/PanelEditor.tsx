"use client";

import { useState } from "react";
import { usePortfolios } from "@/components/Portfolios";
import { SymbolSearch } from "@/components/SymbolSearch";
import { ErrorText } from "@/components/ui";
import { CHART_RANGES, FORECAST_HORIZONS, newPanelId, PANEL_META, PANEL_TYPES, PANEL_WIDTHS, panelSchema, type Panel, type PanelType } from "@/lib/dashboard/schema";
import { firstIssue } from "@/lib/validation";

const WIDTH_LABEL: Record<number, string> = { 3: "Quarter", 4: "Third", 6: "Half", 8: "Two-thirds", 12: "Full" };

type Props = { initial?: Panel; onSave: (panel: Panel) => void | Promise<void>; onCancel: () => void };

/** Create or edit one panel: type, symbols, size and type-specific options. */
export function PanelEditor({ initial, onSave, onCancel }: Props) {
  const { portfolios } = usePortfolios();
  const [type, setType] = useState<PanelType>(initial?.type ?? "compare");
  const [symbols, setSymbols] = useState<string[]>(initial?.symbols ?? []);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [width, setWidth] = useState<number>(initial?.width ?? PANEL_META[initial?.type ?? "compare"].width);
  const [range, setRange] = useState<string>(initial?.range ?? "1Y");
  const [horizon, setHorizon] = useState<string>(initial?.horizon ?? "3m");
  const [portfolioId, setPortfolioId] = useState(initial?.portfolioId ?? portfolios[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const meta = PANEL_META[type];

  const chooseType = (t: PanelType) => {
    setType(t);
    if (!initial) setWidth(PANEL_META[t].width);
    if (PANEL_META[t].maxSymbols > 0) setSymbols((s) => s.slice(0, PANEL_META[t].maxSymbols));
  };

  const addSymbol = (s: string) => {
    if (!s) return;
    setSymbols((prev) => (prev.includes(s) ? prev : meta.maxSymbols === 1 ? [s] : [...prev, s].slice(0, meta.maxSymbols)));
  };

  const save = async () => {
    const candidate = {
      id: initial?.id ?? newPanelId(),
      type,
      title: title.trim() || undefined,
      symbols: meta.maxSymbols === 0 ? [] : symbols,
      width,
      range: type === "price" || type === "compare" ? range : undefined,
      horizon: type === "forecast" ? horizon : undefined,
      portfolioId: type === "portfolio" ? portfolioId || undefined : undefined,
    };
    const parsed = panelSchema.safeParse(candidate);
    if (!parsed.success) return setError(firstIssue(parsed.error));
    setError(null);
    await onSave(parsed.data);
  };

  return (
    <div className="card stack">
      <div className="label" style={{ color: "var(--fg)" }}>{initial ? "Edit panel" : "Add a panel"}</div>
      <div className="row" style={{ gap: 6 }} role="radiogroup" aria-label="Panel type">
        {PANEL_TYPES.map((t) => (
          <button key={t} type="button" role="radio" aria-checked={t === type} className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 13, ...(t === type ? { background: "var(--fg)", color: "var(--bg)" } : {}) }} onClick={() => chooseType(t)}>
            {PANEL_META[t].label}
          </button>
        ))}
      </div>
      <p className="serif muted" style={{ margin: 0, fontSize: 16 }}>{meta.description}</p>

      {meta.maxSymbols > 0 ? (
        <div className="field">
          <span className="label">Symbols {meta.maxSymbols > 1 ? `(${symbols.length}/${meta.maxSymbols})` : ""}</span>
          <div className="row" style={{ gap: 6 }}>
            {symbols.map((s) => (
              <button key={s} type="button" className="btn btn-ghost mono" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setSymbols((prev) => prev.filter((x) => x !== s))} aria-label={`Remove ${s}`}>
                {s} ×
              </button>
            ))}
            {(symbols.length < meta.maxSymbols || meta.maxSymbols === 1) && <SymbolSearch placeholder={meta.maxSymbols === 1 && symbols.length ? "Replace symbol" : "Add a symbol"} onSelect={addSymbol} width={220} />}
          </div>
        </div>
      ) : (
        <label className="field" style={{ maxWidth: 320 }}>
          <span className="label">Portfolio</span>
          <select className="input" value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)}>
            {portfolios.length === 0 && <option value="">No portfolios yet</option>}
            {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}

      <div className="form-grid">
        <label className="field">
          <span className="label">Title (optional)</span>
          <input className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={meta.label} />
        </label>
        <label className="field">
          <span className="label">Width</span>
          <select className="input" value={width} onChange={(e) => setWidth(Number(e.target.value))}>
            {PANEL_WIDTHS.map((w) => <option key={w} value={w}>{WIDTH_LABEL[w]}</option>)}
          </select>
        </label>
        {(type === "price" || type === "compare") && (
          <label className="field">
            <span className="label">Range</span>
            <select className="input" value={range} onChange={(e) => setRange(e.target.value)}>
              {CHART_RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
        {type === "forecast" && (
          <label className="field">
            <span className="label">Horizon</span>
            <select className="input" value={horizon} onChange={(e) => setHorizon(e.target.value)}>
              {FORECAST_HORIZONS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="row">
        <button type="button" className="btn btn-primary" onClick={save}>{initial ? "Save panel" : "Add panel"}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}
