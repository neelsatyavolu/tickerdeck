import { ok, withUser } from "@/lib/api";
import { UserFacingError } from "@/lib/errors";
import { createStreamTicket } from "@/lib/market/streamTicket";

export const dynamic = "force-dynamic";

export function GET() {
  return withUser(async () => {
    const endpoint = process.env.PRICE_STREAM_URL;
    const secret = process.env.PRICE_STREAM_SECRET;
    if (!endpoint || !secret) throw new UserFacingError("Live price stream unavailable.", 503);
    const url = new URL(endpoint);
    url.protocol = "wss:";
    url.searchParams.set("ticket", await createStreamTicket(secret));
    return ok({ url: url.toString() }, { headers: { "Cache-Control": "no-store" } });
  }, "sensitive");
}
