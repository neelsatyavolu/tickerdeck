import { describe, expect, it } from "vitest";
import { buildKeyStats } from "./stats";

describe("buildKeyStats", () => {
  it("converts Finnhub percents to fractions and prefers Nasdaq's summary fields", () => {
    const s = buildKeyStats(
      { peTTM: 37.98, grossMarginTTM: 48.65, marketCapitalization: 4897223, "10DayAverageTradingVolume": 34.2, currentDividendYieldTTM: 0.4, "52WeekHigh": 345.34 },
      { name: "Apple Inc.", exchange: "NASDAQ-GS", sector: "Technology", industry: null, assetClass: "stocks", annualDividend: 1.08, exDividendDate: null, dividendYield: 0.0032, marketCap: 4.968e12 },
    );
    expect(s.peTTM).toBe(37.98);
    expect(s.grossMargin).toBeCloseTo(0.4865);
    expect(s.marketCap).toBe(4.968e12);
    expect(s.avgVolume10d).toBeCloseTo(34_200_000);
    expect(s.dividendYield).toBe(0.0032);
    expect(s.high52).toBe(345.34);
    expect(s.beta).toBeNull();
  });

  it("falls back to Finnhub when Nasdaq has nothing", () => {
    const s = buildKeyStats({ marketCapitalization: 1000, currentDividendYieldTTM: 2 }, null);
    expect(s.marketCap).toBe(1e9);
    expect(s.dividendYield).toBeCloseTo(0.02);
    expect(s.name).toBeNull();
  });
});
