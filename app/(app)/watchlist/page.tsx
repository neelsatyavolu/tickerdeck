"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Sparkline } from "@/components/charts/Sparkline";
import { useLivePrices } from "@/components/LivePrices";
import { PageGate } from "@/components/PageGate";
import { SymbolSearch } from "@/components/SymbolSearch";
import { ErrorText } from "@/components/ui";
import { useWatchlist } from "@/components/Watchlist";
import { cachedApi } from "@/lib/client/api";
import { pct, tone, usd } from "@/lib/format";
import { yahooUrl } from "@/lib/links";
import { INDEXES } from "@/lib/market/indexes";
import type { Overview } from "@/lib/market/overview";

type SortKey = "added" | "symbol" | "price" | "day" | "r1m" | "r3m" | "ytd" | "r1y" | "range";
type Row = {
  symbol: string;
  name: string | null;
  added: string;
  price: number | null;
  day: number | null;
  r1m: number | null;
  r3m: number | null;
  ytd: number | null;
  r1y: number | null;
  range: number | null; // 0 = at 52-week low, 1 = at the high
  overview: Overview | null;
};

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "price", label: "Price" },
  { key: "day", label: "Today" },
  { key: "r1m", label: "1M" },
  { key: "r3m", label: "3M" },
  { key: "ytd", label: "YTD" },
  { key: "r1y", label: "1Y" },
  { key: "range", label: "52-wk range" },
];

function useOverviews(symbols: string[]) {
  const key = [...symbols].sort().join(",");
  const [data, setData] = useState<{ key: string; map: Record<string, Overview | null> } | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    cachedApi<Record<string, Overview | null>>(`/api/market/overview?symbols=${encodeURIComponent(key)}`, 5 * 60_000)
      .then((map) => !cancelled && setData((prev) => ({ key, map: { ...(prev?.map ?? {}), ...map } })))
      .catch(() => !cancelled && setData((prev) => ({ key, map: prev?.map ?? {} })));
    return () => {
      cancelled = true;
    };
  }, [key]);
  return { map: data?.map ?? {}, ready: !key || data?.key === key };
}

function RangeCell({ low, high, price }: { low: number | null; high: number | null; price: number | null }) {
  if (low === null || high === null || price === null || high <= low) return <span className="faint">—</span>;
  const at = Math.min(1, Math.max(0, (price - low) / (high - low)));
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title={`${usd(low)} – ${usd(high)}`}>
      <span className="faint" style={{ fontSize: 11 }}>{usd(low, { digits: 0 })}</span>
      <span style={{ position: "relative", width: 64, height: 6, background: "var(--accent-wash-2)", display: "inline-block" }} aria-label={`${Math.round(at * 100)}% of the way from the 52-week low to the high`} role="img">
        <span style={{ position: "absolute", top: -3, left: `calc(${at * 100}% - 3px)`, width: 6, height: 12, background: "var(--fg)" }} />
      </span>
      <span className="faint" style={{ fontSize: 11 }}>{usd(high, { digits: 0 })}</span>
    </span>
  );
}

