import { z } from "zod";
import { fail, ok, withUser } from "@/lib/api";
import { firstIssue } from "@/lib/validation";
import { deleteWatchlist, listNameSchema, renameWatchlist } from "@/lib/watchlist/repo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/watchlists/:id — rename a list.
export function PATCH(req: Request, { params }: Ctx) {
  return withUser(async ({ user }) => {
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return fail("Watchlist not found.", 404);
    const parsed = z.object({ name: listNameSchema }).safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    await renameWatchlist(user.id, id.data, parsed.data.name);
    return ok(null);
  });
}

// DELETE /api/watchlists/:id — delete a custom list (the primary list stays).
export function DELETE(_req: Request, { params }: Ctx) {
  return withUser(async ({ user }) => {
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return fail("Watchlist not found.", 404);
    await deleteWatchlist(user.id, id.data);
    return ok(null);
  });
}
