import { fail, withUser } from "@/lib/api";
import { buildAuthorizeUrl, generatePkce, isProvider } from "@/lib/ai/providers";
import { writePkce } from "@/lib/ai/session";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// POST /api/ai/:provider/start — begin the OAuth flow; the client opens the
// returned authorizeUrl, then pastes back the callback link / code.
export function POST(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  return withUser(async () => {
    const { provider } = await params;
    if (!isProvider(provider)) return fail("Unknown provider.", 404);
    const { verifier, challenge, state } = generatePkce();
    await writePkce(provider, { verifier, state });
    return NextResponse.json({ authorizeUrl: buildAuthorizeUrl(provider, challenge, state) });
  });
}
