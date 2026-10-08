"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    // Inlined at build time; must be referenced literally for Next to embed them.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
    client = createBrowserClient(url, key);
  }
  return client;
}
