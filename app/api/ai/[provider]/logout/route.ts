import { NextResponse } from "next/server";
import { fail, withUser } from "@/lib/api";
import { isProvider } from "@/lib/ai/providers";
import { clearPkce, clearSession } from "@/lib/ai/session";

export const dynamic = "force-dynamic";

// POST /api/ai/:provider/logout — disconnect (drop the stored tokens).
export function POST(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  return withUser(async () => {
    const { provider } = await params;
    if (!isProvider(provider)) return fail("Unknown provider.", 404);
    await clearSession(provider);
    await clearPkce(provider);
    return NextResponse.json({ ok: true });
  });
}
