import { ok, withUser } from "@/lib/api";
import { listings } from "@/lib/market/listings";

export const dynamic = "force-dynamic";

// GET /api/market/symbols — every US stock and ETF as [symbol, name, type, marketCap],
// for instant search in the browser. Changes slowly; the browser keeps it for a day.
export function GET() {
  return withUser(async () => ok(await listings(), { headers: { "Cache-Control": "private, max-age=86400" } }));
}
