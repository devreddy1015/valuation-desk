// Business health check: is this a good, honest business, not just a cheap one? Three published
// screens on the reported annual accounts (Piotroski 2000 F-score, Altman 1995 Z'' for
// non-manufacturers and emerging markets, Beneish 1999 eight-variable M-score) plus plain ratios,
// each judged good or bad. Pure and synchronous: the desk, the scanner and API routes all call it.
import { big, bigUnit } from "./format";
import type { HealthGrade } from "./scanTypes";
import type { FiscalYear, StockData } from "./types";

export interface HealthTest {
  key: string;
  label: string; // plain English, e.g. "Cash from operations beat profit"
  pass: boolean | null; // null = could not be computed
  value: string; // the numbers behind the test, formatted
  why: string; // one sentence on why it matters
}

/** good, ok (in between) and bad count toward the score; info and na do not. */
export type Verdict = "good" | "ok" | "bad" | "info" | "na";

export interface HealthMetric {
  key: string;
  label: string;
  value: number | null;
  format: "pct" | "x" | "days" | "num";
  good: boolean | null;
  note: string;
  verdict?: Verdict;
  display?: string; // ready-made text where a bare number would mislead, e.g. "Net cash"
}

export interface AltmanPart { key: string; label: string; value: number; weight: number }
export interface BeneishPart {
  key: string;
  label: string;
  value: number | null; // null = a required input is missing
  weight?: number;
  neutral?: boolean; // input missing, so the neutral 1.0 was used
  manipulators?: number; // Beneish (1999) sample mean for companies that manipulated earnings
  others?: number; // and for those that did not
}

export interface HealthReport {
  score: number | null; // 0-100
  grade: HealthGrade;
  summary: string; // one plain-English sentence
  piotroski: { score: number; max: number; tests: HealthTest[]; history?: { label: string; score: number; max: number }[] } | null;
  altman: { z: number; zone: "safe" | "grey" | "distress"; note: string; parts?: AltmanPart[]; history?: { label: string; z: number }[] } | null;
  beneish: { m: number; flag: boolean; note: string; parts: BeneishPart[]; neutral?: string[]; history?: { label: string; m: number }[] } | null;
  metrics: HealthMetric[];
  flags: string[]; // plain-language red flags
  strengths: string[];
  notes: string[]; // what could not be computed and why
  years?: string[]; // fiscal year labels used, oldest first
  financial?: boolean;
}

/* ---------- small helpers ---------- */

type N = number | null | undefined;
const ok = (v: N): v is number => typeof v === "number" && Number.isFinite(v);
const pos = (v: N): v is number => ok(v) && v > 0;
const ratio = (a: N, b: N): number | null => (ok(a) && pos(b) ? a / b : null);
/** Yahoo fills a missing operating profit with 0, so an exact 0 means "not reported". */
const ebitOf = (y: FiscalYear): number | null => (ok(y.ebit) && y.ebit !== 0 ? y.ebit : null);
/** Long-term debt, or zero when the company reports no debt at all. */
const ltdOf = (y: FiscalYear): number | null => (ok(y.longTermDebt) ? y.longTermDebt : ok(y.totalDebt) && y.totalDebt <= 0 ? 0 : null);

/** Fixed decimals with a true minus sign and no "−0.0". */
function fix(v: number, dp: number): string {
  const s = v.toFixed(dp);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s.replace(/^-/, "−");
}
const pc = (f: number, dp = 1) => fix(f * 100, dp) + "%";
const spc = (f: number, dp = 1) => { const s = pc(f, dp); return (f > 0 && /[1-9]/.test(s) ? "+" : "") + s; };
const xx = (v: number, dp = 1) => fix(v, dp) + "x";
const s2 = (v: number) => fix(v, 2);
/** A large amount in the reader's unit: "₹35,758 crore", "USD 1,234 mn". */
function amt(v: number, cur: string): string {
  const s = big(Math.abs(v), cur), neg = v < 0 ? "−" : "";
  return cur === "INR" ? `${neg}₹${s} crore` : `${neg}${cur} ${s} ${bigUnit(cur).label.slice(cur.length + 1)}`;
}
const plural = (k: number, one: string, many = one + "s") => `${k} ${k === 1 ? one : many}`;
/** Two figures shown with enough decimals to tell them apart, so a failed "rose" test never reads "1.10 vs 1.10". */
function apart(a: number, b: number, f: (v: number, dp: number) => string, dp: number): [string, string] {
  for (let d = dp; d < dp + 3; d++) { const x = f(a, d), y = f(b, d); if (x !== y) return [x, y]; }
  return [f(a, dp), f(b, dp)];
}

/* ---------- share count: bonus issues and splits ---------- */

export interface ShareStep { label: string; ratio: number; split: number; real: number }

/**
 * Year-on-year change in weighted diluted shares. Reported counts are not split-adjusted and Indian
 * companies often issue bonus shares, so a jump within 10% of a whole multiple (2x, 3x...) is read
 * as a bonus issue or split (or a consolidation when it shrinks) and only the remainder is new shares.
 */
export function shareSteps(h: FiscalYear[]): (ShareStep | null)[] {
  return h.slice(1).map((y, i) => {
    const a = h[i].dilutedShares, b = y.dilutedShares;
    if (!pos(a) || !pos(b)) return null;
    const r = b / a;
    let split = 1;
    if (r >= 1.9) { const k = Math.round(r); if (Math.abs(r / k - 1) <= 0.1) split = k; }
    else if (r <= 1 / 1.9) { const k = Math.round(1 / r); if (Math.abs(r * k - 1) <= 0.1) split = 1 / k; }
    return { label: y.label, ratio: r, split, real: r / split };
  });
}
const splitText = (s: number) => (s >= 1 ? `×${Math.round(s)}` : `÷${Math.round(1 / s)}`);

/* ---------- Piotroski F-score ---------- */

