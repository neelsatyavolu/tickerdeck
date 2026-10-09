import { describe, expect, it } from "vitest";
import { cleanName, searchListings, type Listing } from "./symbolSearch";

const listings: Listing[] = [
  ["AAPL", "Apple Inc.", "Stock", 4.9e12],
  ["APLE", "Apple Hospitality REIT, Inc.", "Stock", 3e9],
  ["APP", "AppLovin Corporation", "Stock", 1.5e11],
  ["NKE", "Nike, Inc.", "Stock", 1.1e11],
  ["KO", "Coca-Cola Company (The)", "Stock", 3.8e11],
  ["BRK.A", "Berkshire Hathaway Inc.", "Stock", 1e12],
  ["BRK.B", "Berkshire Hathaway Inc.", "Stock", 1e12],
  ["SPY", "SPDR S&P 500 ETF Trust", "ETF", 0],
  ["EBAY", "eBay Inc.", "Stock", 5e10],
];

describe("searchListings", () => {
  it("puts the exact ticker first, then prefixes, bigger companies first", () => {
    expect(searchListings(listings, "app").map((r) => r.symbol)).toEqual(["APP", "AAPL", "APLE"]);
    expect(searchListings(listings, "AAPL")[0].symbol).toBe("AAPL");
  });

  it("finds companies by name, case-insensitively", () => {
    expect(searchListings(listings, "nike")[0].symbol).toBe("NKE");
    expect(searchListings(listings, "coca")[0].symbol).toBe("KO");
    expect(searchListings(listings, "ebay")[0].symbol).toBe("EBAY");
    expect(searchListings(listings, "berkshire hathaway").map((r) => r.symbol)).toEqual(["BRK.A", "BRK.B"]);
    expect(searchListings(listings, "s&p 500")[0].symbol).toBe("SPY");
  });

  it("returns nothing for an empty query", () => {
    expect(searchListings(listings, "  ")).toEqual([]);
  });
});

describe("cleanName", () => {
  it("drops share-class boilerplate", () => {
    expect(cleanName("Agilent Technologies Inc. Common Stock")).toBe("Agilent Technologies Inc.");
    expect(cleanName("Alphabet Inc. Class C Capital Stock")).toBe("Alphabet Inc. Class C Capital Stock");
    expect(cleanName("Meta Platforms, Inc. Class A Common Stock")).toBe("Meta Platforms, Inc.");
  });
});
