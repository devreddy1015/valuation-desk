// Risk from price history: how much a stock swings, how far it has fallen, how often a year ended in
// a loss, and the price range one year of the same swings would span. Statistics of the past, not a
// forecast of direction: risk is far more stable from year to year than returns are.
import type { PricePoint } from "./bands";

export interface Drawdown { depth: number; peak: string; trough: string; recovered: string | null }
export interface RiskStats {
  from: string;
  to: string;
  weeks: number;
  vol: number | null; // annualised volatility of weekly log returns over the last two years
  volFull: number | null; // over the whole window
  benchVol: number | null; // the benchmark's, over the same two years
  maxDrawdown: Drawdown | null; // the deepest fall from a high, over the window
  fromPeak: number | null; // today's distance below the window's highest close (0 at a new high)
  rolling: { worst: number; best: number; median: number; lossShare: number; n: number; worstEnd: string } | null; // 52-week total returns
  worstWeek: { ret: number; date: string } | null;
  range: { p10: number; p25: number; p75: number; p90: number } | null; // one-year price band, no drift
}

const fin = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const WEEKS = 52;
/** z-scores of the 10th/25th percentiles of a normal distribution. */
const Z10 = 1.2815515655446004, Z25 = 0.6744897501960817;

function stdev(a: number[]): number | null {
  if (a.length < 20) return null;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
const logReturns = (p: PricePoint[]) => p.slice(1).map((x, i) => Math.log(x.close / p[i].close)).filter(fin);
/** Annualised volatility of weekly closes. */
export const annualVol = (p: PricePoint[]): number | null => { const s = stdev(logReturns(p)); return s === null ? null : s * Math.sqrt(WEEKS); };

/** The deepest peak-to-trough fall, and when (if ever) the price got back to that peak. */
export function maxDrawdown(p: PricePoint[]): Drawdown | null {
  if (p.length < 2) return null;
  let peak = p[0], best: Drawdown | null = null, bestPeakClose = p[0].close;
  for (const x of p) {
    if (x.close > peak.close) peak = x;
    const d = x.close / peak.close - 1;
    if (!best || d < best.depth) { best = { depth: d, peak: peak.date, trough: x.date, recovered: null }; bestPeakClose = peak.close; }
  }
  if (!best || best.depth >= 0) return null;
  const after = p.find((x) => x.date > best!.trough && x.close >= bestPeakClose);
  best.recovered = after?.date ?? null;
  return best;
}

/** Every 52-week return in the window (weekly steps), with the worst, best, median and share of losses. */
export function rollingYear(p: PricePoint[]): RiskStats["rolling"] {
  const r: { ret: number; end: string }[] = [];
  for (let i = WEEKS; i < p.length; i++) r.push({ ret: p[i].close / p[i - WEEKS].close - 1, end: p[i].date });
  if (r.length < 10) return null;
  const sorted = [...r].sort((a, b) => a.ret - b.ret);
  const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2].ret : (sorted[sorted.length / 2 - 1].ret + sorted[sorted.length / 2].ret) / 2;
  return { worst: sorted[0].ret, best: sorted[sorted.length - 1].ret, median: mid, lossShare: r.filter((x) => x.ret < 0).length / r.length, n: r.length, worstEnd: sorted[0].end };
}

/**
 * The price band one year of the same swings would span: today's price times exp(±z·σ), with σ the
 * annual volatility. The middle of the band is today's price, because direction is not forecast.
 */
export function priceRange(price: number, vol: number | null): RiskStats["range"] {
  if (!fin(price) || price <= 0 || !fin(vol) || vol <= 0) return null;
  return { p10: price * Math.exp(-Z10 * vol), p25: price * Math.exp(-Z25 * vol), p75: price * Math.exp(Z25 * vol), p90: price * Math.exp(Z10 * vol) };
}

export function riskStats(points: PricePoint[], bench: PricePoint[] | null, price: number): RiskStats | null {
  const p = points.filter((x) => fin(x.close) && x.close > 0);
  if (p.length < 30) return null;
  const recent = p.slice(-(2 * WEEKS + 1));
  const vol = annualVol(recent);
  const since = recent[0].date;
  const b = bench?.filter((x) => fin(x.close) && x.close > 0 && x.date >= since) ?? [];
  const hi = Math.max(...p.map((x) => x.close));
  const weekly = p.slice(1).map((x, i) => ({ ret: x.close / p[i].close - 1, date: x.date }));
  const worst = weekly.reduce<{ ret: number; date: string } | null>((w, x) => (!w || x.ret < w.ret ? x : w), null);
  return {
    from: p[0].date, to: p[p.length - 1].date, weeks: p.length,
    vol, volFull: annualVol(p), benchVol: b.length >= 30 ? annualVol(b) : null,
    maxDrawdown: maxDrawdown(p),
    fromPeak: fin(price) && price > 0 ? Math.min(0, price / hi - 1) : null,
    rolling: rollingYear(p),
    worstWeek: worst,
    range: priceRange(price, vol),
  };
}
