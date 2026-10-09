import { z } from "zod";
import { fail, ok, withUser } from "@/lib/api";
import { firstIssue, symbolSchema } from "@/lib/validation";
import { addToWatchlist, listWatchlist } from "@/lib/watchlist/repo";

export const dynamic = "force-dynamic";

const body = z.object({ symbol: symbolSchema, name: z.string().max(200).nullable().optional() });

// GET /api/watchlist — the user's watched symbols, oldest first.
export function GET() {
  return withUser(async ({ user }) => ok(await listWatchlist(user.id)));
}

// POST /api/watchlist — start watching a symbol.
export function POST(req: Request) {
  return withUser(async ({ user }) => {
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    await addToWatchlist(user.id, parsed.data.symbol, parsed.data.name);
    return ok(null, { status: 201 });
  });
}
