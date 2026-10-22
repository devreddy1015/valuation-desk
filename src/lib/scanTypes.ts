// Shared contract for the opportunity scanner and the portfolio X-ray. Both pages fetch one
// ScanRow per stock from GET /api/scan/row?symbol=XYZ and do all cross-stock maths in the browser.

/** A quick valuation of one stock with the desk's default inputs and no peers. */
export interface ScanRow {
  symbol: string;
  name: string;
  exchange: string;
  country: string;
  sector: string;
  industry: string;
  currency: string; // model currency (major unit)
  price: number;
  marketCap: number;
  financial: boolean; // bank or insurer: DCF not used
  // own valuation, default inputs, base case
  dcfValue: number | null; // DCF value per share; null when not meaningful or a financial firm
  wacc: number | null; // fraction
  impliedGrowth: number | null; // percent a year from the reverse DCF
  histGrowth: number | null; // percent a year, average reported revenue growth
  expectedReturn: number | null; // fraction a year: the return at today's price if the base case comes true
  growthShare: number | null; // fraction of today's price that pays for growth beyond today's profits
  fcfYield: number | null; // year-1 free cash flow / market cap
  // raw inputs so a page can value the stock against peers inside its own list
  pe: number | null;
  evEbitda: number | null;
  pb: number | null;
  eps: number; // trailing, per share
  ebitda: number; // trailing
  netCash: number; // cash minus borrowings and leases
  shares: number;
  bookValuePerShare: number | null;
  // business health
  health: { score: number | null; grade: HealthGrade; flags: string[]; strengths: string[] };
  warnings: string[];
  asOf: string; // ISO time the row was computed
}

export type HealthGrade = "A" | "B" | "C" | "D" | "E" | "–";

export interface UniverseMember { symbol: string; name: string; group?: string }

/** A list of stocks to scan, e.g. Nifty 50 from NSE's constituent file. */
export interface Universe {
  id: string;
  name: string;
  description: string;
  source: string;
  members: UniverseMember[];
}

export interface UniverseInfo { id: string; name: string; description: string; size: number | null }
