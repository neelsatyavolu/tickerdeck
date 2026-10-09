import { describe, expect, it } from "vitest";
import { buildSystemPrompt, mentionedSymbols } from "./context";
import { aggregatePositions, portfolioTotals } from "../portfolio/math";
import type { Portfolio } from "../portfolio/types";

describe("mentionedSymbols", () => {
  it("finds $tickers and bare caps words but skips common acronyms", () => {
    expect(mentionedSymbols("Should I trim $nvda or AAPL? The CEO said AI demand is up")).toEqual(["NVDA", "AAPL"]);
    expect(mentionedSymbols("compare BRK.B with MSFT")).toEqual(["BRK.B", "MSFT"]);
    expect(mentionedSymbols("A B C D E F GG HH II JJ", 2)).toEqual(["GG", "HH"]);
  });
});

describe("buildSystemPrompt", () => {
  const portfolio: Portfolio = {
    id: "p1",
    name: "Core",
    kind: "holdings",
    starting_cash: null,
    start_date: null,
    created_at: "2026-01-01",
    holdings: [{ id: "h1", portfolio_id: "p1", symbol: "AAPL", shares: 10, cost_basis: 100, bought_at: null, note: null }],
  };
  const positions = aggregatePositions(portfolio.holdings, { AAPL: { price: 150, prevClose: 140 } });
  const totals = portfolioTotals(portfolio, positions);

  it("includes holdings, focus marker and symbol details", () => {
    const prompt = buildSystemPrompt({
      now: new Date("2026-10-08T17:00:00Z"),
      portfolios: [{ portfolio, positions, totals }],
      focusPortfolioId: "p1",
      symbols: [{
        symbol: "AAPL",
        quote: { symbol: "AAPL", price: 150, prevClose: 140, time: Date.parse("2026-10-08T16:59:00Z") },
        profile: null,
        targets: { low: 120, mean: 170, median: 172, high: 200, analysts: 30, rating: "buy" },
        recommendations: [],
        news: [{ time: Date.parse("2026-10-07T12:00:00Z"), headline: "Apple ships thing", source: "Reuters", url: "https://x", summary: "" }],
        forecast: null,
      }],
    });
    expect(prompt).toContain("Today is 2026-10-08");
    expect(prompt).toContain("### Core (currently open) [portfolioId p1]");
    expect(prompt).toContain("```tickerdeck-panels");
    expect(prompt).toContain("- AAPL: 10 sh @ avg $100.00 · price $150.00 (+7.14% today) · value $1,500.00 · gain $500.00 (+50.00%)");
    expect(prompt).toContain("analyst targets: low $120.00 · mean $170.00");
    expect(prompt).toContain("2026-10-07 Reuters: Apple ships thing");
    expect(prompt).toContain("cannot change portfolios");
  });

  it("lists each watchlist separately from holdings", () => {
    const prompt = buildSystemPrompt({
      now: new Date(),
      portfolios: [],
      symbols: [],
      watchlists: [
        { name: "Watchlist", primary: true, items: [{ symbol: "VTSAX", name: "Vanguard Total", price: 184.77, prevClose: 185.53 }] },
        { name: "Chips", primary: false, items: [{ symbol: "AMD", name: null, price: 100, prevClose: 100 }] },
        { name: "Empty", primary: false, items: [] },
      ],
    });
    expect(prompt).toContain("## Watchlists (followed, not held)");
    expect(prompt).toContain("### Watchlist (primary)");
    expect(prompt).toContain("### Chips");
    expect(prompt).not.toContain("### Empty");
    expect(prompt).toContain("- VTSAX (Vanguard Total): price $184.77 (-0.41% today)");
  });

  it("says so when there are no portfolios", () => {
    const prompt = buildSystemPrompt({ now: new Date(), portfolios: [], symbols: [] });
    expect(prompt).toContain("no portfolios yet");
    expect(prompt).not.toContain("Symbols in focus");
  });
});

import { statsLines } from "./context";
import { buildKeyStats } from "../market/stats";

describe("statsLines", () => {
  it("labels volume and valuation so the assistant can quote them", () => {
    const st = buildKeyStats({ peTTM: 25.5, epsTTM: 7.9 }, { name: "Alphabet", exchange: "NASDAQ-GS", sector: "Technology", industry: null, assetClass: "stocks", annualDividend: null, exDividendDate: null, dividendYield: null, marketCap: 2.1e12, volume: 21_500_000, avgVolume: 28_000_000, dayHigh: 251, dayLow: 246 });
    const text = statsLines(st, "GOOG").join("\n");
    expect(text).toContain("volume today 21.50M shares");
    expect(text).toContain("average daily volume 28.00M shares");
    expect(text).toContain("day range $246.00 – $251.00");
    expect(text).toContain("P/E (TTM) 25.5");
  });
});

describe("symbol blocks for the worksheet", () => {
  it("gives an index its level in points, its exchange note and 10-year return", () => {
    const prompt = buildSystemPrompt({
      now: new Date("2026-10-09T15:00:00Z"),
      portfolios: [],
      symbols: [{
        symbol: "^DJI",
        quote: { symbol: "^DJI", price: 51231.64, prevClose: 51179.87, time: Date.parse("2026-10-09T14:59:00Z") },
        profile: null,
        targets: null,
        recommendations: [],
        news: [],
        forecast: null,
        stats: { ...buildKeyStats({}, null), name: "Dow Jones Industrial Average", assetClass: "index" },
        returns: [{ label: "1Y", value: 0.099 }, { label: "10Y", value: 1.832 }],
      }],
    });
    expect(prompt).toContain("price 51,231.64 · prev close 51,179.87 (+0.10%)");
    expect(prompt).toContain("exchange index (not traded)");
    expect(prompt).toContain("returns: 1Y +9.90% · 10Y +183.20%");
  });
});
