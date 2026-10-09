import { z } from "zod";
import { fail, ok, withUser } from "@/lib/api";
import { createDashboard, listDashboards } from "@/lib/dashboard/repo";
import { dashboardInputSchema } from "@/lib/dashboard/schema";
import { firstIssue } from "@/lib/validation";

export const dynamic = "force-dynamic";

// GET /api/dashboards — the user's dashboards with their panels.
export function GET() {
  return withUser(async ({ user }) => ok(await listDashboards(user.id)));
}

// POST /api/dashboards — create one (blank, or with panels from a layout).
export function POST(req: Request) {
  return withUser(async ({ user }) => {
    const parsed = dashboardInputSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(firstIssue(parsed.error as z.ZodError), 400);
    return ok({ id: await createDashboard(user.id, parsed.data) }, { status: 201 });
  });
}
