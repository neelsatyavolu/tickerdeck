"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Ratings, TargetRange } from "@/components/AnalystPanel";
import { useAssistant } from "@/components/Assistant";
import { LineChart } from "@/components/charts/LineChart";
import { ForecastPanel } from "@/components/ForecastPanel";
import { HoldingForm } from "@/components/HoldingForm";
import { useLivePrices } from "@/components/LivePrices";
import { usePortfolios } from "@/components/Portfolios";
import { useHistories } from "@/components/useHistory";
import { Change, ErrorText, Seg } from "@/components/ui";
import { api } from "@/lib/client/api";
import { timeAgo, usd } from "@/lib/format";
import type { AnalystTargets, NewsItem, Profile, QuoteSnapshot, Recommendation } from "@/lib/market/types";
import { HISTORY_RANGES, type HistoryRange } from "@/lib/market/types";
import { addHolding } from "@/lib/client/portfolios";

type Panel<T> = { value: T | null; error: string | null };
type StockInfo = {
  symbol: string;
  quote: Panel<QuoteSnapshot>;
  profile: Panel<Profile>;
  targets: Panel<AnalystTargets>;
  recommendations: Panel<Recommendation[]>;
  news: Panel<NewsItem[]>;
};

export default function StockPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(params.symbol).toUpperCase();
  const [loaded, setLoaded] = useState<{ symbol: string; info: StockInfo | null; error: string | null } | null>(null);
  const info = loaded?.symbol === symbol ? loaded.info : null;
  const error = loaded?.symbol === symbol ? loaded.error : null;
  const [range, setRange] = useState<HistoryRange>("1y");
  const { prices, lastTrade } = useLivePrices([symbol]);
  const { data: hist, failed } = useHistories([symbol], range);
  const { data: yearHist } = useHistories([symbol], "1y");
  const { ask } = useAssistant();

  useEffect(() => {
    let cancelled = false;
    api<StockInfo>(`/api/market/stock/${encodeURIComponent(symbol)}`)
      .then((d) => !cancelled && setLoaded({ symbol, info: d, error: null }))
      .catch((err) => !cancelled && setLoaded({ symbol, info: null, error: err instanceof Error ? err.message : "Could not load." }));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const live = prices[symbol];
  const price = live?.price ?? info?.quote.value?.price ?? null;
  const prevClose = live?.prevClose ?? info?.quote.value?.prevClose ?? null;
  const change = price !== null && prevClose ? price - prevClose : null;
  const points = useMemo(() => (hist[symbol] ?? []).map((p) => ({ t: p.t, v: p.close })), [hist, symbol]);
  const yearPoints = useMemo(() => (yearHist[symbol] ?? []).map((p) => ({ t: p.t, v: p.close })), [yearHist, symbol]);
  const rec = info?.recommendations.value?.[0];

  if (error) return <ErrorText error={error} />;

  return (
    <div>
      <div className="label">{info?.profile.value ? [info.profile.value.exchange, info.profile.value.industry].filter(Boolean).join(" · ") : "stock"}</div>
      <div className="spread" style={{ marginTop: 8 }}>
        <div>
          <h1 className="display">{symbol}</h1>
          <div className="serif muted" style={{ fontSize: 19, marginTop: 4 }}>{info?.profile.value?.name ?? " "}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="hero-value" style={{ fontSize: 40 }}>{usd(price)}</div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 4 }}>
            <Change amount={change} percent={change !== null && prevClose ? change / prevClose : null} />
            <span className="faint mono" style={{ fontSize: 12 }}>{live?.fromTrade && lastTrade ? `trade ${timeAgo(live.time)}` : "today"}</span>
          </div>
        </div>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={() => ask(`What should I know about $${symbol} right now?`, { symbol })}>Ask about {symbol}</button>
        <AddToPortfolio symbol={symbol} />
      </div>

      <section className="section">
        <div className="spread">
          <h2 className="display">Price</h2>
          <Seg label="History range" value={range} options={HISTORY_RANGES} onChange={setRange} />
        </div>
        {failed.length ? <div className="notice">No price history available.</div> : <LineChart points={points} label={`${symbol} price`} height={280} />}
      </section>

      <section className="section">
        <div className="spread"><h2 className="display">Forecast</h2></div>
        <ForecastPanel
          exposures={price ? [{ symbol, value: price }] : []}
          runKey={`${symbol}:${price !== null}`}
          history={yearPoints}
          onAskOutlook={() => ask(`Give me a bull, base and bear outlook for $${symbol} over the next 3 months. Use the forecast range, analyst targets and recent headlines, and name what would move it toward each case.`, { symbol })}
        />
      </section>

      <section className="section">
        <div className="spread"><h2 className="display">Analysts</h2></div>
        <div className="grid-cells cols-2">
          <div>
            <div className="label" style={{ marginBottom: 8 }}>Price targets</div>
            {!info ? <div className="notice">Loading</div> : info.targets.value ? <TargetRange targets={info.targets.value} price={price} /> : <div className="notice">{info.targets.error ?? "No analyst targets for this symbol."}</div>}
          </div>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>Ratings</div>
            {!info ? <div className="notice">Loading</div> : rec ? <Ratings rec={rec} /> : <div className="notice">{info.recommendations.error ?? "No ratings for this symbol."}</div>}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="spread"><h2 className="display">News</h2></div>
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
    </div>
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
