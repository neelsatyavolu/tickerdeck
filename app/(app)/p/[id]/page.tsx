"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useAssistant } from "@/components/Assistant";
import { LineChart } from "@/components/charts/LineChart";
import { ForecastPanel } from "@/components/ForecastPanel";
import { HoldingForm } from "@/components/HoldingForm";
import { HoldingsTable } from "@/components/HoldingsTable";
import { ImportCsv } from "@/components/ImportCsv";
import { useLivePrices } from "@/components/LivePrices";
import { PageGate } from "@/components/PageGate";
import { PortfolioForm } from "@/components/PortfolioForm";
import { usePortfolios } from "@/components/Portfolios";
import { useHistories } from "@/components/useHistory";
import { Change, ErrorText, Seg, Tile } from "@/components/ui";
import { pct, signedUsd, tone, usd } from "@/lib/format";
import type { HistoryRange } from "@/lib/market/types";
import { holdingsValueSeries } from "@/lib/portfolio/history";
import { aggregatePositions, portfolioTotals } from "@/lib/portfolio/math";
import { addHolding, deletePortfolio, updatePortfolio } from "@/lib/client/portfolios";

const RANGES = ["3mo", "6mo", "1y", "2y"] as const satisfies readonly HistoryRange[];

export default function PortfolioPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { portfolios, loading, mutate } = usePortfolios();
  const { ask } = useAssistant();
  const portfolio = portfolios.find((p) => p.id === id);
  const symbols = useMemo(() => [...new Set(portfolio?.holdings.map((h) => h.symbol) ?? [])], [portfolio]);
  const { prices, checked } = useLivePrices(symbols);
  const [forecastFor, setForecastFor] = useState<string | null>(null);
  const onForecastSettled = useCallback(() => setForecastFor(id), [id]);
  const [range, setRange] = useState<(typeof RANGES)[number]>("1y");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const positions = useMemo(() => (portfolio ? aggregatePositions(portfolio.holdings, prices) : []), [portfolio, prices]);
  const totals = portfolio ? portfolioTotals(portfolio, positions) : null;
  const sharesBySymbol = useMemo(() => Object.fromEntries(positions.map((p) => [p.symbol, p.shares])), [positions]);
  const held = positions.filter((p) => p.shares > 0).map((p) => p.symbol);
  const { data: histories, failed, loading: historyLoading } = useHistories(held, range);
  const { data: yearHistories } = useHistories(held, "1y");
  const valueSeries = useMemo(() => holdingsValueSeries(histories, sharesBySymbol), [histories, sharesBySymbol]);
  const yearSeries = useMemo(() => holdingsValueSeries(yearHistories, sharesBySymbol), [yearHistories, sharesBySymbol]);
  const exposures = positions.filter((p) => p.shares > 0 && p.marketValue).map((p) => ({ symbol: p.symbol, value: p.marketValue ?? 0 }));
  const runKey = positions.map((p) => `${p.symbol}:${p.shares}:${p.price !== null}`).join("|");

  const noCharts = !portfolio || portfolio.kind === "watchlist" || held.length === 0;
  const steps = [
    { label: "Portfolio", done: !loading },
    { label: "Live prices", done: !loading && symbols.every((s) => prices[s] || checked[s]) },
    { label: "Price history", done: !loading && (noCharts || !historyLoading) },
    { label: "Forecast", done: !loading && (noCharts || forecastFor === id) },
  ];

  if (loading) return <PageGate key={`loading-${id}`} title="portfolio" steps={steps}>{null}</PageGate>;
  if (!portfolio || !totals) {
    return (
      <div className="empty">
        <p>This portfolio doesn&apos;t exist or was deleted.</p>
        <Link className="btn btn-primary" href="/">Back to portfolios</Link>
      </div>
    );
  }

  const isWatch = portfolio.kind === "watchlist";
  const isPaper = portfolio.kind === "paper";

  const remove = async () => {
    if (!window.confirm(`Delete "${portfolio.name}" and all its holdings?`)) return;
    try {
      await mutate(() => deletePortfolio(portfolio.id));
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete.");
    }
  };

  return (
    <PageGate key={id} title={portfolio.name} steps={steps}>
      <div className="spread">
        <div>
          <div className="label">{portfolio.kind}{isPaper && portfolio.start_date ? ` · since ${portfolio.start_date}` : ""}</div>
          <h1 className="display" style={{ marginTop: 8 }}>{portfolio.name}</h1>
        </div>
        <div className="row">
          <button className="btn btn-ghost" onClick={() => ask(`Review the "${portfolio.name}" portfolio: performance, concentration and the main risks.`, { portfolioId: portfolio.id })}>Ask about this</button>
          <button className="btn-text" onClick={() => setEditing((v) => !v)}>Edit</button>
          <button className="btn-text danger" onClick={remove}>Delete</button>
        </div>
      </div>
      <ErrorText error={error} />
      {editing && (
        <div style={{ marginTop: 16 }}>
          <PortfolioForm
            initial={portfolio}
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={async (values) => {
              await mutate(() => updatePortfolio(portfolio.id, values));
              setEditing(false);
            }}
          />
        </div>
      )}

      {!isWatch && (
        <div className="grid-cells cols-4" style={{ marginTop: 24 }}>
          <Tile label="Value" value={usd(totals.marketValue + totals.cash)} sub={isPaper ? `${usd(totals.cash)} cash` : undefined} />
          <Tile label="Today" value={<Change amount={totals.dayChange} />} sub={pct(totals.dayChangePct)} subTone={tone(totals.dayChange)} />
          <Tile label="Total gain" value={<span className={tone(totals.totalGain)}>{signedUsd(totals.totalGain)}</span>} sub={pct(totals.totalGainPct)} subTone={tone(totals.totalGain)} />
          <Tile label={isPaper ? "Starting cash" : "Cost basis"} value={usd(isPaper ? portfolio.starting_cash : totals.cost)} />
        </div>
      )}
      {totals.missing.length > 0 && <p className="notice">Waiting for prices: {totals.missing.join(", ")}</p>}

      <section className="section">
        <div className="spread">
          <h2 className="display">Holdings</h2>
          {!adding && !importing && (
            <div className="row">
              <button className="btn btn-ghost" onClick={() => setImporting(true)}>Import CSV</button>
              <button className="btn btn-primary" onClick={() => setAdding(true)}>Add {isWatch ? "symbol" : "holding"}</button>
            </div>
          )}
        </div>
        {importing && (
          <div style={{ marginBottom: 16 }}>
            <ImportCsv portfolioId={portfolio.id} onCancel={() => setImporting(false)} onDone={() => setImporting(false)} />
          </div>
        )}
        {adding && (
          <div className="card" style={{ marginBottom: 16 }}>
            <HoldingForm
              kind={portfolio.kind}
              submitLabel="Add"
              onCancel={() => setAdding(false)}
              onSubmit={async (values) => {
                await mutate(() => addHolding(portfolio.id, values));
              }}
            />
          </div>
        )}
        {positions.length === 0 ? (
          !adding && !importing && <div className="empty"><p>No holdings yet. Add a symbol to start tracking it live.</p></div>
        ) : (
          <HoldingsTable portfolio={portfolio} positions={positions} />
        )}
      </section>

      {!isWatch && held.length > 0 && (
        <>
          <section className="section">
            <div className="spread">
              <h2 className="display">Value of current holdings</h2>
              <Seg label="History range" value={range} options={RANGES} onChange={setRange} />
            </div>
            {historyLoading && valueSeries.length === 0 ? (
              <div className="notice">Loading history<span className="caret" aria-hidden="true" /></div>
            ) : (
              <LineChart points={valueSeries} label="Value of current holdings" />
            )}
            <p className="notice">What today&apos;s shares would have been worth each day. It ignores when you bought them.{failed.length > 0 && ` No history for ${failed.join(", ")}.`}</p>
          </section>

          <section className="section">
            <div className="spread">
              <h2 className="display">Forecast</h2>
            </div>
            <ForecastPanel
              exposures={exposures}
              runKey={runKey}
              history={yearSeries}
              onSettled={onForecastSettled}
              onAskOutlook={() => ask(`Give a bull, base and bear outlook for the "${portfolio.name}" portfolio over the next 3 months, using the forecast range, analyst targets and recent news for its biggest positions.`, { portfolioId: portfolio.id })}
            />
          </section>
        </>
      )}
    </PageGate>
  );
}
