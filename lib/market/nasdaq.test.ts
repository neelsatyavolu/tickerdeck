import { describe, expect, it } from "vitest";
import { parseDay, parseHistory, parseNum, parseSummary, parseTargets } from "./nasdaq";

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
        },
      },
      "stocks",
    );
    expect(s).toMatchObject({ name: "Apple Inc.", exchange: "NASDAQ-GS", sector: "Technology", annualDividend: 1.08, marketCap: 4968150755600, exDividendDate: null });
    expect(s.dividendYield).toBeCloseTo(0.0032);
  });
});
