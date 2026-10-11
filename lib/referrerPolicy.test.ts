import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

// Next.js applies every matching entry in order, and for the same header the last one wins.
async function referrerPolicies(): Promise<{ source: string; value: string }[]> {
  const entries = (await nextConfig.headers?.()) ?? [];
  return entries.flatMap((entry) => entry.headers.filter((h) => h.key === "Referrer-Policy").map((h) => ({ source: entry.source, value: h.value })));
}

describe("Referrer-Policy", () => {
  it("keeps the reset page's address, which carries the token, out of every Referer", async () => {
    const policies = await referrerPolicies();
    expect(policies.at(-1)).toEqual({ source: "/login/reset", value: "no-referrer" });
  });

  it("leaves the site-wide policy in place for every other page", async () => {
    const policies = await referrerPolicies();
    expect(policies[0]).toEqual({ source: "/:path*", value: "strict-origin-when-cross-origin" });
    expect(policies).toHaveLength(2);
  });
});
