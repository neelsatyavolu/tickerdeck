import { NextResponse } from "next/server";
import { fail, withUser } from "@/lib/api";
import { exchangeCode, extractCodeAndState, isProvider } from "@/lib/ai/providers";
import { clearPkce, readPkce, writeSession } from "@/lib/ai/session";

export const dynamic = "force-dynamic";

// POST /api/ai/:provider/complete — finish OAuth with the callback link (ChatGPT)
// or authorization code (Grok) the user pasted, exchanging it for tokens.
export function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  return withUser(async ({ user }) => {
    const { provider } = await params;
    if (!isProvider(provider)) return fail("Unknown provider.", 404);

    const body = (await req.json().catch(() => null)) as { callback?: unknown } | null;
    const callback = typeof body?.callback === "string" ? body.callback : "";
    if (!callback) return fail("Paste the callback link or code.", 400);

    const { code, state } = extractCodeAndState(callback);
    if (!code) return fail("Could not find an authorization code in what you pasted.", 400);

    const pkce = await readPkce(provider);
    if (!pkce) return fail("This sign-in expired. Click Connect again.", 400);
    // Codex always returns state; Grok's bare code has none and binds to the pending attempt.
    if ((provider === "codex" && pkce.state !== state) || (state && pkce.state !== state)) {
      return fail("Sign-in state mismatch. Try again.", 400);
    }

    try {
      const tokens = await exchangeCode(provider, code, pkce.verifier);
      await writeSession(provider, user.id, tokens);
      await clearPkce(provider);
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error(`[ai] ${provider} token exchange failed:`, err instanceof Error ? err.message : err);
      return fail("Sign-in failed. The code may have expired. Click Connect again.", 502);
    }
  });
}
