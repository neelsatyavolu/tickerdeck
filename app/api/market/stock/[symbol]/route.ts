import { fail, ok, withUser } from "@/lib/api";
import { news, profile, quote, recommendations } from "@/lib/market/finnhub";
import { analystTargets } from "@/lib/market/yahoo";
import { firstIssue, symbolSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

function settle<T>(p: Promise<T>): Promise<{ value: T | null; error: string | null }> {
  return p.then(
    (value) => ({ value, error: null }),
    (err) => {
      console.warn("[stock] panel failed:", err instanceof Error ? err.message : err);
      return { value: null, error: "Unavailable right now" };
    },
  );
}

// GET /api/market/stock/AAPL — everything the stock page shows besides the
// chart. Each panel succeeds or fails on its own.
export function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  return withUser(async () => {
    const parsed = symbolSchema.safeParse((await params).symbol);
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    const symbol = parsed.data;
    const [q, p, targets, recs, headlines] = await Promise.all([
      settle(quote(symbol)),
      settle(profile(symbol)),
      settle(analystTargets(symbol)),
      settle(recommendations(symbol)),
      settle(news(symbol)),
    ]);
    if (!q.value && !p.value) return fail(`No data for ${symbol}. Check the ticker.`, 404);
    return ok({ symbol, quote: q, profile: p, targets, recommendations: recs, news: headlines });
  });
}
