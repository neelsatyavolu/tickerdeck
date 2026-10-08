import { NextResponse } from "next/server";
import { clearAllSessions } from "@/lib/ai/session";

// Called after the Neon Auth client signs out: also drops this browser's AI
// subscription tokens so the next account can't use them.
export async function POST() {
  await clearAllSessions();
  return NextResponse.json({ ok: true });
}
