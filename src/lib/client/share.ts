// Share links: a valuation's inputs packed into the URL hash (#v=...), so the server and the CDN
// never see them. No "use client" on purpose: the validators are also used by /api/excel, and the
// browser-only helpers touch `window` only when called.
import { FORECAST_YEARS } from "../model";
import type { Overrides } from "../overrides";
import type { Drivers, FiscalYear, PeerRow, ScenarioKey, UserInputs } from "../types";
import { SCENARIOS } from "../types";

export type SharedInputs = Omit<UserInputs, "price"> & { price?: number };
export interface SharedState { v: 1; symbol: string; inputs: SharedInputs; overrides: Overrides; extraPeers: PeerRow[] }
/** Body of POST /api/excel. `now` pins the valuation date to the one on screen; `calls` adds the BUY/HOLD/SELL row. */
export interface ExportPayload { symbol: string; inputs: SharedInputs; overrides: Overrides; extraPeers: PeerRow[]; calls?: boolean; now?: number }

/** Longest share code accepted (characters after "#v="). */
export const SHARE_MAX_CHARS = 16 * 1024;
/** Longest JSON a code may expand to: stops a small "deflate bomb" from eating memory. */
const MAX_JSON_BYTES = 64 * 1024;
export const TICKER_RE = /^[A-Z0-9^.\-=&]{1,24}$/;

/** Thrown by encodeShare when a state can't travel as a link. The message is written for the user. */
export class ShareError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const inRange = (x: unknown, lim: number): x is number => fin(x) && Math.abs(x) <= lim;
/** Every required key present and nothing unknown. */
const exactKeys = (o: Obj, req: readonly string[], opt: readonly string[] = []) =>
  req.every((k) => Object.keys(o).includes(k)) && Object.keys(o).every((k) => req.includes(k) || opt.includes(k));

const DRIVER_KEYS = ["growth", "margin", "tax", "da", "capex", "wc"] as const satisfies readonly (keyof Drivers)[];
const RATE_KEYS = ["rf", "spread", "beta", "erp", "kd", "g"] as const satisfies readonly (keyof UserInputs["rate"])[];
const MC_KEYS = ["g", "m", "w", "t", "seed"] as const satisfies readonly (keyof UserInputs["mc"])[];
const INPUT_KEYS = ["scenario", "assume", "rate", "dcfWeight", "buy", "sell", "probs", "usePW", "mc", "peers"] as const;
const PEER_KEYS = ["symbol", "name", "industry", "currency", "marketCap", "evEbitda", "pe", "evSales", "pb", "margin", "growth"] as const satisfies readonly (keyof PeerRow)[];
const PEER_NUMS = ["marketCap", "evEbitda", "pe", "evSales", "pb", "margin", "growth"] as const;
/** Numeric FiscalYear lines a data edit ("h:<year>:<field>") may change. */
const HIST_FIELDS = new Set<string>([
  "revenue", "ebit", "da", "pbt", "tax", "capex", "wcInc", "netIncome", "cfo", "totalAssets", "currentAssets", "currentLiabilities",
  "totalLiabilities", "equity", "retainedEarnings", "longTermDebt", "totalDebt", "cash", "receivables", "grossProfit", "sga", "netPPE",
  "interestExpense", "dilutedShares", "dilutedEPS", "dividendsPaid", "buybacks", "sbc",
] satisfies (keyof FiscalYear)[]);
const OVERRIDE_RE = /^(?:h:\d{1,2}:([A-Za-z]+)|b:(?:cash|borrowings|leases|nci|returned)|t:(?:revenue|ebitda|netIncome|eps)|s:shares)$/;

// Inputs are percents (5 = 5%), so 10,000 is far beyond any sane driver yet rules out absurd payloads.
const LIM = 1e4;

function parseDrivers(x: unknown): Drivers | null {
  if (!isObj(x) || !exactKeys(x, DRIVER_KEYS)) return null;
  const out = {} as Drivers;
  for (const k of DRIVER_KEYS) {
    const a = x[k];
    if (!Array.isArray(a) || a.length !== FORECAST_YEARS || !a.every((v) => inRange(v, LIM))) return null;
    out[k] = [...a];
  }
  return out;
}

function parseNums<K extends string>(x: unknown, keys: readonly K[], lim = LIM): Record<K, number> | null {
  if (!isObj(x) || !exactKeys(x, keys)) return null;
  const out = {} as Record<K, number>;
  for (const k of keys) { const v = x[k]; if (!inRange(v, lim)) return null; out[k] = v; }
  return out;
}

