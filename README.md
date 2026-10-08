# tickerdeck

Personal stock and portfolio tracker. It covers:

- **Portfolios**: holdings, watchlists, and paper (what-if) baskets. Holdings are stored as individual purchase lots.
- **Live prices**: streamed from Finnhub's WebSocket.
- **Forecasts**: Monte Carlo price ranges, analyst price targets, and analyst ratings.
- **AI assistant**: runs on your own ChatGPT or Grok subscription, using the [`shared-ai-auth`](https://github.com/neelsatyavolu/shared-ai-auth) sign-in.

## Stack

- **App:** Next.js 16 (App Router), deployed on Vercel.
- **Database and sign-in:** Neon Postgres plus Neon Auth (Vercel Marketplace). All reads and writes go through server routes, and every query is scoped to the signed-in user.
- **Market data:**
  - Finnhub: quotes, the trade stream, profiles, key metrics, ratings, earnings, peers, news, and symbol search.
  - Nasdaq (`lib/market/nasdaq.ts`): daily price history and volume (stocks and ETFs), analyst targets and their history, and sector/dividend summary.
  - Yahoo Finance (`lib/market/yahoo.ts`): fallback for history and targets only. It rate-limits cloud hosts (429 from Vercel), so Nasdaq is tried first (`lib/market/sources.ts`). Nasdaq's and Yahoo's endpoints are both unofficial.
  - Every stock page links out to the matching Yahoo Finance pages.
- **Design:** Machine & Ink (`~/DESIGN.md`).

## Setup

1. Add Neon to the Vercel project from the Marketplace and turn on Neon Auth. This sets `DATABASE_URL`, `NEON_AUTH_BASE_URL` and the other database variables.
2. Add `NEON_AUTH_COOKIE_SECRET` (any random string of 32+ characters) and `FINNHUB_API_KEY` to the project.
3. Run `pnpm build`. It applies `db/migrations/*.sql` before `next build`, so every deploy migrates automatically. Locally, `pnpm migrate` does the same.
4. For local dev, connect the Neon resource to the Development environment, run `vercel env pull .env.local`, then `pnpm dev`.

## How it fits together

| Area | Where |
| --- | --- |
| Forecast math (pure, tested) | `lib/forecast/montecarlo.ts`: resamples whole historical days, so the way assets move together is kept. Historical drift is replaced by an assumed 7%/yr. |
| Portfolio math | `lib/portfolio/math.ts`: merges lots, then computes gain/loss, weights, and paper cash. |
| Data access | `lib/portfolio/repo.ts`: server-only SQL, with every statement filtered by `user_id`. The browser calls `/api/portfolios` and `/api/holdings`. |
| Live prices | `components/LivePrices.tsx`: a REST snapshot, then the Finnhub WebSocket. The socket key is only served to signed-in users. |
| AI sign-in | `app/api/ai/[provider]/*`: paste-the-callback OAuth via `shared-ai-auth`. Tokens are kept in chunked httpOnly cookies, never in the database. |
| AI chat | `app/api/ai/chat`: gathers portfolios, quotes, analyst data, news, and forecasts into the system prompt (`lib/ai/context.ts`), then streams NDJSON back. Read-only: the assistant cannot change data. |

## Tests

```sh
pnpm test        # unit tests (vitest)
pnpm typecheck
pnpm test:e2e    # Playwright; needs the Neon + Finnhub env vars locally
```
