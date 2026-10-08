import "server-only";
import { createNeonAuth } from "@neondatabase/auth/next/server";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

let instance: ReturnType<typeof createNeonAuth> | null = null;

/** Neon Auth (Better Auth) server instance, created on first use so builds don't need the env. */
export function auth(): ReturnType<typeof createNeonAuth> {
  if (!instance) {
    instance = createNeonAuth({
      baseUrl: required("NEON_AUTH_BASE_URL"),
      cookies: { secret: required("NEON_AUTH_COOKIE_SECRET") },
    });
  }
  return instance;
}

export type SessionUser = { id: string; email: string };

/** The signed-in user, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const { data } = await auth().getSession();
  const user = data?.user;
  return user?.id ? { id: user.id, email: user.email } : null;
}
