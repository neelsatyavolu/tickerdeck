import { z } from "zod";
import { fail, ok, withUser } from "@/lib/api";
import { firstIssue, symbolSchema } from "@/lib/validation";
import { removeFromWatchlist } from "@/lib/watchlist/repo";

export const dynamic = "force-dynamic";

// DELETE /api/watchlist/AAPL?list=<id> — remove a symbol from a list (primary by default).
export function DELETE(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  return withUser(async ({ user }) => {
    const parsed = symbolSchema.safeParse(decodeURIComponent((await params).symbol));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    const list = new URL(req.url).searchParams.get("list");
    const listId = list ? z.uuid().safeParse(list) : null;
    if (listId && !listId.success) return fail("Watchlist not found.", 404);
    await removeFromWatchlist(user.id, parsed.data, listId?.data ?? null);
    return ok(null);
  });
}
