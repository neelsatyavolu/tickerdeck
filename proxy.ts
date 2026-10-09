import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/server";
import { isCrossSite } from "@/lib/csrf";

// Signed-out visitors go to /login. API routes skip that redirect: they answer
// 401 JSON themselves (see lib/api.ts).
export function proxy(request: NextRequest) {
  if (isCrossSite(request)) return NextResponse.json({ ok: false, error: "Cross-site request blocked." }, { status: 403 });
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  return auth().middleware({ loginUrl: "/login" })(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
