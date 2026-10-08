import { NextResponse } from "next/server";
import { clearAllSessions } from "@/lib/ai/session";
import { supabaseServer } from "@/lib/supabase/server";

// Signing out also drops this browser's AI subscription tokens.
export async function POST(req: Request) {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  await clearAllSessions();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
