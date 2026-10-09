import { fail, ok, withUser } from "@/lib/api";
import { companyFeed, newsFeed } from "@/lib/market/finnhub";
import { curate } from "@/lib/market/news";
import type { NewsItem } from "@/lib/market/types";
import { firstIssue, symbolListSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 12;

const settle = (p: Promise<NewsItem[]>) =>
  p.catch((err) => {
    console.warn("[news] feed failed:", err instanceof Error ? err.message : err);
    return [] as NewsItem[];
  });

// GET /api/market/news?symbols=AAPL,MSFT — curated market headlines, deals,
// and stories about the given symbols (what the user holds and watches).
export function GET(req: Request) {
  return withUser(async () => {
    const raw = new URL(req.url).searchParams.get("symbols") ?? "";
    let symbols: string[] = [];
    if (raw) {
      const parsed = symbolListSchema.safeParse(raw);
      if (!parsed.success) return fail(firstIssue(parsed.error), 400);
      symbols = [...new Set(parsed.data)].filter((s) => !s.startsWith("^")).slice(0, MAX_SYMBOLS);
    }
    const [general, deals, ...company] = await Promise.all([settle(newsFeed("general")), settle(newsFeed("merger")), ...symbols.map((s) => settle(companyFeed(s)))]);
    return ok({ top: curate(general, 40), deals: curate(deals, 20), forYou: curate(company.flat(), 60) });
  }, "marketHeavy");
}
