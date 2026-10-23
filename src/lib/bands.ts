// Valuation history band: the stock's own P/E or P/B month by month over the years Yahoo has
// statements for, so today's multiple can be read against its own past. Pure, for client and server.
import { median, percentile } from "./model";
import type { FiscalYear, StockData } from "./types";

export type BandKind = "pe" | "pb";
/** A monthly close in major currency units, already adjusted by Yahoo for later splits and bonus issues. */
export interface PricePoint { date: string; close: number }
/** A split or bonus issue: ratio = shares after / shares before (2 for a 2:1 split or a 1:1 bonus). */
export interface SplitEvent { date: string; ratio: number }
/** GET /api/history response. */
export interface PriceHistory { symbol: string; currency: string; points: PricePoint[]; splits: SplitEvent[] }

export interface BandPoint {
  date: string;
  close: number;
  fy: string | null; // fiscal year whose figures apply this month
  perShare: number | null; // earnings or book value per share on today's share basis
  multiple: number | null; // null = gap (loss, negative book, absurd multiple)
}
export interface BandStats {
  median: number; mean: number; sd: number; p10: number; p90: number; // NaN when there are no valid months
  current: number | null; // today's multiple from the live price and trailing figures
  currentPercentile: number | null; // 0-1: share of past months below today's multiple (ties count half)
  atMedian: number | null; // price per share if today's figures traded at the median multiple
  n: number; // valid months
  from: string | null; to: string | null; // first and last valid month
}
export interface Band { kind: BandKind; series: BandPoint[]; stats: BandStats; notes: string[] }
export type BandData = Pick<StockData, "history" | "shares" | "ttm" | "bookValuePerShare">;

/** Multiples above these are treated as noise (tiny earnings or book), not valuation. */
export const BAND_MAX: Record<BandKind, number> = { pe: 300, pb: 100 };
export const BAND_LABEL: Record<BandKind, string> = { pe: "P/E", pb: "P/B" };
/** A share count more than this factor away from today's is treated as a unit mismatch (e.g. depositary receipts). */
const SHARE_SANITY = 1.8;