const WHY: Record<string, string> = {
  roa: "A company that loses money on its assets is using up its owners' capital.",
  cfo: "Profit has to arrive as cash in the end, and cash flow is harder to dress up than profit.",
  droa: "Rising profitability is one of the clearest signs a business is getting stronger.",
  accrual: "When cash lags profit, earnings may rest on generous accounting or customers who pay late.",
  lever: "More debt leaves less room for error when business slows.",
  liquid: "More short-term assets per rupee of bills due within a year means less risk of a cash squeeze.",
  shares: "Issuing shares shrinks each owner's slice and can mean the company could not fund itself.",
  margin: "A higher gross margin points to pricing power or falling costs.",
  turn: "More sales from the same assets means the business uses its capital better.",
};
const NA = "Not available in the data";
const FIN_SKIP = "Not used for banks and insurers";

interface Pio { score: number; max: number; tests: HealthTest[]; endBasis: string[] }

/** Piotroski's nine tests on the last year of `h` against the year before. */
function piotroskiAt(h: FiscalYear[], fin: boolean, cur: string): Pio | null {
  const n = h.length;
  if (n < 2) return null;
  const t = h[n - 1], p = h[n - 2], pp: FiscalYear | undefined = h[n - 3];
  const At = t.totalAssets, Ap = p.totalAssets, App = pp?.totalAssets;
  const begin = pos(Ap) && pos(App); // opening assets for both years
  const endOk = pos(At) && pos(Ap);
  const endBasis: string[] = [];
  const tests: HealthTest[] = [];
  const add = (key: string, label: string, pass: boolean | null, value: string) => tests.push({ key, label, pass, value, why: WHY[key] });
  const prev = `vs ${p.label}`;
  const vs = (a: number, b: number, f: (v: number, dp: number) => string, dp: number) => { const [x, y] = apart(a, b, f, dp); return `${x} ${prev}'s ${y}`; };

  // 1. return on opening assets above zero
  const roa = pos(Ap) ? t.netIncome / Ap : pos(At) ? t.netIncome / At : null;
  if (!pos(Ap) && pos(At)) endBasis.push("return on assets");
  const tEbit = ebitOf(t);
  const offCore = !fin && tEbit !== null && tEbit <= 0 && t.netIncome > 0 ? "; operations made a loss, so this profit came from other items" : "";
  add("roa", "Made a profit", ok(t.netIncome) ? t.netIncome > 0 : null,
    (roa !== null ? `Return on assets ${pc(roa)} in ${t.label}` : `Net profit ${amt(t.netIncome, cur)} in ${t.label}`) + offCore);

  // 2. operating cash flow above zero
  add("cfo", "Operations brought in cash", ok(t.cfo) ? t.cfo > 0 : null, ok(t.cfo) ? `Operating cash flow ${amt(t.cfo, cur)} in ${t.label}` : NA);

  // 3. return on assets rose
  let rT: number | null = null, rP = 0;
  if (begin) { rT = t.netIncome / Ap; rP = p.netIncome / App; }
  else if (endOk) { rT = t.netIncome / At; rP = p.netIncome / Ap; endBasis.push("the change in return on assets"); }
  add("droa", "Return on assets improved", rT === null ? null : rT > rP, rT === null ? NA : vs(rT, rP, pc, 1) + offCore);

  // 4. cash from operations above net profit (accruals)
  add("accrual", "Cash from operations beat profit", ok(t.cfo) ? t.cfo > t.netIncome : null,
    ok(t.cfo) ? `Cash ${amt(t.cfo, cur)} vs profit ${amt(t.netIncome, cur)}` : NA);

  // 5. long-term debt / average total assets fell (or there is next to none)
  const dT = ltdOf(t), dP = ltdOf(p);
  let lT: number | null = null, lP = 0, avg = true;
  if (dT !== null && dP !== null) {
    if (endOk && pos(App)) { lT = dT / ((At + Ap) / 2); lP = dP / ((Ap + App) / 2); }
    else if (endOk) { lT = dT / At; lP = dP / Ap; avg = false; endBasis.push("leverage"); }
  }
  const noDebt = lT !== null && lT < 0.005 && lP < 0.005;
  add("lever", "Long-term debt fell relative to assets", lT === null ? null : noDebt || lT < lP,
    lT === null ? NA : noDebt ? "Almost no long-term debt in either year" : (([x, y]) => `Long-term debt ${x} of ${avg ? "average" : "year-end"} assets ${prev}'s ${y}`)(apart(lT, lP, pc, 1)));

  // 6. current ratio rose
  if (fin) add("liquid", "Short-term liquidity improved", null, FIN_SKIP);
  else {
    const cT = ratio(t.currentAssets, t.currentLiabilities), cP = ratio(p.currentAssets, p.currentLiabilities);
    add("liquid", "Short-term liquidity improved", cT === null || cP === null ? null : cT > cP, cT === null || cP === null ? NA : `Current ratio ${vs(cT, cP, fix, 2)}`);
  }

  // 7. no new shares (bonus issues and splits are not new money)
  const st = shareSteps([p, t])[0];
  add("shares", "No new shares issued", st ? st.real <= 1.005 : null,
    !st ? NA : st.split !== 1 ? `Share count ${splitText(st.split)}, which looks like a bonus issue or split; otherwise ${spc(st.real - 1)}` : `Diluted shares ${spc(st.real - 1)} ${prev}`);

  // 8. gross margin rose
  if (fin) add("margin", "Gross margin improved", null, FIN_SKIP);
  else {
    const gT = ratio(t.grossProfit, t.revenue), gP = ratio(p.grossProfit, p.revenue);
    const noCogs = gT !== null && gP !== null && gT >= 0.999 && gP >= 0.999;
    add("margin", "Gross margin improved", gT === null || gP === null || noCogs ? null : gT > gP,
      gT === null || gP === null ? NA : noCogs ? "No cost of sales reported, so gross margin is not meaningful" : `Gross margin ${vs(gT, gP, pc, 1)}`);
  }

  // 9. asset turnover (revenue / opening assets) rose
  let aT: number | null = null, aP = 0;
  if (begin) { aT = t.revenue / Ap; aP = p.revenue / App; }
  else if (endOk) { aT = t.revenue / At; aP = p.revenue / Ap; endBasis.push("asset turnover"); }
  add("turn", "Assets worked harder (turnover up)", aT === null ? null : aT > aP, aT === null ? NA : `Revenue ÷ assets ${vs(aT, aP, xx, 2)}`);

  const done = tests.filter((x) => x.pass !== null);
  return { score: done.filter((x) => x.pass).length, max: done.length, tests, endBasis };
}

