import { describe, expect, it } from "vitest";
import { parseBars, parseQuotes, stitch } from "./cnbc";
import { isIndex, searchIndexes } from "./indexes";

describe("parseQuotes", () => {
  it("maps CNBC symbols back to ours and parses formatted numbers", () => {
    const q = parseQuotes(
      { FormattedQuoteResult: { FormattedQuote: [{ symbol: ".SPX", last: "7,765.36", previous_day_closing: "7,801.77", last_time: "2026-10-08T16:46:43.000-0400" }, { symbol: ".XXX", last: "1", previous_day_closing: "1" }] } },
      new Map([[".SPX", "^GSPC"]]),
    );
    expect(q).toEqual([{ symbol: "^GSPC", price: 7765.36, prevClose: 7801.77, time: Date.parse("2026-10-08T20:46:43.000Z") }]);
  });
});

describe("parseBars / stitch", () => {
  it("sorts bars and puts weekly history before the daily series", () => {
    const daily = parseBars({ barData: { priceBars: [{ close: "11", tradeTimeinMills: 20 }, { close: "10", tradeTimeinMills: 10 }] } });
    expect(daily).toEqual([{ t: 10, close: 10, volume: undefined }, { t: 20, close: 11, volume: undefined }]);
    const weekly = [{ t: 1, close: 5 }, { t: 15, close: 9 }];
    expect(stitch(daily, weekly).map((p) => p.t)).toEqual([1, 10, 20]);
  });
});

describe("indexes", () => {
  it("finds indexes by common names", () => {
    expect(searchIndexes("dow")[0].symbol).toBe("^DJI");
    expect(searchIndexes("s&p")[0].symbol).toBe("^GSPC");
    expect(searchIndexes("nasdaq").map((i) => i.symbol)).toEqual(["^IXIC", "^NDX"]);
    expect(searchIndexes("^vix")[0].symbol).toBe("^VIX");
    expect(searchIndexes("apple")).toEqual([]);
    expect(isIndex("^GSPC")).toBe(true);
    expect(isIndex("SPY")).toBe(false);
  });
});