export default function WatchlistPage() {
  const { items, loading, error, add, remove } = useWatchlist();
  const symbols = useMemo(() => items.map((i) => i.symbol), [items]);
  const { prices, checked } = useLivePrices(symbols);
  const { map: overviews, ready: overviewsReady } = useOverviews(symbols);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "added", desc: false });
  const [actionError, setActionError] = useState<string | null>(null);

  const rows: Row[] = useMemo(
    () =>
      items.map((i) => {
        const live = prices[i.symbol];
        const o = overviews[i.symbol] ?? null;
        const price = live?.price ?? o?.spark.at(-1) ?? null;
        return {
          symbol: i.symbol,
          name: i.name,
          added: i.added_at,
          price,
          day: live && live.prevClose ? live.price / live.prevClose - 1 : null,
          r1m: o?.r1m ?? null,
          r3m: o?.r3m ?? null,
          ytd: o?.ytd ?? null,
          r1y: o?.r1y ?? null,
          range: o && price !== null && o.high52 !== null && o.low52 !== null && o.high52 > o.low52 ? (price - o.low52) / (o.high52 - o.low52) : null,
          overview: o,
        };
      }),
    [items, prices, overviews],
  );

  const sorted = useMemo(() => {
    const dir = sort.desc ? -1 : 1;
    return [...rows].sort((a, b) => {
      if (sort.key === "added") return dir * a.added.localeCompare(b.added);
      if (sort.key === "symbol") return dir * a.symbol.localeCompare(b.symbol);
      const x = a[sort.key];
      const y = b[sort.key];
      if (x === null) return 1; // blanks last either way
      if (y === null) return -1;
      return dir * (x - y);
    });
  }, [rows, sort]);

  const setSortKey = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "symbol" }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.desc ? " ↓" : " ↑") : "");

  const steps = [
    { label: "Watchlist", done: !loading },
    { label: "Live prices", done: !loading && symbols.every((s) => prices[s] || checked[s]) },
    { label: "Trends and returns", done: !loading && overviewsReady },
  ];

  const onAdd = async (symbol: string, name?: string) => {
    if (!symbol) return;
    setActionError(null);
    try {
      await add(symbol, name);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't add that symbol.");
    }
  };

  const onRemove = async (symbol: string) => {
    setActionError(null);
    try {
      await remove(symbol);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't remove that symbol.");
    }
  };

  return (
    <PageGate title="watchlist" steps={steps}>
      <div className="spread">
        <div>
          <div className="label">{items.length} symbol{items.length === 1 ? "" : "s"}</div>
          <h1 className="display" style={{ marginTop: 8 }}>Watchlist</h1>
        </div>
        <SymbolSearch placeholder="Add a ticker or company" onSelect={onAdd} width={280} />
      </div>
      <ErrorText error={error ?? actionError} />

      {INDEXES.some((i) => !items.some((w) => w.symbol === i.symbol)) && (
        <div className="row" style={{ marginTop: 16, gap: 6 }} aria-label="Add a market index">
          <span className="label" style={{ marginRight: 4 }}>Indexes</span>
          {INDEXES.filter((i) => !items.some((w) => w.symbol === i.symbol)).map((i) => (
            <button key={i.symbol} className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => onAdd(i.symbol, i.name)}>
              + {i.name}
            </button>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty" style={{ marginTop: 24 }}>
          <p>Follow stocks, ETFs and funds without holding them. Add one with the box above, or press Watch on any stock page.</p>
        </div>
      ) : (
        <div className="table-wrap" style={{ marginTop: 24 }}>
          <table className="data">
            <thead>
              <tr>
                <th scope="col" aria-sort={sort.key === "symbol" ? (sort.desc ? "descending" : "ascending") : "none"}>
                  <button className="btn-text" style={{ padding: 0, font: "inherit", color: "inherit", letterSpacing: "inherit", textTransform: "inherit" }} onClick={() => setSortKey("symbol")}>Symbol{arrow("symbol")}</button>
                </th>
                <th scope="col">3M trend</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}>
                    <button className="btn-text" style={{ padding: 0, font: "inherit", color: "inherit", letterSpacing: "inherit", textTransform: "inherit" }} onClick={() => setSortKey(c.key)}>{c.label}{arrow(c.key)}</button>
                  </th>
                ))}
                <th scope="col"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.symbol}>
                  <td style={{ whiteSpace: "normal", minWidth: 160 }}>
                    <Link href={`/s/${encodeURIComponent(r.symbol)}`} style={{ fontWeight: 500 }}>{r.symbol}</Link>
                    <a href={yahooUrl(r.symbol)} target="_blank" rel="noopener noreferrer" className="faint" style={{ marginLeft: 6, fontSize: 12 }} aria-label={`${r.symbol} on Yahoo Finance`} title="Yahoo Finance">↗</a>
                    {r.name && <div className="faint" style={{ fontFamily: "var(--sans)", fontSize: 12, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>}
                  </td>
                  <td>
                    <Sparkline values={r.overview?.spark ?? []} label={`${r.symbol} over 3 months: ${pct(r.r3m, 1)}`} />
                  </td>
                  <td>{usd(r.price)}</td>
                  <td className={tone(r.day)}>{pct(r.day)}</td>
                  <td className={tone(r.r1m)}>{pct(r.r1m, 1)}</td>
                  <td className={tone(r.r3m)}>{pct(r.r3m, 1)}</td>
                  <td className={tone(r.ytd)}>{pct(r.ytd, 1)}</td>
                  <td className={tone(r.r1y)}>{pct(r.r1y, 1)}</td>
                  <td><RangeCell low={r.overview?.low52 ?? null} high={r.overview?.high52 ?? null} price={r.price} /></td>
                  <td>
                    <button className="btn-text danger" onClick={() => onRemove(r.symbol)} aria-label={`Stop watching ${r.symbol}`}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="notice" style={{ marginTop: 12 }}>Returns and the 52-week range come from daily closes; Today uses the live price.</p>
    </PageGate>
  );
}
