import { describe, expect, it } from "vitest";
import { CRYPTO, cryptoInfo, isCrypto, searchCrypto } from "./crypto";

describe("crypto symbols", () => {
  it("names coins the Yahoo way and knows which symbols are crypto", () => {
    expect(isCrypto("BTC-USD")).toBe(true);
    expect(cryptoInfo("ETH-USD")?.name).toBe("Ethereum");
    expect(isCrypto("BRK-B")).toBe(false);
    expect(isCrypto("BTC")).toBe(false);
    expect(isCrypto("^GSPC")).toBe(false);
    expect(cryptoInfo("AAPL")).toBeNull();
  });

  it("only lists symbols the app's symbol format accepts", () => {
    for (const c of CRYPTO) expect(c.symbol).toMatch(/^[A-Z][A-Z0-9.-]{0,9}$/);
    expect(new Set(CRYPTO.map((c) => c.symbol)).size).toBe(CRYPTO.length);
  });

  it("finds coins by ticker, pair or name", () => {
    expect(searchCrypto("btc")[0].symbol).toBe("BTC-USD");
    expect(searchCrypto("BTC-USD")[0].symbol).toBe("BTC-USD");
    expect(searchCrypto("bitcoin").map((c) => c.symbol)).toEqual(["BTC-USD", "BCH-USD"]);
    expect(searchCrypto("ether")[0].symbol).toBe("ETH-USD");
    expect(searchCrypto("  ")).toEqual([]);
  });

  it("doesn't crowd out stocks on a one-letter query", () => {
    expect(searchCrypto("a")).toEqual([]);
    expect(searchCrypto("so").map((c) => c.symbol)).toEqual(["SOL-USD"]);
  });
});
