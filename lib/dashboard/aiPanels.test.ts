import { describe, expect, it } from "vitest";
import { extractProposals, panelGuide } from "./aiPanels";

describe("extractProposals", () => {
  it("pulls panel blocks out of the prose and validates each panel", () => {
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
    expect(proposals[0].panels).toHaveLength(1);
    expect(proposals[0].panels[0]).toMatchObject({ type: "compare", symbols: ["NVDA", "AMD"], width: 8, range: "1Y" });
    expect(proposals[0].rejected).toHaveLength(2);
    expect(proposals[0].rejected[0]).toMatch(/at most 1 symbol/);
  });

  it("reports malformed JSON instead of throwing, and leaves ordinary text alone", () => {
    expect(extractProposals("```tickerdeck-panels\n{oops\n```").proposals[0].rejected[0]).toMatch(/valid JSON/);
    expect(extractProposals("no panels here").proposals).toEqual([]);
  });

  it("describes every panel type for the model", () => {
    const guide = panelGuide();
    for (const t of ["tiles", "price", "compare", "heatmap", "returns", "movers", "forecast", "stats", "analysts", "news", "portfolio"]) expect(guide).toContain(`- ${t}:`);
  });
});
