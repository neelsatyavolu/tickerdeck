"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Ratings, TargetRange } from "@/components/AnalystPanel";
import { CompareChart } from "@/components/charts/CompareChart";
import { LineChart } from "@/components/charts/LineChart";
import { Sparkline } from "@/components/charts/Sparkline";
import { ForecastPanel } from "@/components/ForecastPanel";
import { FundamentalsTable } from "@/components/FundamentalsTable";
import { useLivePrices } from "@/components/LivePrices";
import { usePortfolios } from "@/components/Portfolios";
import { KeyStatsGrid } from "@/components/StockPanels";
import { Change } from "@/components/ui";
import { useHistories } from "@/components/useHistory";
import { useOverviews } from "@/components/useOverviews";
import { useStockInfo } from "@/components/useStockInfo";
import { prefetchStock } from "@/lib/client/prefetch";
import type { Panel } from "@/lib/dashboard/schema";
import { pct, priceOf, signedUsd, timeAgo, tone, usd } from "@/lib/format";
import type { HistoryRange } from "@/lib/market/types";
import { aggregatePositions, portfolioTotals } from "@/lib/portfolio/math";

// One component per panel type. Each loads only what it shows, through the
// same cached hooks the rest of the app uses.

const RANGE_TO_HISTORY: Record<NonNullable<Panel["range"]>, HistoryRange> = { "1M": "1mo", "3M": "3mo", "6M": "6mo", "1Y": "1y", "2Y": "2y", "5Y": "5y", "10Y": "10y" };
const Loading = () => <div className="notice">Loading<span className="caret" aria-hidden="true" /></div>;

const SymbolLink = ({ symbol }: { symbol: string }) => (
  <Link href={`/s/${encodeURIComponent(symbol)}`} onMouseEnter={() => prefetchStock(symbol)} style={{ fontWeight: 500 }}>
    {symbol}
  </Link>
);

function useDayChanges(symbols: string[]) {
  const { prices, checked } = useLivePrices(symbols);
  const rows = symbols.map((s) => {
    const p = prices[s];
    return { symbol: s, price: p?.price ?? null, change: p && p.prevClose ? p.price / p.prevClose - 1 : null };
  });
  return { rows, ready: symbols.every((s) => prices[s] || checked[s]) };
}

function TilesView({ panel }: { panel: Panel }) {
  const { rows } = useDayChanges(panel.symbols);
  return (
    <div className="tiles-grid">
      {rows.map((r) => (
        <div key={r.symbol} className="tile">
          <div className="label"><SymbolLink symbol={r.symbol} /></div>
          <div className="value">{priceOf(r.symbol, r.price)}</div>
          <div className={`sub ${tone(r.change)}`}>{pct(r.change)}</div>
        </div>
      ))}
    </div>
  );
}

/** Diverging fill: green up, red down, neutral at zero; ±3% is full strength. */
function heatColor(change: number | null): string {
  if (change === null) return "var(--surface)";
  const strength = Math.min(1, Math.abs(change) / 0.03);
  const pctMix = Math.round(12 + strength * 58);
  return `color-mix(in srgb, ${change >= 0 ? "var(--ok)" : "var(--danger)"} ${pctMix}%, var(--bg))`;
}

function HeatmapView({ panel }: { panel: Panel }) {
  const { rows } = useDayChanges(panel.symbols);
  return (
    <div className="heatmap" role="list">
      {rows.map((r) => (
        <Link key={r.symbol} role="listitem" href={`/s/${encodeURIComponent(r.symbol)}`} className="heat-cell" style={{ background: heatColor(r.change) }} title={`${r.symbol} ${pct(r.change)} today`}>
          <span className="mono" style={{ fontWeight: 500 }}>{r.symbol}</span>
          <span className="num">{pct(r.change, 1)}</span>
        </Link>
      ))}
    </div>
  );
}

