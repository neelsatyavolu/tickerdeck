import { DurableObject } from "cloudflare:workers";
import { verifyStreamTicket } from "../../lib/market/streamTicket.ts";
import { PriceFanout } from "./fanout.js";

export class PriceStream extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.feed = new PriceFanout(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`https://ws.finnhub.io?token=${encodeURIComponent(this.env.FINNHUB_API_KEY)}`, {
          headers: { Upgrade: "websocket" },
          signal: controller.signal,
        });
        const upstream = response.webSocket;
        if (!upstream) throw new Error("Price provider did not upgrade");
        upstream.accept();
        return upstream;
      } finally {
        // workerd retains the fetch signal on upgraded sockets; only time out the handshake.
        clearTimeout(timeout);
      }
    });
    for (const socket of ctx.getWebSockets()) {
      this.feed.addClient(socket, socket.deserializeAttachment()?.symbols ?? []);
    }
  }

  fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    this.feed.addClient(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, message) {
    this.feed.message(socket, message);
  }

  webSocketClose(socket) {
    this.feed.removeClient(socket);
    socket.close(1000, "Price stream closed");
  }

  webSocketError(socket) {
    this.feed.removeClient(socket);
    socket.close(1011, "Price stream connection lost");
  }
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/stream") return new Response("Not found", { status: 404 });
    if (!env.PRICE_STREAM_SECRET || !env.FINNHUB_API_KEY) return new Response("Stream unavailable", { status: 503 });
    const ticket = url.searchParams.get("ticket") ?? "";
    if (!(await verifyStreamTicket(ticket, env.PRICE_STREAM_SECRET))) return new Response("Unauthorized", { status: 401 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket upgrade required", { status: 426 });
    // The API key is the coordination atom: every browser shares exactly this one DO.
    return env.PRICE_STREAM.getByName("finnhub").fetch(request);
  },
};

export default worker;
