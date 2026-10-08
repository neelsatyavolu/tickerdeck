import { describe, expect, it } from "vitest";
import { importCsv, normalizeSymbol, parseAmount, parseCsv, parseDate } from "./importCsv";

const YAHOO = `Symbol,Current Price,Date,Time,Change,Open,High,Low,Volume,Trade Date,Purchase Price,Quantity,Commission,High Limit,Low Limit,Comment
AAPL,340.42,2026/10/08,16:00 EDT,3.75,336.8,341.57,335.9,35317997,20250314,212.5,10,,,,"first, lot"
AAPL,340.42,2026/10/08,16:00 EDT,3.75,336.8,341.57,335.9,35317997,20260102,250,2.5,,,,
BRK-B,506.25,2026/10/08,16:00 EDT,0.1,506.1,506.7,504.3,3506275,20240601,410,3,,,,
NVDA,230.48,2026/10/08,16:00 EDT,-6.99,236,238,229,200000000,,,,,,,
BTC-USD,81884,2026/10/08,20:00 UTC,10,1,1,1,1,20250101,60000,0.1,,,,
SHOP.TO,150,2026/10/08,16:00 EDT,1,1,1,1,1,20250101,100,5,,,,
^GSPC,6000,2026/10/08,16:00 EDT,1,1,1,1,1,,,,,,,
`;

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF and blank lines", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n\r\n1,2,3')).toEqual([["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
    expect(parseCsv("﻿x\n")).toEqual([["x"]]);
  });
});

describe("parseAmount / parseDate", () => {
  it("reads money-ish strings", () => {
    expect(parseAmount("$1,234.50")).toBe(1234.5);
    expect(parseAmount("(12.00)")).toBe(-12);
    expect(parseAmount("--")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
  it("reads common date formats and rejects impossible dates", () => {
    expect(parseDate("20250314")).toBe("2025-03-14");
    expect(parseDate("2025-03-14")).toBe("2025-03-14");
    expect(parseDate("3/14/2025")).toBe("2025-03-14");
    expect(parseDate("3/14/25")).toBe("2025-03-14");
    expect(parseDate("20250231")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("normalizeSymbol", () => {
  it("converts Yahoo share classes and rejects non-US listings", () => {
    expect(normalizeSymbol("brk-b")).toEqual({ symbol: "BRK.B" });
    expect(normalizeSymbol("BTC-USD")).toHaveProperty("reason");
    expect(normalizeSymbol("^GSPC")).toHaveProperty("reason");
    expect(normalizeSymbol("SHOP.TO")).toHaveProperty("reason");
    expect(normalizeSymbol("EURUSD=X")).toHaveProperty("reason");
    expect(normalizeSymbol("$$CASH_TX_FILTER")).toEqual({ reason: "Cash row" });
  });
});

describe("importCsv", () => {
  it("reads Yahoo's export: one holding per lot, watchlist rows with zero shares, unsupported rows skipped", () => {
    const r = importCsv(YAHOO);
    expect(r.format).toBe("yahoo");
    expect(r.holdings).toEqual([
      { symbol: "AAPL", shares: 10, cost_basis: 212.5, bought_at: "2025-03-14", note: "first, lot" },
      { symbol: "AAPL", shares: 2.5, cost_basis: 250, bought_at: "2026-01-02", note: null },
      { symbol: "BRK.B", shares: 3, cost_basis: 410, bought_at: "2024-06-01", note: null },
      { symbol: "NVDA", shares: 0, cost_basis: 0, bought_at: null, note: null },
    ]);
    expect(r.skipped.map((s) => [s.line, s.symbol])).toEqual([[6, "BTC-USD"], [7, "SHOP.TO"], [8, "^GSPC"]]);
  });

  it("reads a broker-style file with a total cost column", () => {
    const r = importCsv("Ticker,Qty,Cost Basis Total,Date Acquired\nMSFT,4,\"$2,000.00\",01/15/2026\nTSLA,-2,500,01/15/2026\n");
    expect(r.format).toBe("generic");
    expect(r.holdings).toEqual([{ symbol: "MSFT", shares: 4, cost_basis: 500, bought_at: "2026-01-15", note: null }]);
    expect(r.skipped[0]).toMatchObject({ symbol: "TSLA", reason: expect.stringMatching(/Negative/) });
  });

  it("explains what's wrong with an unusable file", () => {
    expect(() => importCsv("")).toThrow(/empty/);
    expect(() => importCsv("Name,Amount\nfoo,1\n")).toThrow(/Symbol or Ticker/);
  });
});