function MoversView({ panel }: { panel: Panel }) {
  const { rows, ready } = useDayChanges(panel.symbols);
  const priced = rows.filter((r) => r.change !== null).sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
  if (!ready && priced.length === 0) return <Loading />;
  const n = Math.min(5, Math.ceil(priced.length / 2));
  const up = priced.slice(0, n).filter((r) => (r.change ?? 0) > 0);
  const down = priced.slice(-n).reverse().filter((r) => (r.change ?? 0) < 0);
  const max = Math.max(0.0001, ...priced.map((r) => Math.abs(r.change ?? 0)));
  const row = (r: (typeof rows)[number]) => (
    <div key={r.symbol} className="mover-row">
      <SymbolLink symbol={r.symbol} />
      <span className="mover-bar" aria-hidden="true"><span style={{ width: `${(Math.abs(r.change ?? 0) / max) * 100}%`, background: (r.change ?? 0) >= 0 ? "var(--ok)" : "var(--danger)" }} /></span>
      <span className={`num ${tone(r.change)}`}>{pct(r.change)}</span>
    </div>
  );
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div><div className="label" style={{ marginBottom: 6 }}>Up</div>{up.length ? up.map(row) : <div className="notice">Nothing up today.</div>}</div>
      <div><div className="label" style={{ marginBottom: 6 }}>Down</div>{down.length ? down.map(row) : <div className="notice">Nothing down today.</div>}</div>
    </div>
  );
}

