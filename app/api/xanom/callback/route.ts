import { NextResponse, type NextRequest } from "next/server";
import { completeCallback } from "@/lib/xanom/callback";
import { FLOW_COOKIE, XanomError } from "@/lib/xanom/oidc";
import { NeonAuthError } from "@/lib/xanom/neonAuth";

export const dynamic = "force-dynamic";

/** Short and safe for the log: never a token, code or email. */
function describe(err: unknown): string {
  if (err instanceof XanomError || err instanceof NeonAuthError) return err.message.slice(0, 120);
  return err instanceof Error ? err.name : "unknown error";
}

// GET /api/xanom/callback — accounts.xanom.co sends the browser back here.
export async function GET(req: NextRequest) {
  const flowCookie = req.cookies.get(FLOW_COOKIE)?.value;
  let target: URL;
  let cookies: string[] = [];
  try {
    const result = await completeCallback(req.nextUrl, flowCookie);
    cookies = result.cookies;
    target = new URL(result.returnTo, req.url);
    if (result.intent !== "signin") target.searchParams.set("xanom", "linked");
  } catch (err) {
    const code = err instanceof XanomError ? err.code : "failed";
    console.warn("[xanom] callback failed:", describe(err));
    // A link or convert started in settings; a sign-in started on the login page.
    target = new URL(req.cookies.get("__Secure-neon-auth.session_token") ? "/settings" : "/login", req.url);
    target.searchParams.set("xanom", code);
  }
  const res = NextResponse.redirect(target);
  // res.cookies rewrites every Set-Cookie header when used, so it goes first and the
  // session cookies (already serialized by the Neon Auth SDK) are appended after it.
  res.cookies.set(FLOW_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/xanom", maxAge: 0 });
  for (const cookie of cookies) res.headers.append("Set-Cookie", cookie);
  return res;
}
