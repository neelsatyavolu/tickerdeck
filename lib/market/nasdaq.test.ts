import { describe, expect, it } from "vitest";
import { parseDay, parseExtended, parseHistory, parseNum, parseSummary, parseTargets } from "./nasdaq";

describe("parseNum", () => {
  it("strips currency, commas and percent signs", () => {
    expect(parseNum("$1,234.50")).toBe(1234.5);
    expect(parseNum("777.22")).toBe(777.22);
    expect(parseNum("0.32%")).toBe(0.32);
    expect(parseNum("N/A")).toBeNull();
    expect(parseNum("")).toBeNull();
    expect(parseNum(undefined)).toBeNull();
  });
});

describe("parseDay", () => {
  it("reads MM/DD/YYYY as the US close", () => {
    expect(new Date(parseDay("10/07/2026")!).toISOString()).toBe("2026-10-07T20:00:00.000Z");
    expect(parseDay("2026-10-07")).toBeNull();
  });
});

describe("parseHistory", () => {
  it("sorts ascending and keeps volume", () => {
    const points = parseHistory({
      tradesTable: {
        rows: [
          { date: "10/07/2026", close: "$336.67", volume: "34,147,860" },
          { date: "10/06/2026", close: "$333.63", volume: "30,449,010" },
          { date: "bad", close: "$1" },
        ],
      },
    });
    expect(points.map((p) => p.close)).toEqual([333.63, 336.67]);
    expect(points[1].volume).toBe(34147860);
  });

  it("handles missing data", () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory({ tradesTable: null })).toEqual([]);
  });
});

describe("parseTargets", () => {
  it("maps the consensus and its history", () => {
    const r = parseTargets({
      consensusOverview: { lowPriceTarget: 245, highPriceTarget: 400, priceTarget: 337.51, buy: 15, hold: 9, sell: 4 },
      historicalConsensus: [{ x: 1759276800, y: 255.45, z: { buy: 16, hold: 12, sell: 3, consensus: "Buy" } }],
    });
    expect(r?.targets).toEqual({ low: 245, mean: 337.51, median: null, high: 400, analysts: 28, rating: "buy" });
    expect(r?.history).toEqual([{ t: 1759276800000, target: 255.45, buy: 16, hold: 12, sell: 3 }]);
  });

  it("returns null when there's no coverage", () => {
    expect(parseTargets(null)).toBeNull();
    expect(parseTargets({ consensusOverview: { priceTarget: 0 } })).toBeNull();
  });
});

describe("parseSummary", () => {
  it("reads labelled fields and trims the share-class suffix", () => {
    const s = parseSummary(
      { companyName: "Apple Inc. Common Stock", exchange: "NASDAQ-GS" },
      {
        summaryData: {
          Sector: { label: "Sector", value: "Technology" },
          AnnualizedDividend: { label: "", value: "$1.08" },
          Yield: { label: "", value: "0.32%" },
          MarketCap: { label: "", value: "4,968,150,755,600" },
          ExDividendDate: { label: "", value: "N/A" },
          ShareVolume: { label: "", value: "35,317,997.938384" },
          AverageVolume: { label: "", value: "44,155,968" },
          TodayHighLow: { label: "", value: "$341.57/$335.9" },
        },
      },
      "stocks",
    );
    expect(s).toMatchObject({ name: "Apple Inc.", exchange: "NASDAQ-GS", sector: "Technology", annualDividend: 1.08, marketCap: 4968150755600, exDividendDate: null });
    expect(s.dividendYield).toBeCloseTo(0.0032);
    expect(s).toMatchObject({ volume: 35317997.938384, avgVolume: 44155968, dayHigh: 341.57, dayLow: 335.9 });
  });
});

import { latestQuote, parseLookup } from "./nasdaq";

