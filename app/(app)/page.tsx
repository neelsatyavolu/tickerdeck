"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAssistant } from "@/components/Assistant";
import { Sparkline } from "@/components/charts/Sparkline";
import { PanelView } from "@/components/dashboard/PanelViews";
import { useDashboards } from "@/components/Dashboards";
import { useLivePrices } from "@/components/LivePrices";
import { PageGate } from "@/components/PageGate";
import { usePortfolios } from "@/components/Portfolios";
import { Change } from "@/components/ui";
import { useOverviews } from "@/components/useOverviews";
import { useWatchlist } from "@/components/Watchlist";
import { prefetchStock } from "@/lib/client/prefetch";
import type { Panel } from "@/lib/dashboard/schema";
import { pct, priceOf, signedUsd, timeAgo, tone, usd } from "@/lib/format";
import { INDEXES } from "@/lib/market/indexes";
import { greeting, marketStatus } from "@/lib/marketHours";
import { aggregatePositions, portfolioTotals, uniqueSymbols } from "@/lib/portfolio/math";

// Home: one clean screen that pulls together markets, your money, what's
// moving in what you hold and watch, news, and shortcuts to everything else.

const MARKETS = ["^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX"];
const MAX_HEAT = 40;

function Section({ title, span, action, children }: { title: string; span: 4 | 6 | 8 | 12; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`dash-panel span-${span}`} aria-label={title}>
      <div className="dash-panel-head">
        <span className="label">{title}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function Home() {
  const { portfolios, loading: loadingPortfolios } = usePortfolios();
  const { primary, loading: loadingWatch } = useWatchlist();
  const { dashboards } = useDashboards();
  const { ask } = useAssistant();
  const [now] = useState(() => new Date());

  const held = useMemo(() => uniqueSymbols(portfolios.filter((p) => p.kind !== "watchlist")), [portfolios]);
  const watched = useMemo(() => primary?.items.map((i) => i.symbol) ?? [], [primary]);
  const everything = useMemo(() => [...new Set([...held, ...watched])], [held, watched]);
  const { prices, checked } = useLivePrices([...MARKETS, ...everything]);
  const { map: overviews, ready: trendsReady } = useOverviews([...MARKETS, ...watched.slice(0, 8)]);

  const money = useMemo(() => {
    const rows = portfolios
      .filter((p) => p.kind !== "watchlist")
      .map((p) => {
        const positions = aggregatePositions(p.holdings, prices);
        return { p, totals: portfolioTotals(p, positions) };
      });
    const value = rows.reduce((s, r) => s + r.totals.marketValue + r.totals.cash, 0);
    const day = rows.reduce((s, r) => s + r.totals.dayChange, 0);
    const gain = rows.reduce((s, r) => s + r.totals.totalGain, 0);
    const basis = rows.reduce((s, r) => s + (r.p.kind === "paper" && r.p.starting_cash ? r.p.starting_cash : r.totals.cost), 0);
    return { rows, value, day, gain, basis };
  }, [portfolios, prices]);

  const status = marketStatus(now);
  const recentDashboards = [...dashboards].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 4);
  const panel = (type: Panel["type"], symbols: string[]): Panel => ({ id: `home-${type}`, type, symbols, width: 12 });
  const empty = !loadingPortfolios && !loadingWatch && everything.length === 0;

  const steps = [
    { label: "Portfolios and watchlist", done: !loadingPortfolios && !loadingWatch },
    { label: "Live prices", done: [...MARKETS, ...everything].every((s) => prices[s] || checked[s]) },
    { label: "Market trends", done: trendsReady },
  ];

  return (
    <PageGate title="home" steps={steps}>
      <div className="dash-head">
        <div>
          <div className="label">{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
          <h1 className="display" style={{ marginTop: 6 }}>{greeting(now)}</h1>
        </div>
        <span className="status" title="Regular session, New York time">
          <span className={`dot ${status.open ? "live" : ""}`} />
          {status.label}
        </span>
      </div>

      {/* Markets */}
      <div className="home-markets" role="list" aria-label="Markets">
        {MARKETS.map((s) => {
          const info = INDEXES.find((i) => i.symbol === s);
          const live = prices[s];
          const change = live && live.prevClose ? live.price / live.prevClose - 1 : null;
          const spark = overviews[s]?.spark.slice(-22) ?? [];
          return (
            <Link key={s} href={`/s/${encodeURIComponent(s)}`} role="listitem" className="home-market" onMouseEnter={() => prefetchStock(s)}>
              <div className="label">{info?.name ?? s}</div>
              <div className="num" style={{ fontSize: 18, marginTop: 4 }}>{priceOf(s, live?.price ?? null)}</div>
              <div className="spread" style={{ alignItems: "center", marginTop: 2 }}>
                <span className={`num ${tone(change)}`} style={{ fontSize: 12 }}>{pct(change)}</span>
                <Sparkline values={spark} width={72} height={20} label={`${info?.name ?? s}, 1 month`} />
              </div>
            </Link>
          );
        })}
      </div>

      {empty && (
        <div className="empty" style={{ marginTop: 24 }}>
          <p>Welcome. Track what you own, follow a few tickers, or bring your portfolios over from Yahoo Finance.</p>
          <div className="row">
            <Link className="btn btn-primary" href="/portfolios">Create a portfolio</Link>
            <Link className="btn btn-ghost" href="/portfolios">Import CSV</Link>
            <Link className="btn btn-ghost" href="/watchlist">Start a watchlist</Link>
          </div>
        </div>
      )}

      <div className="dash-grid" style={{ marginTop: 24 }}>
        {money.rows.length > 0 && (
          <Section title="Your money" span={8} action={<Link className="btn-text" href="/portfolios">All portfolios →</Link>}>
            <div className="spread" style={{ alignItems: "flex-end" }}>
              <div>
                <div className="hero-value" style={{ fontSize: 44 }}>{usd(money.value)}</div>
                <div className="row" style={{ marginTop: 6 }}>
                  <Change amount={money.day} percent={money.value - money.day > 0 ? money.day / (money.value - money.day) : null} />
                  <span className="faint mono" style={{ fontSize: 12 }}>today</span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="label">Total gain</div>
                <div className={`num ${tone(money.gain)}`} style={{ fontSize: 18 }}>{signedUsd(money.gain)}</div>
                <div className={`num ${tone(money.gain)}`} style={{ fontSize: 12 }}>{pct(money.basis > 0 ? money.gain / money.basis : null)}</div>
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              {money.rows.slice(0, 5).map(({ p, totals }) => (
                <Link key={p.id} href={`/p/${p.id}`} className="home-row">
                  <span style={{ fontWeight: 500 }}>{p.name} <span className="faint mono" style={{ fontSize: 11 }}>{p.kind}</span></span>
                  <span className="num">{usd(totals.marketValue + totals.cash)}</span>
                  <span className={`num ${tone(totals.dayChangePct)}`}>{pct(totals.dayChangePct)}</span>
                </Link>
              ))}
            </div>
          </Section>
        )}

        {everything.length >= 2 && (
          <Section title="Movers today" span={money.rows.length > 0 ? 4 : 6}>
            <PanelView panel={panel("movers", everything.slice(0, MAX_HEAT))} />
          </Section>
        )}

        {everything.length >= 2 && (
          <Section title="Everything you hold and watch" span={money.rows.length > 0 ? 6 : 6}>
            <PanelView panel={panel("heatmap", everything.slice(0, MAX_HEAT))} />
          </Section>
        )}

        {watched.length > 0 && (
          <Section title={primary?.name ?? "Watchlist"} span={6} action={<Link className="btn-text" href="/watchlist">Open →</Link>}>
            <div>
              {watched.slice(0, 8).map((s) => {
                const live = prices[s];
                const change = live && live.prevClose ? live.price / live.prevClose - 1 : null;
                return (
                  <Link key={s} href={`/s/${encodeURIComponent(s)}`} className="home-row" onMouseEnter={() => prefetchStock(s)}>
                    <span className="mono" style={{ fontWeight: 500 }}>{s}</span>
                    <Sparkline values={overviews[s]?.spark ?? []} width={80} height={20} label={`${s}, 3 months`} />
                    <span className="num">{priceOf(s, live?.price ?? null)}</span>
                    <span className={`num ${tone(change)}`}>{pct(change)}</span>
                  </Link>
                );
              })}
            </div>
          </Section>
        )}

        <Section title="Market news" span={8}>
          <PanelView panel={panel("news", ["^GSPC"])} />
        </Section>

        <Section title="Jump back in" span={4}>
          <div className="stack" style={{ gap: 0 }}>
            {recentDashboards.map((d) => (
              <Link key={d.id} href={`/d/${d.id}`} className="home-row">
                <span style={{ fontWeight: 500 }}>{d.name}</span>
                <span className="faint mono" style={{ fontSize: 11 }}>{d.panels.length} panels · {timeAgo(Date.parse(d.updated_at))}</span>
              </Link>
            ))}
            <div className="row" style={{ gap: 6, marginTop: 12 }}>
              <Link className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 13 }} href="/d">New dashboard</Link>
              <Link className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 13 }} href="/portfolios">New portfolio</Link>
              <Link className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 13 }} href="/watchlist">Watchlists</Link>
              <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => ask("Give me a quick briefing on today: how the market and my holdings are doing, and anything notable in the news.")}>
                Ask AI for today&apos;s briefing
              </button>
            </div>
          </div>
        </Section>
      </div>
    </PageGate>
  );
}
