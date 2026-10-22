// Cross-stock maths for the opportunity scanner, run in the browser on the rows fetched so far:
// peer values from the other stocks in the scanned list, the blended model value, gaps, views,
// filters, summary statistics and CSV export. Pure functions.
import { median } from "./model";
import type { HealthGrade, ScanRow } from "./scanTypes";

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const inRange = (x: number | null | undefined, lo: number, hi: number): x is number => fin(x) && x > lo && x < hi;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

/** Most stocks one scan may hold: the largest registry universe, and a sane load on Yahoo. */
export const MAX_SCAN = 150;
/** Fewest comparable stocks a peer median is built from. */
export const MIN_PEERS = 3;
/** Same thresholds as the desk's default calls: upside above +15% is BUY, below -10% SELL. */
export const BUY_ABOVE = 0.15, SELL_BELOW = -0.1;

export type PeerBasis = "industry" | "sector" | "list" | "none";
export type Method = "dcf+peers" | "dcf" | "peers" | "none";
export type Call = "BUY" | "HOLD" | "SELL";

export interface PeerMedians { evEbitda: number | null; pe: number | null; pb: number | null }

/** A scan row with the values that depend on the other stocks in the list. */
export interface Scored extends ScanRow {
  group: string; // display group: the index's own industry label, else Yahoo's sector
  peers: PeerMedians & { basis: PeerBasis; n: number };
  compsValue: number | null; // per share, from the peer medians
  modelValue: number | null; // per share: 50/50 DCF and peers when both exist
  method: Method;
  valueGap: number | null; // fraction: model value / price - 1
  expectationsGap: number | null; // percentage points: growth the price implies minus reported growth
  extreme: boolean; // model value above 3x or below a third of the price: check data and assumptions first
}

/** A model value this far from the price usually means odd data or default inputs that don't fit the company. */
export const EXTREME_RATIO = 3;
const isExtreme = (value: number | null, price: number) => value !== null && price > 0 && (value / price > EXTREME_RATIO || value / price < 1 / EXTREME_RATIO);

/** Multiples a row can lend to a peer median, with the desk's validity filters (model.ts). */
export function usableMultiples(r: ScanRow): PeerMedians {
  return {
    evEbitda: !r.financial && inRange(r.evEbitda, 0, 200) ? r.evEbitda : null, // meaningless for lenders
    pe: inRange(r.pe, 0, 500) ? r.pe : null,
    pb: inRange(r.pb, 0, 100) ? r.pb : null,
  };
}

/** Whether a row has any multiple that a subject of this kind is valued on. */
function lendsTo(o: ScanRow, financial: boolean): boolean {
  const m = usableMultiples(o);
  return financial ? m.pe !== null || m.pb !== null : m.evEbitda !== null || m.pe !== null;
}

/**
 * Leave-one-out peers for row i: the other rows of the same kind (banks and insurers only with each
 * other) in the same Yahoo industry when at least MIN_PEERS of them have usable multiples, else the
 * same sector, else the whole list, else none.
 */
export function peerGroup(rows: ScanRow[], i: number): { basis: PeerBasis; peers: ScanRow[] } {
  const r = rows[i];
  const others = rows.filter((o, j) => j !== i && o.symbol !== r.symbol && o.financial === r.financial && lendsTo(o, r.financial));
  const industry = r.industry ? others.filter((o) => o.industry === r.industry) : [];
  if (industry.length >= MIN_PEERS) return { basis: "industry", peers: industry };
  const sector = r.sector ? others.filter((o) => o.sector === r.sector) : [];
  if (sector.length >= MIN_PEERS) return { basis: "sector", peers: sector };
  if (others.length >= MIN_PEERS) return { basis: "list", peers: others };
  return { basis: "none", peers: [] };
}

export function peerMedians(peers: ScanRow[]): PeerMedians {
  const pick = (k: keyof PeerMedians) => peers.map((p) => usableMultiples(p)[k]).filter(fin);
  const med = (a: number[]) => (a.length ? median(a) : null);
  return { evEbitda: med(pick("evEbitda")), pe: med(pick("pe")), pb: med(pick("pb")) };
}

/**
 * Peer value per share, as on the desk: the average of the median EV/EBITDA price
 * ((median x EBITDA + net cash) / shares) and the median P/E price; banks and insurers use the
 * median P/E and P/B prices. A part counts only when its inputs are positive.
 */
export function compsValueFor(r: ScanRow, m: PeerMedians): number | null {
  const parts: number[] = [];
  const bv = r.bookValuePerShare;
  if (r.financial) {
    if (m.pe !== null && r.eps > 0) parts.push(m.pe * r.eps);
    if (m.pb !== null && fin(bv) && bv > 0) parts.push(m.pb * bv);
  } else {
    if (m.evEbitda !== null && r.ebitda > 0 && r.shares > 0) parts.push((m.evEbitda * r.ebitda + r.netCash) / r.shares);
    if (m.pe !== null && r.eps > 0) parts.push(m.pe * r.eps);
  }
  const v = parts.length ? mean(parts) : NaN;
  return fin(v) ? v : null;
}

