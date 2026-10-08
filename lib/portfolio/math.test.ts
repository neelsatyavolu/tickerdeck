import { describe, expect, it } from "vitest";
import { aggregatePositions, portfolioTotals, uniqueSymbols } from "./math";
import type { Holding } from "./types";

const lot = (symbol: string, shares: number, cost_basis: number): Holding => ({
  id: `${symbol}-${shares}-${cost_basis}`,
  portfolio_id: "p1",
  symbol,
  shares,
  cost_basis,
  bought_at: null,
  note: null,
});

describe("aggregatePositions", () => {
  it("merges lots and computes gains and weights", () => {
    const positions = aggregatePositions(
      [lot("AAPL", 10, 100), lot("AAPL", 10, 200), lot("MSFT", 5, 300)],
      { AAPL: { price: 180, prevClose: 170 }, MSFT: { price: 400, prevClose: 410 } },
    );
    const aapl = positions.find((p) => p.symbol === "AAPL")!;
    expect(aapl).toMatchObject({ shares: 20, cost: 3000, avgCost: 150, marketValue: 3600, dayChange: 200, totalGain: 600 });
    expect(aapl.totalGainPct).toBeCloseTo(0.2);
    expect(aapl.dayChangePct).toBeCloseTo(10 / 170);
    const msft = positions.find((p) => p.symbol === "MSFT")!;
    expect(msft.dayChange).toBe(-50);
    expect(aapl.weight! + msft.weight!).toBeCloseTo(1);
    expect(positions[0].symbol).toBe("AAPL"); // largest first
  });

  it("leaves unpriced symbols null instead of zero", () => {
    const [p] = aggregatePositions([lot("ZZZZ", 1, 10)], {});
    expect(p.price).toBeNull();
    expect(p.marketValue).toBeNull();
    expect(p.weight).toBeNull();
  });

  it("treats zero-share watchlist rows as price-only", () => {
    const [p] = aggregatePositions([lot("NVDA", 0, 0)], { NVDA: { price: 100, prevClose: 90 } });
    expect(p.marketValue).toBe(0);
    expect(p.totalGain).toBeNull();
    expect(p.dayChangePct).toBeCloseTo(1 / 9);
  });
});

describe("portfolioTotals", () => {
  it("sums priced positions and reports missing ones", () => {
    const positions = aggregatePositions([lot("A", 10, 10), lot("B", 1, 50)], { A: { price: 12, prevClose: 11 } });
    const t = portfolioTotals({ kind: "holdings", starting_cash: null }, positions);
    expect(t).toMatchObject({ marketValue: 120, cost: 100, dayChange: 10, totalGain: 20, cash: 0, missing: ["B"] });
    expect(t.totalGainPct).toBeCloseTo(0.2);
    expect(t.dayChangePct).toBeCloseTo(10 / 110);
  });

  it("counts uninvested cash for paper portfolios", () => {
    const positions = aggregatePositions([lot("A", 10, 10)], { A: { price: 15, prevClose: 15 } });
    const t = portfolioTotals({ kind: "paper", starting_cash: 1000 }, positions);
    expect(t.cash).toBe(900);
    expect(t.totalGain).toBe(50);
    expect(t.totalGainPct).toBeCloseTo(0.05);
  });

  it("handles an empty portfolio", () => {
    const t = portfolioTotals({ kind: "holdings", starting_cash: null }, []);
    expect(t).toMatchObject({ marketValue: 0, totalGain: 0, dayChangePct: null, totalGainPct: null });
  });
});

describe("uniqueSymbols", () => {
  it("dedupes and sorts across portfolios", () => {
    expect(uniqueSymbols([{ holdings: [lot("B", 1, 1), lot("A", 1, 1)] }, { holdings: [lot("A", 2, 2)] }])).toEqual(["A", "B"]);
  });
});
