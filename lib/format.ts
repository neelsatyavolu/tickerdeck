const isNum = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

export function usd(n: number | null | undefined, opts: { digits?: number; compact?: boolean } = {}): string {
  if (!isNum(n)) return "—";
  if (opts.compact && Math.abs(n) >= 1e6) {
    return `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n)}`;
  }
  const digits = opts.digits ?? (Math.abs(n) < 1 && n !== 0 ? 4 : 2);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Index levels are points, not dollars. */
export function points(n: number | null | undefined, digits = 2): string {
  if (!isNum(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** A symbol's price: dollars for securities, points for indexes (^GSPC). */
export function priceOf(symbol: string, n: number | null | undefined, digits?: number): string {
  return symbol.startsWith("^") ? points(n, digits ?? 2) : usd(n, digits === undefined ? {} : { digits });
}

export function signedUsd(n: number | null | undefined): string {
  if (!isNum(n)) return "—";
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${usd(Math.abs(n))}`;
}

export function pct(n: number | null | undefined, digits = 2): string {
  if (!isNum(n)) return "—";
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n * 100).toFixed(digits)}%`;
}

export function plainPct(n: number | null | undefined, digits = 1): string {
  return isNum(n) ? `${(n * 100).toFixed(digits)}%` : "—";
}

export function shares(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/** CSS class for a gain/loss value: green up, red down, neutral otherwise. */
export function tone(n: number | null | undefined): string {
  if (!isNum(n) || n === 0) return "";
  return n > 0 ? "up" : "down";
}

export function shortDate(t: number | string): string {
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function timeAgo(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return shortDate(t);
}

export function todayIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