/** Strict check of a valuation's inputs; rebuilds a fresh object so nothing unexpected rides along. */
export function parseInputs(x: unknown): SharedInputs | null {
  if (!isObj(x) || !exactKeys(x, INPUT_KEYS, ["price"])) return null;
  if (typeof x.scenario !== "string" || !SCENARIOS.includes(x.scenario as ScenarioKey)) return null;
  if (!isObj(x.assume) || !exactKeys(x.assume, SCENARIOS)) return null;
  const assume = {} as Record<ScenarioKey, Drivers>;
  for (const k of SCENARIOS) { const d = parseDrivers(x.assume[k]); if (!d) return null; assume[k] = d; }
  const rate = parseNums(x.rate, RATE_KEYS);
  const probs = parseNums(x.probs, SCENARIOS);
  const mc = parseNums(x.mc, MC_KEYS, 1e6);
  if (!rate || !probs || !mc) return null;
  if (!inRange(x.dcfWeight, LIM) || !inRange(x.buy, LIM) || !inRange(x.sell, LIM) || typeof x.usePW !== "boolean") return null;
  if (!isObj(x.peers) || Object.keys(x.peers).length > 100) return null;
  const peers: Record<string, boolean> = {};
  for (const [s, on] of Object.entries(x.peers)) { if (!TICKER_RE.test(s) || typeof on !== "boolean") return null; peers[s] = on; }
  const out: SharedInputs = { scenario: x.scenario as ScenarioKey, assume, rate, dcfWeight: x.dcfWeight, buy: x.buy, sell: x.sell, probs, usePW: x.usePW, mc, peers };
  if (x.price !== undefined) {
    if (!fin(x.price) || x.price <= 0 || x.price > 1e9) return null;
    out.price = x.price;
  }
  return out;
}

export function parseOverrides(x: unknown): Overrides | null {
  if (!isObj(x) || Object.keys(x).length > 300) return null;
  const out: Overrides = {};
  for (const [k, v] of Object.entries(x)) {
    const m = OVERRIDE_RE.exec(k);
    if (!m || (m[1] !== undefined && !HIST_FIELDS.has(m[1])) || !fin(v)) return null;
    out[k] = v;
  }
  return out;
}

const shortText = (x: unknown, max: number): x is string => typeof x === "string" && x.length <= max;

export function parsePeers(x: unknown): PeerRow[] | null {
  if (!Array.isArray(x) || x.length > 30) return null;
  const out: PeerRow[] = [];
  for (const p of x) {
    if (!isObj(p) || !exactKeys(p, PEER_KEYS)) return null;
    if (typeof p.symbol !== "string" || !TICKER_RE.test(p.symbol) || !shortText(p.name, 200) || !shortText(p.industry, 200)) return null;
    if (typeof p.currency !== "string" || !/^[A-Za-z]{2,5}$/.test(p.currency)) return null;
    const row: PeerRow = { symbol: p.symbol, name: p.name, industry: p.industry, currency: p.currency, marketCap: null, evEbitda: null, pe: null, evSales: null, pb: null, margin: null, growth: null };
    for (const k of PEER_NUMS) { const v = p[k]; if (v !== null && !fin(v)) return null; row[k] = v; }
    out.push(row);
  }
  return out;
}

/** Validates a decoded share. Returns null for anything that is not exactly a version-1 state. */
export function parseSharedState(x: unknown): SharedState | null {
  if (!isObj(x) || !exactKeys(x, ["v", "symbol", "inputs", "overrides", "extraPeers"]) || x.v !== 1) return null;
  if (typeof x.symbol !== "string" || !TICKER_RE.test(x.symbol)) return null;
  const inputs = parseInputs(x.inputs), overrides = parseOverrides(x.overrides), extraPeers = parsePeers(x.extraPeers);
  if (!inputs || !overrides || !extraPeers) return null;
  return { v: 1, symbol: x.symbol, inputs, overrides, extraPeers };
}

/** Validates the body of POST /api/excel with the same rules as a share link. */
export function parseExportPayload(x: unknown): ExportPayload | null {
  if (!isObj(x) || !exactKeys(x, ["symbol", "inputs", "overrides", "extraPeers"], ["calls", "now"])) return null;
  const symbol = typeof x.symbol === "string" ? x.symbol.trim().toUpperCase() : "";
  const s = parseSharedState({ v: 1, symbol, inputs: x.inputs, overrides: x.overrides, extraPeers: x.extraPeers });
  if (!s) return null;
  if (x.calls !== undefined && typeof x.calls !== "boolean") return null;
  if (x.now !== undefined && !fin(x.now)) return null;
  const out: ExportPayload = { symbol: s.symbol, inputs: s.inputs, overrides: s.overrides, extraPeers: s.extraPeers };
  if (x.calls !== undefined) out.calls = x.calls;
  if (x.now !== undefined) out.now = x.now;
  return out;
}

