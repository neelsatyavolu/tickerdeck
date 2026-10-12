const STOCK = /^[A-Z][A-Z0-9.-]{0,9}$/;
const LIMIT = 50;

// One controller owns the provider socket and the union of every browser's subscriptions.
export class PriceFanout {
  constructor(connectUpstream) {
    this.connectUpstream = connectUpstream;
    this.clients = new Map();
    this.symbols = new Set();
    this.latest = new Map();
    this.pending = new Map();
    this.upstream = null;
    this.connecting = false;
    this.generation = 0;
    this.retryTimer = null;
    this.flushTimer = null;
    this.failures = 0;
  }

  addClient(client, restored = []) {
    this.clients.set(client, new Set());
    this.send(client, { type: "status", connected: Boolean(this.upstream) });
    for (const symbol of restored) this.message(client, JSON.stringify({ type: "subscribe", symbol }));
    this.attach(client);
  }

  message(client, raw) {
    const owned = this.clients.get(client);
    if (!owned) return;
    let frame;
    try { frame = typeof raw === "string" && raw.length <= 2048 ? JSON.parse(raw) : null; } catch { frame = null; }
    if (!frame || !["subscribe", "unsubscribe"].includes(frame.type) || typeof frame.symbol !== "string" || !STOCK.test(frame.symbol)) {
      this.send(client, { type: "error", message: "Invalid price subscription" });
      return;
    }
    const { type, symbol } = frame;
    if (type === "unsubscribe") {
      owned.delete(symbol);
      this.release(symbol);
    } else if (!owned.has(symbol)) {
      if (owned.size >= LIMIT) {
        this.send(client, { type: "error", message: "Live price symbol limit reached" });
        return;
      }
      const first = !this.symbols.has(symbol);
      owned.add(symbol);
      if (first && this.symbols.size >= LIMIT) {
        this.send(client, { type: "error", message: "Waiting for live price capacity" });
      } else {
        this.symbols.add(symbol);
        if (first) this.sendUpstream({ type: "subscribe", symbol });
      }
      const trade = this.latest.get(symbol);
      if (trade) this.send(client, { type: "trade", data: [trade] });
    }
    this.attach(client);
    if (this.symbols.size) this.ensureConnection();
    else this.stop();
  }

  attach(client) {
    const owned = this.clients.get(client);
    if (owned) client.serializeAttachment({ symbols: [...owned] });
  }

  removeClient(client) {
    const owned = this.clients.get(client);
    if (!owned) return;
    this.clients.delete(client);
    for (const symbol of owned) this.release(symbol);
    if (!this.symbols.size) this.stop();
  }

  release(symbol) {
    if ([...this.clients.values()].some((owned) => owned.has(symbol))) return;
    if (this.symbols.delete(symbol)) this.sendUpstream({ type: "unsubscribe", symbol });
    this.latest.delete(symbol);
    this.pending.delete(symbol);
    for (const owned of this.clients.values()) {
      for (const waiting of owned) {
        if (this.symbols.size >= LIMIT) return;
        if (this.symbols.has(waiting)) continue;
        this.symbols.add(waiting);
        this.sendUpstream({ type: "subscribe", symbol: waiting });
      }
    }
  }

  send(client, frame) {
    try { client.send(JSON.stringify(frame)); } catch { this.removeClient(client); }
  }

  broadcast(frame) {
    for (const client of [...this.clients.keys()]) this.send(client, frame);
  }

  sendUpstream(frame) {
    const upstream = this.upstream;
    if (!upstream) return;
    try { upstream.send(JSON.stringify(frame)); } catch { this.lost(upstream, true); }
  }

  ensureConnection() {
    if (!this.symbols.size || this.upstream || this.connecting || this.retryTimer !== null) return;
    this.connecting = true;
    const generation = this.generation;
    void this.connectUpstream().then((upstream) => {
      if (generation !== this.generation || !this.symbols.size) { upstream.close(1000, "No subscribers"); return; }
      this.upstream = upstream;
      upstream.addEventListener("message", (event) => this.receive(upstream, event.data));
      upstream.addEventListener("close", () => this.lost(upstream));
      upstream.addEventListener("error", () => this.lost(upstream, true));
      for (const symbol of this.symbols) this.sendUpstream({ type: "subscribe", symbol });
      if (this.upstream === upstream) this.broadcast({ type: "status", connected: true });
    }).catch(() => {
      if (generation !== this.generation) return;
      this.broadcast({ type: "error", message: "Market price provider unavailable" });
      this.broadcast({ type: "status", connected: false });
      this.scheduleRetry();
    }).finally(() => {
      this.connecting = false;
      this.ensureConnection();
    });
  }

  lost(upstream, error = false) {
    if (this.upstream !== upstream) return;
    this.upstream = null;
    upstream.close(1000, "Reconnecting price stream");
    if (error) this.broadcast({ type: "error", message: "Market price provider unavailable" });
    this.broadcast({ type: "status", connected: false });
    this.scheduleRetry();
  }

  scheduleRetry() {
    if (!this.symbols.size || this.retryTimer !== null) return;
    const delay = Math.min(1000 * 2 ** Math.min(this.failures++, 5), 30000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.ensureConnection();
    }, delay);
  }

  receive(upstream, raw) {
    if (this.upstream !== upstream || typeof raw !== "string") return;
    let frame;
    try { frame = JSON.parse(raw); } catch { return; }
    if (frame?.type === "error") { this.lost(upstream, true); return; }
    if (frame?.type !== "trade" || !Array.isArray(frame.data)) return;
    for (const trade of frame.data) {
      if (!trade || !this.symbols.has(trade.s) || !Number.isFinite(trade.p) || trade.p <= 0 || !Number.isFinite(trade.t) || trade.t <= 0) continue;
      const previous = this.latest.get(trade.s);
      if (previous && previous.t > trade.t) continue;
      const price = { s: trade.s, p: trade.p, t: trade.t };
      this.failures = 0;
      this.latest.set(trade.s, price);
      this.pending.set(trade.s, price);
    }
    if (this.pending.size && this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        const trades = [...this.pending.values()];
        this.pending.clear();
        for (const [client, owned] of [...this.clients]) {
          const data = trades.filter((trade) => owned.has(trade.s));
          if (data.length) this.send(client, { type: "trade", data });
        }
      }, 400);
    }
  }

  stop() {
    this.generation++;
    clearTimeout(this.retryTimer);
    clearTimeout(this.flushTimer);
    this.retryTimer = this.flushTimer = null;
    this.pending.clear();
    const upstream = this.upstream;
    this.upstream = null;
    if (upstream) upstream.close(1000, "No subscribers");
    this.broadcast({ type: "status", connected: false });
  }
}
