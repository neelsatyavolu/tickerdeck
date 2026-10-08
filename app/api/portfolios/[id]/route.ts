import { z } from "zod";
import { fail, ok, withUser } from "@/lib/api";
import { deletePortfolio, updatePortfolio } from "@/lib/portfolio/repo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

export function PATCH(req: Request, { params }: Ctx) {
  return withUser(async ({ user }) => {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail("Portfolio not found.", 404);
    await updatePortfolio(user.id, id.data, await req.json().catch(() => ({})));
    return ok(null);
  });
}

export function DELETE(_req: Request, { params }: Ctx) {
  return withUser(async ({ user }) => {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail("Portfolio not found.", 404);
    await deletePortfolio(user.id, id.data);
    return ok(null);
  });
}
