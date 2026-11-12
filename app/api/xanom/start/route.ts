import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { xanomConfig } from "@/lib/xanom/config";
import { FLOW_COOKIE, FLOW_COOKIE_MAX_AGE, isIntent, safeReturn, startSignIn } from "@/lib/xanom/oidc";
import { emailVerified } from "@/lib/xanom/repo";

export const dynamic = "force-dynamic";

// GET /api/xanom/start?intent=signin|link|convert&return=<path>
// Sends the browser to accounts.xanom.co with state, PKCE and a nonce kept in a
// short-lived signed cookie. Link and convert need a signed-in user.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const intent = q.get("intent") ?? "signin";
  if (!isIntent(intent)) return NextResponse.json({ ok: false, error: "Unknown intent." }, { status: 400 });
  if (q.get("platform") === "ios") return NextResponse.json({ ok: false, error: "TickerQuill has no iOS app." }, { status: 400 });

  try {
    const config = xanomConfig();
    let user = null;
    let convert;
    if (intent !== "signin") {
      user = await currentUser();
      if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/settings")}`, req.url));
      if (intent === "convert") {
        convert = { email: user.email, name: user.email.split("@")[0], emailVerified: await emailVerified(user.id) };
      }
    }
    const { url, cookie } = await startSignIn(config, {
      redirectUri: `${req.nextUrl.origin}/api/xanom/callback`,
      intent,
      returnTo: safeReturn(q.get("return") ?? (intent === "signin" ? "/" : "/settings")),
      userId: user?.id ?? null,
      convert,
    });
    const res = NextResponse.redirect(url);
    res.cookies.set(FLOW_COOKIE, cookie, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/xanom", maxAge: FLOW_COOKIE_MAX_AGE });
    return res;
  } catch (err) {
    console.error("[xanom] start failed", err instanceof Error ? err.message : "unknown error");
    const back = intent === "signin" ? "/login" : "/settings";
    return NextResponse.redirect(new URL(`${back}?xanom=unavailable`, req.url));
  }
}
