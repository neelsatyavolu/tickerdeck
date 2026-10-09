import { ok, withUser } from "@/lib/api";
import { finnhubKey } from "@/lib/market/finnhub";

export const dynamic = "force-dynamic";

// The browser streams trades straight from Finnhub's WebSocket, which needs
// a key. Only signed-in users get it (rate-limited, never cached). Set
// FINNHUB_WS_KEY to a separate key so the server's REST quota stays private.
export function GET() {
  return withUser(async () => ok({ key: process.env.FINNHUB_WS_KEY || finnhubKey() }, { headers: { "Cache-Control": "no-store" } }), "sensitive");
}
