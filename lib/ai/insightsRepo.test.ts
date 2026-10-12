import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestSql, type TestSql } from "@/test/pg";

const db = vi.hoisted(() => ({ sql: null as unknown as TestSql }));
vi.mock("../db", () => ({ sql: () => db.sql }));

import type { Insight } from "./insights";
import { getInsights, saveInsights } from "./insightsRepo";

const ME = "user-me";
const OTHER = "user-other";
const insight = (title: string): Insight => ({ category: "Risk", title, body: "Body.", symbols: ["NVDA"], tone: "down", sources: [] });

beforeAll(async () => {
  db.sql = await createTestSql();
});

beforeEach(async () => {
  await db.sql.query("delete from ai_insights");
});

describe("ai insights", () => {
  it("has nothing for a user who never generated any", async () => {
    expect(await getInsights(ME)).toBeNull();
  });

  it("saves a set and reads it back", async () => {
    const saved = await saveInsights(ME, { insights: [insight("First")], provider: "codex", model: "gpt-test" });
    expect(saved.insights).toEqual([insight("First")]);
    expect(saved.provider).toBe("codex");
    expect(saved.model).toBe("gpt-test");
    expect(Number.isNaN(Date.parse(saved.generated_at))).toBe(false);
    expect(await getInsights(ME)).toEqual(saved);
  });

  it("replaces the previous set", async () => {
    await saveInsights(ME, { insights: [insight("Old"), insight("Older")], provider: "codex", model: "gpt-test" });
    await saveInsights(ME, { insights: [insight("New")], provider: "grok", model: "grok-test" });
    const now = await getInsights(ME);
    expect(now?.insights.map((i) => i.title)).toEqual(["New"]);
    expect(now?.provider).toBe("grok");
  });

  it("keeps each user's set to themselves", async () => {
    await saveInsights(ME, { insights: [insight("Mine")], provider: "codex", model: "gpt-test" });
    await saveInsights(OTHER, { insights: [insight("Theirs")], provider: "codex", model: "gpt-test" });
    expect((await getInsights(ME))?.insights[0].title).toBe("Mine");
    expect((await getInsights(OTHER))?.insights[0].title).toBe("Theirs");
  });

  it("drops a stored item that no longer fits the schema", async () => {
    await db.sql.query("insert into ai_insights (user_id, insights, provider, model) values ($1, $2::jsonb, 'codex', 'gpt-test')", [ME, JSON.stringify([insight("Good"), { category: "Gone" }])]);
    expect((await getInsights(ME))?.insights.map((i) => i.title)).toEqual(["Good"]);
  });
});
