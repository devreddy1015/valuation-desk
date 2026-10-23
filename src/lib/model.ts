// The valuation engine: DCF (FCFF), peer comparison, scenarios, reverse DCF, sensitivity and
// Monte Carlo. Pure functions, unit-agnostic: money and shares only need to be consistent.
import type { Drivers, FiscalYear, PeerRow, ScenarioKey, StockData, UserInputs } from "./types";
import { SCENARIOS } from "./types";

export const FORECAST_YEARS = 5;
const DAY = 864e5;
const pc = (x: number) => x / 100;
const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const fin = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const round1 = (x: number) => Math.round(x * 10) / 10;

export function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y), n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
/** Excel PERCENTILE.INC. */
export function percentile(a: number[], p: number): number {
  const s = [...a].sort((x, y) => x - y), n = s.length;
  if (!n) return NaN;
  const h = (n - 1) * p, lo = Math.floor(h);
  return lo + 1 < n ? s[lo] + (h - lo) * (s[lo + 1] - s[lo]) : s[lo];
}

export interface HistAverages {
  growth: number; margin: number; tax: number; da: number; capex: number; wc: number; marginLast: number; growthLast: number;
}
export function histAverages(h: FiscalYear[]): HistAverages {
  const growth: number[] = [];
  // Working capital per unit of revenue change, pooled over the years where revenue grew by 3% or
  // more: a year of near-flat revenue would otherwise divide by almost nothing and dominate a plain mean.
  let wcSum = 0, dSum = 0;
  for (let i = 1; i < h.length; i++) {
    if (h[i - 1].revenue > 0) growth.push(h[i].revenue / h[i - 1].revenue - 1);
    const d = h[i].revenue - h[i - 1].revenue;
    if (h[i - 1].revenue > 0 && d >= 0.03 * h[i - 1].revenue) { wcSum += h[i].wcInc; dSum += d; }
  }
  const pos = h.filter((y) => y.revenue > 0);
  const last = h[h.length - 1];
  return {
    growth: avg(growth),
    margin: avg(pos.map((y) => y.ebit / y.revenue)),
    tax: avg(h.filter((y) => y.pbt > 0).map((y) => y.tax / y.pbt)),
    da: avg(pos.map((y) => y.da / y.revenue)),
    capex: avg(pos.map((y) => y.capex / y.revenue)),
    wc: dSum > 0 ? wcSum / dSum : NaN,
    marginLast: last && last.revenue > 0 ? last.ebit / last.revenue : NaN,
    growthLast: growth.length ? growth[growth.length - 1] : NaN,
  };
}

export function defaultTerminalGrowth(currency: string): number {
  return currency === "INR" ? 5 : 3;
}

/** Starter drivers from history and consensus revenue estimates. Placeholders for the user to replace. */
export function starterDrivers(data: StockData): Record<ScenarioKey, Drivers> {
  const H = histAverages(data.history);
  const longRun = defaultTerminalGrowth(data.currency) + 2;
  const g1 = fin(data.estimates.growthThisYear) ? data.estimates.growthThisYear * 100 : fin(H.growth) ? H.growth * 100 : longRun;
  const g2 = fin(data.estimates.growthNextYear) ? data.estimates.growthNextYear * 100 : (g1 + longRun) / 2;
  const a = clamp(g1, -20, 40), b = clamp(g2, -20, 40);
  const base = [a, b, b + (longRun - b) / 3, b + (2 * (longRun - b)) / 3, longRun].map(round1);
  const m0 = clamp(fin(H.marginLast) ? H.marginLast * 100 : fin(H.margin) ? H.margin * 100 : 10, -100, 90);
  const tax = round1(clamp(fin(H.tax) ? H.tax * 100 : 25, 10, 40));
  const da = round1(clamp(fin(H.da) ? H.da * 100 : 3, 0, 30));
  const capex = round1(clamp(fin(H.capex) ? H.capex * 100 : 3, 0, 40));
  const wc = Math.round(clamp(fin(H.wc) ? H.wc * 100 : 15, 0, 40));
  // Heavy investment phases rarely last for ever: when capex runs above depreciation, fade it
  // to 1.15x depreciation by year 5 (a common normalisation); otherwise keep the history.
  const capexTarget = capex > da * 1.15 ? round1(da * 1.15) : capex;
  const capexPath = Array.from({ length: FORECAST_YEARS }, (_, i) => round1(capex + ((capexTarget - capex) * i) / (FORECAST_YEARS - 1)));
  const mk = (dg: number, dm: number, dwc: number): Drivers => ({
    growth: base.map((v) => round1(v + dg)),
    margin: Array(FORECAST_YEARS).fill(round1(m0 + dm)),
    tax: Array(FORECAST_YEARS).fill(tax),
    da: Array(FORECAST_YEARS).fill(da),
    capex: capexPath,
    wc: Array(FORECAST_YEARS).fill(clamp(wc + dwc, 0, 80)),
  });
  return { bear: mk(-3, -1.5, 5), base: mk(0, 0, 0), bull: mk(3, 1.5, -5) };
}

