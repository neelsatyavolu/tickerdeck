import { describe, expect, it } from "vitest";
import { buildTemplate, TEMPLATES, wallRows } from "./templates";
import { isTidy } from "./tidy";

const ctx = { portfolios: [{ id: "11111111-1111-4111-8111-111111111111", name: "Core", symbols: ["AAPL", "VTSAX"] }], watchlist: ["NVDA"], symbol: "DHT" };

describe("templates", () => {
  it("offers seven layouts that all validate", () => {
    expect(TEMPLATES).toHaveLength(7);
    for (const t of TEMPLATES) {
      const d = buildTemplate(t.id, ctx);
      expect(d.panels.length).toBeGreaterThan(3);
      expect(new Set(d.panels.map((p) => p.id)).size).toBe(d.panels.length);
    }
  });

  it("builds the portfolio layout from the user's portfolio and the deep dive from the symbol", () => {
    const p = buildTemplate("portfolio", ctx);
    expect(p.panels[0]).toMatchObject({ type: "portfolio", portfolioId: ctx.portfolios[0].id });
    expect(p.panels.find((x) => x.type === "compare")?.symbols).toEqual(["AAPL", "VTSAX", "^GSPC"]);
    const s = buildTemplate("stock", ctx);
    expect(s.name).toBe("DHT deep dive");
    expect(s.panels.find((x) => x.type === "price")?.symbols).toEqual(["DHT"]);
  });

  it("still works for a brand-new user", () => {
    const d = buildTemplate("portfolio", { portfolios: [], watchlist: [] });
    expect(d.panels.some((p) => p.type === "portfolio")).toBe(false);
    expect(d.panels[0].type).toBe("heatmap");
  });
});

describe("wall layout", () => {
  const many = { portfolios: [{ id: "11111111-1111-4111-8111-111111111111", name: "Core", symbols: ["AAPL", "MSFT"] }, { id: "22222222-2222-4222-8222-222222222222", name: "Play", symbols: ["MSFT", "DHT"] }], watchlist: ["NVDA", "^GSPC", "AAPL"] };

  const charts = (panels: { type: string; symbols: string[] }[]) => panels.filter((p) => p.type === "price").map((p) => p.symbols[0]);
  const list = (n: number) => Array.from({ length: n }, (_, i) => `S${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`);

  it("gives a short list prices, then a chart and headlines per symbol, then the numbers and market news", () => {
    const d = buildTemplate("wall", { portfolios: [], watchlist: ["DHT", "CTVA", "AGIO"], source: "watchlist" });
    expect(d.panels.map((p) => `${p.type}:${p.width}`)).toEqual([
      "tiles:12",
      "price:4", "price:4", "price:4",
      "news:4", "news:4", "news:4",
      "lookup:12",
      "returns:8", "news:4",
    ]);
    expect(d.panels.filter((p) => p.type === "news").map((p) => p.symbols[0])).toEqual(["DHT", "CTVA", "AGIO", "^GSPC"]);
    expect(d.panels.at(-1)?.title).toBe("Market news");
  });

  it("keeps each symbol's headlines under its chart, and skips them for indexes and crypto", () => {
    const d = buildTemplate("wall", { ...many, source: "all" });
    expect(d.name).toBe("Everything wall");
    expect(charts(d.panels)).toEqual(["AAPL", "MSFT", "DHT", "NVDA", "^GSPC"]);
    expect(d.panels.slice(1, 9).map((p) => `${p.type}:${p.symbols[0]}:${p.width}`)).toEqual([
      "price:AAPL:4", "price:MSFT:4", "price:DHT:4",
      "news:AAPL:4", "news:MSFT:4", "news:DHT:4",
      "price:NVDA:6", "price:^GSPC:6",
    ]);
    expect(d.panels[9]).toMatchObject({ type: "news", symbols: ["NVDA"], width: 12 });
    const coins = buildTemplate("wall", { portfolios: [], watchlist: ["BTC-USD", "^VIX"], source: "watchlist" });
    expect(coins.panels.filter((p) => p.type === "news").map((p) => p.symbols[0])).toEqual(["^GSPC"]);
  });

  it("swaps per-symbol headlines for a heatmap and movers once the list is long", () => {
    const d = buildTemplate("wall", { portfolios: [], watchlist: list(20), source: "watchlist" });
    expect(d.panels.slice(0, 2).map((p) => `${p.type}:${p.width}`)).toEqual(["heatmap:8", "movers:4"]);
    expect(charts(d.panels)).toHaveLength(20);
    expect(d.panels.filter((p) => p.type === "news").map((p) => p.symbols[0])).toEqual(["^GSPC"]);
    expect(d.panels.slice(-3).map((p) => p.type)).toEqual(["lookup", "returns", "news"]);
  });

  it("sizes the charts to the symbol count so every row spans the grid", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17].map(wallRows)).toEqual([
      [1], [2], [3], [2, 2], [3, 2], [3, 3], [4, 3], [4, 4], [3, 3, 3], [4, 3, 3], [4, 4, 4, 4], [4, 4, 3, 3, 3],
    ]);
    for (let n = 1; n <= 40; n++) {
      expect(isTidy(buildTemplate("wall", { portfolios: [], watchlist: list(n), source: "watchlist" }).panels)).toBe(true);
    }
  });

  it("can use a custom watchlist, and 'all' includes every list", () => {
    const lists = { ...many, watchlists: [{ id: "c1", name: "Chips", symbols: ["AMD", "NVDA"] }] };
    const chips = buildTemplate("wall", { ...lists, source: "list:c1" });
    expect(chips.name).toBe("Chips wall");
    expect(charts(chips.panels)).toEqual(["AMD", "NVDA"]);
    expect(charts(buildTemplate("wall", { ...lists, source: "all" }).panels)).toContain("AMD");
  });

  it("explains an empty source instead of inventing symbols", () => {
    expect(() => buildTemplate("wall", { portfolios: [], watchlist: [], source: "watchlist" })).toThrow(/watchlist is empty/);
    expect(() => buildTemplate("wall", { portfolios: [], watchlist: [] })).toThrow(/Nothing to show/);
  });

  it("can be limited to one portfolio or the watchlist, and stays within 40 panels", () => {
    expect(buildTemplate("wall", { ...many, source: many.portfolios[1].id }).name).toBe("Play wall");
    expect(charts(buildTemplate("wall", { ...many, source: "watchlist" }).panels)).toEqual(["NVDA", "^GSPC", "AAPL"]);
    expect(buildTemplate("wall", { portfolios: [], watchlist: list(60), source: "watchlist" }).panels).toHaveLength(40);
  });
});

