// Turns a portfolio CSV (Yahoo Finance's export, or a broker-style file with
// symbol/shares/cost/date columns) into holdings. Pure: no network, no DB.

export type ImportedHolding = {
  symbol: string;
  shares: number;
  cost_basis: number;
  bought_at: string | null;
  note: string | null;
};

export type SkippedRow = { line: number; symbol: string; reason: string };

export type ImportResult = {
  format: "yahoo" | "generic";
  holdings: ImportedHolding[];
  skipped: SkippedRow[];
};

export const MAX_IMPORT_ROWS = 1000;
const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

/** RFC 4180-ish CSV: quoted fields, escaped quotes, CRLF, blank lines skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

const COLUMNS = {
  symbol: ["symbol", "ticker", "tickersymbol", "stock", "security"],
  shares: ["quantity", "shares", "qty", "units", "position"],
  price: ["purchaseprice", "price", "costpershare", "avgcost", "averagecost", "avgprice", "averageprice", "unitcost", "pricepaid"],
  total: ["costbasistotal", "totalcost", "costbasis", "cost", "totalcostbasis"],
  date: ["tradedate", "date", "purchasedate", "bought", "acquired", "dateacquired", "opendate"],
  note: ["comment", "note", "notes", "description"],
} as const;

function findColumn(headers: string[], names: readonly string[]): number {
  const keys = headers.map(norm);
  for (const n of names) {
    const i = keys.indexOf(n);
    if (i !== -1) return i;
  }
  return -1;
}

/** "$1,234.50", "(12.00)", "1.5" → number; blank → null. */
export function parseAmount(v: string | undefined): number | null {
  if (v === undefined) return null;
  const s = v.trim();
  if (!s || s === "--" || /^n\/?a$/i.test(s)) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  const n = Number(s.replace(/[$,()\s-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** 20250314, 2025-03-14, 03/14/2025, 3/14/25 → "2025-03-14"; anything else → null. */
export function parseDate(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  let y: number, m: number, d: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s))) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += y >= 70 ? 1900 : 2000;
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Yahoo writes share classes with a dash (BRK-B). Other dashes, carets and
 * exchange suffixes (BTC-USD, ^GSPC, SHOP.TO, EURUSD=X) aren't US listings.
 */
export function normalizeSymbol(raw: string): { symbol: string } | { reason: string } {
  const s = raw.trim().toUpperCase();
  if (!s) return { reason: "No symbol" };
  if (/^\$\$CASH/.test(s) || s === "CASH") return { reason: "Cash row" };
  const shareClass = /^([A-Z]{1,6})-([A-Z])$/.exec(s);
  if (shareClass) return { symbol: `${shareClass[1]}.${shareClass[2]}` };
  if (/[\^=]/.test(s) || /-/.test(s)) return { reason: "Not a US stock or ETF (index, currency or crypto)" };
  if (/\.[A-Z]{2,}$/.test(s)) return { reason: "Listed outside the US" };
  if (!SYMBOL_RE.test(s)) return { reason: "Not a valid ticker" };
  return { symbol: s };
}

export function importCsv(text: string): ImportResult {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error("The file is empty.");
  const headers = rows[0];
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, findColumn(headers, names)])) as Record<keyof typeof COLUMNS, number>;
  if (col.symbol === -1) throw new Error("Couldn't find a Symbol or Ticker column.");
  const format = findColumn(headers, ["purchaseprice"]) !== -1 && findColumn(headers, ["tradedate"]) !== -1 ? "yahoo" : "generic";

  const body = rows.slice(1);
  if (body.length > MAX_IMPORT_ROWS) throw new Error(`That file has ${body.length} rows; the limit is ${MAX_IMPORT_ROWS}.`);

  const holdings: ImportedHolding[] = [];
  const skipped: SkippedRow[] = [];
  body.forEach((cells, i) => {
    const line = i + 2;
    const rawSymbol = cells[col.symbol] ?? "";
    const sym = normalizeSymbol(rawSymbol);
    if ("reason" in sym) {
      skipped.push({ line, symbol: rawSymbol.trim(), reason: sym.reason });
      return;
    }
    const shares = col.shares === -1 ? 0 : parseAmount(cells[col.shares]) ?? 0;
    if (shares < 0) {
      skipped.push({ line, symbol: sym.symbol, reason: "Negative quantity (short positions aren't supported)" });
      return;
    }
    let cost = col.price === -1 ? null : parseAmount(cells[col.price]);
    if (cost === null && col.total !== -1 && shares > 0) {
      const total = parseAmount(cells[col.total]);
      cost = total === null ? null : total / shares;
    }
    if (cost !== null && cost < 0) cost = null;
    const note = col.note === -1 ? "" : (cells[col.note] ?? "").trim();
    holdings.push({
      symbol: sym.symbol,
      shares,
      cost_basis: cost === null ? 0 : Math.round(cost * 1e6) / 1e6,
      bought_at: col.date === -1 ? null : parseDate(cells[col.date]),
      note: note ? note.slice(0, 500) : null,
    });
  });
  return { format, holdings, skipped };
}
