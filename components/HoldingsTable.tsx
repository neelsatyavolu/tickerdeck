"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { pct, shares, signedUsd, tone, usd } from "@/lib/format";
import type { Position } from "@/lib/portfolio/math";
import type { Holding, Portfolio } from "@/lib/portfolio/types";
import { deleteHolding, updateHolding } from "@/lib/client/portfolios";
import { HoldingForm } from "./HoldingForm";
import { usePortfolios } from "./Portfolios";
import { ErrorText } from "./ui";

type Props = { portfolio: Portfolio; positions: Position[] };

export function HoldingsTable({ portfolio, positions }: Props) {
  const { mutate } = usePortfolios();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isWatch = portfolio.kind === "watchlist";
  const lotsBySymbol = (s: string) => portfolio.holdings.filter((h) => h.symbol === s);
  const maxWeight = Math.max(...positions.map((p) => p.weight ?? 0), 0.0001);

  const remove = async (h: Holding) => {
    if (!window.confirm(`Delete this ${h.symbol} lot?`)) return;
    setError(null);
    try {
      await mutate(() => deleteHolding(h.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete.");
    }
  };

  const cols = isWatch ? 4 : 8;

  return (
    <div>
      <ErrorText error={error} />
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              {!isWatch && <th scope="col">Shares</th>}
              {!isWatch && <th scope="col">Avg cost</th>}
              <th scope="col">Price</th>
              <th scope="col">Today</th>
              {!isWatch && <th scope="col">Value</th>}
              {!isWatch && <th scope="col">Total gain</th>}
              {isWatch ? <th scope="col">Lots</th> : <th scope="col">Weight</th>}
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const lots = lotsBySymbol(p.symbol);
              const open = expanded === p.symbol;
              return (
                <Fragment key={p.symbol}>
                  <tr>
                    <td>
                      <button className="btn-text" style={{ padding: "0 6px 0 0" }} onClick={() => setExpanded(open ? null : p.symbol)} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} ${p.symbol} lots`}>
                        {open ? "−" : "+"}
                      </button>
                      <Link href={`/s/${encodeURIComponent(p.symbol)}`} style={{ fontWeight: 500 }}>{p.symbol}</Link>
                    </td>
                    {!isWatch && <td>{shares(p.shares)}</td>}
                    {!isWatch && <td>{usd(p.avgCost)}</td>}
                    <td>{usd(p.price)}</td>
                    <td className={tone(p.dayChangePct)}>{pct(p.dayChangePct)}</td>
                    {!isWatch && <td>{usd(p.marketValue)}</td>}
                    {!isWatch && (
                      <td className={tone(p.totalGain)}>
                        {signedUsd(p.totalGain)} <span className="faint">{pct(p.totalGainPct, 1)}</span>
                      </td>
                    )}
                    {isWatch ? (
                      <td>{lots.length}</td>
                    ) : (
                      <td>
                        <span className="weight-bar" style={{ width: `${Math.round(((p.weight ?? 0) / maxWeight) * 60)}px` }} aria-hidden="true" />
                        {p.weight === null ? "—" : `${(p.weight * 100).toFixed(1)}%`}
                      </td>
                    )}
                  </tr>
                  {open &&
                    lots.map((h) =>
                      editing === h.id ? (
                        <tr key={h.id} className="lot">
                          <td colSpan={cols} style={{ textAlign: "left", whiteSpace: "normal" }}>
                            <HoldingForm
                              kind={portfolio.kind}
                              initial={h}
                              submitLabel="Save lot"
                              onCancel={() => setEditing(null)}
                              onSubmit={async (values) => {
                                await mutate(() => updateHolding(h.id, values));
                                setEditing(null);
                              }}
                            />
                          </td>
                        </tr>
                      ) : (
                        <tr key={h.id} className="lot">
                          <td style={{ paddingLeft: 32 }}>{h.bought_at ?? "no date"}</td>
                          {!isWatch && <td>{shares(h.shares)}</td>}
                          {!isWatch && <td>{usd(h.cost_basis)}</td>}
                          <td colSpan={isWatch ? 2 : 4} style={{ textAlign: "left", whiteSpace: "normal" }}>{h.note}</td>
                          <td>
                            <button className="btn-text" onClick={() => setEditing(h.id)}>Edit</button>
                            <button className="btn-text danger" onClick={() => remove(h)}>Delete</button>
                          </td>
                        </tr>
                      ),
                    )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
