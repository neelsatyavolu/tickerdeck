import { fail, ok, withUser } from "@/lib/api";
import { firstIssue, symbolSchema } from "@/lib/validation";
import { removeFromWatchlist } from "@/lib/watchlist/repo";

export const dynamic = "force-dynamic";

// DELETE /api/watchlist/AAPL — stop watching a symbol.
export function DELETE(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  return withUser(async ({ user }) => {
    const parsed = symbolSchema.safeParse(decodeURIComponent((await params).symbol));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    await removeFromWatchlist(user.id, parsed.data);
    return ok(null);
  });
}
