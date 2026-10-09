"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ratings, TargetRange } from "@/components/AnalystPanel";
import { useAssistant } from "@/components/Assistant";
import { LineChart } from "@/components/charts/LineChart";
import { ForecastPanel } from "@/components/ForecastPanel";
import { HoldingForm } from "@/components/HoldingForm";
import { useLivePrices } from "@/components/LivePrices";
import { PageGate } from "@/components/PageGate";
import { usePortfolios } from "@/components/Portfolios";
import { WatchButton } from "@/components/Watchlist";
import { AddToDashboard } from "@/components/dashboard/AddToDashboard";
import { EarningsChart, KeyStatsGrid, Peers, PerformanceStrip, YahooLinks } from "@/components/StockPanels";
import { useExtended } from "@/components/useExtended";
import { useHistories } from "@/components/useHistory";
import { Change, ErrorText, Seg } from "@/components/ui";
import { cachedApi } from "@/lib/client/api";
import { addHolding } from "@/lib/client/portfolios";
import { priceOf, timeAgo } from "@/lib/format";
import { yahooUrl } from "@/lib/links";
import { lastDays, periodReturns } from "@/lib/market/performance";
import type { AnalystTargets, EarningsPoint, KeyStats, NewsItem, Profile, QuoteSnapshot, Recommendation, TargetPoint } from "@/lib/market/types";

type Panel<T> = { value: T | null; error: string | null };
type StockInfo = {
  symbol: string;
  quote: Panel<QuoteSnapshot>;
  profile: Panel<Profile>;
  stats: Panel<KeyStats>;
  targets: Panel<{ targets: AnalystTargets; history: TargetPoint[] }>;
  recommendations: Panel<Recommendation[]>;
  news: Panel<NewsItem[]>;
  earnings: Panel<EarningsPoint[]>;
  peers: Panel<string[]>;
};

const RANGES = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, "2Y": 731, "5Y": 1827, "10Y": 3653 } as const;
type Range = keyof typeof RANGES;
const RANGE_KEYS = Object.keys(RANGES) as Range[];

