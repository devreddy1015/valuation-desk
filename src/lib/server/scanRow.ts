import "server-only";
import { cached, MIN } from "./cache";
import { getStockData } from "./yahoo";
import { compute, defaultInputs } from "../model";
import { healthCheck, type HealthReport } from "../quality";
import { returnsFor, type Returns } from "../returns";
import type { ScanRow } from "../scanTypes";
import type { StockData } from "../types";

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const orNull = (x: unknown) => (fin(x) ? x : null);
const pos = (x: unknown) => (fin(x) && x > 0 ? x : null);
const orZero = (x: unknown) => (fin(x) ? x : 0);

/**
 * One stock valued the way the desk opens it: default inputs, base case, no peers (the scanner
 * values peers inside its own list). Financial firms (lenders, insurers, holding companies) get no DCF-based figures, because a
 * free-cash-flow DCF does not describe a lender. Throws DataError when the data is missing.
 */
export function scanRowFrom(data: StockData, now: number): ScanRow {
  const inp = defaultInputs(data, []);
  const R = compute(inp, data, [], now);
  const notes: string[] = [];
  let ret: Returns | null = null, h: HealthReport | null = null;
  try { ret = returnsFor(inp, data, R); } catch { notes.push("The expected-return calculation failed for this stock."); }
  try { h = healthCheck(data); } catch { notes.push("The business health check failed for this stock."); }
  const dcfLike = !data.financial;
  const dcfOk = dcfLike && R.dcfOk;
  if (dcfLike && !dcfOk) notes.push("With default inputs the DCF gives no positive value, so the scanner values this stock on peers only.");
  const B = data.bridge;
  return {
    symbol: data.symbol, name: data.name, exchange: data.exchange, country: data.country, sector: data.sector, industry: data.industry,
    currency: data.currency, price: data.price, marketCap: orZero(data.marketCap), financial: data.financial,
    dcfValue: dcfOk ? orNull(R.live.vps) : null,
    wacc: dcfLike ? orNull(R.wacc) : null,
    impliedGrowth: dcfLike ? orNull(R.impliedGrowth) : null,
    // above 100% a year the average says more about a tiny first year or an acquisition than about the business
    histGrowth: fin(R.H.growth) && Math.abs(R.H.growth) <= 1 ? R.H.growth * 100 : null,
    expectedReturn: dcfLike ? orNull(ret?.irr) : null,
    growthShare: dcfLike ? orNull(ret?.growthShare) : null,
    fcfYield: dcfLike ? orNull(R.fcfYield) : null,
    pe: pos(R.subject.pe),
    evEbitda: dcfLike ? pos(R.subject.evE) : null,
    pb: pos(R.subject.pb),
    eps: orZero(data.ttm.eps),
    ebitda: orZero(data.ttm.ebitda),
    netCash: orZero(data.compsNetCash ?? B.cash - B.borrowings - B.leases - B.nci),
    shares: orZero(data.shares),
    bookValuePerShare: orNull(data.bookValuePerShare),
    health: h ? { score: orNull(h.score), grade: h.grade, flags: h.flags, strengths: h.strengths } : { score: null, grade: "–", flags: [], strengths: [] },
    warnings: [...data.warnings, ...notes],
    asOf: new Date(now).toISOString(),
  };
}

/** The scan row for a symbol, cached for 15 minutes like the stock data it comes from. */
export function getScanRow(symbol: string): Promise<ScanRow> {
  const sym = symbol.trim().toUpperCase();
  return cached("scanrow:" + sym, 15 * MIN, async () => scanRowFrom(await getStockData(sym), Date.now()));
}