export function defaultInputs(data: StockData, peers: PeerRow[]): UserInputs {
  const rf = data.riskFree.rate;
  const spread = data.currency === "INR" ? data.erp.defaultSpread : 0;
  const beta = Math.round((data.beta?.value ?? data.yahooBeta ?? 1) * 100) / 100;
  const include: Record<string, boolean> = {};
  peers.forEach((p) => { include[p.symbol] = true; });
  return {
    scenario: "base",
    assume: starterDrivers(data),
    rate: { rf, spread, beta: clamp(beta, 0.3, 2.5), erp: data.erp.value, kd: round1(rf + 1.5), g: defaultTerminalGrowth(data.currency) },
    price: data.price,
    dcfWeight: data.financial ? 0 : 50,
    buy: 15,
    sell: -10,
    probs: { bear: 25, base: 50, bull: 25 },
    usePW: false,
    mc: { g: 2, m: 1.5, w: 1, t: 0.5, seed: 1 },
    peers: include,
  };
}

/** Round a price target to a sensible step for its size (Rs 1,163 -> nearest 10). */
export function roundTarget(x: number): number {
  if (!fin(x)) return NaN;
  const a = Math.abs(x);
  const step = a >= 1000 ? 10 : a >= 100 ? 1 : a >= 10 ? 0.1 : 0.01;
  return Number((Math.round(x / step) * step).toFixed(2));
}

export interface DcfOut {
  rev: number[]; ebit: number[]; nopat: number[]; da: number[]; capex: number[]; wcInc: number[]; fcf: number[]; df: number[]; pv: number[];
  sumPv: number; valid: boolean; tv: number; pvTv: number; ev: number; tvShare: number; equity: number; vps: number;
}
interface Stat { q1: number; med: number; q3: number; n: number }
export interface Check { what: string; pass: boolean | null; fix: string }

export interface Valuation {
  t: number[]; fyLabels: string[]; rf: number; ke: number; mcap: number; we: number; kdAT: number; wacc: number; g: number; bridge: number;
  scen: Record<ScenarioKey, DcfOut>; live: DcfOut; pw: number; dcfUsed: number;
  sens: number[][]; sensW: number[]; sensG: number[];
  peers: (PeerRow & { included: boolean })[]; stats: { evE: Stat; pe: Stat; evS: Stat; pb: Stat };
  implied: { evE: Stat; pe: Stat; evS: Stat; pb: Stat }; subject: { evE: number; pe: number; evS: number; pb: number };
  compsValue: number; compsMethod: string; discount: number; discountMetric: string;
  w: number; dcfOk: boolean; ptRaw: number; pt: number; upside: number; rating: "BUY" | "HOLD" | "SELL" | "–"; ok: boolean;
  impliedGrowth: number; impliedMargin: number; liveAvgGrowth: number; liveAvgMargin: number;
  marginChangeBps: number; fcfYield: number; checks: Check[]; H: HistAverages;
  dcf: (A: Drivers, w: number, g: number) => DcfOut;
}

function addYears(iso: string, n: number): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate());
}

export function fyLabel(iso: string, prefixFY: boolean): string {
  const d = new Date(iso), y = d.getUTCFullYear();
  return prefixFY ? `FY${String(y).slice(2)}` : String(y);
}

