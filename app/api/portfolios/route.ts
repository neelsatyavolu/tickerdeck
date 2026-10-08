import { ok, withUser } from "@/lib/api";
import { createPortfolio, listPortfolios } from "@/lib/portfolio/repo";

export const dynamic = "force-dynamic";

// GET /api/portfolios — the user's portfolios with their holdings.
export function GET() {
  return withUser(async ({ user }) => ok(await listPortfolios(user.id)));
}

// POST /api/portfolios — create one; returns its id.
export function POST(req: Request) {
  return withUser(async ({ user }) => ok({ id: await createPortfolio(user.id, await req.json().catch(() => ({}))) }, { status: 201 }));
}
