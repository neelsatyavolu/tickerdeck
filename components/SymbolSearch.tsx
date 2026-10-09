"use client";

import { useEffect, useId, useState } from "react";
import { api } from "@/lib/client/api";
import type { SymbolMatch } from "@/lib/market/types";

type Props = {
  onSelect: (symbol: string, name?: string) => void;
  placeholder?: string;
  initial?: string;
  /** Keep the chosen symbol in the box (forms) instead of clearing it (navigation). */
  keepValue?: boolean;
  width?: number | string;
  inputId?: string;
};

export function SymbolSearch({ onSelect, placeholder = "Search ticker or company", initial = "", keepValue, width, inputId }: Props) {
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<SymbolMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [resultsFor, setResultsFor] = useState("");
  const listId = useId();

  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 1) return;
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const r = await api<SymbolMatch[]>(`/api/market/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        setResults(r);
        setActive(0);
        setResultsFor(term);
      } catch {
        if (!ctrl.signal.aborted) setResults([]);
      }
    }, 200);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [q, open]);

  // Keep the last results visible while the next search is debounced.
  const shown = open && q.trim() && resultsFor ? results : [];

  const choose = (symbol: string, name?: string) => {
    onSelect(symbol, name);
    setQ(keepValue ? symbol : "");
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const match = shown[active];
      const pick = match?.symbol ?? q.trim().toUpperCase();
      if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(pick)) choose(pick, match?.name);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="search-box" style={width ? { width } : undefined}>
      <input
        id={inputId}
        className="input mono"
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          if (keepValue) onSelect("");
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
      />
      {shown.length > 0 && (
        <ul className="search-list" id={listId} role="listbox">
          {shown.map((r, i) => (
            <li key={r.symbol}>
              <button type="button" role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r.symbol, r.name)}>
                <span className="mono" style={{ minWidth: 64 }}>{r.symbol}</span>
                <span className="faint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
