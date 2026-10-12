import "server-only";
import { sql } from "../db";
import { insightSchema, type Insight, type InsightSet } from "./insights";

// One row per user: the latest set. Every query is scoped by user_id. Items
// are validated on the way out too (a bad one is dropped, not fatal).

function toSet(r: Record<string, unknown>): InsightSet {
  const raw = Array.isArray(r.insights) ? r.insights : [];
  return {
    insights: raw.map((i) => insightSchema.safeParse(i)).flatMap((i) => (i.success ? [i.data] : [])),
    generated_at: r.generated_at instanceof Date ? r.generated_at.toISOString() : String(r.generated_at),
    provider: r.provider as InsightSet["provider"],
    model: r.model as string,
  };
}

export async function getInsights(userId: string): Promise<InsightSet | null> {
  const rows = await sql()`select insights, provider, model, generated_at from ai_insights where user_id = ${userId}`;
  return rows[0] ? toSet(rows[0]) : null;
}

export async function saveInsights(userId: string, set: { insights: Insight[]; provider: InsightSet["provider"]; model: string }): Promise<InsightSet> {
  const rows = await sql()`
    insert into ai_insights (user_id, insights, provider, model)
    values (${userId}, ${JSON.stringify(set.insights)}::jsonb, ${set.provider}, ${set.model})
    on conflict (user_id) do update set insights = excluded.insights, provider = excluded.provider, model = excluded.model, generated_at = now()
    returning insights, provider, model, generated_at`;
  return toSet(rows[0]);
}
