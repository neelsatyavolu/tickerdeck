# Page loading verification — 2026-10-12

Measured against `726a3d1`, including Claude's latest AI insights and price/chart changes. The performance work was built in an isolated checkout; other sessions' unfinished local edits were excluded.

## Results

Production Next.js build, local headless Chromium, three fresh browser contexts per route. Times are medians from navigation to the main heading becoming visible. Both builds used identical fixtures and response delays: account data 100 ms, stock details 150 ms, quotes 250 ms, daily history 500 ms, trends and forecasts 2,400 ms.

| Page | Before | After | Faster |
| --- | ---: | ---: | ---: |
| Home | 2,886 ms | 885 ms | 3.3× |
| Stock | 2,892 ms | 273 ms | 10.6× |
| Watchlist | 2,882 ms | 872 ms | 3.3× |
| Portfolio | 3,402 ms | 882 ms | 3.9× |

These are controlled page-reveal measurements, not production Core Web Vitals or a guarantee that every real-world page loads twice as fast. Actual auth, database, provider, network and device latency vary. Stock company details remain required; a slow details response can still delay that page.

History fixture transfer fell from 163,689 to 5,860 bytes on Home (96% less) and to 23,114 bytes on the portfolio page (86% less). Stock pages retain the full series for their long-term returns. The server still obtains its existing cached full history; this change reduces browser transfers and parsing, not the upstream history fetch.

## Changes

- Keep account data and prices required, but let optional trends, history and forecasts finish after the page appears. Remove the intentional 200 ms reveal delay.
- Existing-account watchlist reads use two parallel SELECTs instead of four queries across three sequential stages. Primary-list creation and user scoping are preserved.
- Request the chart's actual history window, reuse wider cached/in-flight series and render resolved cached history on revisits.
- Share overview results and in-flight loads by symbol across overlapping panels; fetch only additions, in batches of at most 50.
- Keep GETs deduplicated for their entire in-flight lifetime; start their cache TTL when the response arrives. Plain API reads and writes stay uncached.
- Load the Markdown renderer and GFM support when an AI reply is rendered. The renderer is in an on-demand chunk of about 147 kB raw / 44 kB gzip. The assistant launcher stays available immediately, and existing image/link safety rules are preserved.

## Validation

321 tests passed across 59 files; full ESLint and diff checks passed. Production build and TypeScript validation passed with webpack. Webpack was used because the temporary checkout shares dependencies by symlink, which Turbopack rejects outside its filesystem root.

Browser checks covered all four routes, correct $220 portfolio totals, delayed trends and forecast errors appearing after reveal, opening the assistant, GFM tables, and suppression of images and unsafe links. The benchmark uses a dummy local session and intercepts API requests; it does not create accounts or write portfolio data.

To reproduce after building, serve the local build with test-only auth settings:

```sh
pnpm exec next build --webpack
NEON_AUTH_BASE_URL=http://127.0.0.1:3137/benchmark-auth NEON_AUTH_COOKIE_SECRET=local-benchmark-only-cookie-secret-123456789 pnpm exec next start --port 3137
```

In another terminal, run `node scripts/benchmark-loading.mjs --verify`. Never use these dummy auth settings for a deployed app.
