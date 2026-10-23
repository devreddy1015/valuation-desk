// Portfolio X-ray: read holdings from a broker file or pasted text, then look through the whole
// portfolio with one ScanRow per stock. Pure functions: the page does the fetching and storage.
import { money, num, pct } from "./format";
import { isExtreme } from "./scanMath";
import type { HealthGrade, ScanRow } from "./scanTypes";

export const PORTFOLIO_KEY = "vd:portfolio:v1";
export const PORTFOLIO_BASE_KEY = "vd:portfolio:base:v1";
export const MAX_HOLDINGS = 200;

/** One holding as stored in the browser. avgCost is per share, in the stock's own currency. */
export interface Holding { symbol: string; qty: number; avgCost?: number; added: string }
/** A holding before it is stored: what an import line or the add form produces. */
export type Lot = Omit<Holding, "added">;
/** Yahoo suffix for bare symbols: NSE, BSE, or none (US and symbols that already carry a suffix). */
export type Exchange = "NS" | "BO" | "";
export type ImportFormat = "zerodha-kite" | "zerodha-console" | "csv" | "text";
export interface SkippedLine { line: number; text: string; reason: string }
export interface ImportResult { format: ImportFormat; lots: Lot[]; skipped: SkippedLine[]; notes: string[] }

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

/* ------------------------------------------------------------------ parsing */

/**
 * A number as people type it in holdings files: currency signs, thousands separators (including
 * Indian lakh grouping), "@" prefixes, brackets or a minus for negatives. When both "," and "."
 * appear the later one is the decimal mark; a lone comma is decimal only when `decimalComma`.
 */
export function parseNumber(raw: string | undefined | null, decimalComma = false): number | null {
  if (raw == null) return null;
  let s = raw.replace(/[\s   ']/g, "").replace(/^(?:@|₹|rs\.?|inr|usd|us\$|eur|gbp|\$|€|£|¥)+/i, "").replace(/(?:₹|\$|€|£)$/, "");
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^[-−]/.test(s)) { neg = !neg; s = s.slice(1); } else if (s.startsWith("+")) s = s.slice(1);
  if (decimalComma && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // "1.200" is twelve hundred there
  const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
  const comma = lc >= 0 && ld >= 0 ? lc > ld : decimalComma && lc >= 0;
  s = comma ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}

/** Split delimited text into rows of trimmed cells, honouring double quotes ("" is a literal quote). */
export function splitDelimited(text: string, delim: string): { cells: string[]; line: number }[] {
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [], cell = "", quoted = false, line = 1, start = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else { if (c === "\n") line++; cell += c; }
    } else if (c === '"' && cell.trim() === "") { quoted = true; cell = ""; }
    else if (c === delim) { cells.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cells.push(cell); rows.push({ cells, line: start });
      cells = []; cell = ""; line++; start = line;
    } else cell += c;
  }
  if (cell !== "" || cells.length) { cells.push(cell); rows.push({ cells, line: start }); }
  return rows.map((r) => ({ ...r, cells: r.cells.map((x) => x.trim()) }));
}

