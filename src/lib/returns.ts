// What buying at today's price earns if the forecast comes true, and how much of the price
// pays for growth. STUB: the contract below is fixed; the implementation is being written.
import type { Valuation } from "./model";
import type { StockData, UserInputs } from "./types";

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
}

export function returnsFor(inp: UserInputs, data: StockData, R: Valuation): Returns {
  void inp; void data;
  return { irr: null, wacc: R.wacc, ke: R.ke, spread: null, epv: null, growthShare: null, earningsYield: null, fcfYield: null, bondYield: 0, notes: [] };
}
