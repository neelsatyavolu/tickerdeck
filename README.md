# tickerdeck

Personal stock and portfolio tracker. It covers:

- **Portfolios**: holdings, watchlists, and paper (what-if) baskets. Holdings are stored as individual purchase lots.
- **Live prices**: streamed from Finnhub's WebSocket.
- **Forecasts**: Monte Carlo price ranges, analyst price targets, and analyst ratings.
- **AI assistant**: runs on your own ChatGPT or Grok subscription, using the [`shared-ai-auth`](https://github.com/neelsatyavolu/shared-ai-auth) sign-in.

## Stack

- **App:** Next.js 16 (App Router), deployed on Vercel.
- **Database:** Supabase (Auth + Postgres). Every table has row-level security, so each user can only read and write their own rows.
- **Market data:**
  - Finnhub: quotes, the trade stream, profiles, ratings, news, and symbol search.
  - Yahoo Finance: daily price history and analyst price targets. These endpoints are unofficial and all Yahoo code lives in `lib/market/yahoo.ts`.
- **Design:** Machine & Ink (`~/DESIGN.md`).

## Setup

1. Add Supabase to the Vercel project (Marketplace). This sets `NEXT_PUBLIC_SUPABASE_URL` and the anon key.
2. Run the migration in `supabase/migrations/` against the database (SQL editor or `psql "$POSTGRES_URL" -f …`).
3. Add `FINNHUB_API_KEY` to the Vercel project, then run `vercel env pull .env.local`.
4. In Supabase Auth → URL configuration, set the Site URL to the deployed origin and add `http://localhost:3000/**` as a redirect URL.
5. Run `pnpm install` then `pnpm dev`.

## How it fits together

| Area | Where |
| --- | --- |
| Forecast math (pure, tested) | `lib/forecast/montecarlo.ts`: resamples whole historical days, so the way assets move together is kept. Historical drift is replaced by an assumed 7%/yr. |
| Portfolio math | `lib/portfolio/math.ts`: merges lots, then computes gain/loss, weights, and paper cash. |
| Data access | `lib/portfolio/repo.ts`: the browser writes directly to Supabase (RLS enforces ownership); the server reads for AI context. |
| Live prices | `components/LivePrices.tsx`: a REST snapshot, then the Finnhub WebSocket. The socket key is only served to signed-in users. |
| AI sign-in | `app/api/ai/[provider]/*`: paste-the-callback OAuth via `shared-ai-auth`. Tokens are kept in chunked httpOnly cookies, never in the database. |
| AI chat | `app/api/ai/chat`: gathers portfolios, quotes, analyst data, news, and forecasts into the system prompt (`lib/ai/context.ts`), then streams NDJSON back. Read-only: the assistant cannot change data. |

## Tests

```sh
pnpm test        # unit tests (vitest)
pnpm typecheck
pnpm test:e2e    # Playwright; needs SUPABASE_SERVICE_ROLE_KEY + FINNHUB_API_KEY in env
```
