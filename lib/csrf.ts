const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cross-site request forgery guard: state-changing requests must come from
 * this site. Browsers send Sec-Fetch-Site on every request; Origin is the
 * fallback for older ones.
 */
export function isCrossSite(request: Pick<Request, "method" | "headers"> & { nextUrl: { host: string } }): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host);
  } catch {
    return true;
  }
}
