import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { hasSession } from "@/lib/ai/session";

export const dynamic = "force-dynamic";

// GET /api/ai/status — which providers this user is connected to in this browser.
export function GET() {
  return withUser(async ({ user }) => {
    const [codex, grok] = await Promise.all([hasSession("codex", user.id), hasSession("grok", user.id)]);
    return NextResponse.json({ codex, grok });
  });
}
