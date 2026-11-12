import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";
const streamOrigin = process.env.PRICE_STREAM_URL ? new URL(process.env.PRICE_STREAM_URL).origin.replace(/^https:/, "wss:") : "";

// Plaid Link (brokerage sign-in) loads Plaid's script, runs in Plaid's frame
// and reports to Plaid's API. Only allowed when Plaid is set up.
const plaid = Boolean(process.env.PLAID_CLIENT_ID);
const plaidApi = `https://${process.env.PLAID_ENV === "production" ? "production" : "sandbox"}.plaid.com`;

// Next.js inlines its bootstrap scripts, so scripts allow 'unsafe-inline'
// (nonces would force every page to render dynamically). Everything else is
// locked to this origin, plus the shared price socket and https news images.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://analytics.n3el.dev${dev ? " 'unsafe-eval'" : ""}${plaid ? " https://cdn.plaid.com/link/v2/stable/link-initialize.js" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${streamOrigin} https://analytics.n3el.dev${dev ? " ws:" : ""}${plaid ? ` ${plaidApi}` : ""}`,
  plaid ? "frame-src https://cdn.plaid.com" : "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The reset link carries its token in the address; never pass it on as a Referer. Later entries win.
      { source: "/login/reset", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
