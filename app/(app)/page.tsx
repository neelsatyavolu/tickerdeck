"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useLivePrices } from "@/components/LivePrices";
import { PortfolioForm } from "@/components/PortfolioForm";
import { usePortfolios } from "@/components/Portfolios";
import { Change, ErrorText, Tile } from "@/components/ui";
import { createPortfolio } from "@/lib/portfolio/repo";
import { aggregatePositions, portfolioTotals, uniqueSymbols } from "@/lib/portfolio/math";
import { pct, signedUsd, tone, usd } from "@/lib/format";

export default function Dashboard() {
  const { portfolios, loading, error, mutate } = usePortfolios();
  const { prices } = useLivePrices(uniqueSymbols(portfolios));
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  const rows = useMemo(
    () =>
      portfolios.map((p) => {
        const positions = aggregatePositions(p.holdings, prices);
        return { p, positions, totals: portfolioTotals(p, positions) };
      }),
    [portfolios, prices],
  );

  // Headline numbers cover money portfolios (holdings + paper), not watchlists.
  const money = rows.filter((r) => r.p.kind !== "watchlist");
  const value = money.reduce((s, r) => s + r.totals.marketValue + r.totals.cash, 0);
  const day = money.reduce((s, r) => s + r.totals.dayChange, 0);
  const gain = money.reduce((s, r) => s + r.totals.totalGain, 0);
  const basis = money.reduce((s, r) => s + (r.p.kind === "paper" && r.p.starting_cash ? r.p.starting_cash : r.totals.cost), 0);

  if (loading) return <div className="notice">Loading portfolios<span className="caret" aria-hidden="true" /></div>;

  return (
    <div>
      <div className="label">All portfolios</div>
      <div className="hero-value" style={{ marginTop: 8 }}>{usd(value)}</div>
      <div className="row" style={{ marginTop: 8 }}>
        <Change amount={day} percent={value - day > 0 ? day / (value - day) : null} />
        <span className="faint mono" style={{ fontSize: 12 }}>today</span>
      </div>

      <div className="grid-cells cols-4" style={{ marginTop: 32 }}>
        <Tile label="Total gain" value={<span className={tone(gain)}>{signedUsd(gain)}</span>} sub={pct(basis > 0 ? gain / basis : null)} subTone={tone(gain)} />
        <Tile label="Portfolios" value={portfolios.length} />
        <Tile label="Positions" value={money.reduce((s, r) => s + r.positions.filter((x) => x.shares > 0).length, 0)} />
        <Tile label="Watching" value={uniqueSymbols(portfolios).length} sub="symbols" />
      </div>

      <section className="section">
        <div className="spread">
          <h2 className="display">Portfolios</h2>
          {!creating && portfolios.length > 0 && <button className="btn btn-primary" onClick={() => setCreating(true)}>New portfolio</button>}
        </div>
        <ErrorText error={error} />
        {creating || portfolios.length === 0 ? (
          <div className="stack">
            {portfolios.length === 0 && !creating && (
              <div className="empty">
                <p>Start with a portfolio. Track what you own, follow a watchlist, or test a what-if basket with paper money.</p>
                <button className="btn btn-primary" onClick={() => setCreating(true)}>New portfolio</button>
              </div>
            )}
            {creating && (
              <PortfolioForm
                submitLabel="Create"
                onCancel={() => setCreating(false)}
                onSubmit={async (values) => {
                  const id = await mutate((db) => createPortfolio(db, values));
                  setCreating(false);
                  router.push(`/p/${id}`);
                }}
              />
            )}
          </div>
        ) : null}
        {rows.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border)", marginTop: creating ? 24 : 0 }}>
            <div className="list-row label" style={{ paddingTop: 10, paddingBottom: 10 }}>
              <span>Name</span>
              <span className="r">Value</span>
              <span className="r hide-sm">Today</span>
              <span className="r hide-sm">Total gain</span>
            </div>
            {rows.map(({ p, positions, totals }) => (
              <Link key={p.id} href={`/p/${p.id}`} className="list-row">
                <span>
                  <span style={{ fontWeight: 500 }}>{p.name}</span>{" "}
                  <span className="label" style={{ marginLeft: 6 }}>{p.kind} · {positions.length}</span>
                </span>
                <span className="r num">{p.kind === "watchlist" ? "—" : usd(totals.marketValue + totals.cash)}</span>
                <span className="r hide-sm"><Change percent={totals.dayChangePct} /></span>
                <span className="r hide-sm">{p.kind === "watchlist" ? <span className="faint">—</span> : <Change amount={totals.totalGain} />}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