/**
 * The input at which f crosses zero, for the reverse DCF. Value need not be monotonic in the input:
 * with a large working-capital driver, shrinking revenue releases cash, so a "shrink to riches" root
 * can exist far below the one that matters. Every crossing in [lo, hi] is found; only those where f
 * moves in the same direction as at the user's own case (x0) count, and the nearest to x0 wins.
 * NaN when no such crossing exists.
 */
export function impliedRoot(f: (x: number) => number, x0: number, lo: number, hi: number, steps = 160): number {
  const dx = (hi - lo) / steps;
  const slope = (x: number) => { const h = 0.05; const a = f(x - h), b = f(x + h); return fin(a) && fin(b) ? Math.sign(b - a) : 0; };
  const want = fin(x0) ? slope(clamp(x0, lo, hi)) : 0;
  let best = NaN;
  let px = lo, pf = f(lo);
  for (let i = 1; i <= steps; i++) {
    const x = lo + i * dx, fx = f(x);
    if (fin(pf) && fin(fx) && pf * fx <= 0 && (pf !== 0 || fx !== 0)) {
      let a = px, b = x, fa = pf;
      for (let k = 0; k < 80; k++) {
        const m = (a + b) / 2, fm = f(m);
        if (!fin(fm)) break;
        if (fa * fm <= 0) b = m; else { a = m; fa = fm; }
      }
      const root = (a + b) / 2;
      const dir = Math.sign(fx - pf);
      if ((want === 0 || dir === want) && (!fin(best) || Math.abs(root - x0) < Math.abs(best - x0))) best = root;
    }
    px = x; pf = fx;
  }
  return best;
}

