"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageGate } from "@/components/PageGate";
import { usePortfolios } from "@/components/Portfolios";
import { ErrorText, Seg } from "@/components/ui";
import { useWatchlist } from "@/components/Watchlist";
import { cachedApi } from "@/lib/client/api";
import { timeAgo } from "@/lib/format";
import type { NewsItem } from "@/lib/market/types";
import { uniqueSymbols } from "@/lib/portfolio/math";

// News: curated headlines from reputable outlets, stories about what you hold
// and watch, and deals. Every story links out to its publisher.

type Feeds = { top: NewsItem[]; forYou: NewsItem[]; deals: NewsItem[] };
const TABS = ["All", "For you", "Markets", "Deals"] as const;
type Tab = (typeof TABS)[number];
const ALL_SOURCES = "All sources";

/** For the overview: the freshest stories that have photos first (stable, so still newest-first within each group). */
const pictured = (items: NewsItem[]) => [...items.slice(0, 24)].sort((a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image)));

function StoryImage({ item, lead }: { item: NewsItem; lead?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (!item.image || broken) {
    return (
      <div className={`news-img news-img-empty${lead ? " lead" : ""}`} aria-hidden="true">
        <span>{item.source}</span>
      </div>
    );
  }
  return (
    // Publisher images come from many hosts; a plain lazy <img> avoids proxying them.
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`news-img${lead ? " lead" : ""}`} src={item.image} alt="" loading={lead ? "eager" : "lazy"} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
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
  return (
    <article className="news-lead">
      <a href={item.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true"><StoryImage item={item} lead /></a>
      <div>
        <div className="label">{item.source} · {timeAgo(item.time)}</div>
        <h2 className="news-lead-headline"><a href={item.url} target="_blank" rel="noopener noreferrer">{item.headline}</a></h2>
        {item.summary && <p className="muted news-summary">{item.summary}</p>}
        <Tickers symbols={item.related ?? []} mine={mine} />
      </div>
    </article>
  );
}

function Card({ item, mine }: { item: NewsItem; mine: Set<string> }) {
  return (
    <article className="news-card">
      <a href={item.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true"><StoryImage item={item} /></a>
      <div className="label" style={{ marginTop: 10 }}>{item.source} · {timeAgo(item.time)}</div>
      <a className="news-card-headline" href={item.url} target="_blank" rel="noopener noreferrer">{item.headline}</a>
      <Tickers symbols={item.related ?? []} mine={mine} />
    </article>
  );
}

function Grid({ items, mine }: { items: NewsItem[]; mine: Set<string> }) {
  if (items.length === 0) return <div className="notice">No stories right now.</div>;
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
  const [loaded, setLoaded] = useState<{ key: string; feeds: Feeds | null; error: string | null } | null>(null);

  const ready = !loadingPortfolios && !loadingWatch;
  const mineList = useMemo(() => {
    const held = uniqueSymbols(portfolios.filter((p) => p.kind !== "watchlist"));
    const watched = lists.flatMap((l) => l.items.map((i) => i.symbol));
    return [...new Set([...held, ...watched])].filter((s) => !s.startsWith("^"));
  }, [portfolios, lists]);
  const mine = useMemo(() => new Set(mineList), [mineList]);
  const key = ready ? mineList.slice(0, 12).join(",") : null;

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
  const sources = useMemo(() => {
    const all = feeds ? [...feeds.top, ...feeds.forYou, ...feeds.deals].map((n) => n.source) : [];
    return [ALL_SOURCES, ...[...new Set(all)].sort()];
  }, [feeds]);
  const pick = (items: NewsItem[]) => (source === ALL_SOURCES ? items : items.filter((n) => n.source === source));
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
          <Seg label="Section" value={tab} options={TABS} onChange={setTab} />
          <select className="input" style={{ width: "auto", padding: "4px 8px", fontSize: 13 }} aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)}>
            {sources.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {current?.error && <ErrorText error={current.error} />}

      {feeds && tab === "All" && (
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
      {feeds && tab !== "All" && (
        <div style={{ marginTop: 24 }}>
          <Grid items={tab === "For you" ? forYou : tab === "Markets" ? top : deals} mine={mine} />
        </div>
      )}
    </PageGate>
  );
}
