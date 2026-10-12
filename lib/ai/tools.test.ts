import { beforeEach, describe, expect, it, vi } from "vitest";

const market = vi.hoisted(() => ({
  quotes: vi.fn(),
  history: vi.fn(),
  search: vi.fn(),
  news: vi.fn(),
  marketNews: vi.fn(),
  peers: vi.fn(),
  symbolContext: vi.fn(),
}));

vi.mock("../market/sources", () => ({ quotes: market.quotes, history: market.history, search: market.search }));
vi.mock("../market/finnhub", () => ({ news: market.news, marketNews: market.marketNews, peers: market.peers }));
vi.mock("./gather", () => ({ symbolContext: market.symbolContext }));

import { UpstreamError } from "../market/http";
import { prepareTool, sample, TOOL_SPECS } from "./tools";

const DAY = 86_400_000;

beforeEach(() => vi.resetAllMocks());

describe("TOOL_SPECS", () => {
  it("describes every tool as a function with an object schema", () => {
    expect(TOOL_SPECS.map((t) => t.name)).toEqual([
      "get_quotes", "get_stock_details", "get_price_history", "get_company_news", "get_market_news", "search_symbols", "get_peers",
    ]);
    for (const spec of TOOL_SPECS) {
      expect(spec).toMatchObject({ type: "function", strict: false, parameters: { type: "object" } });
      expect(spec.description.length).toBeGreaterThan(20);
      expect(spec.parameters).not.toHaveProperty("$schema");
    }
    expect(TOOL_SPECS[0].parameters).toMatchObject({ properties: { symbols: { type: "array" } }, required: ["symbols"] });
  });
});

describe("prepareTool", () => {
  it("fetches quotes and formats them for the model", async () => {
    market.quotes.mockResolvedValue({
      quotes: [{ symbol: "NVDA", price: 110, prevClose: 100, time: Date.UTC(2026, 9, 9, 15) }],
      failed: ["ZZZZ"],
    });
    const tool = prepareTool("get_quotes", '{"symbols":["nvda","ZZZZ"]}');
    expect(tool.status).toBe("Getting quotes for NVDA, ZZZZ");
    const out = await tool.run();
    expect(market.quotes).toHaveBeenCalledWith(["NVDA", "ZZZZ"]);
    expect(out).toContain("NVDA: $110.00 (+10.00% today, previous close $100.00, as of 2026-10-09T15:00:00.000Z)");
    expect(out).toContain("No quote for: ZZZZ");
  });

  it("rejects bad arguments without calling anything", async () => {
    const tool = prepareTool("get_quotes", '{"symbols":[]}');
    expect(await tool.run()).toMatch(/^Error: invalid arguments/);
    expect(await prepareTool("get_quotes", "{not json").run()).toMatch(/^Error: invalid arguments/);
    expect(market.quotes).not.toHaveBeenCalled();
  });

  it("answers an unknown tool name with an error the model can read", async () => {
    const tool = prepareTool("delete_portfolio", "{}");
    expect(tool.status).toBe("Working");
    expect(await tool.run()).toBe("Error: unknown tool delete_portfolio");
  });

  it("turns an upstream failure into an error result instead of throwing", async () => {
    market.peers.mockRejectedValueOnce(new UpstreamError("Finnhub", 429, "Finnhub returned 429 (rate limited)"));
    expect(await prepareTool("get_peers", '{"symbol":"AMD"}').run()).toBe("Error: Finnhub returned 429 (rate limited)");
    // Anything unexpected is logged, and the model only hears that it failed.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    market.peers.mockRejectedValueOnce(new Error("connection string postgres://secret"));
    expect(await prepareTool("get_peers", '{"symbol":"AMD"}').run()).toBe("Error: the lookup failed.");
    expect(logged).toHaveBeenCalled();
  });

  it("summarises price history and samples long series", async () => {
    const end = Date.UTC(2026, 9, 9);
    market.history.mockResolvedValue(Array.from({ length: 250 }, (_, i) => ({ t: end - (249 - i) * DAY, close: 100 + i })));
    const tool = prepareTool("get_price_history", '{"symbol":"AAPL","range":"1y"}');
    expect(tool.status).toBe("Reading AAPL price history (1y)");
    const out = await tool.run();
    expect(market.history).toHaveBeenCalledWith("AAPL", "1y");
    expect(out).toContain("first close $100.00");
    expect(out).toContain("last close $349.00");
    expect(out).toContain("change +249.00%");
    expect(out).toContain("2026-10-09 349.00");
    expect(out.split("\n").filter((l) => /^\d{4}-\d{2}-\d{2} /.test(l)).length).toBeLessThanOrEqual(60);
  });

  it("lists company news with dates, sources and links", async () => {
    market.news.mockResolvedValue([{ time: Date.UTC(2026, 9, 8), headline: "Chips rally", source: "Reuters", url: "https://example.com/n", summary: "Semis rose." }]);
    const out = await prepareTool("get_company_news", '{"symbol":"NVDA","days":3}').run();
    expect(market.news).toHaveBeenCalledWith("NVDA", 3);
    expect(out).toBe("- 2026-10-08 Reuters: Chips rally. Semis rose. https://example.com/n");
  });

  it("says so when a ticker has no data", async () => {
    market.symbolContext.mockResolvedValue(null);
    const out = await prepareTool("get_stock_details", '{"symbol":"QQQQQ"}').run();
    expect(market.symbolContext).toHaveBeenCalledWith("QQQQQ", true, "3m");
    expect(out).toMatch(/No data for QQQQQ/);
  });

  it("caps very long results", async () => {
    market.search.mockResolvedValue(Array.from({ length: 400 }, (_, i) => ({ symbol: `S${i}`, name: "x".repeat(60), type: "Common Stock" })));
    const out = await prepareTool("search_symbols", '{"query":"s"}').run();
    expect(out.length).toBeLessThanOrEqual(8_100);
    expect(out).toMatch(/\(truncated\)$/);
  });
});

describe("sample", () => {
  it("keeps short series whole and always keeps the first and last point", () => {
    expect(sample([1, 2, 3], 5)).toEqual([1, 2, 3]);
    const picked = sample(Array.from({ length: 100 }, (_, i) => i), 10);
    expect(picked).toHaveLength(10);
    expect(picked[0]).toBe(0);
    expect(picked[9]).toBe(99);
  });
});
