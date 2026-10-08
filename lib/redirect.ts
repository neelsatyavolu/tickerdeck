/** Resolve a post-sign-in `next` value to a same-origin URL; anything else goes home. */
export function safeNext(next: string | null, origin: string): URL {
  try {
    const target = new URL(next ?? "/", origin);
    if (target.origin === origin) return target;
  } catch {
    /* malformed */
  }
  return new URL("/", origin);
}