/* ---------- Altman Z'' ---------- */

const ALTMAN: { key: string; label: string; weight: number }[] = [
  { key: "x1", label: "Working capital ÷ total assets", weight: 6.56 },
  { key: "x2", label: "Retained earnings ÷ total assets", weight: 3.26 },
  { key: "x3", label: "Operating profit (EBIT) ÷ total assets", weight: 6.72 },
  { key: "x4", label: "Book equity ÷ total liabilities", weight: 1.05 },
];

/** Altman (1995) Z'' = 6.56 X1 + 3.26 X2 + 6.72 X3 + 1.05 X4 for one year, or null if an input is missing. */
export function altmanZ(y: FiscalYear): { z: number; parts: AltmanPart[] } | null {
  const ebit = ebitOf(y), A = y.totalAssets, Lb = y.totalLiabilities;
  if (!ok(y.currentAssets) || !ok(y.currentLiabilities) || !ok(y.retainedEarnings) || !ok(y.equity) || !pos(A) || !pos(Lb) || ebit === null) return null;
  const xs = [(y.currentAssets - y.currentLiabilities) / A, y.retainedEarnings / A, ebit / A, y.equity / Lb];
  const parts = ALTMAN.map((a, i) => ({ ...a, value: xs[i] }));
  return { z: parts.reduce((s, q) => s + q.weight * q.value, 0), parts };
}
export const altmanZone = (z: number): "safe" | "grey" | "distress" => (z > 2.6 ? "safe" : z >= 1.1 ? "grey" : "distress");

function altmanMissing(y: FiscalYear): string[] {
  const m: [unknown, string][] = [[y.currentAssets, "current assets"], [y.currentLiabilities, "current liabilities"], [y.retainedEarnings, "retained earnings"], [y.equity, "equity"], [y.totalAssets, "total assets"], [y.totalLiabilities, "total liabilities"], [ebitOf(y), "operating profit"]];
  return m.filter(([v]) => !ok(v as N)).map(([, k]) => k);
}

/* ---------- Beneish M-score ---------- */

// Coefficients from Beneish (1999); manipulators/others are the sample means in that paper's Table 2.
const BENEISH: (Omit<BeneishPart, "value"> & { weight: number; required?: boolean; plain: string })[] = [
  { key: "dsri", label: "Receivables growing faster than sales (DSRI)", plain: "receivables growing faster than sales", weight: 0.92, manipulators: 1.465, others: 1.031, required: true },
  { key: "gmi", label: "Gross margin slipping (GMI)", plain: "a slipping gross margin", weight: 0.528, manipulators: 1.193, others: 1.014 },
  { key: "aqi", label: "More hard-to-value assets (AQI)", plain: "more hard-to-value assets", weight: 0.404, manipulators: 1.254, others: 1.039, required: true },
  { key: "sgi", label: "Sales growth (SGI)", plain: "fast sales growth", weight: 0.892, manipulators: 1.607, others: 1.134, required: true },
  { key: "depi", label: "Depreciation slowing (DEPI)", plain: "slower depreciation", weight: 0.115, manipulators: 1.077, others: 1.001 },
  { key: "sgai", label: "Overheads vs sales (SGAI)", plain: "overheads rising faster than sales", weight: -0.172, manipulators: 1.041, others: 1.054 },
  { key: "tata", label: "Profit not backed by cash, ÷ assets (TATA)", plain: "profit not backed by cash", weight: 4.679, manipulators: 0.031, others: 0.018, required: true },
  { key: "lvgi", label: "Leverage rising (LVGI)", plain: "rising leverage", weight: -0.327, manipulators: 1.111, others: 1.037 },
];
const PLAIN = Object.fromEntries(BENEISH.map((b) => [b.key, b.plain]));
export const BENEISH_CUTOFF = -1.78;

/** Beneish (1999) eight-variable M-score for year t against year p. Missing optional indexes take the neutral 1.0. */
export function beneishM(p: FiscalYear, t: FiscalYear): { m: number | null; parts: BeneishPart[]; neutral: string[]; missing: string[] } {
  const sT = t.revenue, sP = p.revenue;
  const salesOk = pos(sT) && pos(sP);
  const idx: Record<string, number | null> = {};
  // receivables / sales, t over t-1 (no receivables in either year is neutral)
  const rT = t.receivables, rP = p.receivables;
  idx.dsri = !salesOk || !ok(rT) || !ok(rP) ? null : rP > 0 ? (rT / sT) / (rP / sP) : rT <= 0 ? 1 : null;
  // gross margin, t-1 over t
  const gT = ratio(t.grossProfit, sT), gP = ratio(p.grossProfit, sP);
  idx.gmi = gT === null || gP === null || gT <= 0 || (gT >= 0.999 && gP >= 0.999) ? null : gP / gT;
  // share of assets that are neither current nor property, t over t-1
  const aq = (y: FiscalYear) => (ok(y.currentAssets) && ok(y.netPPE) && pos(y.totalAssets) ? 1 - (y.currentAssets + y.netPPE) / y.totalAssets : null);
  const qT = aq(t), qP = aq(p);
  idx.aqi = qT === null || qP === null ? null : qP > 0.001 ? qT / qP : qT <= 0.001 ? 1 : null;
  idx.sgi = salesOk ? sT / sP : null;
  // depreciation rate = dep / (dep + net PP&E), t-1 over t
  const dr = (y: FiscalYear) => (pos(y.da) && ok(y.netPPE) && y.da + y.netPPE > 0 ? y.da / (y.da + y.netPPE) : null);
  const dT = dr(t), dP = dr(p);
  idx.depi = dT === null || dP === null ? null : dP / dT;
  idx.sgai = salesOk && pos(t.sga) && pos(p.sga) ? (t.sga / sT) / (p.sga / sP) : null;
  // (current liabilities + long-term debt) / total assets, t over t-1
  const lv = (y: FiscalYear) => { const d = ltdOf(y); return ok(y.currentLiabilities) && d !== null && pos(y.totalAssets) ? (y.currentLiabilities + d) / y.totalAssets : null; };
  const lT = lv(t), lP = lv(p);
  idx.lvgi = lT === null || lP === null || lP <= 0 ? null : lT / lP;
  idx.tata = ok(t.cfo) && pos(t.totalAssets) ? (t.netIncome - t.cfo) / t.totalAssets : null;

  const neutral: string[] = [], missing: string[] = [];
  const parts: BeneishPart[] = BENEISH.map(({ required, plain, ...b }) => {
    void plain;
    const v = idx[b.key];
    if (v !== null) return { ...b, value: v };
    if (required) { missing.push(b.key.toUpperCase()); return { ...b, value: null }; }
    neutral.push(b.key.toUpperCase());
    return { ...b, value: 1, neutral: true };
  });
  const m = missing.length ? null : -4.84 + parts.reduce((s, q) => s + (q.weight ?? 0) * (q.value as number), 0);
  return { m, parts, neutral, missing };
}

