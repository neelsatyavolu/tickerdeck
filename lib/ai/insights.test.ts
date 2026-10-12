import { describe, expect, it } from "vitest";
import { isStale, MAX_INSIGHTS, parseInsights, readAnswer, STALE_MS } from "./insights";

const item = (over: object = {}) => ({ category: "Risk", title: "NVDA is 41% of Core", body: "One position drives most of the portfolio's swings.", symbols: ["NVDA"], tone: "down", sources: [], ...over });

describe("readAnswer", () => {
  it("joins the text and keeps the cited pages", () => {
    const raw = ['{"s":"Searching the web"}', '{"t":"[{"}', '{"t":"}]"}', '{"src":[{"url":"https://example.com/a","title":"A"}]}', '{"done":true}', ""].join("\n");
    expect(readAnswer(raw)).toEqual({ text: "[{}]", error: null, sources: [{ url: "https://example.com/a", title: "A" }] });
  });

  it("reports the stream's error", () => {
    expect(readAnswer('{"t":"partial"}\n{"e":"Could not reach the model."}\n')).toEqual({ text: "partial", error: "Could not reach the model.", sources: [] });
  });
});

describe("parseInsights", () => {
  it("reads a bare JSON array", () => {
    expect(parseInsights(JSON.stringify([item()]))).toEqual([item()]);
  });

  it("reads an array inside a code fence or surrounding prose", () => {
    const text = "Here you go:\n```json\n" + JSON.stringify([item()]) + "\n```\nHope that helps.";
    expect(parseInsights(text)).toHaveLength(1);
  });

  it("reads an object that wraps the list", () => {
    expect(parseInsights(JSON.stringify({ insights: [item()] }))).toHaveLength(1);
  });

  it("drops malformed items and keeps the rest", () => {
    const out = parseInsights(JSON.stringify([item(), item({ category: "Horoscope" }), item({ title: "" }), "nope", item({ title: "Second" })]));
    expect(out.map((i) => i.title)).toEqual(["NVDA is 41% of Core", "Second"]);
  });

  it("fills in what the model left out", () => {
    const out = parseInsights(JSON.stringify([{ category: "Market", title: "Stocks fell", body: "The S&P 500 lost 1.2%." }]));
    expect(out).toEqual([{ category: "Market", title: "Stocks fell", body: "The S&P 500 lost 1.2%.", symbols: [], tone: "neutral", sources: [] }]);
  });

  it("upper-cases tickers and drops ones that aren't tickers", () => {
    const out = parseInsights(JSON.stringify([item({ symbols: ["nvda", "^gspc", "brk.b", "not a ticker", 7] })]));
    expect(out[0].symbols).toEqual(["NVDA", "^GSPC", "BRK.B"]);
  });

  it("keeps only sources the model actually cited", () => {
    const sources = [{ url: "https://example.com/a", title: "A" }, { url: "https://made-up.example/b", title: "B" }, { url: "javascript:alert(1)", title: "Bad" }];
    const out = parseInsights(JSON.stringify([item({ sources })]), [{ url: "https://example.com/a", title: "Cited A" }]);
    expect(out[0].sources).toEqual([{ url: "https://example.com/a", title: "A" }]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_INSIGHTS + 5 }, (_, i) => item({ title: `Insight ${i}` }));
    expect(parseInsights(JSON.stringify(many))).toHaveLength(MAX_INSIGHTS);
  });

  it("returns nothing for text that isn't JSON", () => {
    expect(parseInsights("I could not find anything.")).toEqual([]);
    expect(parseInsights("[not json]")).toEqual([]);
    expect(parseInsights("")).toEqual([]);
  });
});

describe("isStale", () => {
  const now = Date.parse("2026-10-12T20:00:00Z");
  it("is stale once a day old", () => {
    expect(isStale(new Date(now - STALE_MS + 60_000).toISOString(), now)).toBe(false);
    expect(isStale(new Date(now - STALE_MS - 60_000).toISOString(), now)).toBe(true);
  });
  it("treats an unreadable date as stale", () => {
    expect(isStale("never", now)).toBe(true);
  });
});
