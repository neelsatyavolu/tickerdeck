import { NextResponse, type NextRequest } from "next/server";
import { xanomConfig } from "@/lib/xanom/config";
import { issuerKeys, verifySummaryRequest } from "@/lib/xanom/oidc";
import { summaryFor } from "@/lib/xanom/summary";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// GET /api/xanom/summary — accounts.xanom.co asks for the dashboard card with a
// short-lived RS256 JWT it signs (SPEC.md §4). Counts only.
export async function GET(req: NextRequest) {
  let sub: string | null;
  try {
    const config = xanomConfig();
    sub = await verifySummaryRequest(config, req.headers.get("authorization"), issuerKeys(config));
  } catch (err) {
    console.error("[xanom] summary auth unavailable", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (!sub) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { ...NO_STORE, "WWW-Authenticate": "Bearer" } });
  try {
    return NextResponse.json(await summaryFor(sub, `${req.nextUrl.origin}/`), { headers: NO_STORE });
  } catch (err) {
    console.error("[xanom] summary failed", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
