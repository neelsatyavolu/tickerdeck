"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Sparkline } from "@/components/charts/Sparkline";
import { useLivePrices } from "@/components/LivePrices";
import { PageGate } from "@/components/PageGate";
import { SymbolSearch } from "@/components/SymbolSearch";
import { FundamentalsTable } from "@/components/FundamentalsTable";
import { ErrorText, Seg } from "@/components/ui";
import { useOverviews } from "@/components/useOverviews";
import { useWatchlist } from "@/components/Watchlist";
import { prefetchStock } from "@/lib/client/prefetch";
import { pct, priceOf, tone } from "@/lib/format";
import { yahooUrl } from "@/lib/links";
import { INDEXES } from "@/lib/market/indexes";
import { moveItem } from "@/lib/reorder";
import type { Overview } from "@/lib/market/overview";

type SortKey = "custom" | "symbol" | "price" | "day" | "r1m" | "r3m" | "ytd" | "r1y" | "range";
type Row = {
  symbol: string;
  name: string | null;
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

function RangeCell({ symbol, low, high, price }: { symbol: string; low: number | null; high: number | null; price: number | null }) {
  const usd = (n: number, o?: { digits?: number }) => priceOf(symbol, n, o?.digits);
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

const VIEWS = ["Performance", "Fundamentals"] as const;

function WatchlistView() {
  const { lists, primary, loading, error, add, remove, reorder, createList, renameList, deleteList } = useWatchlist();
  const params = useSearchParams();
  const router = useRouter();
  const active = lists.find((l) => l.id === params.get("list")) ?? primary;
  const items = useMemo(() => active?.items ?? [], [active]);
  const listId = active?.id;
  const [creating, setCreating] = useState<string | null>(null);
  const [view, setView] = useState<(typeof VIEWS)[number]>("Performance");
  const [renaming, setRenaming] = useState<string | null>(null);
  const symbols = useMemo(() => items.map((i) => i.symbol), [items]);
  const { prices, checked } = useLivePrices(symbols);
  const { map: overviews, ready: overviewsReady } = useOverviews(symbols);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "custom", desc: false });
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
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
    const key = sort.key;
    if (key === "custom") return rows; // the saved order
    return [...rows].sort((a, b) => {
      if (key === "symbol") return dir * a.symbol.localeCompare(b.symbol);
      const x = a[key];
      const y = b[key];
      if (x === null) return 1; // blanks last either way
      if (y === null) return -1;
      return dir * (x - y);
    });
  }, [rows, sort]);

  const setSortKey = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "symbol" }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.desc ? " ↓" : " ↑") : "");

  const custom = sort.key === "custom";

  const move = async (from: number, to: number) => {
    if (from === to) return;
    setActionError(null);
    try {
      await reorder(moveItem(items.map((i) => i.symbol), from, to), listId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't save the new order.");
    }
  };

  const endDrag = () => {
    setDragging(null);
    setDropAt(null);
  };

  const steps = [
    { label: "Watchlist", done: !loading },
    { label: "Live prices", done: !loading && symbols.every((s) => prices[s] || checked[s]) },
    { label: "Trends and returns", done: !loading && overviewsReady },
  ];

  const onCreateList = async () => {
    const name = creating?.trim();
    if (!name) return;
    setActionError(null);
    try {
      const id = await createList(name);
      setCreating(null);
      router.push(`/watchlist?list=${id}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't create the list.");
    }
  };

  const onRenameList = async () => {
    const name = renaming?.trim();
    setRenaming(null);
    if (!active || !name || name === active.name) return;
    try {
      await renameList(active.id, name);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't rename the list.");
    }
  };

  const onDeleteList = async () => {
    if (!active || active.is_primary || !window.confirm(`Delete the "${active.name}" list?`)) return;
    try {
      await deleteList(active.id);
      router.push("/watchlist");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't delete the list.");
    }
  };

  const onAdd = async (symbol: string, name?: string) => {
    if (!symbol) return;
    setActionError(null);
    try {
      await add(symbol, name, listId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't add that symbol.");
    }
  };

  const onRemove = async (symbol: string) => {
    setActionError(null);
    try {
      await remove(symbol, listId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't remove that symbol.");
    }
  };

  return (
    <PageGate title="watchlists" steps={steps}>
      <div className="spread">
        <div style={{ minWidth: 0 }}>
          <div className="label">{items.length} symbol{items.length === 1 ? "" : "s"}{active && !active.is_primary ? " · custom list" : ""}</div>
          {renaming !== null && active ? (
            <form onSubmit={(e) => { e.preventDefault(); onRenameList(); }} style={{ marginTop: 6 }}>
              <input className="input display" style={{ fontSize: 28, width: "min(480px, 100%)" }} value={renaming} maxLength={60} autoFocus onChange={(e) => setRenaming(e.target.value)} onBlur={onRenameList} aria-label="List name" />
            </form>
          ) : (
            <h1 className="display" style={{ marginTop: 8 }}>{active?.name ?? "Watchlist"}</h1>
          )}
        </div>
        <div className="row">
          {active && !active.is_primary && renaming === null && (
            <>
              <button className="btn-text" onClick={() => setRenaming(active.name)}>Rename</button>
              <button className="btn-text danger" onClick={onDeleteList}>Delete list</button>
            </>
          )}
          <SymbolSearch placeholder={`Add to ${active?.name ?? "watchlist"}`} onSelect={onAdd} width={280} />
        </div>
      </div>

      <nav className="list-tabs" aria-label="Watchlists" style={{ marginTop: 16 }}>
        {lists.map((l) => (
          <Link key={l.id} className="list-tab" href={l.is_primary ? "/watchlist" : `/watchlist?list=${l.id}`} aria-current={l.id === listId ? "page" : undefined}>
            {l.name}<span className="count">{l.items.length}</span>
          </Link>
        ))}
        {creating === null ? (
          <button className="list-tab btn-text" style={{ textTransform: "uppercase" }} onClick={() => setCreating("")}>+ New list</button>
        ) : (
          <form className="row" style={{ gap: 6, padding: "4px 8px" }} onSubmit={(e) => { e.preventDefault(); onCreateList(); }}>
            <input className="input" style={{ padding: "4px 8px", fontSize: 13 }} placeholder="List name" value={creating} maxLength={60} autoFocus onChange={(e) => setCreating(e.target.value)} aria-label="New list name" />
            <button className="btn-text" disabled={!creating.trim()}>Create</button>
            <button type="button" className="btn-text" onClick={() => setCreating(null)}>Cancel</button>
          </form>
        )}
      </nav>
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

      {items.length > 0 && (
        <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
          <Seg label="Table view" value={view} options={VIEWS} onChange={setView} />
        </div>
      )}
      {items.length === 0 ? (
        <div className="empty" style={{ marginTop: 24 }}>
          <p>Follow stocks, ETFs and funds without holding them. Add one with the box above, or press Watch on any stock page.</p>
        </div>
      ) : view === "Fundamentals" ? (
        <div style={{ marginTop: 12 }}>
          <FundamentalsTable symbols={items.map((i) => i.symbol)} />
        </div>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data">
            <thead>
              <tr>
                <th scope="col" style={{ width: 28, paddingRight: 0 }}><span className="sr-only">Reorder</span></th>
                <th scope="col" className="left" aria-sort={sort.key === "symbol" ? (sort.desc ? "descending" : "ascending") : "none"}>
                  <button className="btn-text" style={{ padding: 0, font: "inherit", color: "inherit", letterSpacing: "inherit", textTransform: "inherit" }} onClick={() => setSortKey("symbol")}>Symbol{arrow("symbol")}</button>
                </th>
                <th scope="col" className="left">3M trend</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}>
                    <button className="btn-text" style={{ padding: 0, font: "inherit", color: "inherit", letterSpacing: "inherit", textTransform: "inherit" }} onClick={() => setSortKey(c.key)}>{c.label}{arrow(c.key)}</button>
                  </th>
                ))}
                <th scope="col"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr
                  key={r.symbol}
                  draggable={custom}
                  onDragStart={(e) => {
                    setDragging(r.symbol);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", r.symbol);
                  }}
                  onDragOver={(e) => {
                    if (!dragging) return;
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setDropAt(e.clientY < rect.top + rect.height / 2 ? i : i + 1);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = items.findIndex((x) => x.symbol === dragging);
                    if (from !== -1 && dropAt !== null) move(from, dropAt > from ? dropAt - 1 : dropAt);
                    endDrag();
                  }}
                  onDragEnd={endDrag}
                  className={[dragging === r.symbol ? "row-dragging" : "", dropAt === i ? "drop-before" : "", dropAt === i + 1 && i === sorted.length - 1 ? "drop-after" : ""].join(" ")}
                >
                  <td style={{ paddingRight: 0 }}>
                    {custom ? <span className="grip" aria-hidden="true" title="Drag to reorder" /> : null}
                  </td>
                  <td className="left" style={{ whiteSpace: "normal", minWidth: 160 }}>
                    <Link href={`/s/${encodeURIComponent(r.symbol)}`} style={{ fontWeight: 500 }} onMouseEnter={() => prefetchStock(r.symbol)}>{r.symbol}</Link>
                    <a href={yahooUrl(r.symbol)} target="_blank" rel="noopener noreferrer" className="faint" style={{ marginLeft: 6, fontSize: 12 }} aria-label={`${r.symbol} on Yahoo Finance`} title="Yahoo Finance">↗</a>
                    {r.name && <div className="faint" style={{ fontFamily: "var(--sans)", fontSize: 12, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>}
                  </td>
                  <td className="left">
                    <Sparkline values={r.overview?.spark ?? []} label={`${r.symbol} over 3 months: ${pct(r.r3m, 1)}`} />
                  </td>
                  <td>{priceOf(r.symbol, r.price)}</td>
                  <td className={tone(r.day)}>{pct(r.day)}</td>
                  <td className={tone(r.r1m)}>{pct(r.r1m, 1)}</td>
                  <td className={tone(r.r3m)}>{pct(r.r3m, 1)}</td>
                  <td className={tone(r.ytd)}>{pct(r.ytd, 1)}</td>
                  <td className={tone(r.r1y)}>{pct(r.r1y, 1)}</td>
                  <td><RangeCell symbol={r.symbol} low={r.overview?.low52 ?? null} high={r.overview?.high52 ?? null} price={r.price} /></td>
                  <td>
                    {custom && (
                      <>
                        <button className="btn-text" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${r.symbol} up`} title="Move up">↑</button>
                        <button className="btn-text" onClick={() => move(i, i + 1)} disabled={i === sorted.length - 1} aria-label={`Move ${r.symbol} down`} title="Move down">↓</button>
                      </>
                    )}
                    <button className="btn-text danger" onClick={() => onRemove(r.symbol)} aria-label={`Stop watching ${r.symbol}`}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="spread" style={{ marginTop: 12 }}>
        <p className="notice" style={{ margin: 0 }}>
          {custom ? "Drag rows (or use ↑ ↓) to reorder. " : "Sorted by a column; switch to My order to rearrange. "}
          Returns and the 52-week range come from daily closes; Today uses the live price.
        </p>
        {!custom && <button className="btn-text" onClick={() => setSort({ key: "custom", desc: false })}>My order</button>}
      </div>
    </PageGate>
  );
}

export default function WatchlistPage() {
  return (
    <Suspense>
      <WatchlistView />
    </Suspense>
  );
}
