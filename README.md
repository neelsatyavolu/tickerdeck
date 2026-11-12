# tickerquill

Personal stock and portfolio tracker. It covers:

- **Portfolios**: holdings, watchlists, and paper (what-if) baskets. Holdings are stored as individual purchase lots.
- **Brokerage sync** (optional): link a brokerage through Plaid and each account becomes a read-only portfolio that mirrors your positions.
- **Live prices**: streamed through a shared relay from Yahoo Finance's streamer, with Finnhub's trade WebSocket as the fallback. Indexes refresh from snapshots every 5 seconds during market hours. Crypto (`BTC-USD` and about 25 other coins) can be watched and charted; it refreshes every 15 seconds.
- **Dashboards and display mode**: any dashboard can fill a spare tablet, phone or monitor and keep the screen awake. The "Display board" layout shows big price tiles, and `?display=1` on a dashboard's address opens it straight into display mode.
- **Themes**: Ink, Paper, Graphite, Salmon and Night, chosen in Settings and saved per browser.
- **Forecasts**: Monte Carlo price ranges, analyst price targets, and analyst ratings.
- **AI assistant**: runs on your own ChatGPT or Grok subscription, using the [`shared-ai-auth`](https://github.com/neelsatyavolu/shared-ai-auth) sign-in.

## Stack

- **App:** Next.js 16 (App Router), deployed on Vercel.
- **Database and sign-in:** Neon Postgres plus Neon Auth (Vercel Marketplace). All reads and writes go through server routes, and every query is scoped to the signed-in user.
- **Market data:**
  - Finnhub: quotes, the trade stream, profiles, key metrics, ratings, earnings, peers, news, and symbol search.
  - Nasdaq (`lib/market/nasdaq.ts`): daily price history and volume (stocks and ETFs), analyst targets and their history, and sector/dividend summary.
  - Coinbase Exchange (`lib/market/coinbase.ts`): crypto quotes and daily history. Official, and needs no key.
  - Yahoo Finance (`lib/market/yahoo.ts`): fallback for history and targets only. It rate-limits cloud hosts (429 from Vercel), so Nasdaq is tried first (`lib/market/sources.ts`). Nasdaq's and Yahoo's endpoints are both unofficial.
  - Every stock page links out to the matching Yahoo Finance pages.
- **Design:** Machine & Ink: warm ink-black, Geist / Geist Mono / Newsreader, one blue accent, flat with sharp corners.

## Setup

1. Add Neon to the Vercel project from the Marketplace and turn on Neon Auth. This sets `DATABASE_URL`, `NEON_AUTH_BASE_URL` and the other database variables.
2. Add `NEON_AUTH_COOKIE_SECRET` (any random string of 32+ characters) and `FINNHUB_API_KEY` to the project.
3. Run `pnpm build`. It applies `db/migrations/*.sql` before `next build`, so every production deploy migrates automatically. Preview deploys skip migrations unless `ALLOW_PREVIEW_MIGRATIONS` is set. Locally, `pnpm migrate` does the same.
4. For local dev, connect the Neon resource to the Development environment, run `vercel env pull .env.local`, then `pnpm dev`.

### Account emails

Password reset, email confirmation and sign-in link emails are sent by the app through [Resend](https://resend.com), from `TickerQuill <no-reply@n3el.dev>`. Neon Auth hands each one over by calling a webhook.

1. Add `RESEND_API_KEY` to the project. The sender's domain (`n3el.dev`) must be verified in Resend.
2. In the Neon Console, open **Auth → Configuration → Webhooks**. Enable delivery, set the URL to `https://tickerquill.n3el.dev/api/webhooks/neon-auth`, and select the `send.magic_link` event.
3. In the Neon Auth settings, make sure the site's origin (`https://tickerquill.n3el.dev`) is a trusted domain. The reset link returns to `/login/reset`, and Neon refuses to redirect anywhere it does not trust.

Once `send.magic_link` is selected, Neon stops sending every email that carries a link, which includes the confirmation link at sign-up when the project verifies by link. There is no fallback: if all three delivery attempts fail (the webhook or Resend is down), the request fails for the user. Deploy the app with `RESEND_API_KEY` set before turning the webhook on.

### Xanom sign-in

"Continue with Xanom" signs people in with their accounts.xanom.co account; the email and password form keeps working. Settings can convert an account to Xanom or link an existing Xanom account. The contract is `SPEC.md` in the xanom-accounts repo.

1. Set `XANOM_ISSUER` (`https://accounts.xanom.co`), `XANOM_CLIENT_ID` (`tickerquill`) and `XANOM_CLIENT_SECRET`.
2. In Neon Auth, turn on the Magic Link plugin and keep the webhook above subscribed to `send.magic_link` at `https://tickerquill.xanom.co/api/webhooks/neon-auth`. Neon Auth can't start a session for a user the app vouches for, so after checking the Xanom id_token the callback asks Neon for a magic link and the webhook hands its token back instead of emailing it (`lib/xanom/handoff.ts`). An account whose email was never confirmed but has a password gets that password replaced through the same trick (a reset link nobody sees) and its other sessions ended, so a squatter can't keep a way in.
3. Xanom links live in `xanom_links` (Neon Auth owns the user table). accounts.xanom.co reads `GET /api/xanom/summary` for its dashboard: counts only, no names, tickers or amounts.

### Brokerage sync (optional)

Off unless the Plaid variables are set, and then only for one user.

1. Create a [Plaid](https://dashboard.plaid.com) account. The free Trial plan includes Investments and allows 10 links in total; unlinking does not give one back, so try things in the sandbox first.
2. In the Plaid dashboard, add `https://<your-domain>/plaid/oauth` to the allowed redirect URIs (and `http://localhost:3000/plaid/oauth` for local dev).
3. Add `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_TOKEN_KEY` (a random string of 32+ characters) and `PLAID_OWNER_USER_ID` (your user id, shown in Settings → Account). Leave `PLAID_ENV` unset for the sandbox; set it to `production` for real brokerages.
4. Redeploy, then use Settings → Brokerages.

`PLAID_TOKEN_KEY` encrypts the stored access tokens. If it changes, every link has to be made again.

## How it fits together

| Area | Where |
| --- | --- |
| Forecast math (pure, tested) | `lib/forecast/montecarlo.ts`: resamples whole historical days, so the way assets move together is kept. Historical drift is replaced by an assumed 7%/yr. |
| Portfolio math | `lib/portfolio/math.ts`: merges lots, then computes gain/loss, weights, and paper cash. |
| Data access | `lib/portfolio/repo.ts`: server-only SQL, with every statement filtered by `user_id`. The browser calls `/api/portfolios` and `/api/holdings`. |
| Brokerage sync | `lib/plaid/*`: `map.ts` turns Plaid positions into lots (cost per share, no purchase date; cash, options, bonds and crypto are skipped and reported). `repo.ts` replaces a link's portfolios in one all-or-nothing transaction; an account the brokerage stops reporting is released as an ordinary portfolio. Access tokens are sealed with AES-256-GCM before they are stored (`tokens.ts`) and never leave the server. Syncs run on demand: the Sync button, or opening a linked portfolio whose last sync is over 12 hours old. |
| Live prices | `components/LivePrices.tsx`: a REST snapshot, then the shared stream in `realtime/`. One Cloudflare Durable Object owns the provider connection for all browsers: Yahoo Finance's streamer (about one price a second per symbol), falling back to Finnhub trades if Yahoo refuses the connection. Signed-in users get a one-minute connection ticket; the provider key stays on the backend. |
| Forgot password | `app/login/forgot` asks Neon Auth for a reset link; `app/login/reset` sets the new password. Neon calls `app/api/webhooks/neon-auth` (`lib/auth/webhook.ts`), which checks Neon's Ed25519 signature and sends the email (`lib/mail/`). |
| AI sign-in | `app/api/ai/[provider]/*`: paste-the-callback OAuth via `shared-ai-auth`. Tokens are kept in chunked httpOnly cookies, never in the database. |
| AI chat | `app/api/ai/chat`: gathers portfolios, quotes, analyst data, news, and forecasts into the system prompt (`lib/ai/context.ts`), then streams NDJSON back. Up to four screenshots can be attached to a message (`lib/ai/images.ts`). The model can look up any ticker mid-answer with the data tools in `lib/ai/tools.ts` and search the web with its provider's built-in search (ChatGPT `web_search`; Grok `web_search` and `x_search`), which runs on the subscription and needs no key; `lib/ai/stream.ts` runs the tool rounds. Read-only: the assistant cannot change data. |
| AI insights | `app/api/ai/insights`: the same subscription writes 8 to 12 short findings about your holdings, watchlists and the market as a JSON list (`lib/ai/insightsPrompt.ts`), which is validated (`lib/ai/insights.ts`) and saved, one set per user (`ai_insights`). The page shows the saved set at once and rewrites it on Refresh, or on opening it when it is over a day old. A source link is shown only if the model really cited that page. |

### Shared price stream

Deploy `realtime/wrangler.jsonc` with Wrangler. Set its `FINNHUB_API_KEY` and `PRICE_STREAM_SECRET` secrets, then set the same `PRICE_STREAM_SECRET` and the deployed `https://<worker>/stream` as `PRICE_STREAM_URL` on Vercel. Redeploy the app after changing the URL so its socket origin is allowed by the content security policy. The relay connects only while stocks are being watched, combines overlapping subscriptions, and reconnects with backoff. The relay accepts at most 50 symbols in the combined set; indexes and crypto continue using snapshots.

## Tests

```sh
pnpm test        # unit tests (vitest)
pnpm exec vitest run --config realtime/vitest.config.mjs # shared stream
pnpm typecheck
pnpm test:e2e    # Playwright; needs the Neon + Finnhub env vars locally
```

## License

MIT. See [LICENSE](LICENSE).
