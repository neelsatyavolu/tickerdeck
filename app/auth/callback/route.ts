import { NextResponse } from "next/server";
import { safeNext } from "@/lib/redirect";
import { supabaseServer } from "@/lib/supabase/server";

// Magic-link landing: trade the one-time code for a session cookie.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(safeNext(url.searchParams.get("next"), url.origin));
    console.warn("[auth] code exchange failed:", error.message);
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
