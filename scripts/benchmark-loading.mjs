import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { performance } from 'node:perf_hooks';
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const cookieSecret = 'local-benchmark-only-cookie-secret-123456789';
const base = 'http://localhost:3137';
const exp = Math.floor(Date.now() / 1000) + 1800;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const header = encode({ alg: 'HS256', typ: 'JWT' });
const dates = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
const payload = encode({ user: { id: 'speed-test', email: 'speed@tickerdeck.test', ...dates }, session: { id: 'speed-test', userId: 'speed-test', expiresAt: new Date(exp * 1000).toISOString(), ...dates }, iat: Math.floor(Date.now() / 1000), exp, sub: 'speed-test' });
const data = `${header}.${payload}`;
const jwt = `${data}.${createHmac('sha256', cookieSecret).update(data).digest('base64url')}`;
const browser = await chromium.launch({ headless: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const quote = symbol => ({ symbol, price: 110, prevClose: 100, time: Date.now() });
const points = Array.from({ length: 2600 }, (_, i) => ({ t: Date.now() - (2599 - i) * 86400000, close: 100 + i / 260, volume: 1000000 }));
const overview = { spark: points.slice(-22).map(p => p.close), r1m: 0.01, r3m: 0.02, ytd: 0.03, r1y: 0.04, low52: 90, high52: 120 };
const none = { value: null, error: null };
const info = { symbol: 'AAPL', quote: { value: quote('AAPL'), error: null }, profile: none, stats: none, targets: none, recommendations: none, news: { value: [], error: null }, earnings: none, peers: none };
const results = [];
try {
  for (const route of ['/', '/s/AAPL', '/watchlist', '/p/11111111-1111-4111-8111-111111111111']) {
    for (let run = 0; run < 3; run++) {
      const context = await browser.newContext({ extraHTTPHeaders: { Cookie: `__Secure-neon-auth.local.session_data=${jwt}; __Secure-neon-auth.session_token=local-benchmark` } });
      await context.addCookies([{ name: '__Secure-neon-auth.local.session_data', value: jwt, domain: 'localhost', path: '/', secure: true }, { name: '__Secure-neon-auth.session_token', value: 'local-benchmark', domain: 'localhost', path: '/', secure: true }]);
      await context.routeWebSocket('**', ws => ws.close());
      let historyBytes = 0;
      let overviewCalls = 0;
      let scriptBytes = 0;
      const scriptTasks = [];
      const page = await context.newPage();
      page.on('response', r => { if (r.request().resourceType() === 'script' && r.url().startsWith(base)) scriptTasks.push(r.body().then(b => { scriptBytes += b.length; }).catch(() => {})); });
      await context.route('**/api/**', async r => {
        const u = new URL(r.request().url());
        let value = [];
        let delay = 100;
        if (u.pathname === '/api/portfolios') value = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Speed portfolio', kind: 'holdings', starting_cash: null, start_date: null, created_at: new Date().toISOString(), holdings: [{ id: 'h', portfolio_id: '11111111-1111-4111-8111-111111111111', symbol: 'AAPL', shares: 2, cost_basis: 100, bought_at: null, note: null }] }];
        if (u.pathname === '/api/watchlists') value = [{ id: 'watch', name: 'Watchlist', is_primary: true, items: [{ symbol: 'AAPL', name: 'Apple', added_at: new Date().toISOString() }] }];
        if (u.pathname === '/api/market/quotes') { value = { quotes: (u.searchParams.get('symbols') ?? '').split(',').map(quote), failed: [] }; delay = 250; }
        if (u.pathname === '/api/market/overview') { overviewCalls++; value = Object.fromEntries((u.searchParams.get('symbols') ?? '').split(',').map(s => [s, overview])); delay = 2400; }
        if (u.pathname.startsWith('/api/market/stock/')) { value = info; delay = 150; }
        if (u.pathname === '/api/market/history') { const days = { '1mo': 31, '3mo': 92, '6mo': 183, '1y': 366, '2y': 731, '5y': 1827, '10y': 3653 }[u.searchParams.get('range')]; value = points.filter(p => p.t >= points.at(-1).t - days * 86400000); historyBytes += JSON.stringify(value).length; delay = 500; }
        if (u.pathname === '/api/market/stream') value = { url: 'ws://localhost:3137/benchmark-stream' };
        if (u.pathname === '/api/forecast') { await sleep(2400); return r.fulfill({ status: 502, json: { ok: false, error: 'Benchmark forecast unavailable' } }); }
        if (u.pathname === '/api/ai/status' || u.pathname === '/api/ai/models') return r.fulfill({ json: u.pathname.endsWith('status') ? { codex: true, grok: false } : { codex: [], grok: [] } });
        if (u.pathname === '/api/ai/chat') return r.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ t: '**Ready**\n\n| Asset | Change |\n| --- | --- |\n| AAPL | +10% |\n\n[Source](https://example.com/news)\n\n![blocked](https://example.com/track.png) [unsafe](javascript:alert(1))' }) + '\n' + JSON.stringify({ done: true }) + '\n' });
        if (u.pathname === '/api/market/extended') value = {};
        await sleep(delay);
        await r.fulfill({ json: { ok: true, data: value } });
      });
      const start = performance.now();
      await page.goto(base + route, { waitUntil: 'domcontentloaded' });
      const heading = route === '/' ? page.getByRole('heading', { name: /^Good / }) : route.startsWith('/s') ? page.getByRole('heading', { name: 'AAPL', exact: true }) : route === '/watchlist' ? page.getByRole('heading', { name: 'Watchlist', exact: true }) : page.getByRole('heading', { name: 'Speed portfolio', exact: true });
      try { await heading.waitFor({ state: 'visible', timeout: 30000 }); }
      catch (error) { console.log({ url: page.url(), headings: await page.locator('h1').allTextContents(), text: (await page.locator('body').innerText()).slice(0,400) }); throw error; }
      const visibleMs = Math.round(performance.now() - start);
      await Promise.all(scriptTasks);
      const initialScriptBytes = scriptBytes;
      if (process.argv.includes('--verify')) {
        await page.locator('.assist-launcher').click();
        await page.getByRole('dialog', { name: 'AI assistant' }).waitFor({ state: 'visible' });
        await page.getByRole('dialog').getByLabel('Message').fill('Show the market table');
        await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
        await page.locator('.assist-body table').waitFor({ state: 'visible' });
        if (await page.locator('.assist-body img, .assist-body a[href^="javascript:"]').count()) throw new Error('Unsafe markdown was rendered');
        await page.getByRole('button', { name: 'Close assistant' }).click();
        if (route === '/' || route.startsWith('/p/')) await page.getByText('$220.00', { exact: true }).first().waitFor({ state: 'visible' });
        if (route === '/watchlist') await page.getByText('+1.0%', { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 });
        if (route.startsWith('/s') || route.startsWith('/p/')) await page.getByText('Benchmark forecast unavailable', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
      }
      await Promise.all(scriptTasks);
      results.push({ route, run, visibleMs, scriptBytes: initialScriptBytes, historyBytes, overviewCalls });
      console.log(JSON.stringify(results.at(-1)));
      await context.close();
    }
  }
  for (const route of [...new Set(results.map(r => r.route))]) {
    const rows = results.filter(r => r.route === route);
    console.log(JSON.stringify({ route, medianMs: rows.map(r => r.visibleMs).sort((a,b) => a-b)[1], scriptBytes: rows[1].scriptBytes, historyBytes: rows[1].historyBytes }));
  }
} finally { await browser.close(); }