/** 50/50 DCF and peer value when both are positive, otherwise whichever is. */
export function blend(dcf: number | null, comps: number | null): { value: number | null; method: Method } {
  const d = fin(dcf) && dcf > 0, c = fin(comps) && comps > 0;
  if (d && c) return { value: (dcf + comps) / 2, method: "dcf+peers" };
  if (d) return { value: dcf, method: "dcf" };
  if (c) return { value: comps, method: "peers" };
  return { value: null, method: "none" };
}

/** Score every row against the others in the list. `groupOf` gives the index's own label for a symbol. */
export function scoreRows(rows: ScanRow[], groupOf?: (symbol: string) => string | undefined): Scored[] {
  return rows.map((r, i) => {
    const { basis, peers } = peerGroup(rows, i);
    const med = peerMedians(peers);
    const compsValue = basis === "none" ? null : compsValueFor(r, med);
    const { value, method } = blend(r.dcfValue, compsValue);
    const gap = value !== null && r.price > 0 ? value / r.price - 1 : NaN;
    const eg = fin(r.impliedGrowth) && fin(r.histGrowth) ? r.impliedGrowth - r.histGrowth : NaN;
    return {
      ...r,
      group: groupOf?.(r.symbol) || r.sector || "Other",
      peers: { ...med, basis, n: peers.length },
      compsValue, modelValue: value, method,
      valueGap: fin(gap) ? gap : null,
      expectationsGap: fin(eg) ? eg : null,
      extreme: isExtreme(value, r.price),
    };
  });
}

export function callFor(gap: number | null): Call | null {
  if (!fin(gap)) return null;
  return gap > BUY_ABOVE ? "BUY" : gap < SELL_BELOW ? "SELL" : "HOLD";
}

// ---- health grades ----

export const GRADES: Exclude<HealthGrade, "–">[] = ["A", "B", "C", "D", "E"];
/** A = 5 ... E = 1; null when the health check could not grade the stock. */
export function gradeRank(g: HealthGrade): number | null {
  const i = GRADES.indexOf(g as Exclude<HealthGrade, "–">);
  return i < 0 ? null : 5 - i;
}
export function meetsGrade(g: HealthGrade, min: HealthGrade | "any"): boolean {
  if (min === "any") return true;
  const a = gradeRank(g), b = gradeRank(min);
  return a !== null && b !== null && a >= b;
}

// ---- sorting, views and filters ----

export type SortKey = "name" | "group" | "price" | "modelValue" | "valueGap" | "expectedReturn" | "expectationsGap" | "pe" | "health" | "flags";
export interface Sort { key: SortKey; dir: 1 | -1 }

export function sortValue(r: Scored, k: SortKey): string | number | null {
  switch (k) {
    case "name": return r.name;
    case "group": return r.group;
    case "health": { const g = gradeRank(r.health.grade); return g === null ? null : g * 1000 + (r.health.score ?? 0); }
    case "flags": return r.health.grade === "–" ? null : r.health.flags.length;
    default: { const v = r[k]; return fin(v) ? v : null; }
  }
}

