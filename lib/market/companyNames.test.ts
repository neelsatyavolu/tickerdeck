import { describe, expect, it } from "vitest";
import { namedSymbols } from "./companyNames";

describe("namedSymbols", () => {
  it("maps the worksheet's companies and indexes", () => {
    expect(namedSymbols("Nike, Facebook, Apple, Tesla, Costco, ebay, Coca-Cola, Starbucks, Berkshire Hathaway A")).toEqual(["NKE", "META", "AAPL", "TSLA", "COST", "EBAY", "KO", "SBUX", "BRK.A"]);
    expect(namedSymbols("What is the Dow Jones at right now, and the NASDAQ?")).toEqual(["^DJI", "^IXIC"]);
    expect(namedSymbols("how did the S&P 500 do")).toEqual(["^GSPC"]);
  });

  it("prefers the longer name and ignores partial words", () => {
    expect(namedSymbols("Berkshire Hathaway B vs Nasdaq-100")).toEqual(["BRK.B", "^NDX"]);
    expect(namedSymbols("snapshot of my targets")).toEqual([]);
    expect(namedSymbols("what's the price target")).toEqual([]);
  });
});
