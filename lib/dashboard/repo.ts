import "server-only";
import type { z } from "zod";
import { sql } from "../db";
import { UserFacingError } from "../errors";
import { dashboardInputSchema, dashboardPatchSchema, panelSchema, type Dashboard, type Panel } from "./schema";

// Every query is scoped by user_id. Panels are validated on the way in and,
// defensively, on the way out (a bad panel is dropped, not fatal).

function toDashboard(r: Record<string, unknown>): Dashboard {
  const raw = Array.isArray(r.panels) ? r.panels : [];
  const panels = raw.map((p) => panelSchema.safeParse(p)).filter((p) => p.success).map((p) => p.data as Panel);
  return {
    id: r.id as string,
    name: r.name as string,
    panels,
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

export async function listDashboards(userId: string): Promise<Dashboard[]> {
  const rows = await sql()`select id, name, panels, updated_at from dashboards where user_id = ${userId} order by position nulls last, created_at`;
  return rows.map(toDashboard);
}

export async function getDashboard(userId: string, id: string): Promise<Dashboard | null> {
  const rows = await sql()`select id, name, panels, updated_at from dashboards where id = ${id} and user_id = ${userId}`;
  return rows[0] ? toDashboard(rows[0]) : null;
}

export async function createDashboard(userId: string, input: z.input<typeof dashboardInputSchema>): Promise<string> {
  const v = dashboardInputSchema.parse(input);
  const rows = await sql()`
    insert into dashboards (user_id, name, panels, position)
    values (${userId}, ${v.name}, ${JSON.stringify(v.panels)}::jsonb, (select coalesce(max(position), 0) + 1 from dashboards where user_id = ${userId}))
    returning id`;
  return rows[0].id as string;
}

export async function updateDashboard(userId: string, id: string, input: z.input<typeof dashboardPatchSchema>): Promise<void> {
  const v = dashboardPatchSchema.parse(input);
  const rows = await sql()`
    update dashboards set
      name = coalesce(${v.name ?? null}, name),
      panels = coalesce(${v.panels ? JSON.stringify(v.panels) : null}::jsonb, panels),
      updated_at = now()
    where id = ${id} and user_id = ${userId} returning id`;
  if (rows.length === 0) throw new UserFacingError("Dashboard not found.", 404);
}

export async function deleteDashboard(userId: string, id: string): Promise<void> {
  const rows = await sql()`delete from dashboards where id = ${id} and user_id = ${userId} returning id`;
  if (rows.length === 0) throw new UserFacingError("Dashboard not found.", 404);
}
