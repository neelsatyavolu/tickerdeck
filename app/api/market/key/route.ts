import { ok, withUser } from "@/lib/api";
import { finnhubKey } from "@/lib/market/finnhub";

export const dynamic = "force-dynamic";

// The browser streams trades straight from Finnhub's WebSocket, which needs
// the key. Only signed-in users get it, and it is never cached.
export function GET() {
  return withUser(async () => ok({ key: finnhubKey() }, { headers: { "Cache-Control": "no-store" } }));
}
