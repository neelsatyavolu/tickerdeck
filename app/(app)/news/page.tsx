"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageGate } from "@/components/PageGate";
import { usePortfolios } from "@/components/Portfolios";
import { ErrorText, Seg } from "@/components/ui";
import { useWatchlist } from "@/components/Watchlist";
import { cachedApi } from "@/lib/client/api";
import { timeAgo } from "@/lib/format";
import { isCrypto } from "@/lib/market/crypto";
import { NEWS_MAX_SYMBOLS, storiesFor } from "@/lib/market/newsScope";
import type { NewsItem } from "@/lib/market/types";
import { uniqueSymbols } from "@/lib/portfolio/math";

// News: curated headlines from reputable outlets, stories about what you hold
// and watch, and deals. Picking one portfolio or watchlist narrows the page to
// stories about its stocks. Every story links out to its publisher.

type Feeds = { top: NewsItem[]; forYou: NewsItem[]; deals: NewsItem[] };
const TABS = ["All", "For you", "Markets", "Deals"] as const;
type Tab = (typeof TABS)[number];
const ALL_SOURCES = "All sources";
const ALL_STOCKS = "all";
const SELECT_STYLE: React.CSSProperties = { width: "auto", padding: "4px 8px", fontSize: 13 };

/** A portfolio or watchlist the page can be narrowed to (indexes have no company news). */
type Scope = { id: string; name: string; symbols: string[] };
const toScope = (id: string, name: string, symbols: string[]): Scope => ({ id, name, symbols: [...new Set(symbols)].filter((s) => !s.startsWith("^") && !isCrypto(s)) });
const hasStocks = (s: Scope) => s.symbols.length > 0;

/** For the overview: the freshest stories that have photos first (stable, so still newest-first within each group). */
const pictured = (items: NewsItem[]) => [...items.slice(0, 24)].sort((a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image)));

/** The story's photo, or null once it fails to load (the card then renders as text). */
function useImage(item: NewsItem): [string | null, () => void] {
  const [broken, setBroken] = useState(false);
  return [broken ? null : item.image ?? null, () => setBroken(true)];
}