/* ---------- grading ---------- */

export function gradeFor(score: number | null): HealthGrade {
  if (score === null) return "–";
  return score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "E";
}
const TONE: Record<HealthGrade, string> = {
  A: "passes most quality and accounting screens",
  B: "looks mostly healthy",
  C: "shows a mixed picture",
  D: "looks weak on several screens",
  E: "shows serious signs of financial stress",
  "–": "",
};
/** Score weights from the brief: Piotroski 40%, Altman 20%, Beneish 15%, ratios 25%, re-weighted over what is available. */
const WEIGHTS = { piotroski: 0.4, altman: 0.2, beneish: 0.15, metrics: 0.25 };
const VERDICT_SCORE: Partial<Record<Verdict, number>> = { good: 1, ok: 0.5, bad: 0 };
/** Banks, carmakers and conglomerates often carry a lending arm's borrowings on the group balance sheet. */
const CAPTIVE_FINANCE = /auto manufacturers|conglomerates|farm & heavy construction/i;

interface Cand { p: number; text: string }

/* ---------- the report ---------- */

export function healthCheck(data: StockData): HealthReport {
  const h = data.history, n = h.length, fin = data.financial, cur = data.currency;
  const notes: string[] = [];
  const empty: HealthReport = { score: null, grade: "–", summary: "", piotroski: null, altman: null, beneish: null, metrics: [], flags: [], strengths: [], notes, years: h.map((y) => y.label), financial: fin };
  if (n < 2) {
    notes.push("The health check needs at least two years of annual accounts; fewer are available.");
    return { ...empty, summary: "Not enough history to grade: the check needs at least two years of annual accounts." };
  }
  const L = h[n - 1], P = h[n - 2], F0 = h[0];
  const span = `${F0.label}–${L.label}`;
  const flags: Cand[] = [], strengths: Cand[] = [];
  if (fin) notes.push("Banks and insurers: the Altman and Beneish screens, the current-ratio and gross-margin tests, and the debt and cash-conversion ratios are left out because loans and deposits make them misleading. Operating cash flow for a lender also swings with loans and deposits, so read the two cash tests loosely.");

  /* Piotroski */
  const pio = piotroskiAt(h, fin, cur);
  let piotroski: HealthReport["piotroski"] = null;
  if (pio && pio.max > 0) {
    const history = h.slice(0, -1).map((_, i) => (i >= 1 ? piotroskiAt(h.slice(0, i + 1), fin, cur) : null))
      .map((r, i) => (r && r.max > 0 ? { label: h[i].label, score: r.score, max: r.max } : null)).filter((x): x is NonNullable<typeof x> => x !== null);
    piotroski = { score: pio.score, max: pio.max, tests: pio.tests, history };
    if (pio.endBasis.length) notes.push(`Piotroski: ${pio.endBasis.join(", ")} use${pio.endBasis.length === 1 ? "s" : ""} year-end assets because opening assets for an earlier year are not available.`);
    if (pio.max < 7) notes.push(`Only ${pio.max} of 9 Piotroski tests could be computed, so treat the F-score as a rough guide.`);
    const share = pio.score / pio.max;
    if (pio.max >= 5 && share >= 7 / 9 - 1e-9) strengths.push({ p: 1, text: `Strong fundamentals: Piotroski F-score is ${pio.score} of ${pio.max} for ${L.label}.` });
    if (pio.max >= 5 && share <= 3 / 9 + 1e-9) flags.push({ p: 2.8, text: `Weak fundamentals: Piotroski F-score is only ${pio.score} of ${pio.max} for ${L.label}.` });
    const roaT = pio.tests.find((x) => x.key === "roa"), cfoT = pio.tests.find((x) => x.key === "cfo");
    if (roaT?.pass === false) flags.push({ p: 3, text: `Loss-making: a net loss of ${amt(L.netIncome, cur)} in ${L.label}.` });
    if (cfoT?.pass === false && ok(L.cfo)) flags.push({ p: 4, text: `Operations used cash: operating cash flow was ${amt(L.cfo, cur)} in ${L.label}.` });
  } else notes.push("Piotroski F-score: none of the nine tests could be computed from the data.");

  /* Altman Z'' */
  let altman: HealthReport["altman"] = null;
  if (fin) notes.push("Altman Z'' is not used for banks and insurers: it was built for companies whose balance sheets are not mostly loans and deposits.");
  else {
    const a = altmanZ(L);
    if (!a) notes.push(`Altman Z'' could not be computed: ${L.label} lacks ${altmanMissing(L).join(", ")}.`);
    else {
      const zone = altmanZone(a.z);
      let note = `${L.label} figures. Safe above 2.60, grey zone 1.10 to 2.60, distress below 1.10.`;
      const buybackRE = ok(L.retainedEarnings) && L.retainedEarnings < 0 && h.every((y) => y.netIncome > 0) && h.some((y) => pos(y.buybacks));
      if (buybackRE) note += " Retained earnings are negative because of large buybacks rather than losses, which pulls the score down more than the risk deserves.";
      const history = h.slice(0, -1).map((y) => ({ label: y.label, r: altmanZ(y) })).filter((x) => x.r).map((x) => ({ label: x.label, z: x.r!.z }));
      altman = { z: a.z, zone, note, parts: a.parts, history };
      const why = buybackRE ? ", partly because buybacks have made retained earnings negative" : "";
      if (zone === "distress") flags.push({ p: buybackRE ? 6 : 1, text: `Balance sheet under strain: Altman Z'' is ${s2(a.z)}, in the distress zone (below 1.10)${why}.` });
      else if (zone === "grey") flags.push({ p: 9.5, text: `Balance sheet in the grey zone: Altman Z'' is ${s2(a.z)}, between 1.10 and 2.60${why}.` });
      else strengths.push({ p: 2.5, text: `Comfortable balance sheet: Altman Z'' is ${s2(a.z)}, in the safe zone (above 2.60).` });
    }
  }

  /* Beneish M */
  let beneish: HealthReport["beneish"] = null;
  if (fin) notes.push("Beneish M-score is not used for banks and insurers: receivables, gross margin and asset quality mean something different for a lender.");
  else {
    const b = beneishM(P, L);
    if (b.m === null) notes.push(`Beneish M-score could not be computed: ${b.missing.join(", ")} need${b.missing.length === 1 ? "s" : ""} receivables, current assets, net property and equipment, total assets and operating cash flow for ${P.label} and ${L.label}.`);
    else {
      const flag = b.m > BENEISH_CUTOFF;
      let note = `${L.label} against ${P.label}. Above −1.78 the pattern resembles companies later found to have manipulated earnings; some analysts use a stricter −2.22.`;
      if (b.neutral.length) note += ` ${b.neutral.join(", ")} ${b.neutral.length === 1 ? "was" : "were"} missing and set to the neutral 1.0.`;
      const history = h.slice(1, -1).map((y, i) => ({ label: y.label, m: beneishM(h[i], y).m })).filter((x): x is { label: string; m: number } => x.m !== null);
      beneish = { m: b.m, flag, note, parts: b.parts, neutral: b.neutral, history };
      const top = b.parts.filter((q) => q.value !== null && !q.neutral && q.manipulators !== undefined && q.value >= q.manipulators && (q.weight ?? 0) > 0).map((q) => PLAIN[q.key]);
      if (flag) flags.push({ p: 1.5, text: `The accounts share traits with past earnings manipulators: Beneish M-score is ${s2(b.m)}, above the −1.78 cut-off${top.length ? `, driven by ${top.join(" and ")}` : ""}.` });
      else strengths.push({ p: 6.5, text: `The accounts don't match the manipulator pattern: Beneish M-score is ${s2(b.m)}, below the −1.78 cut-off.` });
      if (b.neutral.length >= 3) notes.push(`Beneish: ${b.neutral.join(", ")} were missing, so the M-score leans on fewer signals than usual.`);
    }
  }

  /* ratios */
  const metrics: HealthMetric[] = [];
  const add = (key: string, label: string, value: number | null, format: HealthMetric["format"], verdict: Verdict, note: string, display?: string) =>
    metrics.push({ key, label, value, format, good: verdict === "good" ? true : verdict === "bad" ? false : null, note, verdict, ...(display ? { display } : {}) });
  const ebitL = ebitOf(L), ebitF = ebitOf(F0);
  const niSum = h.reduce((s, y) => s + y.netIncome, 0);

  // shared by both kinds of company
  const roe = () => {
    if (!ok(L.equity)) return add("roe", "Return on equity", null, "pct", "na", `Shareholders' equity not reported for ${L.label}.`);
    if (L.equity <= 0) {
      flags.push({ p: 2, text: `Liabilities exceed assets: shareholders' equity is ${amt(L.equity, cur)} in ${L.label}.` });
      return add("roe", "Return on equity", null, "pct", "bad", `Shareholders' equity is negative (${amt(L.equity, cur)}), so ROE is not meaningful.`, "Negative equity");
    }
    const v = L.netIncome / L.equity, vd = v >= 0.15 ? "good" : v < 0.1 ? "bad" : "ok";
    if (vd === "good") strengths.push({ p: 3.5, text: `High return for shareholders: ROE was ${pc(v)} in ${L.label}.` });
    if (vd === "bad") flags.push({ p: 8, text: `Low return for shareholders: ROE was ${pc(v)} in ${L.label}, below 10%.` });
    add("roe", "Return on equity", v, "pct", vd, `Net profit ÷ shareholders' equity, ${L.label}. 15% or more is strong.${v > 0.5 ? " A very high figure often means buybacks or past losses have shrunk equity." : ""}`);
  };
  const splits = shareSteps(h);
  const shareChange = () => {
    const st = splits.filter((x): x is ShareStep => x !== null);
    if (!st.length) return add("shares", "Share count change", null, "pct", "na", "Diluted share counts not reported.");
    const g = Math.pow(st.reduce((s, x) => s * x.real, 1), 1 / st.length) - 1;
    const vd = g <= 0.005 ? "good" : g > 0.02 ? "bad" : "ok";
    const sp = st.filter((x) => x.split !== 1).map((x) => `${x.label} (${splitText(x.split)})`);
    if (vd === "bad") flags.push({ p: 5.5, text: `Owners are being diluted: the share count grew ${pc(g)} a year over ${span} (shares issued for a merger or to repay debt count too).` });
    if (g < -0.01) strengths.push({ p: 5.5, text: `Share count shrinking ${pc(-g)} a year, so each share owns more of the business.` });
    add("shares", "Share count change", g, "pct", vd, `Weighted diluted shares, a year, ${span}. Above 2% a year is heavy dilution; shares issued for mergers count too.${sp.length ? ` Adjusted for a likely bonus issue or split in ${sp.join(", ")}.` : ""}`, `${spc(g)} a year`);
  };
  const payout = () => {
    const reported = h.some((y) => ok(y.dividendsPaid) || ok(y.buybacks));
    if (!reported) return add("payout", "Paid out to shareholders", null, "pct", "na", "Dividends and buybacks not reported.");
    const paid = h.reduce((s, y) => s + (ok(y.dividendsPaid) ? y.dividendsPaid : 0) + (ok(y.buybacks) ? y.buybacks : 0), 0);
    if (niSum <= 0) {
      if (paid > 0.05 * Math.abs(niSum)) {
        flags.push({ p: 6.5, text: `Paying out while losing money: ${amt(paid, cur)} went to shareholders over ${span} despite combined losses.` });
        return add("payout", "Paid out to shareholders", null, "pct", "bad", `${amt(paid, cur)} paid in dividends and buybacks over ${span} despite combined losses.`, "Despite losses");
      }
      return add("payout", "Paid out to shareholders", null, "pct", "na", `Combined losses over ${span}, so a payout ratio is not meaningful.`);
    }
    const v = paid / niSum;
    add("payout", "Paid out to shareholders", v, "pct", "info", `Dividends and buybacks ÷ net profit, ${span}. Neither high nor low is good on its own: it depends on how well the company could reinvest.${v > 1 ? " Above 100% means paying out more than it earned." : ""}`);
  };
  const sbc = () => {
    if (!ok(L.sbc) || !pos(L.revenue)) return add("sbc", "Stock-based pay", null, "pct", "na", "Stock-based compensation not reported.");
    const v = L.sbc / L.revenue, vd = v <= 0.02 ? "good" : v > 0.05 ? "bad" : "ok";
    if (vd === "bad") flags.push({ p: 9, text: `Heavy stock-based pay: ${pc(v)} of revenue in ${L.label}, a hidden cost to shareholders.` });
    add("sbc", "Stock-based pay", v, "pct", vd, `Share-based pay ÷ revenue, ${L.label}. Above 5% is a large hidden cost to owners.`);
  };
  const growth = () => {
    const k = h.slice(1).filter((y, i) => y.revenue > h[i].revenue).length, poss = n - 1;
    const vd = k === poss && poss >= 2 ? "good" : k / poss < 0.5 ? "bad" : "ok";
    if (vd === "good") strengths.push({ p: 4.5, text: `Steady growth: revenue rose in each of the last ${plural(poss, "year")}.` });
    if (vd === "bad") flags.push({ p: 8.5, text: `Revenue is erratic: it grew in only ${k} of ${plural(poss, "year")} over ${span}.` });
    add("growth", "Years of revenue growth", k, "num", vd, `Years in which revenue beat the year before, ${span}.`, `${k} of ${poss}`);
  };

  if (!fin) {
    // cash conversion
    const yc = h.filter((y) => ok(y.cfo));
    if (yc.length < 2) add("cash", "Cash conversion", null, "pct", "na", "Operating cash flow not reported for at least two years.");
    else {
      const c = yc.reduce((s, y) => s + (y.cfo as number), 0), ni = yc.reduce((s, y) => s + y.netIncome, 0);
      const sp = `${yc[0].label}–${yc[yc.length - 1].label}`;
      if (ni <= 0) add("cash", "Cash conversion", null, "pct", "na", `Combined net result over ${sp} was a loss, so the ratio is not meaningful; operating cash flow totalled ${amt(c, cur)}.`);
      else {
        const v = c / ni, vd = v >= 0.9 ? "good" : v < 0.7 ? "bad" : "ok";
        if (vd === "good") strengths.push({ p: 2, text: `Profit is backed by cash: operations produced ${pc(v, 0)} of reported profit over ${plural(yc.length, "year")}.` });
        if (vd === "bad") flags.push({ p: 3.5, text: `Profit isn't turning into cash: operations produced ${pc(v, 0)} of reported profit over ${plural(yc.length, "year")}.` });
        add("cash", "Cash conversion", v, "pct", vd, `Operating cash flow ÷ net profit, ${sp}. 90% or more means profit is backed by cash.`, pc(v, 0));
      }
    }
    // profit that comes from outside the operating business
    if (ebitL !== null && L.netIncome > 0 && (ebitL <= 0 || L.netIncome > 1.2 * ebitL)) {
      flags.push({ p: 2.5, text: ebitL <= 0
        ? `Profit came from outside the core business: net profit was ${amt(L.netIncome, cur)} in ${L.label} while operations lost ${amt(-ebitL, cur)}.`
        : `Profit leans on items outside the core business: net profit of ${amt(L.netIncome, cur)} was ${pc(L.netIncome / ebitL - 1, 0)} above operating profit in ${L.label}; check for one-off gains.` });
    }
    const captive = CAPTIVE_FINANCE.test(data.industry) ? " Carmakers and conglomerates often carry a lending arm's debt here, which overstates the burden." : "";
    // ROCE
    if (ebitL === null || !pos(L.totalAssets) || !ok(L.currentLiabilities) || L.totalAssets - L.currentLiabilities <= 0) add("roce", "Return on capital (ROCE)", null, "pct", "na", `Needs operating profit, total assets and current liabilities for ${L.label}.`);
    else {
      const v = ebitL / (L.totalAssets - L.currentLiabilities), vd = v >= 0.15 ? "good" : v < 0.1 ? "bad" : "ok";
      if (vd === "good") strengths.push({ p: 3, text: `High return on capital: ROCE was ${pc(v)} in ${L.label}.` });
      if (vd === "bad") flags.push({ p: 7.5, text: `Low return on capital: ROCE was ${pc(v)} in ${L.label}, below 10%.` });
      add("roce", "Return on capital (ROCE)", v, "pct", vd, `EBIT ÷ (total assets − current liabilities), ${L.label}. 15% or more is strong.${captive ? " A lending arm's loan book inflates capital employed and pulls this down." : ""}`);
    }
    roe();
    // interest coverage
    const intr = L.interestExpense;
    const lowDebt = (ok(L.totalDebt) && L.totalDebt <= 0) || (ok(L.totalDebt) && pos(L.totalAssets) && L.totalDebt / L.totalAssets < 0.02);
    if (ebitL === null) add("cover", "Interest cover", null, "x", "na", `Operating profit not reported for ${L.label}.`);
    else if (!pos(intr)) {
      if (lowDebt) add("cover", "Interest cover", null, "x", "good", "No meaningful borrowings, so no interest to cover.", "No debt");
      else add("cover", "Interest cover", null, "x", "na", `Interest cost not reported for ${L.label}.`);
    } else {
      const v = ebitL / intr, vd = v >= 5 ? "good" : v < 2 ? "bad" : "ok";
      if (vd === "bad") flags.push({ p: 4.5, text: ebitL <= 0
        ? `Operating profit doesn't cover interest: EBIT was ${amt(ebitL, cur)} against interest of ${amt(intr, cur)} in ${L.label}.`
        : `Interest is a heavy burden: operating profit covers interest only ${xx(v)} in ${L.label}.` });
      if (vd === "good" && v >= 10) strengths.push({ p: 6, text: `Interest is easily covered: operating profit is ${v > 100 ? "more than 100" : fix(v, 0)} times interest in ${L.label}.` });
      add("cover", "Interest cover", v, "x", vd, `EBIT ÷ interest cost, ${L.label}. 5x or more is comfortable; below 2x is risky.`, v > 100 ? ">100x" : ebitL <= 0 ? "EBIT < 0" : undefined);
    }
    // net debt / EBITDA
    if (!ok(L.totalDebt) || !ok(L.cash) || ebitL === null) add("netdebt", "Net debt ÷ EBITDA", null, "x", "na", `Needs debt, cash and operating profit for ${L.label}.`);
    else {
      const nd = L.totalDebt - L.cash, ebitda = ebitL + (ok(L.da) ? L.da : 0);
      if (nd <= 0) {
        strengths.push({ p: 4, text: `Net cash: cash exceeds all borrowings by ${amt(-nd, cur)} in ${L.label}.` });
        add("netdebt", "Net debt ÷ EBITDA", ebitda > 0 ? nd / ebitda : null, "x", "good", `Cash exceeds borrowings (including leases) by ${amt(-nd, cur)}.`, "Net cash");
      } else if (ebitda <= 0) {
        flags.push({ p: 5, text: `Debt with no operating cushion: net debt of ${amt(nd, cur)} against negative EBITDA in ${L.label}.` });
        add("netdebt", "Net debt ÷ EBITDA", null, "x", "bad", `Net debt of ${amt(nd, cur)} with negative EBITDA.${captive}`, "EBITDA < 0");
      } else {
        const v = nd / ebitda, vd = v <= 1.5 ? "good" : v > 3.5 ? "bad" : "ok";
        if (vd === "bad") flags.push({ p: 5, text: `Debt is high: net debt is ${xx(v)} EBITDA in ${L.label}.${captive}` });
        if (vd === "good" && v <= 1) strengths.push({ p: 4, text: `Low debt: net debt is only ${xx(v)} EBITDA in ${L.label}.` });
        add("netdebt", "Net debt ÷ EBITDA", v, "x", vd, `(Borrowings − cash) ÷ (EBIT + D&A), ${L.label}. 1.5x or less is comfortable; above 3.5x is heavy.${captive}`);
      }
    }
    // receivable days
    const days = (y: FiscalYear) => (ok(y.receivables) && pos(y.revenue) ? (y.receivables / y.revenue) * 365 : null);
    const withDays = h.filter((y) => days(y) !== null);
    if (withDays.length < 2 || days(L) === null) add("recdays", "Receivable days", null, "days", "na", "Receivables not reported for two years.");
    else {
      const f = withDays[0], d0 = days(f)!, d1 = days(L)!, ch = d1 - d0;
      const vd = ch <= 5 ? "good" : ch > 20 ? "bad" : "ok";
      if (vd === "bad") flags.push({ p: 6, text: `Customers are paying more slowly: receivables rose from ${fix(d0, 0)} to ${fix(d1, 0)} days of sales between ${f.label} and ${L.label}.` });
      add("recdays", "Receivable days", d1, "days", vd, `Receivables ÷ revenue × 365. ${Math.abs(ch) < 1 ? `About the same as ${f.label}` : `${ch > 0 ? "Up" : "Down"} from ${fix(d0, 0)} days in ${f.label}`}; a rise of more than 20 days is a warning.`, `${fix(d1, 0)} days`);
    }
    shareChange();
    payout();
    sbc();
    growth();
    // EBIT margin trend
    if (ebitL === null || ebitF === null || !pos(L.revenue) || !pos(F0.revenue)) add("margin", "EBIT margin trend", null, "pct", "na", "Operating profit missing for the first or last year.");
    else {
      const mF = ebitF / F0.revenue, mL = ebitL / L.revenue, d = mL - mF;
      const vd = d >= 0.01 ? "good" : d <= -0.03 ? "bad" : "ok";
      if (vd === "good") strengths.push({ p: 5, text: `Margins are widening: EBIT margin rose ${fix(d * 100, 1)} points from ${F0.label} to ${L.label}.` });
      if (vd === "bad") flags.push({ p: 7, text: `Margins are shrinking: EBIT margin fell ${fix(-d * 100, 1)} points from ${F0.label} to ${L.label}.` });
      add("margin", "EBIT margin trend", d, "pct", vd, `From ${pc(mF)} in ${F0.label} to ${pc(mL)} in ${L.label}.`, `${d > 0 ? "+" : ""}${fix(d * 100, 1)} pts`);
    }
  } else {
    roe();
    // return on assets
    if (!pos(L.totalAssets)) add("roa", "Return on assets", null, "pct", "na", `Total assets not reported for ${L.label}.`);
    else {
      const v = L.netIncome / L.totalAssets, vd = v >= 0.01 ? "good" : v < 0.005 ? "bad" : "ok";
      if (vd === "good") strengths.push({ p: 3, text: `Solid profitability for a lender: return on assets was ${pc(v, 2)} in ${L.label}.` });
      if (vd === "bad") flags.push({ p: 3.5, text: `Thin profitability: return on assets was only ${pc(v, 2)} in ${L.label}.` });
      add("roa", "Return on assets", v, "pct", vd, `Net profit ÷ total assets, ${L.label}. For a bank, 1% or more is good.`, pc(v, 2));
    }
    // capital cushion
    const ea = ratio(L.equity, L.totalAssets);
    if (ea === null) add("eqassets", "Equity ÷ assets", null, "pct", "na", `Equity or total assets not reported for ${L.label}.`);
    else {
      const vd = ea >= 0.08 ? "good" : ea < 0.05 ? "bad" : "ok";
      if (vd === "good") strengths.push({ p: 4, text: `Thick capital cushion: equity is ${pc(ea)} of assets in ${L.label}.` });
      if (vd === "bad") flags.push({ p: 2.5, text: `Thin capital cushion: equity is only ${pc(ea)} of assets in ${L.label}.` });
      add("eqassets", "Equity ÷ assets", ea, "pct", vd, `How much of the balance sheet owners fund, ${L.label}. 8% or more is a solid cushion for a lender.`);
    }
    // book value per share growth (share counts adjusted for bonus issues and splits)
    const adj = h.map((y) => y.dilutedShares);
    const factor = splits.map((x) => x?.split ?? 1);
    for (let i = n - 2; i >= 0; i--) { const later = factor.slice(i).reduce((s, x) => s * x, 1); adj[i] = pos(adj[i]) ? (adj[i] as number) * later : null; }
    const perShare = pos(adj[0]) && pos(adj[n - 1]);
    const b0 = perShare ? ratio(F0.equity, adj[0]) : ok(F0.equity) ? F0.equity : null, b1 = perShare ? ratio(L.equity, adj[n - 1]) : ok(L.equity) ? L.equity : null;
    if (b0 === null || b1 === null || b0 <= 0 || b1 <= 0) add("bvgrowth", "Book value growth", null, "pct", "na", "Equity not reported or not positive in the first and last year.");
    else {
      const g = Math.pow(b1 / b0, 1 / (n - 1)) - 1, vd = g >= 0.1 ? "good" : g < 0.03 ? "bad" : "ok";
      const what = perShare ? "Book value per share" : "Shareholders' equity";
      if (vd === "good") strengths.push({ p: 5, text: `${what} grew ${pc(g)} a year over ${span}.` });
      if (vd === "bad") flags.push({ p: 6, text: `${what} is barely growing: ${pc(g)} a year over ${span}.` });
      add("bvgrowth", perShare ? "Book value per share growth" : "Book value growth", g, "pct", vd, `${what}, a year, ${span}${perShare ? ", adjusted for bonus issues and splits" : ""}. Mergers and share issues lift it too.`, `${spc(g)} a year`);
    }
    shareChange();
    payout();
    sbc();
    growth();
  }

  const gaps = metrics.filter((m) => m.verdict === "na").map((m) => m.label.toLowerCase());
  if (gaps.length) notes.push(`Not available from the data: ${gaps.join(", ")}.`);
  splits.forEach((s) => { if (s && s.split !== 1) notes.push(`${s.label}: the share count changed ${splitText(s.split)} against the year before, which looks like a bonus issue or split (or a consolidation), so it is not counted as new shares.`); });
  if (data.fxNote) notes.push(`Figures were converted from ${data.financialCurrency} to ${cur} at each year's average rate, so ratios that compare two years also move with the exchange rate.`);

  /* score */
  const parts: [number, number][] = [];
  if (piotroski) parts.push([WEIGHTS.piotroski, piotroski.score / piotroski.max]);
  if (altman) parts.push([WEIGHTS.altman, altman.zone === "safe" ? 1 : altman.zone === "grey" ? 0.5 : 0]);
  if (beneish) parts.push([WEIGHTS.beneish, beneish.flag ? 0 : 1]);
  const scored = metrics.map((m) => VERDICT_SCORE[m.verdict ?? "na"]).filter((v): v is number => v !== undefined);
  if (scored.length) parts.push([WEIGHTS.metrics, scored.reduce((s, v) => s + v, 0) / scored.length]);
  const wsum = parts.reduce((s, [w]) => s + w, 0);
  const score = wsum > 0 ? Math.round((parts.reduce((s, [w, v]) => s + w * v, 0) / wsum) * 100) : null;
  const grade = gradeFor(score);

  const pick = (c: Cand[]) => c.sort((a, b) => a.p - b.p).slice(0, 5).map((x) => x.text);
  const fl = pick(flags), st = pick(strengths);
  const headline = (s: string) => { const t = s.split(":")[0]; return t.charAt(0).toLowerCase() + t.slice(1); };
  const distress = altman?.zone === "distress" || (ok(L.equity) && L.equity <= 0);
  const tone = TONE[grade] + (distress && (grade === "C" || grade === "D") ? " and shows signs of financial distress" : "");
  const summary = grade === "–"
    ? "Not enough data to grade this company."
    : `Grade ${grade} (${score}/100): ${tone}, with ${plural(st.length, "strength")} and ${fl.length ? `${plural(fl.length, "red flag")} (top concern: ${headline(fl[0])})` : "no red flags"}.`;

  return { score, grade, summary, piotroski, altman, beneish, metrics, flags: fl, strengths: st, notes, years: h.map((y) => y.label), financial: fin };
}
