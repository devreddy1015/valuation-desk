// What owning the business at today's price earns if the forecast comes true, and how much of
// the price pays for growth beyond today's profits.
import type { Valuation } from "./model";
import type { FiscalYear, StockData, UserInputs } from "./types";
import { money, pct } from "./format";

export interface Returns {
  irr: number | null; // fraction a year: the discount rate at which the live-case DCF equals today's price
  wacc: number; // fraction, the required return the model uses
  ke: number; // fraction, cost of equity
  spread: number | null; // irr - wacc
  epv: number | null; // no-growth value per share: today's operating profit after tax as a perpetuity, plus the bridge
  growthShare: number | null; // 1 - epv / price, clamped to [0, 1] for display; null when epv is not meaningful
  earningsYield: number | null; // trailing EPS / price
  fcfYield: number | null; // year-1 FCF / market cap
  bondYield: number; // fraction, the risk-free rate before the country spread
  notes: string[];
  // optional extras for the display
  irrStatus?: IrrStatus;
  irrRange?: [number, number]; // the discount rates searched, fractions
  epvParts?: EpvParts | null;
  roe?: number | null; // fraction: last year's net income / average shareholders' equity
  roeYear?: string | null;
}

/** Why an expected return is or is not available. */
export type IrrStatus = "ok" | "financial" | "no-dcf" | "below-range" | "above-range";

/** The earnings power value, step by step, in the model currency (absolute units). */
export interface EpvParts { fy: string; ebit: number; tax: number; nopat: number; capitalised: number; bridge: number; shares: number }

const fin = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const IRR_MAX = 0.6;

/**
 * Root of f on [lo, hi]: scan 60 steps upward for the first sign change, then bisect inside it.
 * The same finder as the reverse DCF in model.ts (value need not be monotonic in the input).
 */
export function solveRoot(f: (x: number) => number, lo: number, hi: number): number {
  const steps = 60, dx = (hi - lo) / steps;
  let a = NaN, b = NaN, fa = NaN, fb = NaN;
  let px = lo, pf = f(lo);
  for (let i = 1; i <= steps; i++) {
    const x = lo + i * dx, fx = f(x);
    if (fin(pf) && fin(fx) && pf * fx <= 0) { a = px; b = x; fa = pf; fb = fx; break; }
    px = x; pf = fx;
  }
  if (!fin(a) || !fin(fa) || !fin(fb)) return NaN;
  for (let i = 0; i < 80; i++) {
    const m = (a + b) / 2, fm = f(m);
    if (!fin(fm)) return NaN;
    if (fa * fm <= 0) { b = m; fb = fm; } else { a = m; fa = fm; }
  }
  return (a + b) / 2;
}

/** Return on equity for the last reported year: net income / average of opening and closing equity. */
export function lastRoe(history: FiscalYear[]): { roe: number | null; fy: string | null } {
  const last = history[history.length - 1], prev = history[history.length - 2];
  if (!last || !fin(last.equity) || last.equity <= 0) return { roe: null, fy: last?.label ?? null };
  const avgEq = prev && fin(prev.equity) && prev.equity > 0 ? (prev.equity + last.equity) / 2 : last.equity;
  return { roe: fin(last.netIncome) ? last.netIncome / avgEq : null, fy: last.label };
}