export default function StockPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(params.symbol).toUpperCase();
  const [loaded, setLoaded] = useState<{ symbol: string; info: StockInfo | null; error: string | null } | null>(null);
  const info = loaded?.symbol === symbol ? loaded.info : null;
  const error = loaded?.symbol === symbol ? loaded.error : null;
  const [range, setRange] = useState<Range>("1Y");
  const { prices, checked, lastTrade } = useLivePrices([symbol]);
  const [forecastFor, setForecastFor] = useState<string | null>(null);
  const onForecastSettled = useCallback(() => setForecastFor(symbol), [symbol]);
  // One 10-year fetch feeds every range, the performance strip and the forecast.
  const { data: hist, failed, loading: histLoading } = useHistories([symbol], "10y");
  const { ask } = useAssistant();

  useEffect(() => {
    let cancelled = false;
    cachedApi<StockInfo>(`/api/market/stock/${encodeURIComponent(symbol)}`, 2 * 60_000)
      .then((d) => !cancelled && setLoaded({ symbol, info: d, error: null }))
      .catch((err) => !cancelled && setLoaded({ symbol, info: null, error: err instanceof Error ? err.message : "Could not load." }));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const live = prices[symbol];
  const ext = useExtended([symbol], prices)[symbol];
  const price = live?.price ?? info?.quote.value?.price ?? null;
  const prevClose = live?.prevClose ?? info?.quote.value?.prevClose ?? null;
  const change = price !== null && prevClose ? price - prevClose : null;
  const all = useMemo(() => hist[symbol] ?? [], [hist, symbol]);
  const points = useMemo(() => lastDays(all, RANGES[range]).map((p) => ({ t: p.t, v: p.close, volume: p.volume })), [all, range]);
  const yearPoints = useMemo(() => lastDays(all, 366).map((p) => ({ t: p.t, v: p.close })), [all]);
  const returns = useMemo(() => periodReturns(all, price), [all, price]);
  const targetHistory = useMemo(() => (info?.targets.value?.history ?? []).map((p) => ({ t: p.t, v: p.target })), [info]);
  const stats = info?.stats.value;
  const name = stats?.name ?? info?.profile.value?.name ?? null;
  const meta = [stats?.exchange ?? info?.profile.value?.exchange, stats?.sector, stats?.industry ?? info?.profile.value?.industry, stats?.assetClass === "etf" ? "ETF" : stats?.assetClass === "mutualfunds" ? "Mutual fund" : stats?.assetClass === "index" ? "Market index" : null].filter(Boolean).join(" · ");
  const rec = info?.recommendations.value?.[0];
  const isIndexPage = stats?.assetClass === "index";
  const steps = [
    { label: "Company details", done: info !== null },
    { label: "Price history", done: all.length > 0 || failed.length > 0 },
    { label: "Live price", done: price !== null || Boolean(checked[symbol]) },
    // No price at all means no forecast will run; don't wait for one.
    { label: "Forecast", done: forecastFor === symbol || (Boolean(checked[symbol]) && price === null) },
  ];

  if (error) {
    return (
      <div className="stack">
        <ErrorText error={error} />
        <a className="btn btn-ghost" style={{ alignSelf: "flex-start" }} href={yahooUrl(symbol)} target="_blank" rel="noopener noreferrer">Look up {symbol} on Yahoo Finance ↗</a>
      </div>
    );
  }

  return (
    <PageGate key={symbol} title={symbol} steps={steps}>
      <div className="label">{meta || "stock"}</div>
      <div className="spread" style={{ marginTop: 8 }}>
        <div>
          <h1 className="display">{symbol}</h1>
          <div className="serif muted" style={{ fontSize: 19, marginTop: 4 }}>{name ?? " "}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="hero-value" style={{ fontSize: 40 }}>{priceOf(symbol, price)}</div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 4 }}>
            <Change amount={change} percent={change !== null && prevClose ? change / prevClose : null} money={!isIndexPage} />
            <span className="faint mono" style={{ fontSize: 12 }}>{live?.fromTrade && lastTrade ? `trade ${timeAgo(live.time)}` : ext ? "at close" : "today"}</span>
          </div>
          {ext && (
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 4 }} aria-label={ext.session === "pre" ? "Pre-market" : "After hours"}>
              <span className="label">{ext.session === "pre" ? "Pre-market" : "After hours"}</span>
              <span className="num">{priceOf(symbol, ext.price)}</span>
              <Change amount={ext.change} percent={ext.changePct} />
              {ext.asOf && <span className="faint mono" style={{ fontSize: 12 }}>{ext.asOf}</span>}
            </div>
          )}
        </div>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={() => ask(`What should I know about $${symbol} right now?`, { symbol })}>Ask about {symbol}</button>
        <WatchButton symbol={symbol} name={name} />
        <AddToDashboard label="Add chart" make={() => [{ type: "price", title: symbol, symbols: [symbol], range: "1Y", width: 6 }]} />
        <a className="btn btn-ghost" href={yahooUrl(symbol)} target="_blank" rel="noopener noreferrer">Yahoo Finance ↗</a>
        {!isIndexPage && <AddToPortfolio symbol={symbol} />}
      </div>

      <div style={{ marginTop: 24 }}>
        <PerformanceStrip rows={returns} />
      </div>

      <section className="section">
        <div className="spread">
          <h2 className="display">Price</h2>
          <Seg label="History range" value={range} options={RANGE_KEYS} onChange={setRange} />
        </div>
        {failed.length ? (
          <div className="notice">No price history available for {symbol}.</div>
        ) : histLoading && all.length === 0 ? (
          <div className="notice">Loading history<span className="caret" aria-hidden="true" /></div>
        ) : (
          <LineChart points={points} label={`${symbol} price`} height={320} money={!isIndexPage} showVolume={!isIndexPage && RANGES[range] <= 731} overlay={targetHistory.length ? { label: "mean analyst target", points: targetHistory } : undefined} />
        )}
      </section>

      {!isIndexPage && <section className="section">
        <div className="spread"><h2 className="display">Key statistics</h2></div>
        {!info ? <div className="notice">Loading</div> : stats ? <KeyStatsGrid stats={stats} price={price} /> : <div className="notice">{info.stats.error ?? "No statistics for this symbol."}</div>}
      </section>}

      <section className="section">
        <div className="spread"><h2 className="display">Forecast</h2></div>
        <ForecastPanel
          exposures={price ? [{ symbol, value: price }] : []}
          runKey={`${symbol}:${price !== null}`}
          history={yearPoints}
          onSettled={onForecastSettled}
          money={!isIndexPage}
          onAskOutlook={() => ask(`Give me a bull, base and bear outlook for $${symbol} over the next 3 months. Use the forecast range${isIndexPage ? "" : ", analyst targets"} and recent headlines, and name what would move it toward each case.`, { symbol })}
        />
      </section>

      {!isIndexPage && <>
      <section className="section">
        <div className="spread"><h2 className="display">Analysts</h2></div>
        <div className="grid-cells cols-2">
          <div>
            <div className="label" style={{ marginBottom: 8 }}>Price targets</div>
            {!info ? <div className="notice">Loading</div> : info.targets.value ? <TargetRange targets={info.targets.value.targets} price={price} /> : <div className="notice">{info.targets.error ?? "No analyst targets for this symbol."}</div>}
          </div>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>Ratings</div>
            {!info ? <div className="notice">Loading</div> : rec ? <Ratings rec={rec} /> : <div className="notice">{info.recommendations.error ?? "No ratings for this symbol."}</div>}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="spread"><h2 className="display">Earnings</h2></div>
        {!info ? <div className="notice">Loading</div> : <EarningsChart rows={info.earnings.value ?? []} />}
      </section>
      </>}

      <section className="section">
        <div className="spread"><h2 className="display">{isIndexPage ? "Market news" : "News"}</h2></div>
        {!info ? (
          <div className="notice">Loading</div>
        ) : info.news.value?.length ? (
          <div style={{ borderTop: "1px solid var(--border)" }}>
            {info.news.value.map((n) => (
              <article key={n.url} className="news-item">
                <a className="headline" href={n.url} target="_blank" rel="noopener noreferrer">{n.headline}</a>
                <div className="meta">{n.source} · {timeAgo(n.time)}</div>
              </article>
            ))}
          </div>
        ) : (
          <div className="notice">{info.news.error ?? "No company news in the last 10 days."}</div>
        )}
      </section>

      {!isIndexPage && (
        <section className="section">
          <div className="spread"><h2 className="display">Peers</h2></div>
          {!info ? <div className="notice">Loading</div> : <Peers symbols={info.peers.value ?? []} />}
        </section>
      )}

      <section className="section">
        <div className="spread"><h2 className="display">More on Yahoo Finance</h2></div>
        <YahooLinks symbol={symbol} />
      </section>
    </PageGate>
  );
}

function AddToPortfolio({ symbol }: { symbol: string }) {
  const { portfolios, mutate } = usePortfolios();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const chosen = portfolios.find((p) => p.id === (target || portfolios[0]?.id));

  if (portfolios.length === 0) return null;
  if (!open) {
    return (
      <>
        <button className="btn btn-primary" onClick={() => { setOpen(true); setDone(null); }}>Add to portfolio</button>
        {done && <span className="notice" role="status">{done}</span>}
      </>
    );
  }

  return (
    <div className="card stack" style={{ width: "100%", marginTop: 8 }}>
      <label className="field" style={{ maxWidth: 320 }}>
        <span className="label">Portfolio</span>
        <select className="input" value={chosen?.id ?? ""} onChange={(e) => setTarget(e.target.value)}>
          {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.kind})</option>)}
        </select>
      </label>
      {chosen && (
        <HoldingForm
          key={chosen.id}
          kind={chosen.kind}
          fixedSymbol={symbol}
          submitLabel={`Add ${symbol}`}
          onCancel={() => setOpen(false)}
          onSubmit={async (values) => {
            await mutate(() => addHolding(chosen.id, values));
            setDone(`Added to ${chosen.name}.`);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