// ---------- bytes ----------
function toB64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "===".slice((b.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Runs bytes through a (de)compression stream; null once the output passes `limit` bytes. */
async function pipe(bytes: Uint8Array, ts: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> }, limit: number): Promise<Uint8Array | null> {
  const w = ts.writable.getWriter();
  w.write(bytes as Uint8Array<ArrayBuffer>).catch(() => {});
  w.close().catch(() => {});
  const r = ts.readable.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    n += value.byteLength;
    if (n > limit) { r.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

/** The state with only the known keys, in a stable order, so old saved objects still make valid links. */
function canonical(s: SharedState): SharedState {
  const i = s.inputs;
  const inputs: SharedInputs = {
    scenario: i.scenario,
    assume: Object.fromEntries(SCENARIOS.map((k) => [k, Object.fromEntries(DRIVER_KEYS.map((d) => [d, i.assume[k][d]]))])) as unknown as Record<ScenarioKey, Drivers>,
    rate: Object.fromEntries(RATE_KEYS.map((k) => [k, i.rate[k]])) as UserInputs["rate"],
    dcfWeight: i.dcfWeight, buy: i.buy, sell: i.sell,
    probs: Object.fromEntries(SCENARIOS.map((k) => [k, i.probs[k]])) as UserInputs["probs"],
    usePW: i.usePW,
    mc: Object.fromEntries(MC_KEYS.map((k) => [k, i.mc[k]])) as UserInputs["mc"],
    peers: { ...i.peers },
  };
  if (i.price !== undefined) inputs.price = i.price;
  const extraPeers = s.extraPeers.map((p) => Object.fromEntries(PEER_KEYS.map((k) => [k, p[k] ?? (k === "industry" ? "" : null)])) as unknown as PeerRow);
  return { v: 1, symbol: s.symbol.toUpperCase(), inputs, overrides: { ...s.overrides }, extraPeers };
}

/**
 * Packs a state into a URL-safe code: "z." + base64url(deflate-raw(JSON)), or "j." + base64url(JSON)
 * where CompressionStream is missing. Throws ShareError if the state is invalid or too big for a link.
 */
export async function encodeShare(state: SharedState): Promise<string> {
  let c: SharedState | null = null;
  try { c = canonical(state); } catch { /* malformed state: reported below */ }
  if (!c || !parseSharedState(c)) throw new ShareError("Some inputs are not valid numbers. Fix the fields marked in red, then share again.");
  const json = new TextEncoder().encode(JSON.stringify(c));
  let code: string;
  if (typeof CompressionStream === "function") {
    const z = await pipe(json, new CompressionStream("deflate-raw"), Infinity);
    code = "z." + toB64url(z ?? new Uint8Array());
  } else code = "j." + toB64url(json);
  if (code.length > SHARE_MAX_CHARS || json.byteLength > MAX_JSON_BYTES) throw new ShareError("This valuation has too many data edits or added peers to fit in a link. Undo some edits and try again.");
  return code;
}

/** Unpacks a share code. Returns null for anything malformed, tampered, oversized or unknown; never throws. */
export async function decodeShare(code: unknown): Promise<SharedState | null> {
  try {
    if (typeof code !== "string" || code.length < 3 || code.length > SHARE_MAX_CHARS) return null;
    const bytes = fromB64url(code.slice(2));
    if (!bytes) return null;
    let json: Uint8Array | null = null;
    if (code.startsWith("z.")) {
      if (typeof DecompressionStream !== "function") return null;
      json = await pipe(bytes, new DecompressionStream("deflate-raw"), MAX_JSON_BYTES);
    } else if (code.startsWith("j.")) json = bytes.byteLength <= MAX_JSON_BYTES ? bytes : null;
    if (!json) return null;
    return parseSharedState(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json)));
  } catch {
    return null;
  }
}

/** The link to send: the stock page with the state in the hash, which browsers never send to a server. */
export async function shareUrl(origin: string, state: SharedState): Promise<string> {
  return `${origin.replace(/\/+$/, "")}/stock/${encodeURIComponent(state.symbol.toUpperCase())}#v=${await encodeShare(state)}`;
}

/** Browser only: the shared state in this page's hash, or null if there is none, it is invalid, or it is for another stock. */
export async function readSharedFromHash(symbol: string): Promise<SharedState | null> {
  if (typeof window === "undefined") return null;
  const code = new URLSearchParams(window.location.hash.slice(1)).get("v");
  if (!code) return null;
  const s = await decodeShare(code);
  return s && s.symbol === symbol.trim().toUpperCase() ? s : null;
}

/** Browser only: drops the "#v=..." from the address bar without a navigation or a new history entry. */
export function clearShareHash(): void {
  try {
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, "", pathname + search);
  } catch { /* not in a browser */ }
}
