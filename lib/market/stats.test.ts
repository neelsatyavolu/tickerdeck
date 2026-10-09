import { describe, expect, it } from "vitest";
import { buildKeyStats, paysDividend, withHistoryVolume } from "./stats";

describe("buildKeyStats", () => {
  it("converts Finnhub percents to fractions and prefers Nasdaq's summary fields", () => {
    const s = buildKeyStats(
      { peTTM: 37.98, grossMarginTTM: 48.65, marketCapitalization: 4897223, "10DayAverageTradingVolume": 34.2, currentDividendYieldTTM: 0.4, "52WeekHigh": 345.34 },
      { name: "Apple Inc.", exchange: "NASDAQ-GS", sector: "Technology", industry: null, assetClass: "stocks", annualDividend: 1.08, exDividendDate: null, dividendYield: 0.0032, marketCap: 4.968e12, volume: 35e6, avgVolume: 44e6, dayHigh: 341.57, dayLow: 335.9 },
    );
    expect(s.peTTM).toBe(37.98);
    expect(s.grossMargin).toBeCloseTo(0.4865);
    expect(s.marketCap).toBe(4.968e12);
    expect(s.avgVolume10d).toBeCloseTo(34_200_000);
    expect(s.dividendYield).toBe(0.0032);
    expect(s.high52).toBe(345.34);
    expect(s.beta).toBeNull();
    expect(s).toMatchObject({ volume: 35e6, avgVolume: 44e6, dayHigh: 341.57, dayLow: 335.9 });
  });

  it("falls back to Finnhub when Nasdaq has nothing", () => {
    const s = buildKeyStats({ marketCapitalization: 1000, currentDividendYieldTTM: 2 }, null);
    expect(s.marketCap).toBe(1e9);
    expect(s.dividendYield).toBeCloseTo(0.02);
    expect(s.name).toBeNull();
  });
});

describe("withHistoryVolume", () => {
  it("fills missing volume from the last session and a 3-month average", () => {
    const st = buildKeyStats({}, null);
    const points = [{ t: 1, close: 1, volume: 100 }, { t: 2, close: 1, volume: 300 }];
    expect(withHistoryVolume(st, points)).toMatchObject({ volume: 300, avgVolume: 200 });
  });
  it("keeps values the summary already had", () => {
    const st = { ...buildKeyStats({}, null), volume: 5, avgVolume: 6 };
    expect(withHistoryVolume(st, [{ t: 1, close: 1, volume: 100 }])).toMatchObject({ volume: 5, avgVolume: 6 });
  });
});

describe("paysDividend", () => {
  it("knows payers, non-payers and unknowns", () => {
    expect(paysDividend({ annualDividend: 2.12, dividendYield: 0.03, assetClass: "stocks" })).toBe(true);
    expect(paysDividend({ annualDividend: 0, dividendYield: null, assetClass: "stocks" })).toBe(false);
    expect(paysDividend({ annualDividend: null, dividendYield: null, assetClass: "stocks" })).toBe(false);
    expect(paysDividend({ annualDividend: null, dividendYield: null, assetClass: "index" })).toBeNull();
  });
});
