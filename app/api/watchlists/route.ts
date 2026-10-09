import { z } from "zod";
import { fail, ok, withUser } from "@/lib/api";
import { firstIssue } from "@/lib/validation";
import { createWatchlist, listNameSchema, listWatchlists } from "@/lib/watchlist/repo";

export const dynamic = "force-dynamic";

// GET /api/watchlists — all of the user's lists (primary first) with their symbols.
export function GET() {
  return withUser(async ({ user }) => ok(await listWatchlists(user.id)));
}

// POST /api/watchlists — create a named custom list.
export function POST(req: Request) {
  return withUser(async ({ user }) => {
    const parsed = z.object({ name: listNameSchema }).safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    return ok({ id: await createWatchlist(user.id, parsed.data.name) }, { status: 201 });
  });
}
