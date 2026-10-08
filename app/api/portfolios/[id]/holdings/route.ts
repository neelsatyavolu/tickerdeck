import { z } from "zod";
import { fail, ok, withUser } from "@/lib/api";
import { addHolding } from "@/lib/portfolio/repo";

export const dynamic = "force-dynamic";

// POST /api/portfolios/:id/holdings — add a lot to one of the user's portfolios.
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async ({ user }) => {
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return fail("Portfolio not found.", 404);
    await addHolding(user.id, id.data, await req.json().catch(() => ({})));
    return ok(null, { status: 201 });
  });
}
