import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./context";
import { INSIGHT_CATEGORIES } from "./insights";
import { buildInsightsPrompt } from "./insightsPrompt";
import { aggregatePositions, portfolioTotals } from "../portfolio/math";
import type { Portfolio } from "../portfolio/types";

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
const input = {
  now: new Date("2026-10-12T17:00:00Z"),
  portfolios: [{ portfolio, positions, totals: portfolioTotals(portfolio, positions) }],
  watchlists: [{ name: "Watching", primary: true, items: [{ symbol: "MSFT", name: "Microsoft", price: 400, prevClose: 390 }] }],
  symbols: [],
};

describe("buildInsightsPrompt", () => {
  const prompt = buildInsightsPrompt(input);

  it("carries the same data the assistant sees", () => {
    expect(prompt).toContain("2026-10-12");
    expect(prompt).toContain("### Core");
    expect(prompt).toContain("AAPL: 10 sh");
    expect(prompt).toContain("MSFT (Microsoft)");
    // The data sections are shared with the chat prompt, not re-derived.
    const shared = prompt.slice(prompt.indexOf("## Portfolios"));
    expect(buildSystemPrompt(input)).toContain(shared);
  });

  it("asks for JSON in the known categories and leaves out the dashboard guide", () => {
    for (const c of INSIGHT_CATEGORIES) expect(prompt).toContain(c);
    expect(prompt).toContain("JSON array");
    expect(prompt).not.toContain("dashboard");
  });
});
