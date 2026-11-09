"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import { prefetchStock } from "@/lib/client/prefetch";
import { cachedListings, loadListings } from "@/lib/client/symbolIndex";
import { searchCrypto } from "@/lib/market/crypto";
import { searchIndexes } from "@/lib/market/indexes";
import { searchListings, type Listing } from "@/lib/market/symbolSearch";
import type { SymbolMatch } from "@/lib/market/types";

type Props = {
  onSelect: (symbol: string, name?: string) => void;
  placeholder?: string;
  initial?: string;
  /** Keep the chosen symbol in the box (forms) instead of clearing it (navigation). */
  keepValue?: boolean;
  /** Start loading the highlighted result's stock page before it's chosen. */
  prefetch?: boolean;
  width?: number | string;
  inputId?: string;
};

const LIMIT = 8;
const SYMBOL_RE = /^([A-Z][A-Z0-9.-]{0,9}|\^[A-Z0-9]{2,6})$/;

/**
 * Instant search: results come from an in-browser index of every US stock and
 * ETF as you type. Only when that finds little (e.g. mutual funds) does it ask
 * the server, and those results are appended.
 */
export function SymbolSearch({ onSelect, placeholder = "Search ticker or company", initial = "", keepValue, prefetch, width, inputId }: Props) {
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [remote, setRemote] = useState<{ q: string; results: SymbolMatch[] } | null>(null);
  const listId = useId();
  const term = q.trim();

  // Load the index the first time the box is used (instant if stored).
  useEffect(() => {
    if (!open || listings) return;
    let cancelled = false;
    const ready = cachedListings();
    (ready ? Promise.resolve(ready) : loadListings()).then((l) => !cancelled && setListings(l)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, listings]);

  const local = useMemo(() => {
    if (!term) return [];
    const direct = [
      ...searchIndexes(term).map((i) => ({ symbol: i.symbol, name: i.name, type: "Index" })),
      ...searchCrypto(term).map((c) => ({ symbol: c.symbol, name: c.name, type: "Crypto" })),
    ];
    const fromIndex = listings ? searchListings(listings, term, LIMIT) : [];
    return [...direct, ...fromIndex.filter((r) => !direct.some((d) => d.symbol === r.symbol))].slice(0, LIMIT);
  }, [term, listings]);

  // Remote search only fills gaps (funds, or before the index has loaded).
  const needRemote = open && term.length >= 1 && (!listings || local.length < 3);
  useEffect(() => {
    if (!needRemote) return;
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const r = await api<SymbolMatch[]>(`/api/market/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        setRemote({ q: term, results: r });
      } catch {
        /* local results stand */
      }
    }, listings ? 250 : 120);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [needRemote, term, listings]);

  const shown = useMemo(() => {
    if (!open || !term) return [];
    const extra = remote && remote.q === term ? remote.results.filter((r) => !local.some((l) => l.symbol === r.symbol)) : [];
    return [...local, ...extra].slice(0, LIMIT);
  }, [open, term, local, remote]);
  const highlighted = shown[Math.min(active, shown.length - 1)]?.symbol;

  useEffect(() => {
    if (!prefetch || !highlighted) return;
    const t = setTimeout(() => prefetchStock(highlighted), 120);
    return () => clearTimeout(t);
  }, [prefetch, highlighted]);

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
      const match = shown[Math.min(active, shown.length - 1)];
      const pick = match?.symbol ?? term.toUpperCase();
      if (SYMBOL_RE.test(pick)) choose(pick, match?.name);
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
          setActive(0);
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
              <button type="button" role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => prefetch && prefetchStock(r.symbol)} onClick={() => choose(r.symbol, r.name)}>
                <span className="mono" style={{ minWidth: 64 }}>{r.symbol}</span>
                <span className="faint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{r.name}</span>
                {r.type && r.type !== "Stock" && <span className="faint mono" style={{ fontSize: 10, textTransform: "uppercase" }}>{r.type}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