export function compute(inp: UserInputs, data: StockData, peerRows: PeerRow[], valDate: number): Valuation {
  const r = inp.rate, price = inp.price, shares = data.shares, B = data.bridge;
  const last = data.history[data.history.length - 1];
  const t = Array.from({ length: FORECAST_YEARS }, (_, i) => Math.max(0, (addYears(last.end, i + 1) - valDate) / DAY / 365));
  const marchFY = new Date(last.end).getUTCMonth() !== 11;
  const fyLabels = Array.from({ length: FORECAST_YEARS }, (_, i) => fyLabel(new Date(addYears(last.end, i + 1)).toISOString(), marchFY) + "E");
  const live = inp.assume[inp.scenario];
  const rf = pc(r.rf) - pc(r.spread);
  const ke = rf + r.beta * pc(r.erp);
  const mcap = price * shares;
  const debt = B.borrowings + B.leases;
  const we = mcap / (mcap + debt);
  const kdAT = pc(r.kd) * (1 - pc(live.tax[0]));
  const wacc = we * ke + (1 - we) * kdAT;
  const g = pc(r.g);
  const bridge = B.cash - B.borrowings - B.leases - B.nci - B.returned;
  const rev0 = last.revenue;

  function dcf(A: Drivers, w: number, gg: number): DcfOut {
    const o: DcfOut = { rev: [], ebit: [], nopat: [], da: [], capex: [], wcInc: [], fcf: [], df: [], pv: [], sumPv: 0, valid: false, tv: NaN, pvTv: NaN, ev: NaN, tvShare: NaN, equity: NaN, vps: NaN };
    let prev = rev0;
    for (let i = 0; i < FORECAST_YEARS; i++) {
      const rev = prev * (1 + pc(A.growth[i]));
      const ebit = rev * pc(A.margin[i]);
      const nopat = ebit * (1 - pc(A.tax[i]));
      const da = rev * pc(A.da[i]);
      const capex = rev * pc(A.capex[i]);
      const wcInc = (rev - prev) * pc(A.wc[i]);
      const fcf = nopat + da - capex - wcInc;
      const df = 1 / Math.pow(1 + w, t[i]);
      o.rev.push(rev); o.ebit.push(ebit); o.nopat.push(nopat); o.da.push(da); o.capex.push(capex);
      o.wcInc.push(wcInc); o.fcf.push(fcf); o.df.push(df); o.pv.push(fcf * df);
      prev = rev;
    }
    o.sumPv = o.pv.reduce((s, x) => s + x, 0);
    o.valid = w > gg;
    o.tv = o.valid ? (o.fcf[FORECAST_YEARS - 1] * (1 + gg)) / (w - gg) : NaN;
    o.pvTv = o.tv * o.df[FORECAST_YEARS - 1];
    o.ev = o.sumPv + o.pvTv;
    o.tvShare = o.pvTv / o.ev;
    o.equity = o.ev + bridge;
    o.vps = o.equity / shares;
    return o;
  }

  const scen = {} as Record<ScenarioKey, DcfOut>;
  for (const k of SCENARIOS) scen[k] = dcf(inp.assume[k], wacc, g);
  const L = scen[inp.scenario];
  const psum = inp.probs.bear + inp.probs.base + inp.probs.bull;
  const pw = psum > 0 ? SCENARIOS.reduce((s, k) => s + inp.probs[k] * scen[k].vps, 0) / psum : NaN;
  const dcfUsed = inp.usePW ? pw : L.vps;

  const step = 0.005, offs = [-2, -1, 0, 1, 2];
  const sensW = offs.map((o) => wacc + o * step), sensG = offs.map((o) => g + o * step);
  const sens = sensG.map((gg) => sensW.map((w) => (w > gg ? dcf(live, w, gg).vps : NaN)));

  // peer comparison
  const peers = peerRows.map((p) => ({ ...p, included: inp.peers[p.symbol] !== false }));
  const inc = peers.filter((p) => p.included);
  const ok1 = (x: number | null, lo: number, hi: number) => fin(x) && x > lo && x < hi;
  const stat = (vals: number[]): Stat => ({ q1: percentile(vals, 0.25), med: median(vals), q3: percentile(vals, 0.75), n: vals.length });
  const stats = {
    evE: stat(inc.map((p) => p.evEbitda).filter((x): x is number => ok1(x, 0, 200))),
    pe: stat(inc.map((p) => p.pe).filter((x): x is number => ok1(x, 0, 500))),
    evS: stat(inc.map((p) => p.evSales).filter((x): x is number => ok1(x, 0, 100))),
    pb: stat(inc.map((p) => p.pb).filter((x): x is number => ok1(x, 0, 100))),
  };
  // EV includes minority holders' claim, since EBITDA includes their share of consolidated profit
  const netCash = data.compsNetCash ?? B.cash - B.borrowings - B.leases - B.nci;
  const T = data.ttm, bv = data.bookValuePerShare;
  const mapStat = (s: Stat, f: (m: number) => number): Stat => ({ q1: f(s.q1), med: f(s.med), q3: f(s.q3), n: s.n });
  const implied = {
    evE: mapStat(stats.evE, (m) => (T.ebitda > 0 ? (m * T.ebitda + netCash) / shares : NaN)),
    pe: mapStat(stats.pe, (m) => (T.eps > 0 ? m * T.eps : NaN)),
    evS: mapStat(stats.evS, (m) => (T.revenue > 0 ? (m * T.revenue + netCash) / shares : NaN)),
    pb: mapStat(stats.pb, (m) => (fin(bv) && bv > 0 ? m * bv : NaN)),
  };
  const ev = price * shares - netCash;
  const subject = { evE: T.ebitda > 0 ? ev / T.ebitda : NaN, pe: T.eps > 0 ? price / T.eps : NaN, evS: T.revenue > 0 ? ev / T.revenue : NaN, pb: fin(bv) && bv > 0 ? price / bv : NaN };
  const pair = data.financial ? [implied.pe.med, implied.pb.med] : [implied.evE.med, implied.pe.med];
  const usable = pair.filter(fin);
  const compsValue = usable.length ? avg(usable) : NaN;
  const compsMethod = data.financial ? "average of median P/E and median P/B prices" : "average of median EV/EBITDA and median P/E prices";
  const discountMetric = data.financial ? "P/E" : "EV/EBITDA";
  const discount = data.financial ? subject.pe / stats.pe.med - 1 : subject.evE / stats.evE.med - 1;

  // blend
  const w = clamp(inp.dcfWeight, 0, 100) / 100;
  const dcfOk = L.valid && fin(dcfUsed) && dcfUsed > 0;
  const compsOk = fin(compsValue);
  let ptRaw = NaN;
  if (dcfOk && compsOk) ptRaw = dcfUsed * w + compsValue * (1 - w);
  else if (dcfOk && w === 1) ptRaw = dcfUsed;
  else if (compsOk && w === 0) ptRaw = compsValue;
  else if (dcfOk && !compsOk) ptRaw = dcfUsed;
  else if (compsOk && !dcfOk) ptRaw = compsValue;
  const pt = roundTarget(ptRaw);
  const upside = pt / price - 1;
  const ok = fin(pt);
  const rating = !ok ? "–" : upside > pc(inp.buy) ? "BUY" : upside < pc(inp.sell) ? "SELL" : "HOLD";

  // reverse DCF: the constant growth, or constant margin, that makes value = price
  const impliedGrowth = L.valid ? impliedRoot((G) => dcf({ ...live, growth: Array(FORECAST_YEARS).fill(G) }, wacc, g).vps - price, avg(live.growth), -60, 100) : NaN;
  const impliedMargin = L.valid ? impliedRoot((M) => dcf({ ...live, margin: Array(FORECAST_YEARS).fill(M) }, wacc, g).vps - price, avg(live.margin), -50, 90) : NaN;

  const H = histAverages(data.history);
  const checks: Check[] = [
    { what: "WACC is above terminal growth g", pass: wacc > g, fix: "Lower g or raise the WACC inputs." },
    { what: "The DCF gives a positive value per share", pass: L.valid ? L.vps > 0 : null, fix: "A negative value usually means capex or working capital stays too high for ever, or the bridge holds a finance arm's debt. Until fixed, the price target uses peer multiples only." },
    { what: "Shares × price is within 2% of the reported market cap", pass: data.marketCap > 0 ? Math.abs(mcap / data.marketCap - 1) < 0.02 : null, fix: "If you changed the price, the share count may also be out of date." },
    { what: "Scenario values are in order: bear ≤ base ≤ bull", pass: scen.bear.vps <= scen.base.vps && scen.base.vps <= scen.bull.vps, fix: "Bear and bull drivers are the wrong way round." },
    { what: "At least three peers are in the medians", pass: inc.length >= 3, fix: "Add or tick more peers in the comps table." },
    { what: "Terminal value is less than 85% of enterprise value", pass: L.valid ? L.tvShare < 0.85 : null, fix: "Most of the value sits after year 5: check terminal growth and the year-5 margin." },
    { what: "The forecast starts after the last reported year", pass: t[0] > 0, fix: "The latest annual report may be missing: check the history dates." },
  ];

  return {
    t, fyLabels, rf, ke, mcap, we, kdAT, wacc, g, bridge, scen, live: L, pw, dcfUsed, sens, sensW, sensG,
    peers, stats, implied, subject, compsValue, compsMethod, discount, discountMetric,
    w, dcfOk, ptRaw, pt, upside, rating, ok, impliedGrowth, impliedMargin,
    liveAvgGrowth: avg(live.growth), liveAvgMargin: avg(live.margin),
    marginChangeBps: (pc(live.margin[FORECAST_YEARS - 1]) - H.marginLast) * 10000,
    fcfYield: L.fcf[0] / mcap, checks, H, dcf,
  };
}

