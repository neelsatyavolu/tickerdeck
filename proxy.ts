import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth/server";

// Signed-out visitors go to /login. API routes are excluded: they answer 401
// JSON themselves (see lib/api.ts).
export function proxy(request: NextRequest) {
  return auth().middleware({ loginUrl: "/login" })(request);
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