describe("display board layout", () => {
  const many = { portfolios: [{ id: "11111111-1111-4111-8111-111111111111", name: "Core", symbols: ["AAPL", "MSFT"] }], watchlist: ["NVDA", "^GSPC", "AAPL"] };

  it("leads with index tiles, then big quote tiles for the chosen symbols", () => {
    const d = buildTemplate("board", { ...many, source: "watchlist" });
    expect(d.name).toBe("Watchlist board");
    expect(d.panels.map((p) => p.type)).toEqual(["tiles", "tiles", "heatmap", "movers"]);
    expect(d.panels[0].symbols).toContain("^GSPC");
    expect(d.panels[1].symbols).toEqual(["NVDA", "^GSPC", "AAPL"]);
    expect(d.panels.slice(0, 2).every((p) => p.width === 12)).toBe(true);
  });

  it("splits a long list into tile panels of twelve and keeps every symbol", () => {
    const symbols = Array.from({ length: 30 }, (_, i) => `S${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`);
    const d = buildTemplate("board", { portfolios: [], watchlist: symbols, source: "watchlist" });
    const tiles = d.panels.filter((p) => p.type === "tiles").slice(1);
    expect(tiles.map((p) => p.symbols.length)).toEqual([12, 12, 6]);
    expect(tiles.flatMap((p) => p.symbols)).toEqual(symbols);
  });

  it("skips the heatmap and movers for a single symbol, and explains an empty source", () => {
    expect(buildTemplate("board", { portfolios: [], watchlist: ["AAPL"], source: "watchlist" }).panels.map((p) => p.type)).toEqual(["tiles", "tiles"]);
    expect(() => buildTemplate("board", { portfolios: [], watchlist: [], source: "watchlist" })).toThrow(/watchlist is empty/);
  });
});
