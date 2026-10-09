import { fail, ok, withUser } from "@/lib/api";
import { earnings, metrics, news, peers, profile, recommendations } from "@/lib/market/finnhub";
import { summary } from "@/lib/market/nasdaq";
import { analystTargets, quote } from "@/lib/market/sources";
import { buildKeyStats } from "@/lib/market/stats";
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
// price chart. Each panel succeeds or fails on its own.
export function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  return withUser(async () => {
    const parsed = symbolSchema.safeParse((await params).symbol);
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    const symbol = parsed.data;
    const [q, p, targets, recs, headlines, m, s, e, pe] = await Promise.all([
      settle(quote(symbol)),
      settle(profile(symbol)),
      settle(analystTargets(symbol)),
      settle(recommendations(symbol)),
      settle(news(symbol)),
      settle(metrics(symbol)),
      settle(summary(symbol)),
      settle(earnings(symbol)),
      settle(peers(symbol)),
    ]);
    if (!q.value && !p.value && !s.value) return fail(`No data for ${symbol}. Check the ticker.`, 404);
    const stats = m.value || s.value ? { value: buildKeyStats(m.value ?? {}, s.value), error: null } : { value: null, error: m.error ?? s.error };
    return ok({ symbol, quote: q, profile: p, stats, targets, recommendations: recs, news: headlines, earnings: e, peers: pe });
  });
}