describe("latestQuote", () => {
  it("uses the last two closes", () => {
    expect(latestQuote("VTSAX", [{ t: 1, close: 185.53 }, { t: 2, close: 184.77 }], new Date("2026-10-10T17:00:00Z"))).toEqual({ symbol: "VTSAX", price: 184.77, prevClose: 185.53, time: 2 });
    expect(latestQuote("X", [{ t: 1, close: 1 }])).toBeNull();
  });

  // Daily points are stamped 20:00 UTC on their trading day. New York is UTC-4 in October.
  const thursday = { t: Date.UTC(2026, 9, 8, 20), close: 184.77 };
  const friday = { t: Date.UTC(2026, 9, 9, 20), close: 185.93 };
  const monday = { t: Date.UTC(2026, 9, 12, 20), close: 186.5 };

  it("shows no move once a new trading day has opened and its close is not in yet", () => {
    const mondayAfternoon = new Date("2026-10-12T17:00:00Z"); // Mon 1:00 PM ET
    expect(latestQuote("VTSAX", [thursday, friday], mondayAfternoon)).toEqual({ symbol: "VTSAX", price: 185.93, prevClose: 185.93, time: friday.t });
    const mondayEvening = new Date("2026-10-12T21:30:00Z"); // Mon 5:30 PM ET, before the NAV posts
    expect(latestQuote("VTSAX", [thursday, friday], mondayEvening)?.prevClose).toBe(185.93);
  });

  it("shows the move once that day has its close", () => {
    const mondayNight = new Date("2026-10-12T23:00:00Z"); // Mon 7:00 PM ET
    expect(latestQuote("VTSAX", [thursday, friday, monday], mondayNight)).toEqual({ symbol: "VTSAX", price: 186.5, prevClose: 185.93, time: monday.t });
  });

  it("keeps the last move before the open and at weekends", () => {
    expect(latestQuote("VTSAX", [thursday, friday], new Date("2026-10-12T13:00:00Z"))?.prevClose).toBe(184.77); // Mon 9:00 AM ET
    expect(latestQuote("VTSAX", [thursday, friday], new Date("2026-10-10T17:00:00Z"))?.prevClose).toBe(184.77); // Saturday
    expect(latestQuote("VTSAX", [thursday, friday], new Date("2026-10-09T21:00:00Z"))?.prevClose).toBe(184.77); // Fri 5 PM ET, NAV posted
  });
});

describe("parseLookup", () => {
  it("keeps stocks, ETFs and mutual funds with readable types", () => {
    expect(
      parseLookup([
        { symbol: "VTSAX", name: "Vanguard Total Stock Market Index Fund Admiral Shares", asset: "MUTUALFUNDS" },
        { symbol: "AAPL", name: "Apple Inc. Common Stock", asset: "STOCKS" },
        { symbol: "ES=F", name: "E-mini", asset: "FUTURES" },
      ]),
    ).toEqual([
      { symbol: "VTSAX", name: "Vanguard Total Stock Market Index Fund Admiral Shares", type: "Mutual fund" },
      { symbol: "AAPL", name: "Apple Inc.", type: "Stock" },
    ]);
  });
});

import { firstClass } from "./nasdaq";

describe("firstClass", () => {
  const delay = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

  it("resolves with the first class that finds something, without waiting for slower ones", async () => {
    const t0 = Date.now();
    const hit = await firstClass((cls) => (cls === "etf" ? delay(10, "found") : cls === "stocks" ? delay(5, null) : delay(500, "late")));
    expect(hit).toEqual({ cls: "etf", value: "found" });
    expect(Date.now() - t0).toBeLessThan(300);
  });

  it("resolves null when every class comes back empty or fails", async () => {
    expect(await firstClass((cls) => (cls === "stocks" ? Promise.reject(new Error("x")) : delay(1, null)))).toBeNull();
  });
});

describe("parseExtended", () => {
  const block = (price: string, change = "-0.34", pct = "-0.10%", ts = "Oct 9, 2026 5:17 PM ET") => ({ lastSalePrice: price, netChange: change, percentageChange: pct, lastTradeTimestamp: ts });
  it("reads after-hours trades against the close", () => {
    expect(parseExtended({ marketStatus: "After-Hours", primaryData: block("$336.30"), secondaryData: block("$336.64", "-3.78", "-1.11%", "Closed at Oct 9, 2026 4:00 PM ET") })).toEqual({
      session: "after",
      price: 336.3,
      close: 336.64,
      change: -0.34,
      changePct: -0.001,
      asOf: "5:17 PM ET",
    });
  });
  it("reads pre-market", () => {
    expect(parseExtended({ marketStatus: "Pre-Market", primaryData: block("$10.50", "0.50", "5.00%", "Oct 9, 2026 8:01 AM ET"), secondaryData: block("$10.00") })?.session).toBe("pre");
  });
  it("is null during the regular session or without data", () => {
    expect(parseExtended({ marketStatus: "Market Open", primaryData: block("$10.00"), secondaryData: null })).toBeNull();
    expect(parseExtended({ marketStatus: "Closed", primaryData: block("$10.00"), secondaryData: block("$10.00") })).toBeNull();
    expect(parseExtended(null)).toBeNull();
  });
});
