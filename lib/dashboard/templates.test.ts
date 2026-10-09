import { describe, expect, it } from "vitest";
import { buildTemplate, TEMPLATES } from "./templates";

const ctx = { portfolios: [{ id: "11111111-1111-4111-8111-111111111111", name: "Core", symbols: ["AAPL", "VTSAX"] }], watchlist: ["NVDA"], symbol: "DHT" };

describe("templates", () => {
  it("offers five layouts that all validate", () => {
    expect(TEMPLATES).toHaveLength(5);
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
