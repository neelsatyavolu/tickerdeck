import { describe, expect, it } from "vitest";
import { storiesFor } from "./newsScope";
import type { NewsItem } from "./types";

const item = (o: Partial<NewsItem>): NewsItem => ({ time: 1, headline: "H", source: "Reuters", url: "https://x.com/a", summary: "", image: null, related: [], ...o });

describe("storiesFor", () => {
  it("keeps only stories tagged with one of the symbols, newest first", () => {
    const out = storiesFor(
      [
        item({ time: 1, url: "https://a.com/1", related: ["AAPL"] }),
        item({ time: 3, url: "https://a.com/2", related: ["TSLA"] }),
        item({ time: 2, url: "https://a.com/3", related: ["NVDA", "MSFT"] }),
        item({ time: 4, url: "https://a.com/4" }),
      ],
      ["AAPL", "MSFT"],
    );
    expect(out.map((n) => n.url)).toEqual(["https://a.com/3", "https://a.com/1"]);
  });

  it("lists a story once when several feeds carry it", () => {
    const story = item({ url: "https://a.com/1", related: ["AAPL"] });
    expect(storiesFor([story, { ...story }], ["AAPL"])).toHaveLength(1);
  });

  it("returns nothing for an empty list or untagged stories", () => {
    expect(storiesFor([item({ related: ["AAPL"] })], [])).toEqual([]);
    expect(storiesFor([item({ related: undefined })], ["AAPL"])).toEqual([]);
  });
});