/** Stable sort; missing values always go last, whichever the direction. Ties break by name. */
export function sortRows(rows: Scored[], s: Sort): Scored[] {
  return rows
    .map((r) => ({ r, v: sortValue(r, s.key) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === b.v ? a.r.name.localeCompare(b.r.name) : a.v === null ? 1 : -1;
      const c = typeof a.v === "string" || typeof b.v === "string" ? String(a.v).localeCompare(String(b.v)) : a.v - b.v;
      return c * s.dir || a.r.name.localeCompare(b.r.name);
    })
    .map((x) => x.r);
}

export type ViewKey = "gap" | "return" | "expectations" | "health";
export const VIEWS: { key: ViewKey; label: string; sort: Sort; hint: string }[] = [
  { key: "gap", label: "Biggest value gap", sort: { key: "valueGap", dir: -1 }, hint: "Model value furthest above today's price first." },
  { key: "return", label: "Best expected return", sort: { key: "expectedReturn", dir: -1 }, hint: "Highest yearly return at today's price if the base case comes true." },
  { key: "expectations", label: "Lowest expectations", sort: { key: "expectationsGap", dir: 1 }, hint: "Prices that assume the least growth compared with the company's own record." },
  { key: "health", label: "Healthiest", sort: { key: "health", dir: -1 }, hint: "Best business-health grade first." },
];
export function viewFor(s: Sort): ViewKey | null {
  return VIEWS.find((v) => v.sort.key === s.key && v.sort.dir === s.dir)?.key ?? null;
}

export interface Filters { group: string; hideFinancials: boolean; minGrade: HealthGrade | "any" }
export const NO_FILTERS: Filters = { group: "", hideFinancials: false, minGrade: "any" };

export function filterRows(rows: Scored[], f: Filters): Scored[] {
  return rows.filter((r) => (!f.group || r.group === f.group) && !(f.hideFinancials && r.financial) && meetsGrade(r.health.grade, f.minGrade));
}

// ---- summary ----

export interface ScanSummary {
  n: number; valued: number; medianGap: number | null; above15: number;
  graded: number; healthAB: number; withReturn: number; medianReturn: number | null; medianWacc: number | null;
  extreme: number; // rows left out of the gap figures
}

export function summarize(rows: Scored[]): ScanSummary {
  const gaps = rows.filter((r) => !r.extreme).map((r) => r.valueGap).filter(fin);
  const rets = rows.map((r) => r.expectedReturn).filter(fin);
  const waccs = rows.filter((r) => fin(r.expectedReturn)).map((r) => r.wacc).filter(fin);
  const ranks = rows.map((r) => gradeRank(r.health.grade)).filter((g): g is number => g !== null);
  const med = (a: number[]) => (a.length ? median(a) : null);
  return {
    n: rows.length, valued: gaps.length, medianGap: med(gaps), above15: gaps.filter((g) => g > BUY_ABOVE).length,
    graded: ranks.length, healthAB: ranks.filter((g) => g >= 4).length,
    withReturn: rets.length, medianReturn: med(rets), medianWacc: med(waccs),
    extreme: rows.filter((r) => r.extreme).length,
  };
}

// ---- tickers typed by the user ----

export type BareSuffix = "NS" | "BO" | "none";
const TICKER = /^[A-Z0-9^.\-=&]{1,24}$/;

/**
 * Tickers from free text (commas, spaces or new lines). "NSE:INFY" and "BSE:INFY" prefixes work;
 * bare tickers get the chosen exchange suffix, and six-digit BSE scrip codes always get .BO.
 */
export function parseTickers(text: string, bare: BareSuffix = "NS"): { symbols: string[]; invalid: string[]; truncated: boolean } {
  const symbols: string[] = [], invalid: string[] = [];
  for (const raw of text.toUpperCase().split(/[\s,;]+/)) {
    if (!raw) continue;
    let t = raw;
    const pre = /^(NSE|BSE):(.+)$/.exec(t);
    if (pre) t = `${pre[2]}.${pre[1] === "NSE" ? "NS" : "BO"}`;
    else if (/^\d{6}$/.test(t)) t += ".BO";
    else if (!t.includes(".") && !t.startsWith("^") && bare !== "none") t += "." + bare;
    if (!TICKER.test(t)) invalid.push(raw);
    else if (!symbols.includes(t)) symbols.push(t);
  }
  return { symbols: symbols.slice(0, MAX_SCAN), invalid, truncated: symbols.length > MAX_SCAN };
}

// ---- CSV ----

const cell = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const r2 = (x: number | null) => (fin(x) ? Math.round(x * 100) / 100 : null);
const p2 = (x: number | null) => (fin(x) ? Math.round(x * 1e4) / 100 : null); // fraction -> percent

/** The rows as CSV, one line per stock, percentages as numbers (12.34 = 12.34%). */
export function toCsv(rows: Scored[], opts: { calls: boolean }): string {
  const head = [
    "Symbol", "Company", "Group", "Sector", "Industry", "Currency", "Price", "DCF value", "Peer value", "Model value", "Method",
    "Value gap (%)", "Expected return a year (%)", "WACC (%)", "Price implies growth (%/yr)", "Reported growth (%/yr)", "Expectations gap (points)",
    "P/E", "EV/EBITDA", "P/B", "Peer basis", "Peers", "Bank or insurer", "Health grade", "Health score", "Health flags",
    ...(opts.calls ? ["Call (model output)"] : []), "As of",
  ];
  const lines = rows.map((r) => [
    r.symbol, r.name, r.group, r.sector, r.industry, r.currency, r2(r.price), r2(r.dcfValue), r2(r.compsValue), r2(r.modelValue), r.method,
    p2(r.valueGap), p2(r.expectedReturn), p2(r.wacc), r2(r.impliedGrowth), r2(r.histGrowth), r2(r.expectationsGap),
    r2(r.pe), r2(r.evEbitda), r2(r.pb), r.peers.basis, r.peers.n, r.financial ? "yes" : "no", r.health.grade, r.health.score, r.health.flags.join("; "),
    ...(opts.calls ? [callFor(r.valueGap)] : []), r.asOf,
  ].map(cell).join(","));
  return [head.map(cell).join(","), ...lines].join("\r\n") + "\r\n";
}