/** Deterministic PRNG so the Monte Carlo chart does not jump between renders. */
export function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MonteCarlo { vals: number[]; p10: number; p25: number; p50: number; p75: number; p90: number; mean: number; probAbove: number; n: number }

export function monteCarlo(inp: UserInputs, R: Valuation, n = 2000): MonteCarlo {
  const rnd = mulberry32(1000 + (inp.mc.seed | 0) * 7919);
  const gauss = () => { let u = 0; while (u === 0) u = rnd(); const v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const base = inp.assume[inp.scenario];
  const vals: number[] = [];
  for (let i = 0; i < n; i++) {
    const dg = gauss() * inp.mc.g, dm = gauss() * inp.mc.m;
    const w = Math.max(0.02, R.wacc + (gauss() * inp.mc.w) / 100);
    const tg = Math.min(R.g + (gauss() * inp.mc.t) / 100, w - 0.01);
    const v = R.dcf({ ...base, growth: base.growth.map((x) => x + dg), margin: base.margin.map((x) => x + dm) }, w, tg).vps;
    if (fin(v)) vals.push(v);
  }
  vals.sort((a, b) => a - b);
  const q = (p: number) => percentile(vals, p);
  return { vals, n: vals.length, p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), mean: avg(vals), probAbove: vals.length ? vals.filter((v) => v > inp.price).length / vals.length : NaN };
}