/** The delimiter used in the most of the first lines (commas, semicolons, tabs or pipes). */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 12);
  let best = ",", bestScore = -1;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = lines.map((l) => l.replace(/"[^"]*"/g, "").split(d).length - 1);
    const score = counts.filter((n) => n > 0).length * 1000 + sum(counts);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

const DEBT_SERIES = /-(GB|GS|SG|TB|N[0-9A-Z]|Y[0-9A-Z])$/;
const EQUITY_SERIES = /-(EQ|BE|BZ|BL|SM|ST|IL|IT|RL|E1|T0)$/;

/**
 * Turn what a broker or a person writes into a Yahoo symbol: INFY -> INFY.NS (or .BO), a six-digit
 * BSE scrip code -> 500325.BO, NSE:INFY -> INFY.NS, IDEA-BE -> IDEA.NS (NSE series dropped),
 * BRK.B -> BRK-B. Gold bonds, government securities and clearly named ETFs are refused with a reason.
 */
export function toYahooSymbol(raw: string, exchange: Exchange): { symbol: string } | { reason: string } {
  let s = raw.replace(/^﻿/, "").trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return { reason: "No symbol on this line" };
  const pre = s.match(/^(NSE|BSE):/);
  if (pre) { exchange = pre[1] === "NSE" ? "NS" : "BO"; s = s.slice(4); }
  const suffix = s.match(/\.(NS|BO)$/)?.[0] ?? "";
  const foreign = !suffix && (/\.[A-Z]{1,3}$/.test(s) || /[\^=]/.test(s));
  if (!foreign && (suffix || exchange)) {
    let core = suffix ? s.slice(0, -suffix.length) : s;
    if (/^SGB[A-Z]{1,4}\d{2}/.test(core) || /-GB$/.test(core)) return { reason: "Sovereign Gold Bond: a government bond, not a share" };
    if (DEBT_SERIES.test(core)) return { reason: "Bond or government security, not a share" };
    if (/BEES$|ETF$|^SETF|^ETF/.test(core)) return { reason: "Exchange-traded fund: the model values companies, not funds" };
    core = core.replace(EQUITY_SERIES, "");
    s = suffix ? core + suffix : /^[589]\d{5}$/.test(core) ? `${core}.BO` : `${core}.${exchange}`;
  } else if (!exchange && /^[A-Z]+\.[AB]$/.test(s)) s = s.replace(".", "-"); // US share classes: BRK.B is BRK-B on Yahoo
  if (!/^[A-Z0-9^.\-=&]{1,24}$/.test(s)) return { reason: `"${raw.trim().slice(0, 30)}" does not look like a ticker symbol` };
  return { symbol: s };
}

const normHeader = (s: string) => s.replace(/^﻿/, "").toLowerCase().replace(/[_\s]+/g, " ").trim();
const first = (h: string[], tests: ((x: string) => boolean)[]) => {
  for (const t of tests) { const i = h.findIndex(t); if (i >= 0) return i; }
  return -1;
};
const oneOf = (...xs: string[]) => (x: string) => xs.includes(x);

interface Columns { symbol: number; qty: number; extraQty: number[]; cost: number; exchange: number; format: ImportFormat }

/** Find the symbol, quantity and (optional) average-cost columns in a header row. */
export function locateColumns(cells: string[]): Columns | null {
  const h = cells.map(normHeader);
  const symbol = first(h, [
    oneOf("instrument", "symbol", "ticker", "tradingsymbol", "trading symbol", "scrip", "scrip code", "stock symbol", "nse symbol", "bse code", "stock code", "security id", "code"),
    (x) => /symbol|ticker|instrument|scrip/.test(x) && !/isin|name|type|description/.test(x),
  ]);
  const qty = first(h, [
    oneOf("qty.", "qty", "quantity", "shares", "quantity available", "no. of shares", "number of shares", "units", "holding qty", "net qty", "total qty", "available qty", "qty available"),
    (x) => /\b(qty|quantity|shares|units)\b/.test(x) && !/long term|pledged|discrepant|t1|blocked|sold|buy|sell|price|value|collateral/.test(x),
  ]);
  if (symbol < 0 || qty < 0 || symbol === qty) return null;
  const cost = first(h, [
    oneOf("avg. cost", "avg cost", "average cost", "average price", "avg. price", "avg price", "avg buy price", "average buy price", "buy price", "buy avg", "buy average", "purchase price", "cost price", "cost", "unit cost", "cost per share", "price paid"),
    (x) => /avg|average|buy price|purchase price|cost price|unit cost|cost per share/.test(x) && !/total|value|amount|invest|ltp|last|close|current|market/.test(x),
  ]);
  const exchange = h.findIndex(oneOf("exchange", "exch", "exchange name"));
  const console = h[qty] === "quantity available" && h.includes("isin");
  const kite = h[symbol] === "instrument" && (h.includes("qty.") || h.includes("avg. cost") || h.includes("ltp") || h.includes("cur. val"));
  const extraQty = console ? ["quantity discrepant", "quantity pledged (margin)", "quantity pledged (loan)"].map((k) => h.indexOf(k)).filter((i) => i >= 0) : [];
  return { symbol, qty, extraQty, cost, exchange, format: console ? "zerodha-console" : kite ? "zerodha-kite" : "csv" };
}

/**
 * The exchange a broker's "Exchange" cell names: NSE, NSE_EQ, "N", "National..." are NSE; BSE, BSE_EQ,
 * "B", "Bombay..." are BSE; a US venue means no suffix. Anything else keeps the user's default, so an
 * unfamiliar label never turns an Indian symbol into a US ticker (IEX would become IDEX Corp).
 */
export function exchangeFromCell(v: string | undefined, fallback: Exchange, unknown?: Set<string>): Exchange {
  const x = (v ?? "").trim().toUpperCase();
  if (!x) return fallback;
  if (/^NSE|^NS$|^N$|NATIONAL/.test(x)) return "NS";
  if (/^BSE|^BO$|^B$|BOMBAY/.test(x)) return "BO";
  if (/^(NASDAQ|NYSE|AMEX|ARCA|BATS|OTC|US|NMS|NGM|NCM|PCX)\b/.test(x)) return "";
  unknown?.add(x);
  return fallback;
}

/** Whether a semicolon or tab file writes decimals with a comma (1450,50). */
function usesDecimalComma(rows: string[][]): boolean {
  const cells = rows.flat();
  return cells.some((c) => /^[-\d.]*\d,\d{1,2}$/.test(c) || /\d\.\d{3},\d/.test(c)) && !cells.some((c) => /^\d+\.\d{1,2}$/.test(c));
}

type LineResult = { lot: Lot } | { reason: string } | null;

function lotFrom(rawSymbol: string, qtyText: string | undefined, costText: string | undefined, exchange: Exchange, decimalComma: boolean, notes: string[], line: number, extraQty = 0): LineResult {
  if (/^(grand\s+)?total\b/i.test(rawSymbol.trim())) return { reason: "Total row" };
  const sym = toYahooSymbol(rawSymbol, exchange);
  if ("reason" in sym) return sym;
  const q = parseNumber(qtyText, decimalComma);
  const qty = (q ?? 0) + extraQty;
  if (q === null && !extraQty) return { reason: qtyText ? `Quantity "${qtyText.slice(0, 20)}" is not a number` : "No quantity on this line" };
  if (!(qty > 0)) return { reason: "Quantity is zero or negative" };
  const lot: Lot = { symbol: sym.symbol, qty };
  if (costText && costText.trim()) {
    const c = parseNumber(costText, decimalComma);
    if (c !== null && c > 0) lot.avgCost = c;
    else if (c !== 0) notes.push(`Line ${line}: the average cost "${costText.slice(0, 20)}" was not understood, so ${sym.symbol} was kept without a cost.`);
  }
  return { lot };
}

function parseTable(rows: { cells: string[]; line: number }[], at: number, cols: Columns, exchange: Exchange, delim: string, skipped: SkippedLine[], notes: string[]): Lot[] {
  const body = rows.slice(at + 1);
  const decimalComma = delim !== "," && usesDecimalComma(body.map((r) => r.cells));
  const ex: Exchange = cols.format === "csv" ? exchange : "NS"; // Zerodha instruments are NSE symbols
  const lots: Lot[] = [];
  const unknownExchanges = new Set<string>();
  for (const r of body) {
    if (r.cells.every((c) => !c)) continue;
    const text = r.cells.filter(Boolean).join(", ").slice(0, 80);
    const extra = sum(cols.extraQty.map((i) => parseNumber(r.cells[i], decimalComma) ?? 0));
    const res = lotFrom(r.cells[cols.symbol] ?? "", r.cells[cols.qty], cols.cost >= 0 ? r.cells[cols.cost] : undefined, cols.exchange >= 0 ? exchangeFromCell(r.cells[cols.exchange], ex, unknownExchanges) : ex, decimalComma, notes, r.line, extra);
    if (!res) continue;
    if ("lot" in res) lots.push(res.lot); else skipped.push({ line: r.line, text, reason: res.reason });
  }
  if (unknownExchanges.size) notes.push(`The exchange column said ${[...unknownExchanges].slice(0, 4).map((x) => `"${x}"`).join(", ")}, which was not recognised, so those symbols were treated as ${ex === "NS" ? "NSE (.NS)" : ex === "BO" ? "BSE (.BO)" : "US (no suffix)"} listings, your default.`);
  if (cols.format === "zerodha-console" && cols.extraQty.length) notes.push("Zerodha Console lists pledged and discrepant shares apart from available ones; they are still yours, so each holding adds them up.");
  if (cols.cost < 0) notes.push("No average-cost column was found, so profit and loss will show only after you add costs.");
  return lots;
}

/** One free-text line: "INFY.NS 10 1450", "INFY 10", "TCS, 4, 3200", "INFY 10 @ ₹1,450". */
function parseTextLine(raw: string, line: number, exchange: Exchange, notes: string[]): LineResult {
  const t = raw.replace(/\s+(#|\/\/).*$/, "").trim();
  if (!t || /^(#|\/\/)/.test(t)) return null;
  let parts: string[];
  if (/[\t;|]/.test(t)) parts = t.split(/[\t;|]+/);
  else {
    const ws = t.split(/\s+/);
    parts = ws.length >= 2 && !ws[0].endsWith(",") ? ws : t.split(/,\s*|\s+/);
  }
  // filler words between the values ("INFY x 10 @ 1450"); the first token is always the symbol (X is a ticker)
  parts = parts.map((p) => p.trim().replace(/,$/, "")).filter((p, i) => p && !(i > 0 && /^(@|x|×|at|qty|shares?)$/i.test(p)));
  if (parts.length && /^(symbol|ticker|stock|instrument|scrip)$/i.test(parts[0])) return { reason: "Header line" };
  // "10 INFY", and "10 500325" (a quantity, then a six-digit BSE code)
  if (parts.length >= 2 && parseNumber(parts[0]) !== null && (parseNumber(parts[1]) === null || (/^[589]\d{5}$/.test(parts[1]) && !/^[589]\d{5}$/.test(parts[0])))) [parts[0], parts[1]] = [parts[1], parts[0]];
  if (parts.length < 2) return { reason: "Expected a symbol and a quantity, like INFY 10" };
  if (parts.length > 3) return { reason: "More than three values: write SYMBOL QUANTITY COST, with no commas inside numbers" };
  return lotFrom(parts[0], parts[1], parts[2], exchange, false, notes, line);
}

/**
 * Merge lots of the same symbol: quantities add up and the average cost is weighted by quantity.
 * When only some lots carry a cost, the merged holding has none rather than a misleading one.
 */
export function mergeLots(lots: Lot[]): { lots: Lot[]; notes: string[] } {
  const by = new Map<string, Lot[]>();
  for (const l of lots) by.set(l.symbol, [...(by.get(l.symbol) ?? []), l]);
  const notes: string[] = [];
  const out = [...by.entries()].map(([symbol, ls]) => {
    const qty = sum(ls.map((l) => l.qty));
    const merged: Lot = { symbol, qty };
    if (ls.every((l) => fin(l.avgCost))) merged.avgCost = sum(ls.map((l) => l.qty * (l.avgCost as number))) / qty;
    else if (ls.some((l) => fin(l.avgCost))) notes.push(`${symbol}: some lots had no cost, so the combined holding has no average cost. Add it by editing the holding.`);
    if (ls.length > 1) notes.push(`${symbol}: ${ls.length} lines combined into one holding of ${num(qty, Number.isInteger(qty) ? 0 : 4)} shares.`);
    return merged;
  });
  return { lots: out, notes };
}

/**
 * Read holdings from pasted text or a file: a Zerodha Kite or Console holdings export, any CSV with
 * symbol and quantity columns (comma, semicolon or tab separated), or free-text lines. Duplicates
 * are merged and at most MAX_HOLDINGS are kept; every line not used is reported with a reason.
 */
export function parseHoldings(input: string, exchange: Exchange = "NS"): ImportResult {
  const text = input.replace(/^﻿/, "").replace(/​/g, "");
  const skipped: SkippedLine[] = [], notes: string[] = [];
  const delim = detectDelimiter(text);
  const rows = splitDelimited(text, delim);
  let format: ImportFormat = "text", lots: Lot[] = [];
  const at = rows.slice(0, 30).findIndex((r) => locateColumns(r.cells));
  if (at >= 0) {
    const cols = locateColumns(rows[at].cells)!;
    format = cols.format;
    lots = parseTable(rows, at, cols, exchange, delim, skipped, notes);
  } else {
    text.split(/\r?\n/).forEach((l, i) => {
      const r = parseTextLine(l, i + 1, exchange, notes);
      if (!r) return;
      if ("lot" in r) lots.push(r.lot); else skipped.push({ line: i + 1, text: l.trim().slice(0, 80), reason: r.reason });
    });
  }
  const m = mergeLots(lots);
  notes.push(...m.notes);
  const kept = m.lots.slice(0, MAX_HOLDINGS);
  m.lots.slice(MAX_HOLDINGS).forEach((l) => skipped.push({ line: 0, text: l.symbol, reason: `Over the ${MAX_HOLDINGS}-holding limit` }));
  return { format, lots: kept, skipped, notes };
}

export const FORMAT_LABEL: Record<ImportFormat, string> = {
  "zerodha-kite": "Zerodha Kite holdings file",
  "zerodha-console": "Zerodha Console holdings report",
  csv: "CSV with a header row",
  text: "lines of text",
};

export type MergeMode = "add" | "update" | "replace";

/**
 * Put imported lots into the stored holdings. "add" adds quantities to holdings of the same symbol
 * (re-weighting the cost, as mergeLots does); "update" sets them to the file's quantity and cost, which
 * is what a fresh broker snapshot means, and keeps holdings the file doesn't mention; "replace" starts
 * over. Returns the holdings to store, the symbols over the cap, and the symbols already held.
 */
export function mergeHoldings(existing: Holding[], incoming: Lot[], now: string, mode: MergeMode = "add"): { holdings: Holding[]; dropped: string[]; combined: string[] } {
  const out = mode === "replace" ? [] : existing.map((h) => ({ ...h }));
  const dropped: string[] = [], combined: string[] = [];
  for (const l of incoming) {
    const h = out.find((x) => x.symbol === l.symbol);
    if (h && mode === "update") {
      h.qty = l.qty;
      if (fin(l.avgCost)) h.avgCost = l.avgCost;
      combined.push(l.symbol);
    } else if (h) {
      const qty = h.qty + l.qty;
      h.avgCost = fin(h.avgCost) && fin(l.avgCost) ? (h.qty * h.avgCost + l.qty * l.avgCost) / qty : undefined;
      if (h.avgCost === undefined) delete h.avgCost;
      h.qty = qty;
      combined.push(l.symbol);
    } else if (out.length >= MAX_HOLDINGS) dropped.push(l.symbol);
    else out.push({ ...l, added: now });
  }
  return { holdings: out, dropped, combined };
}

/** Holdings read back from storage, keeping only well-formed entries. */
export function cleanHoldings(raw: unknown): Holding[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Holding[] = [];
  for (const x of raw as Partial<Holding>[]) {
    if (!x || typeof x.symbol !== "string" || !/^[A-Z0-9^.\-=&]{1,24}$/.test(x.symbol) || !fin(x.qty) || x.qty <= 0 || seen.has(x.symbol)) continue;
    seen.add(x.symbol);
    out.push({ symbol: x.symbol, qty: x.qty, ...(fin(x.avgCost) && x.avgCost > 0 ? { avgCost: x.avgCost } : {}), added: typeof x.added === "string" ? x.added : "" });
    if (out.length >= MAX_HOLDINGS) break;
  }
  return out;
}

/** Five large NSE companies with made-up quantities and no costs; prices are fetched live. */
export const SAMPLE_PORTFOLIO: Lot[] = [
  { symbol: "INFY.NS", qty: 10 }, { symbol: "HDFCBANK.NS", qty: 15 }, { symbol: "RELIANCE.NS", qty: 8 }, { symbol: "TCS.NS", qty: 4 }, { symbol: "ITC.NS", qty: 50 },
];
export const isSample = (h: Holding[]) => h.length === SAMPLE_PORTFOLIO.length && SAMPLE_PORTFOLIO.every((s) => h.some((x) => x.symbol === s.symbol && x.qty === s.qty && x.avgCost === undefined));

/* ------------------------------------------------------------------ fetching */

export type RowResult = { ok: true; row: ScanRow; via?: string } | { ok: false; error: string; code: string };
type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
const defaultFetch: Fetcher = (u) => fetch(u);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const RETRY_STATUS = new Set([502, 503, 504]);

/** GET a JSON body, retrying once after a pause on a gateway error or a network failure. */
async function getJson(url: string, fetcher: Fetcher, wait: (ms: number) => Promise<void>): Promise<{ status: number; body: Record<string, unknown> | null }> {
  for (let attempt = 0; ; attempt++) {
    let status = 0, body: Record<string, unknown> | null = null;
    try {
      const res = await fetcher(url);
      status = res.status;
      body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    } catch { status = 0; }
    if (attempt === 0 && (status === 0 || RETRY_STATUS.has(status))) { await wait(900); continue; }
    return { status, body };
  }
}

const ERROR_TEXT: Record<string, string> = {
  not_found: "Yahoo Finance has no data for this symbol",
  unsupported: "This kind of security can't be valued by the model",
  network: "Could not reach the server",
  upstream: "Market data is unavailable right now",
};

/**
 * One stock's quick valuation from GET /api/scan/row. A bare NSE symbol that Yahoo does not know is
 * tried once on BSE (.BO), since some companies list only there; the result says which was used.
 */
export async function fetchScanRow(symbol: string, fetcher: Fetcher = defaultFetch, wait = sleep): Promise<RowResult> {
  const get = async (s: string): Promise<RowResult> => {
    const { status, body } = await getJson(`/api/scan/row?symbol=${encodeURIComponent(s)}`, fetcher, wait);
    const row = body?.row as ScanRow | undefined;
    if (status === 200 && row && typeof row.price === "number") return { ok: true, row };
    const code = typeof body?.code === "string" ? body.code : status === 0 ? "network" : status === 404 ? "not_found" : status >= 500 ? "upstream" : "unsupported";
    return { ok: false, code, error: typeof body?.error === "string" ? body.error : ERROR_TEXT[code] ?? `Request failed (${status})` };
  };
  const r = await get(symbol);
  if (!r.ok && r.code === "not_found" && symbol.endsWith(".NS")) {
    const alt = symbol.replace(/\.NS$/, ".BO");
    const b = await get(alt);
    if (b.ok) return { ...b, via: alt };
  }
  return r;
}

/** Units of `to` per unit of `from` from GET /api/fx, or null when no rate is available. */
export async function fetchFx(from: string, to: string, fetcher: Fetcher = defaultFetch, wait = sleep): Promise<number | null> {
  if (from === to) return 1;
  const { status, body } = await getJson(`/api/fx?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, fetcher, wait);
  const rate = body?.rate;
  return status === 200 && fin(rate) && rate > 0 ? rate : null;
}

/** Run fn over items with at most `limit` calls in flight, keeping the input order. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/* ------------------------------------------------------------------ currencies */

/** The currency a symbol probably trades in before its data arrives (only used to pick a default). */
export function currencyGuess(symbol: string): string | null {
  return /\.(NS|BO)$/.test(symbol) ? "INR" : /^[A-Z]{1,5}(-[A-Z])?$/.test(symbol) ? "USD" : null;
}
/** Rupees when any holding is Indian, otherwise dollars. */
export function defaultBase(currencies: string[]): string {
  return currencies.includes("INR") ? "INR" : "USD";
}
/** Currencies offered as the base: the ones held, then the usual majors. */
export function baseOptions(currencies: string[]): string[] {
  return [...new Set([...currencies, "INR", "USD", "EUR", "GBP", "JPY"])];
}

/* ------------------------------------------------------------------ the X-ray */

export const LIMITS = {
  position: 0.2, // a single holding above 20% of value
  sector: 0.35, // a sector above 35% of value
  expectations: 5, // implied growth more than 5 percentage points above reported growth
  costRatio: 5, // price more than 5x, or under a fifth of, the average cost
} as const;
/** The desk's default call thresholds: model value more than 15% above price is BUY, more than 10% below SELL. */
export const CALL_BUY = 0.15, CALL_SELL = -0.1;

export interface PositionInput { holding: Holding; row: ScanRow | null; fx: number | null } // fx: base units per unit of row.currency

export interface PositionView {
  symbol: string; // as stored
  link: string; // the symbol actually valued (may be the BSE listing)
  name: string;
  qty: number;
  avgCost: number | null; // own currency
  currency: string | null;
  price: number | null; // own currency
  fx: number | null;
  value: number | null; // base currency
  cost: number | null; // base currency, at today's exchange rate
  pnl: number | null;
  pnlPct: number | null;
  weight: number | null; // fraction of the valued total
  modelValue: number | null; // DCF value per share, own currency
  gap: number | null; // modelValue / price - 1
  expectedReturn: number | null;
  wacc: number | null;
  expGap: number | null; // percentage points: implied growth minus reported growth
  impliedGrowth: number | null;
  histGrowth: number | null;
  healthScore: number | null;
  grade: HealthGrade;
  flags: string[];
  financial: boolean;
  extreme: boolean; // DCF value above 3x or below a third of the price: shown, but left out of the averages and calls
  sector: string;
  country: string;
}

export interface Weighted { value: number | null; coverage: number; n: number } // coverage: fraction of valued total
export interface MixRow { key: string; value: number; weight: number; count: number }
export type ObservationKind = "position" | "sector" | "health" | "expectations" | "cost" | "check";
export interface Observation { kind: ObservationKind; key: string; symbol?: string; title: string; detail: string; weight: number }

export interface Xray {
  base: string;
  positions: PositionView[];
  count: number;
  valued: number;
  total: number;
  cost: { total: number; value: number; pnl: number | null; pnlPct: number | null; n: number; coverage: number };
  gap: Weighted;
  expectedReturn: Weighted;
  wacc: Weighted;
  expGap: Weighted;
  health: Weighted;
  weakHealth: number; // fraction of valued total in D or E grades
  concentration: { top: PositionView | null; top5: number | null; hhi: number | null; effectiveN: number | null };
  mix: { sector: MixRow[]; country: MixRow[]; currency: MixRow[] };
  financials: string[]; // symbols left out of the DCF-based averages
  observations: Observation[];
}

/** Value-weighted mean of v over the items where it exists, with the share of weight it covers. */
export function weightedMean(items: { w: number; v: number | null | undefined }[]): Weighted {
  const all = sum(items.map((i) => i.w));
  const have = items.filter((i): i is { w: number; v: number } => fin(i.v) && i.w > 0);
  const covered = sum(have.map((i) => i.w));
  return { value: covered > 0 ? sum(have.map((i) => i.w * i.v)) / covered : null, coverage: all > 0 ? covered / all : 0, n: have.length };
}

/** Herfindahl index (sum of squared weights) and its inverse, the effective number of holdings. */
export function concentrationOf(weights: number[]): { hhi: number | null; effectiveN: number | null } {
  const w = weights.filter((x) => x > 0);
  if (!w.length) return { hhi: null, effectiveN: null };
  const hhi = sum(w.map((x) => x * x));
  return { hhi, effectiveN: 1 / hhi };
}

/** Share of value by a label (sector, country, currency), largest first. */
export function mixBy(positions: PositionView[], key: (p: PositionView) => string): MixRow[] {
  const m = new Map<string, MixRow>();
  const total = sum(positions.map((p) => p.value ?? 0));
  for (const p of positions) {
    if (!fin(p.value) || p.value <= 0) continue;
    const k = key(p) || "Not reported";
    const r = m.get(k) ?? { key: k, value: 0, weight: 0, count: 0 };
    r.value += p.value; r.count++;
    m.set(k, r);
  }
  return [...m.values()].map((r) => ({ ...r, weight: total > 0 ? r.value / total : 0 })).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

function view(p: PositionInput): PositionView {
  const { holding: h, row: r } = p;
  const price = r && fin(r.price) && r.price > 0 ? r.price : null;
  const fx = r && fin(p.fx) && p.fx > 0 ? p.fx : null;
  const value = price !== null && fx !== null ? h.qty * price * fx : null;
  const avgCost = fin(h.avgCost) && h.avgCost > 0 ? h.avgCost : null;
  const cost = value !== null && avgCost !== null ? h.qty * avgCost * (fx as number) : null;
  const dcf = r && !r.financial && fin(r.dcfValue) && r.dcfValue > 0 ? r.dcfValue : null;
  const dcfBased = r && !r.financial;
  const ig = r && fin(r.impliedGrowth) ? r.impliedGrowth : null, hg = r && fin(r.histGrowth) ? r.histGrowth : null;
  return {
    symbol: h.symbol, link: r?.symbol || h.symbol, name: r?.name || h.symbol, qty: h.qty, avgCost, currency: r?.currency ?? null,
    price, fx, value, cost, pnl: cost !== null ? (value as number) - cost : null, pnlPct: cost !== null && cost > 0 ? (value as number) / cost - 1 : null, weight: null,
    modelValue: dcf, gap: dcf !== null && price !== null ? dcf / price - 1 : null,
    expectedReturn: dcfBased && fin(r.expectedReturn) ? r.expectedReturn : null, wacc: dcfBased && fin(r.wacc) ? r.wacc : null,
    impliedGrowth: dcfBased ? ig : null, histGrowth: hg, expGap: dcfBased && ig !== null && hg !== null ? ig - hg : null,
    healthScore: r && fin(r.health?.score) ? r.health.score : null, grade: r?.health?.grade ?? "–", flags: r?.health?.flags ?? [],
    financial: !!r?.financial, extreme: price !== null && isExtreme(dcf, price), sector: r?.sector ?? "", country: r?.country ?? "",
  };
}

/** Everything the X-ray page shows, from holdings joined to their rows and exchange rates. */
export function xray(inputs: PositionInput[], base: string): Xray {
  const positions = inputs.map(view);
  const valued = positions.filter((p) => fin(p.value) && p.value > 0);
  const total = sum(valued.map((p) => p.value as number));
  for (const p of valued) p.weight = (p.value as number) / total;
  const wOf = (p: PositionView) => p.weight ?? 0;
  const withCost = valued.filter((p) => p.cost !== null);
  const costTotal = sum(withCost.map((p) => p.cost as number)), costValue = sum(withCost.map((p) => p.value as number));
  const byWeight = [...valued].sort((a, b) => wOf(b) - wOf(a));
  const conc = concentrationOf(valued.map(wOf));
  const x: Xray = {
    base, positions, count: positions.length, valued: valued.length, total,
    cost: { total: costTotal, value: costValue, pnl: withCost.length ? costValue - costTotal : null, pnlPct: costTotal > 0 ? costValue / costTotal - 1 : null, n: withCost.length, coverage: total > 0 ? costValue / total : 0 },
    // values the scanner would mark "check first" stay out of the averages (coverage says what is left)
    gap: weightedMean(valued.map((p) => ({ w: wOf(p), v: p.extreme ? null : p.gap }))),
    expectedReturn: weightedMean(valued.map((p) => ({ w: wOf(p), v: p.extreme ? null : p.expectedReturn }))),
    wacc: weightedMean(valued.map((p) => ({ w: wOf(p), v: p.extreme ? null : p.wacc }))),
    expGap: weightedMean(valued.map((p) => ({ w: wOf(p), v: p.extreme ? null : p.expGap }))),
    health: weightedMean(valued.map((p) => ({ w: wOf(p), v: p.healthScore }))),
    weakHealth: sum(valued.filter((p) => p.grade === "D" || p.grade === "E").map(wOf)),
    concentration: { top: byWeight[0] ?? null, top5: valued.length ? sum(byWeight.slice(0, 5).map(wOf)) : null, ...conc },
    mix: { sector: mixBy(valued, (p) => p.sector), country: mixBy(valued, (p) => p.country), currency: mixBy(valued, (p) => p.currency ?? "") },
    financials: valued.filter((p) => p.financial).map((p) => p.symbol),
    observations: [],
  };
  x.observations = observe(x, byWeight);
  return x;
}

/** The "look closer" list: observations with the numbers behind them, never recommendations. */
function observe(x: Xray, byWeight: PositionView[]): Observation[] {
  const out: Observation[] = [];
  for (const p of byWeight) {
    const w = p.weight ?? 0;
    if (w > LIMITS.position) out.push({
      kind: "position", key: `pos:${p.symbol}`, symbol: p.link, weight: w,
      title: `${p.name} is ${pct(w, 0)} of the portfolio`,
      detail: `Above ${pct(LIMITS.position, 0)} in one company, its results move the whole portfolio: a 30% fall in this stock alone would cut the total by about ${pct(w * 0.3, 1)}.`,
    });
  }
  for (const s of x.mix.sector) if (s.weight > LIMITS.sector && s.key !== "Not reported") out.push({
    kind: "sector", key: `sec:${s.key}`, weight: s.weight,
    title: `${s.key} is ${pct(s.weight, 0)} of the portfolio`,
    detail: `${s.count} holding${s.count > 1 ? "s" : ""} in one sector. Companies in the same sector tend to rise and fall together when their industry has a good or bad year, so they diversify each other less than their number suggests.`,
  });
  for (const p of byWeight) {
    const w = p.weight ?? 0;
    if (p.grade === "D" || p.grade === "E") out.push({
      kind: "health", key: `hl:${p.symbol}`, symbol: p.link, weight: w,
      title: `${p.name}: business-health grade ${p.grade}${fin(p.healthScore) ? ` (${Math.round(p.healthScore)}/100)` : ""}`,
      detail: (p.flags.length ? `The health check flagged: ${p.flags.slice(0, 2).map((f) => f.replace(/[.\s]+$/, "")).join("; ")}. ` : "") + "A low grade means the reported numbers show weak profitability, a stretched balance sheet or accounts worth reading closely.",
    });
  }
  for (const p of byWeight) {
    if (p.extreme && p.modelValue !== null && p.price !== null) out.push({
      kind: "check", key: `ck:${p.symbol}`, symbol: p.link, weight: p.weight ?? 0,
      title: `Check the data for ${p.name}`,
      detail: `Its DCF value on default inputs (${money(p.modelValue, p.currency ?? x.base)}) is ${p.modelValue > p.price ? `${num(p.modelValue / p.price, 1)} times` : `${pct(p.modelValue / p.price, 0)} of`} the price. A gap that large usually means odd data or default inputs that don't fit the company, so it is left out of the portfolio's averages.`,
    });
  }
  for (const p of byWeight) {
    if (!p.extreme && fin(p.expGap) && p.expGap > LIMITS.expectations && fin(p.impliedGrowth) && fin(p.histGrowth)) out.push({
      kind: "expectations", key: `ex:${p.symbol}`, symbol: p.link, weight: p.weight ?? 0,
      title: `${p.name} is priced for more growth than it has delivered`,
      detail: `To be worth today's price on the model's other default assumptions, revenue would need to grow about ${num(p.impliedGrowth, 1)}% a year for five years. Over its reported years it grew ${num(p.histGrowth, 1)}% a year, ${num(p.expGap, 1)} points less.`,
    });
  }
  for (const p of byWeight) {
    if (p.avgCost === null || p.price === null) continue;
    const ratio = p.price / p.avgCost;
    if (ratio > LIMITS.costRatio || ratio < 1 / LIMITS.costRatio) out.push({
      kind: "cost", key: `cost:${p.symbol}`, symbol: p.link, weight: p.weight ?? 0,
      title: `Check the average cost of ${p.name}`,
      detail: `The price (${money(p.price, p.currency ?? x.base)}) is ${ratio > 1 ? `${num(ratio, 1)} times` : `${pct(ratio, 0)} of`} your average cost (${money(p.avgCost, p.currency ?? x.base)}). That can be real, but it is also what a split or bonus issue looks like when the cost was not adjusted, or a cost entered in pence instead of pounds.`,
    });
  }
  return out;
}

/** Modelled call from the DCF gap with the desk's default thresholds; shown only when calls are on. */
export function modelCall(gap: number | null, extreme = false): "BUY" | "HOLD" | "SELL" | "CHECK" | "–" {
  return extreme ? "CHECK" : !fin(gap) ? "–" : gap > CALL_BUY ? "BUY" : gap < CALL_SELL ? "SELL" : "HOLD";
}

/** A short plain-English reading of the X-ray, for beginners and for clients. */
export function summarise(x: Xray): string[] {
  if (!x.valued) return [];
  const out: string[] = [];
  const cur = x.base;
  const n = (k: number) => `${k} holding${k === 1 ? "" : "s"}`;
  out.push(x.valued === x.count ? `Your ${n(x.count)} ${x.count === 1 ? "is" : "are"} worth ${money(x.total, cur, 0)} at today's prices.` : `The ${x.valued} of ${n(x.count)} valued so far are worth ${money(x.total, cur, 0)} at today's prices.`);
  if (x.cost.pnl !== null) out.push(`Against what you paid for the ${x.cost.n} holding${x.cost.n > 1 ? "s" : ""} with a cost, that is ${x.cost.pnl >= 0 ? "a gain" : "a loss"} of ${money(Math.abs(x.cost.pnl), cur, 0)} (${pct(x.cost.pnlPct, 1, true)}).`);
  const c = x.concentration;
  if (c.top && fin(c.effectiveN)) out.push(`The largest holding, ${c.top.name}, is ${pct(c.top.weight, 0)} of the total${x.valued > 5 ? ` and the top five are ${pct(c.top5, 0)}` : ""}; for spreading risk the portfolio behaves like ${num(c.effectiveN, 1)} equal-sized holdings.`);
  if (fin(x.gap.value)) out.push(`On the model's default assumptions, the holdings it can value with a DCF (${pct(x.gap.coverage, 0)} of the total) are worth ${Math.abs(x.gap.value) < 0.005 ? "about the same as" : `${pct(Math.abs(x.gap.value), 0)} ${x.gap.value >= 0 ? "more" : "less"} than`} their market price.`);
  if (fin(x.expectedReturn.value)) out.push(`If the model's base case comes true, buying them at today's prices would earn about ${pct(x.expectedReturn.value, 1)} a year${fin(x.wacc.value) ? `, against the ${pct(x.wacc.value, 1)} a year their risk calls for` : ""}.`);
  if (fin(x.expGap.value)) out.push(`Today's prices assume revenue growth ${num(Math.abs(x.expGap.value), 1)} points a year ${x.expGap.value >= 0 ? "faster" : "slower"} than these companies have delivered.`);
  if (fin(x.health.value)) out.push(`The value-weighted business-health score is ${Math.round(x.health.value)} out of 100${x.weakHealth > 0 ? `, with ${pct(x.weakHealth, 0)} of the value in companies graded D or E` : ""}.`);
  out.push("These are model outputs on default inputs, for learning, not advice.");
  return out;
}

/* ------------------------------------------------------------------ export */

const csvCell = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) return "";
  const s = typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Holdings and their X-ray numbers as CSV; the symbol, qty and avg_cost columns import back in. */
export function exportCsv(x: Xray): string {
  const head = ["symbol", "name", "qty", "avg_cost", "currency", "price", `value_${x.base}`, "weight", `unrealised_pnl_${x.base}`, "dcf_value", "model_gap", "expected_return", "implied_growth_pct", "hist_growth_pct", "health_score", "health_grade", "sector", "country"];
  const lines = x.positions.map((p) => [p.symbol, p.name, p.qty, p.avgCost, p.currency, p.price, p.value, p.weight, p.pnl, p.modelValue, p.gap, p.expectedReturn, p.impliedGrowth, p.histGrowth, p.healthScore, p.grade === "–" ? "" : p.grade, p.sector, p.country].map(csvCell).join(","));
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
