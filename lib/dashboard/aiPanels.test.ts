import { describe, expect, it } from "vitest";
import { diffLayouts, extractProposals, panelGuide } from "./aiPanels";
import type { Panel } from "./schema";

describe("extractProposals: add", () => {
  it("pulls panel blocks out of the prose, validates each, and tidies rows", () => {
    const text = [
      "Here are two views for chips.",
      "```tickerdeck-panels",
      '[{"type":"compare","symbols":["nvda","AMD"],"range":"1Y"},{"type":"price","symbols":["NVDA","AMD"]},{"type":"bogus","symbols":["X"]}]',
      "```",
      "Want a forecast too?",
    ].join("\n");
    const { prose, proposals } = extractProposals(text);
    expect(prose).toBe("Here are two views for chips.\n\nWant a forecast too?");
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.kind).toBe("add");
    expect(p.panels).toHaveLength(1);
    expect(p.panels[0]).toMatchObject({ type: "compare", symbols: ["NVDA", "AMD"], range: "1Y", width: 12 }); // 8 widened to fill its row
    expect(p.rejected).toHaveLength(2);
    expect(p.rejected[0]).toMatch(/at most 1 symbol/);
  });

  it("reports malformed JSON instead of throwing, and leaves ordinary text alone", () => {
    expect(extractProposals("```tickerdeck-panels\n{oops\n```").proposals[0].rejected[0]).toMatch(/valid JSON/);
    expect(extractProposals("no panels here").proposals).toEqual([]);
  });
});

describe("extractProposals: replace", () => {
  it("keeps existing ids so the edit can be diffed", () => {
    const body = JSON.stringify({ name: "Chips", panels: [{ id: "keep1", type: "tiles", symbols: ["NVDA"], width: 12 }, { type: "news", symbols: ["NVDA"], width: 4 }] });
    const { proposals } = extractProposals("Tidied it.\n```tickerdeck-dashboard\n" + body + "\n```");
    const p = proposals[0];
    expect(p.kind).toBe("replace");
    if (p.kind !== "replace") return;
    expect(p.name).toBe("Chips");
    expect(p.panels[0].id).toBe("keep1");
    expect(p.panels[1].id).not.toBe("keep1");
    expect(p.panels[1].width).toBe(12);
  });

  it("rejects a layout without a panels list", () => {
    expect(extractProposals('```tickerdeck-dashboard\n{"name":"x"}\n```').proposals[0].rejected[0]).toMatch(/panels list/);
  });
});

describe("diffLayouts", () => {
  const a: Panel = { id: "a", type: "tiles", symbols: ["AAPL"], width: 12 };
  const b: Panel = { id: "b", type: "news", symbols: ["AAPL"], width: 4 };
  const c: Panel = { id: "c", type: "price", symbols: ["AAPL"], width: 8 };
  it("counts added, removed, changed and moved panels", () => {
    expect(diffLayouts([a, b, c], [c, { ...a, title: "Today" }, { id: "n", type: "movers", symbols: ["AAPL", "MSFT"], width: 4 }])).toEqual({ added: 1, removed: 1, changed: 1, moved: true });
    expect(diffLayouts([a, b], [a, b])).toEqual({ added: 0, removed: 0, changed: 0, moved: false });
  });
});

describe("panelGuide", () => {
  it("covers every panel type, both blocks and the layout rules", () => {
    const guide = panelGuide();
    for (const t of ["tiles", "price", "compare", "heatmap", "returns", "movers", "forecast", "stats", "analysts", "news", "portfolio"]) expect(guide).toContain(`- ${t}:`);
    expect(guide).toContain("```tickerdeck-dashboard");
    expect(guide).toContain("add up to exactly 12");
  });
});