function Photo({ item, src, onError, lead }: { item: NewsItem; src: string; onError: () => void; lead?: boolean }) {
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
      {/* Publisher images come from many hosts; a plain lazy <img> avoids proxying them. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="news-img" src={src} alt="" loading={lead ? "eager" : "lazy"} referrerPolicy="no-referrer" onError={onError} />
    </a>
  );
}

function Tickers({ symbols, mine }: { symbols: string[]; mine: Set<string> }) {
  const shown = [...symbols].sort((a, b) => Number(mine.has(b)) - Number(mine.has(a))).slice(0, 4);
  if (shown.length === 0) return null;
  return (
    <div className="news-tickers">
      {shown.map((s) => (
        <Link key={s} href={`/s/${encodeURIComponent(s)}`} className={mine.has(s) ? "mine" : undefined}>{s}</Link>
      ))}
    </div>
  );
}

function Lead({ item, mine }: { item: NewsItem; mine: Set<string> }) {
  const [src, onError] = useImage(item);
  return (
    <article className={`news-lead${src ? "" : " text"}`}>
      {src && <Photo item={item} src={src} onError={onError} lead />}
      <div>
        <div className="label">{item.source} · {timeAgo(item.time)}</div>
        <h2 className="news-lead-headline"><a href={item.url} target="_blank" rel="noopener noreferrer">{item.headline}</a></h2>
        {item.summary && <p className="muted news-summary">{item.summary}</p>}
        <Tickers symbols={item.related ?? []} mine={mine} />
      </div>
    </article>
  );
}

/** A photo card when the story has a real photo; otherwise a text card with the summary. */
function Card({ item, mine }: { item: NewsItem; mine: Set<string> }) {
  const [src, onError] = useImage(item);
  return (
    <article className={`news-card${src ? "" : " text"}`}>
      {src && <Photo item={item} src={src} onError={onError} />}
      <div className="label" style={src ? { marginTop: 10 } : undefined}>{item.source} · {timeAgo(item.time)}</div>
      <a className="news-card-headline" href={item.url} target="_blank" rel="noopener noreferrer">{item.headline}</a>
      {!src && item.summary && <p className="muted news-card-summary">{item.summary}</p>}
      <Tickers symbols={item.related ?? []} mine={mine} />
    </article>
  );
}

function Grid({ items, mine, empty = "No stories right now." }: { items: NewsItem[]; mine: Set<string>; empty?: string }) {
  if (items.length === 0) return <div className="notice">{empty}</div>;
  return <div className="news-grid">{items.map((n) => <Card key={n.url} item={n} mine={mine} />)}</div>;
}

function Block({ title, items, mine, more, onMore }: { title: string; items: NewsItem[]; mine: Set<string>; more: number; onMore: () => void }) {
  if (items.length === 0) return null;
  return (
    <section className="section">
      <div className="spread">
        <h2 className="display">{title}</h2>
        {more > items.length && <button className="btn-text" onClick={onMore}>All {more} →</button>}
      </div>
      <Grid items={items} mine={mine} />
    </section>
  );
}

export default function NewsPage() {
  const { portfolios, loading: loadingPortfolios } = usePortfolios();
  const { lists, loading: loadingWatch } = useWatchlist();
  const [tab, setTab] = useState<Tab>("All");
  const [source, setSource] = useState(ALL_SOURCES);
  const [scopeId, setScopeId] = useState(ALL_STOCKS);
  const [loaded, setLoaded] = useState<{ key: string; feeds: Feeds | null; error: string | null } | null>(null);

  const ready = !loadingPortfolios && !loadingWatch;
  const mineList = useMemo(() => {
    const held = uniqueSymbols(portfolios.filter((p) => p.kind !== "watchlist"));
    const watched = lists.flatMap((l) => l.items.map((i) => i.symbol));
    return [...new Set([...held, ...watched])].filter((s) => !s.startsWith("^") && !isCrypto(s));
  }, [portfolios, lists]);
  const mine = useMemo(() => new Set(mineList), [mineList]);
  const portfolioScopes = useMemo(() => portfolios.map((p) => toScope(`p:${p.id}`, p.name, p.holdings.map((h) => h.symbol))).filter(hasStocks), [portfolios]);
  const watchScopes = useMemo(() => lists.map((l) => toScope(`w:${l.id}`, l.name, l.items.map((i) => i.symbol))).filter(hasStocks), [lists]);
  // A list that no longer exists (deleted, or emptied) falls back to all stocks.
  const scope = useMemo(() => [...portfolioScopes, ...watchScopes].find((s) => s.id === scopeId) ?? null, [portfolioScopes, watchScopes, scopeId]);
  const key = ready ? (scope?.symbols ?? mineList).slice(0, NEWS_MAX_SYMBOLS).join(",") : null;

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    cachedApi<Feeds>(`/api/market/news${key ? `?symbols=${encodeURIComponent(key)}` : ""}`, 5 * 60_000)
      .then((feeds) => !cancelled && setLoaded({ key, feeds, error: null }))
      .catch((err) => !cancelled && setLoaded({ key, feeds: null, error: err instanceof Error ? err.message : "Could not load news." }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  const current = loaded?.key === key ? loaded : null;
  const feeds = current?.feeds ?? null;
  const scoped = useMemo(() => (scope && feeds ? storiesFor([...feeds.forYou, ...feeds.top, ...feeds.deals], scope.symbols) : null), [scope, feeds]);
  const highlight = useMemo(() => (scope ? new Set(scope.symbols) : mine), [scope, mine]);
  const sources = useMemo(() => {
    const all = scoped ?? (feeds ? [...feeds.top, ...feeds.forYou, ...feeds.deals] : []);
    return [ALL_SOURCES, ...[...new Set(all.map((n) => n.source))].sort()];
  }, [scoped, feeds]);
  // The chosen outlet may have no stories in the list now showing.
  const activeSource = sources.includes(source) ? source : ALL_SOURCES;
  const pick = (items: NewsItem[]) => (activeSource === ALL_SOURCES ? items : items.filter((n) => n.source === activeSource));
  const top = pick(feeds?.top ?? []);
  const forYou = pick(feeds?.forYou ?? []);
  const deals = pick(feeds?.deals ?? []);
  const lead = top.find((n) => n.image) ?? top[0] ?? forYou[0];
  const steps = [
    { label: "Your portfolios and watchlists", done: ready },
    { label: "Headlines", done: current !== null },
  ];

  return (
    <PageGate title="news" steps={steps}>
      <div className="dash-head">
        <div>
          <div className="label">Curated from Reuters, Bloomberg, CNBC, Yahoo Finance and more</div>
          <h1 className="display" style={{ marginTop: 6 }}>News</h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {!scope && <Seg label="Section" value={tab} options={TABS} onChange={setTab} />}
          <select className="input" style={SELECT_STYLE} aria-label="List" value={scope?.id ?? ALL_STOCKS} onChange={(e) => setScopeId(e.target.value)}>
            <option value={ALL_STOCKS}>All my stocks</option>
            {portfolioScopes.length > 0 && (
              <optgroup label="Portfolios">
                {portfolioScopes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </optgroup>
            )}
            {watchScopes.length > 0 && (
              <optgroup label="Watchlists">
                {watchScopes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </optgroup>
            )}
          </select>
          <select className="input" style={SELECT_STYLE} aria-label="Source" value={activeSource} onChange={(e) => setSource(e.target.value)}>
            {sources.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {current?.error && <ErrorText error={current.error} />}
      {!current && <div className="notice" style={{ marginTop: 24 }}>Loading stories…</div>}

      {scope && scoped && (
        <div style={{ marginTop: 24 }}>
          {scope.symbols.length > NEWS_MAX_SYMBOLS && (
            <div className="label" style={{ marginBottom: 16 }}>Company news for the first {NEWS_MAX_SYMBOLS} of {scope.symbols.length} stocks in {scope.name}</div>
          )}
          <Grid items={pick(scoped)} mine={highlight} empty="No stories for this list right now." />
        </div>
      )}
      {feeds && !scope && tab === "All" && (
        <>
          {lead && <Lead item={lead} mine={mine} />}
          <Block title="Top stories" items={pictured(top.filter((n) => n !== lead)).slice(0, 8)} more={top.length} mine={mine} onMore={() => setTab("Markets")} />
          {mine.size === 0 ? (
            <section className="section">
              <h2 className="display">For you</h2>
              <div className="notice" style={{ marginTop: 12 }}>Hold or watch a few stocks and their news shows up here.</div>
            </section>
          ) : (
            <Block title="Your stocks" items={pictured(forYou).slice(0, 8)} more={forYou.length} mine={mine} onMore={() => setTab("For you")} />
          )}
          <Block title="Deals" items={pictured(deals).slice(0, 4)} more={deals.length} mine={mine} onMore={() => setTab("Deals")} />
        </>
      )}
      {feeds && !scope && tab !== "All" && (
        <div style={{ marginTop: 24 }}>
          <Grid items={tab === "For you" ? forYou : tab === "Markets" ? top : deals} mine={mine} />
        </div>
      )}
    </PageGate>
  );
}