export function returnsFor(inp: UserInputs, data: StockData, R: Valuation): Returns {
  const price = inp.price, cur = data.currency, notes: string[] = [];
  const okPrice = fin(price) && price > 0;
  const live = inp.assume[inp.scenario];
  const bondYield = fin(inp.rate.rf) ? inp.rate.rf / 100 : NaN;
  const { roe, fy: roeYear } = lastRoe(data.history);

  // Expected return: the discount rate that makes the live-case DCF equal today's price.
  let irr: number | null = null, irrStatus: IrrStatus = "ok";
  const lo = R.g + 0.0025, hi = IRR_MAX;
  if (data.financial) irrStatus = "financial";
  else if (!R.dcfOk || !okPrice || !(hi > lo)) irrStatus = "no-dcf";
  else {
    const f = (r: number) => R.dcf(live, r, R.g).vps - price;
    const x = solveRoot(f, lo, hi);
    if (fin(x)) irr = x;
    else irrStatus = f(lo) < 0 ? "below-range" : f(hi) > 0 ? "above-range" : "no-dcf";
  }
  const spread = irr !== null && fin(R.wacc) ? irr - R.wacc : null;
  if (irr !== null) notes.push(`If your ${inp.scenario} case and ${pct(R.g)} terminal growth come true, the whole business returns about ${pct(irr)} a year at today's price, against the ${pct(R.wacc)} the model requires (the WACC).`);
  else if (irrStatus === "financial") notes.push("Expected return is not shown for financial firms: it rests on a free-cash-flow DCF, which does not suit a lender, an insurer or a holding company.");
  else if (irrStatus === "below-range") notes.push(`Even at a required return just above terminal growth (${pct(lo)}), your ${inp.scenario} case is worth less than today's price, so the price asks for more than this forecast.`);
  else if (irrStatus === "above-range") notes.push(`Your ${inp.scenario} case would return more than ${pct(hi, 0)} a year at today's price; a result that high usually means the forecast or the data needs a second look.`);
  else notes.push("No expected return: the DCF does not give a usable value with these inputs.");

  // Earnings power value (Greenwald, simplified): last year's EBIT after tax as a flat perpetuity.
  // Treats depreciation as the capex needed to stand still, so no reinvestment is deducted.
  const last = data.history[data.history.length - 1];
  const tax = fin(live?.tax?.[0]) ? live.tax[0] / 100 : NaN;
  let epv: number | null = null, epvParts: EpvParts | null = null;
  if (!data.financial && last && fin(last.ebit) && last.ebit > 0 && fin(tax) && fin(R.wacc) && R.wacc > 0 && data.shares > 0 && fin(R.bridge)) {
    const nopat = last.ebit * (1 - tax), capitalised = nopat / R.wacc;
    epv = (capitalised + R.bridge) / data.shares;
    epvParts = { fy: last.label, ebit: last.ebit, tax, nopat, capitalised, bridge: R.bridge, shares: data.shares };
  }
  let growthShare: number | null = null;
  if (epv !== null && okPrice) {
    growthShare = epv >= price ? 0 : clamp(1 - epv / price, 0, 1);
    if (epv >= price) notes.push(`Today's profits alone cover the price: ${last.label} operating profit after tax, held flat for ever, is worth ${money(epv, cur)} a share against a price of ${money(price, cur)}.`);
    else if (epv <= 0) notes.push(`${last.label} operating profit after tax, held flat for ever, does not cover the debt and other claims, so all of today's price rests on growth or a recovery.`);
    else notes.push(`About ${pct(growthShare, 0)} of today's price pays for growth: with no growth at all, ${last.label} operating profit after tax is worth ${money(epv, cur)} a share.`);
  } else if (data.financial) notes.push("Earnings power value is not shown for financial firms, for the same reason as the expected return.");
  else if (last && !(last.ebit > 0)) notes.push(`${last.label} had no operating profit, so there is no earnings power value: the whole price rests on a recovery or growth.`);

  const earningsYield = okPrice && fin(data.ttm.eps) ? data.ttm.eps / price : null;
  if (earningsYield !== null && fin(bondYield)) notes.push(`Earnings yield is ${pct(earningsYield)} (trailing earnings per share divided by the price), against ${pct(bondYield)} on a 10-year government bond.`);
  const fcfYield = !data.financial && fin(R.fcfYield) ? R.fcfYield : null;
  if (fcfYield !== null) notes.push(`Free cash flow yield is ${pct(fcfYield)}: ${R.fyLabels[0]} forecast free cash flow divided by the market value at today's price.`);

  return {
    irr, wacc: R.wacc, ke: R.ke, spread, epv, growthShare, earningsYield, fcfYield, bondYield, notes,
    irrStatus, irrRange: [lo, hi], epvParts, roe, roeYear,
  };
}