const fin = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const monthIndex = (iso: string) => { const d = new Date(iso); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
const day = (iso: string) => iso.slice(0, 10);

/**
 * Shares for a fiscal year on today's basis. Yahoo's prices are adjusted for every later split, so
 * the count is multiplied by the ratio of each split after the year end. Yahoo sometimes restates an
 * older year's count after a split; whichever of the raw and adjusted counts sits closer to today's
 * share count is used, so a restated year is not adjusted twice.
 */
export function sharesOnTodayBasis(y: FiscalYear, splits: SplitEvent[], current: number): { shares: number; note: string | null } {
  const raw = y.dilutedShares;
  if (!fin(raw) || raw <= 0) return { shares: current, note: `${y.label}: no reported share count, so today's share count is used.` };
  const factor = splits.filter((s) => day(s.date) > day(y.end) && fin(s.ratio) && s.ratio > 0).reduce((p, s) => p * s.ratio, 1);
  const adj = raw * factor;
  const dist = (x: number) => Math.abs(Math.log(x / current));
  let shares = adj, note: string | null = null;
  if (factor !== 1 && dist(raw) < dist(adj)) { shares = raw; note = `${y.label}: Yahoo's share count already reflects the later split or bonus issue.`; }
  // A whole-number gap that no split explains is a unit mismatch, typically ordinary shares against
  // depositary receipts (an HDFC Bank ADR is three shares): rescale by it.
  const r = shares / current, big = r >= 1 ? r : 1 / r, k = Math.round(big);
  if (k >= 2 && Math.abs(big / k - 1) <= 0.06) {
    shares = r >= 1 ? shares / k : shares * k;
    note = `${y.label}: Yahoo's share count is about ${k} times today's (likely ordinary shares against depositary receipts or an unrecorded split), so it is rescaled.`;
  }
  if (dist(shares) >= Math.log(SHARE_SANITY)) return { shares: current, note: `${y.label}: the reported share count looks inconsistent with today's, so today's count is used.` };
  return { shares, note };
}

const monthLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Monthly multiple series and its range. Each month uses the latest fiscal year whose end plus
 * `lagMonths` (time for annual results to come out) is on or before that month.
 */
export function buildBand(points: PricePoint[], splits: SplitEvent[], data: BandData, kind: BandKind, now: { price: number; date: string }, lagMonths = 2): Band {
  const notes: string[] = [];
  const label = BAND_LABEL[kind], max = BAND_MAX[kind];
  const years = [...data.history].sort((a, b) => +new Date(a.end) - +new Date(b.end));
  const perYear = years.map((y) => {
    const base = kind === "pe" ? y.netIncome : y.equity;
    const s = sharesOnTodayBasis(y, splits, data.shares);
    if (s.note && !notes.includes(s.note)) notes.push(s.note);
    const perShare = fin(base) ? base / s.shares : null;
    if (perShare === null) notes.push(`${y.label}: no ${kind === "pe" ? "net income" : "shareholders' equity"} reported.`);
    else if (perShare <= 0) notes.push(`${y.label}: ${kind === "pe" ? "a loss year" : "negative book value"}, so ${label} is not meaningful and those months are gaps.`);
    return { y, from: monthIndex(y.end) + lagMonths, perShare };
  });

  const nowM = monthIndex(now.date);
  const sorted = [...points].filter((p) => fin(p.close) && p.close > 0 && monthIndex(p.date) <= nowM).sort((a, b) => a.date.localeCompare(b.date));
  const series: BandPoint[] = [];
  let absurd = 0, early = 0;
  for (const p of sorted) {
    const m = monthIndex(p.date);
    let use: (typeof perYear)[number] | null = null;
    for (const r of perYear) if (r.from <= m) use = r;
    if (!use) { early++; continue; }
    let multiple: number | null = null;
    if (use.perShare !== null && use.perShare > 0) {
      const x = p.close / use.perShare;
      if (x > max) absurd++;
      else multiple = x;
    }
    series.push({ date: p.date, close: p.close, fy: use.y.label, perShare: use.perShare, multiple });
  }
  if (early && series.length && perYear.length) notes.push(`Prices go back to ${monthLabel(sorted[0].date)}, but the earliest statements on Yahoo are for ${perYear[0].y.label}, so the history starts in ${monthLabel(series[0].date)}.`);
  if (absurd) notes.push(`${absurd} month${absurd > 1 ? "s" : ""} with ${label} above ${max}x left out as gaps (earnings or book value close to zero).`);

  const vals = series.map((s) => s.multiple).filter(fin);
  const n = vals.length;
  const mean = n ? vals.reduce((s, x) => s + x, 0) / n : NaN;
  const sd = n > 1 ? Math.sqrt(vals.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : NaN;
  const today = kind === "pe" ? data.ttm.eps : data.bookValuePerShare;
  const current = fin(today) && today > 0 && fin(now.price) && now.price > 0 ? now.price / today : null;
  if (current === null) notes.push(kind === "pe" ? "Trailing earnings are zero or negative, so today's P/E can't be calculated." : "Book value per share is missing or negative, so today's P/B can't be calculated.");
  const currentPercentile = current !== null && n ? vals.reduce((s, x) => s + (x < current ? 1 : x === current ? 0.5 : 0), 0) / n : null;
  const med = median(vals);
  if (n > 0 && n < 12) notes.push(`Only ${n} month${n > 1 ? "s" : ""} of history: treat the range as a rough guide.`);
  const valid = series.filter((s) => s.multiple !== null);
  return {
    kind, series, notes,
    stats: {
      median: med, mean, sd, p10: percentile(vals, 0.1), p90: percentile(vals, 0.9),
      current, currentPercentile, atMedian: fin(today) && today > 0 && fin(med) ? med * today : null,
      n, from: valid[0]?.date ?? null, to: valid[valid.length - 1]?.date ?? null,
    },
  };
}
