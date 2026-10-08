import { auth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

// Neon Auth's endpoints (sign-in, sign-up, session, sign-out) proxied under /api/auth.
export function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return auth().handler().GET(req, ctx);
}

export function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return auth().handler().POST(req, ctx);
}
