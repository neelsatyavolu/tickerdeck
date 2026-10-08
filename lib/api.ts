import "server-only";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { currentUser } from "./supabase/server";
import { UpstreamError } from "./market/http";
import { ZodError } from "zod";
import { firstIssue } from "./validation";
import { UserFacingError } from "./errors";


export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiResult<T>>({ ok: true, data }, init);
}

export function fail(error: string, status: number) {
  return NextResponse.json<ApiResult<never>>({ ok: false, error }, { status });
}

type Authed = { user: User; supabase: SupabaseClient };

/** Run a handler for a signed-in user; map known errors to clean responses. */
export async function withUser(handler: (ctx: Authed) => Promise<Response>): Promise<Response> {
  let ctx: { user: User | null; supabase: SupabaseClient };
  try {
    ctx = await currentUser();
  } catch (err) {
    console.error("[api] auth check failed", err);
    return fail("Sign-in service unavailable.", 503);
  }
  if (!ctx.user) return fail("Sign in first.", 401);
  try {
    return await handler({ user: ctx.user, supabase: ctx.supabase });
  } catch (err) {
    if (err instanceof UpstreamError) {
      console.warn(`[api] ${err.message}`);
      return fail(err.status === 404 ? err.message : `Market data unavailable (${err.source}).`, err.status === 404 ? 404 : 502);
    }
    if (err instanceof UserFacingError) return fail(err.message, err.status);
    if (err instanceof ZodError) return fail(firstIssue(err), 400);
    console.error("[api] unexpected error", err);
    return fail("Something went wrong. Try again.", 500);
  }
}
