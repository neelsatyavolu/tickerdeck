import type { Holding, Portfolio, Quote } from "./types";

export type Position = {
  symbol: string;
  shares: number;
  cost: number;
  avgCost: number;
  price: number | null;
  prevClose: number | null;
  marketValue: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  totalGain: number | null;
  totalGainPct: number | null;
  weight: number | null;
};

export type Totals = {
  marketValue: number;
  cash: number;
  cost: number;
  dayChange: number;
  dayChangePct: number | null;
  totalGain: number;
  totalGainPct: number | null;
  /** Symbols held but without a price yet; totals exclude them. */
  missing: string[];
};

const pct = (num: number, den: number) => (den > 0 ? num / den : null);

/** Lots of the same symbol merge into one position. */
export function aggregatePositions(holdings: Holding[], quotes: Record<string, Quote | undefined>): Position[] {
  const bySymbol = new Map<string, { shares: number; cost: number }>();
  for (const h of holdings) {
    const prev = bySymbol.get(h.symbol) ?? { shares: 0, cost: 0 };
    bySymbol.set(h.symbol, { shares: prev.shares + h.shares, cost: prev.cost + h.shares * h.cost_basis });
  }

  const rows = [...bySymbol].map(([symbol, { shares, cost }]) => {
    const q = quotes[symbol];
    const price = q?.price ?? null;
    const prevClose = q?.prevClose ?? null;
    const marketValue = price === null ? null : shares * price;
    const dayChange = price === null || prevClose === null ? null : shares * (price - prevClose);
    return {
      symbol,
      shares,
      cost,
      avgCost: shares > 0 ? cost / shares : 0,
      price,
      prevClose,
      marketValue,
      dayChange,
      dayChangePct: price === null || !prevClose ? null : (price - prevClose) / prevClose,
      totalGain: marketValue === null || shares === 0 ? null : marketValue - cost,
      totalGainPct: marketValue === null ? null : pct(marketValue - cost, cost),
      weight: null as number | null,
    };
  });

  const total = rows.reduce((s, r) => s + (r.marketValue ?? 0), 0);
  return rows
    .map((r) => ({ ...r, weight: r.marketValue === null || total === 0 ? null : r.marketValue / total }))
    .sort((a, b) => (b.marketValue ?? -1) - (a.marketValue ?? -1) || a.symbol.localeCompare(b.symbol));
}

export function portfolioTotals(portfolio: Pick<Portfolio, "kind" | "starting_cash">, positions: Position[]): Totals {
  const priced = positions.filter((p) => p.marketValue !== null);
  const marketValue = priced.reduce((s, p) => s + (p.marketValue ?? 0), 0);
  const cost = priced.reduce((s, p) => s + p.cost, 0);
  const dayChange = priced.reduce((s, p) => s + (p.dayChange ?? 0), 0);
  const allCost = positions.reduce((s, p) => s + p.cost, 0);
  const isPaper = portfolio.kind === "paper" && portfolio.starting_cash !== null;
  const cash = isPaper ? (portfolio.starting_cash ?? 0) - allCost : 0;
  const basis = isPaper ? portfolio.starting_cash ?? 0 : cost;
  // Unpriced positions count at cost so a missing quote doesn't read as a loss.
  const unpricedCost = allCost - cost;
  const totalGain = isPaper ? marketValue + unpricedCost + cash - basis : marketValue - cost;

  return {
    marketValue,
    cash,
    cost,
    dayChange,
    dayChangePct: pct(dayChange, marketValue - dayChange),
    totalGain,
    totalGainPct: pct(totalGain, basis),
    missing: positions.filter((p) => p.marketValue === null && p.shares > 0).map((p) => p.symbol),
  };
}

export function uniqueSymbols(portfolios: Pick<Portfolio, "holdings">[]): string[] {
  return [...new Set(portfolios.flatMap((p) => p.holdings.map((h) => h.symbol)))].sort();
}
