import { describe, expect, it } from "vitest";
import { curate, realImage, sourceName, tidyText } from "./news";
import type { NewsItem } from "./types";

const item = (o: Partial<NewsItem>): NewsItem => ({ time: 1, headline: "H", source: "Reuters", url: "https://x.com/a", summary: "", image: null, related: [], ...o });

describe("sourceName", () => {
  it("maps reputable outlets and drops the rest", () => {
    expect(sourceName("Reuters")).toBe("Reuters");
    expect(sourceName("SeekingAlpha")).toBe("Seeking Alpha");
    expect(sourceName("ChartMill")).toBeNull();
    expect(sourceName("GlobeNewswire")).toBeNull();
  });
});

describe("curate", () => {
  it("filters, dedupes, merges tickers and sorts newest first", () => {
    const out = curate([
      item({ time: 1, url: "https://a.com/1", headline: "Apple beats", related: ["AAPL"], image: "https://img/1.jpg" }),
      item({ time: 3, url: "https://a.com/2", headline: "Fed holds", source: "CNBC" }),
      item({ time: 2, url: "https://a.com/1", headline: "Apple beats", related: ["MSFT"] }),
      item({ time: 5, url: "https://a.com/3", headline: "Spam", source: "ChartMill" }),
      item({ time: 4, url: "http://a.com/4", headline: "Insecure" }),
      item({ time: 6, url: "https://b.com/9", headline: "Apple beats!", source: "Yahoo" }),
    ]);
    expect(out.map((n) => n.headline)).toEqual(["Apple beats", "Fed holds"]);
    expect(out[0].related).toEqual(["AAPL", "MSFT"]);
    expect(out[0].image).toBe("https://img/1.jpg");
    expect(out[0].time).toBe(6);
    expect(out[0].source).toBe("Reuters");
  });

  it("drops non-https images", () => {
    expect(curate([item({ image: "http://img/1.jpg" })])[0].image).toBeNull();
  });
});

describe("realImage", () => {
  it("drops outlet logos but keeps photos", () => {
    expect(realImage("https://static2.finnhub.io/file/finnhub/logo/reuters_logo.jpeg")).toBeNull();
    expect(realImage("https://data.bloomberglp.com/company/sites/2/2019/01/logobbg-wht.png")).toBeNull();
    expect(realImage("https://image.cnbcfm.com/api/v1/image/108321059-IMG_9244.jpg?w=1920")).toBe("https://image.cnbcfm.com/api/v1/image/108321059-IMG_9244.jpg?w=1920");
  });
});

describe("tidyText", () => {
  it("strips the outlet suffix and echo summaries", () => {
    expect(tidyText("Stocks rally - Reuters", "Stocks rally  Reuters", "Reuters")).toEqual({ headline: "Stocks rally", summary: "" });
    expect(tidyText("Fed holds", "Officials kept rates steady.", "CNBC")).toEqual({ headline: "Fed holds", summary: "Officials kept rates steady." });
  });
});