function ReturnsView({ panel }: { panel: Panel }) {
  const { map, ready } = useOverviews(panel.symbols);
  const { rows } = useDayChanges(panel.symbols);
  if (!ready && Object.keys(map).length === 0) return <Loading />;
  return (
    <div className="table-wrap" style={{ borderTop: "none" }}>
      <table className="data compact">
        <thead>
          <tr><th scope="col">Symbol</th><th scope="col" className="left">3M</th><th scope="col">Today</th><th scope="col">1M</th><th scope="col">YTD</th><th scope="col">1Y</th></tr>
        </thead>
        <tbody>
          {panel.symbols.map((s, i) => {
            const o = map[s];
            return (
              <tr key={s}>
                <td><SymbolLink symbol={s} /></td>
                <td className="left"><Sparkline values={o?.spark ?? []} width={72} height={22} label={`${s} 3-month trend ${pct(o?.r3m, 1)}`} /></td>
                <td className={tone(rows[i].change)}>{pct(rows[i].change, 1)}</td>
                <td className={tone(o?.r1m)}>{pct(o?.r1m, 1)}</td>
                <td className={tone(o?.ytd)}>{pct(o?.ytd, 1)}</td>
                <td className={tone(o?.r1y)}>{pct(o?.r1y, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PriceView({ panel }: { panel: Panel }) {
  const symbol = panel.symbols[0];
  const { data, failed, loading } = useHistories([symbol], RANGE_TO_HISTORY[panel.range ?? "1Y"]);
  const points = useMemo(() => (data[symbol] ?? []).map((p) => ({ t: p.t, v: p.close, volume: p.volume })), [data, symbol]);
  if (failed.length) return <div className="notice">No price history for {symbol}.</div>;
  if (loading && points.length === 0) return <Loading />;
  const compact = panel.width <= 4;
  // Volume only where it means something: daily data (≤ 2 years) for securities, not indexes.
  const long = panel.range === "5Y" || panel.range === "10Y";
  return <LineChart points={points} label={`${symbol} price`} height={compact ? 150 : 240} showVolume={!compact && !long && !symbol.startsWith("^")} money={!symbol.startsWith("^")} />;
}

function CompareView({ panel }: { panel: Panel }) {
  const { data, loading } = useHistories(panel.symbols, RANGE_TO_HISTORY[panel.range ?? "1Y"]);
  const series = panel.symbols.filter((s) => data[s]).map((s) => ({ symbol: s, points: data[s] }));
  if (loading && series.length === 0) return <Loading />;
  return <CompareChart series={series} height={260} />;
}

function ForecastView({ panel }: { panel: Panel }) {
  const symbol = panel.symbols[0];
  const { prices } = useLivePrices([symbol]);
  const { data } = useHistories([symbol], "1y");
  const price = prices[symbol]?.price ?? data[symbol]?.at(-1)?.close ?? null;
  const history = useMemo(() => (data[symbol] ?? []).map((p) => ({ t: p.t, v: p.close })), [data, symbol]);
  return <ForecastPanel exposures={price ? [{ symbol, value: price }] : []} runKey={`${symbol}:${price !== null}`} history={history} initialHorizon={panel.horizon ?? "3m"} money={!symbol.startsWith("^")} />;
}

function StatsView({ panel }: { panel: Panel }) {
  const symbol = panel.symbols[0];
  const { info, error, loading } = useStockInfo(symbol);
  const { prices } = useLivePrices([symbol]);
  if (loading) return <Loading />;
  const stats = info?.stats.value;
  if (!stats) return <div className="notice">{error ?? `No statistics for ${symbol}.`}</div>;
  return <KeyStatsGrid stats={stats} price={prices[symbol]?.price ?? info?.quote.value?.price ?? null} />;
}

function AnalystsView({ panel }: { panel: Panel }) {
  const symbol = panel.symbols[0];
  const { info, loading } = useStockInfo(symbol);
  const { prices } = useLivePrices([symbol]);
  if (loading) return <Loading />;
  const targets = info?.targets.value?.targets;
  const rec = info?.recommendations.value?.[0];
  if (!targets && !rec) return <div className="notice">No analyst coverage for {symbol}.</div>;
  return (
    <div className="stack">
      {targets && <TargetRange targets={targets} price={prices[symbol]?.price ?? info?.quote.value?.price ?? null} />}
      {rec && <Ratings rec={rec} />}
    </div>
  );
}

function NewsView({ panel }: { panel: Panel }) {
  const { info, loading } = useStockInfo(panel.symbols[0]);
  if (loading) return <Loading />;
  const items = info?.news.value ?? [];
  if (items.length === 0) return <div className="notice">No recent headlines.</div>;
  return (
    <div className="panel-scroll">
      {items.slice(0, 8).map((n) => (
        <article key={n.url} className="news-item" style={{ padding: "10px 0" }}>
          <a className="headline" style={{ fontSize: 16 }} href={n.url} target="_blank" rel="noopener noreferrer">{n.headline}</a>
          <div className="meta">{n.source} · {timeAgo(n.time)}</div>
        </article>
      ))}
    </div>
  );
}

function PortfolioView({ panel }: { panel: Panel }) {
  const { portfolios, loading } = usePortfolios();
  const portfolio = portfolios.find((p) => p.id === panel.portfolioId);
  const symbols = useMemo(() => [...new Set(portfolio?.holdings.map((h) => h.symbol) ?? [])], [portfolio]);
  const { prices } = useLivePrices(symbols);
  if (loading) return <Loading />;
  if (!portfolio) return <div className="notice">That portfolio no longer exists.</div>;
  const positions = aggregatePositions(portfolio.holdings, prices);
  const totals = portfolioTotals(portfolio, positions);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="spread">
        <div>
          <div className="hero-value" style={{ fontSize: 32 }}>{usd(totals.marketValue + totals.cash)}</div>
          <div className="row" style={{ marginTop: 4 }}><Change amount={totals.dayChange} percent={totals.dayChangePct} /><span className="faint mono" style={{ fontSize: 12 }}>today</span></div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="label">Total gain</div>
          <div className={`num ${tone(totals.totalGain)}`}>{signedUsd(totals.totalGain)} <span className="faint">{pct(totals.totalGainPct, 1)}</span></div>
        </div>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        {positions.filter((p) => p.weight).slice(0, 8).map((p) => (
          <div key={p.symbol} className="mover-row">
            <SymbolLink symbol={p.symbol} />
            <span className="mover-bar" aria-hidden="true"><span style={{ width: `${(p.weight ?? 0) * 100}%`, background: "var(--fg-3)" }} /></span>
            <span className="num">{((p.weight ?? 0) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
      <Link href={`/p/${portfolio.id}`} className="notice">Open {portfolio.name} →</Link>
    </div>
  );
}

export function PanelView({ panel }: { panel: Panel }) {
  switch (panel.type) {
    case "tiles": return <TilesView panel={panel} />;
    case "heatmap": return <HeatmapView panel={panel} />;
    case "movers": return <MoversView panel={panel} />;
    case "returns": return <ReturnsView panel={panel} />;
    case "price": return <PriceView panel={panel} />;
    case "compare": return <CompareView panel={panel} />;
    case "forecast": return <ForecastView panel={panel} />;
    case "stats": return <StatsView panel={panel} />;
    case "analysts": return <AnalystsView panel={panel} />;
    case "news": return <NewsView panel={panel} />;
    case "portfolio": return <PortfolioView panel={panel} />;
    case "lookup": return <FundamentalsTable symbols={panel.symbols} />;
  }
}
