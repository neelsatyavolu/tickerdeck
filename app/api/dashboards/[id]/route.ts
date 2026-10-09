import { z } from "zod";
import { fail, ok, withUser } from "@/lib/api";
import { deleteDashboard, getDashboard, updateDashboard } from "@/lib/dashboard/repo";
import { dashboardPatchSchema } from "@/lib/dashboard/schema";
import { firstIssue } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

export function GET(_req: Request, { params }: Ctx) {
  return withUser(async ({ user }) => {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail("Dashboard not found.", 404);
    const d = await getDashboard(user.id, id.data);
    return d ? ok(d) : fail("Dashboard not found.", 404);
  });
}

// PATCH /api/dashboards/:id — rename and/or replace the panel list.
export function PATCH(req: Request, { params }: Ctx) {
  return withUser(async ({ user }) => {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail("Dashboard not found.", 404);
    const parsed = dashboardPatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    await updateDashboard(user.id, id.data, parsed.data);
    return ok(null);
  });
}

export function DELETE(_req: Request, { params }: Ctx) {
  return withUser(async ({ user }) => {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail("Dashboard not found.", 404);
    await deleteDashboard(user.id, id.data);
    return ok(null);
  });
}
