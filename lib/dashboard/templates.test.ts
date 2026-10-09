import { describe, expect, it } from "vitest";
import { buildTemplate, TEMPLATES } from "./templates";

const ctx = { portfolios: [{ id: "11111111-1111-4111-8111-111111111111", name: "Core", symbols: ["AAPL", "VTSAX"] }], watchlist: ["NVDA"], symbol: "DHT" };

describe("templates", () => {
  it("offers six layouts that all validate", () => {
    expect(TEMPLATES).toHaveLength(6);
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

  it("fills the screen with one small chart per symbol, deduplicated, heatmap first", () => {
    const d = buildTemplate("wall", { ...many, source: "all" });
    expect(d.name).toBe("Everything wall");
    expect(d.panels[0]).toMatchObject({ type: "heatmap", width: 12 });
    expect(d.panels.slice(1).map((p) => p.symbols[0])).toEqual(["AAPL", "MSFT", "DHT", "NVDA", "^GSPC"]);
    expect(d.panels.slice(1).every((p) => p.type === "price" && p.width === 3)).toBe(true);
  });

  it("explains an empty source instead of inventing symbols", () => {
    expect(() => buildTemplate("wall", { portfolios: [], watchlist: [], source: "watchlist" })).toThrow(/watchlist is empty/);
    expect(() => buildTemplate("wall", { portfolios: [], watchlist: [] })).toThrow(/Nothing to show/);
  });

  it("can be limited to one portfolio or the watchlist, and stays within 40 panels", () => {
    expect(buildTemplate("wall", { ...many, source: many.portfolios[1].id }).name).toBe("Play wall");
    expect(buildTemplate("wall", { ...many, source: "watchlist" }).panels.slice(1).map((p) => p.symbols[0])).toEqual(["NVDA", "^GSPC", "AAPL"]);
    const huge = { portfolios: [], watchlist: Array.from({ length: 60 }, (_, i) => `S${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`), source: "watchlist" };
    expect(buildTemplate("wall", huge).panels).toHaveLength(40);
  });
});
