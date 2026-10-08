import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { safeNext } from "@/lib/redirect";
import { supabaseServer } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["magiclink", "email", "signup", "recovery", "invite", "email_change"];

// Token-hash sign-in (works when the link is opened in a different browser
// than the one that requested it, unlike the PKCE code in /auth/callback).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(safeNext(url.searchParams.get("next"), url.origin));
    console.warn("[auth] otp verification failed:", error.message);
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
