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

  it("lists the watchlist separately from holdings", () => {
    const prompt = buildSystemPrompt({ now: new Date(), portfolios: [], symbols: [], watchlist: [{ symbol: "VTSAX", name: "Vanguard Total", price: 184.77, prevClose: 185.53 }] });
    expect(prompt).toContain("## Watchlist (followed, not held)");
    expect(prompt).toContain("- VTSAX (Vanguard Total): price $184.77 (-0.41% today)");
  });

  it("says so when there are no portfolios", () => {
    const prompt = buildSystemPrompt({ now: new Date(), portfolios: [], symbols: [] });
    expect(prompt).toContain("no portfolios yet");
    expect(prompt).not.toContain("Symbols in focus");
  });
});
