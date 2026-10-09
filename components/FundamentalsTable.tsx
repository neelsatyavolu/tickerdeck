"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLivePrices } from "@/components/LivePrices";
import { cachedApi } from "@/lib/client/api";
import { prefetchStock } from "@/lib/client/prefetch";
import { pct, plainPct, priceOf, tone, usd } from "@/lib/format";
import { yahooUrl } from "@/lib/links";

type Row = {
  symbol: string;
  name: string | null;
  exchange: string | null;
  price: number | null;
  prevClose: number | null;
  low52: number | null;
  high52: number | null;
  volume: number | null;
  avgVolume: number | null;
  annualDividend: number | null;
  dividendYield: number | null;
  peTTM: number | null;
};

const shares = (n: number | null) => (n === null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n));

/** The classic "stock look-up" table: exchange, last price, 52-week range, volume, dividend and P/E. */
export function FundamentalsTable({ symbols, onReady }: { symbols: string[]; onReady?: () => void }) {
  const key = symbols.join(",");
  const [data, setData] = useState<{ key: string; rows: Row[]; error: string | null } | null>(null);
  const { prices } = useLivePrices(symbols);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    cachedApi<Row[]>(`/api/market/fundamentals?symbols=${encodeURIComponent(key)}`, 2 * 60_000)
      .then((rows) => !cancelled && setData({ key, rows, error: null }))
      .catch((err) => !cancelled && setData({ key, rows: [], error: err instanceof Error ? err.message : "Unavailable" }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  const ready = !key || data?.key === key;
  useEffect(() => {
    if (ready) onReady?.();
  }, [ready, onReady]);

  if (!ready) return <div className="notice">Loading fundamentals<span className="caret" aria-hidden="true" /></div>;
  if (data?.error) return <div className="error">{data.error}</div>;
  const bySymbol = new Map((data?.rows ?? []).map((r) => [r.symbol, r]));

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Company</th>
            <th scope="col" className="left">Ticker</th>
            <th scope="col" className="left">Exchange</th>
            <th scope="col">Last price</th>
            <th scope="col">Today</th>
            <th scope="col">52-wk range</th>
            <th scope="col">Volume / avg volume</th>
            <th scope="col">Dividend / yield</th>
            <th scope="col">P/E</th>
          </tr>
        </thead>
        <tbody>
          {symbols.map((s) => {
            const r = bySymbol.get(s);
            const live = prices[s];
            const price = live?.price ?? r?.price ?? null;
            const prev = live?.prevClose ?? r?.prevClose ?? null;
            const change = price !== null && prev ? price / prev - 1 : null;
            const money = (n: number | null) => priceOf(s, n);
            return (
              <tr key={s}>
                <td style={{ whiteSpace: "normal", minWidth: 160, fontFamily: "var(--sans)" }}>{r?.name ?? "—"}</td>
                <td className="left">
                  <Link href={`/s/${encodeURIComponent(s)}`} onMouseEnter={() => prefetchStock(s)} style={{ fontWeight: 500 }}>{s}</Link>
                  <a href={yahooUrl(s)} target="_blank" rel="noopener noreferrer" className="faint" style={{ marginLeft: 6, fontSize: 12 }} aria-label={`${s} on Yahoo Finance`}>↗</a>
                </td>
                <td className="left">{r?.exchange ?? "—"}</td>
                <td>{money(price)}</td>
                <td className={tone(change)}>{pct(change)}</td>
                <td>{r?.low52 != null && r?.high52 != null ? `${money(r.low52)} – ${money(r.high52)}` : "—"}</td>
                <td>{shares(r?.volume ?? null)} / {shares(r?.avgVolume ?? null)}</td>
                <td>{r?.annualDividend ? `${usd(r.annualDividend, { digits: 2 })} / ${plainPct(r.dividendYield, 2)}` : r ? "None" : "—"}</td>
                <td>{r?.peTTM != null ? r.peTTM.toFixed(2) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
