export type ScenarioKey = "bear" | "base" | "bull";
export const SCENARIOS: ScenarioKey[] = ["bear", "base", "bull"];

/** One reported fiscal year, in the model currency (absolute units, not crore or millions). */
export interface FiscalYear {
  label: string; // e.g. "FY26" or "2025"
  end: string; // ISO date of the fiscal year end
  revenue: number;
  ebit: number;
  da: number;
  pbt: number;
  tax: number;
  capex: number; // positive = cash spent
  wcInc: number; // positive = cash used by working capital
  netIncome: number;
  // Optional lines for the health check and valuation history: null when Yahoo lacks them.
  // Every amount in a year uses that year's conversion rate, so ratios within a year are exact.
  cfo?: number | null; // cash from operations
  totalAssets?: number | null;
  currentAssets?: number | null;
  currentLiabilities?: number | null;
  totalLiabilities?: number | null; // excluding minority interest
  equity?: number | null; // shareholders' equity
  retainedEarnings?: number | null;
  longTermDebt?: number | null;
  totalDebt?: number | null;
  cash?: number | null; // cash and short-term investments
  receivables?: number | null;
  grossProfit?: number | null;
  sga?: number | null; // selling, general and administrative
  netPPE?: number | null;
  interestExpense?: number | null; // positive = cost
  dilutedShares?: number | null; // weighted average diluted shares, as reported (not split-adjusted)
  dilutedEPS?: number | null; // as reported, converted to the model currency
  dividendsPaid?: number | null; // positive = cash paid
  buybacks?: number | null; // positive = cash paid
  sbc?: number | null; // stock-based compensation
}

export interface Bridge {
  date: string; // ISO date of the balance sheet used
  cash: number; // cash, deposits and short-term investments
  borrowings: number; // debt excluding leases
  leases: number;
  nci: number;
  returned: number; // cash paid to shareholders after the balance sheet date
  returnedNote: string;
}

export interface StockData {
  symbol: string;
  name: string;
  exchange: string;
  country: string;
  sector: string;
  industry: string;
  currency: string; // model currency (major unit, e.g. GBP not GBp)
  financialCurrency: string;
  fxNote: string | null;
  price: number; // in model currency
  priceTime: string;
  marketCap: number; // as reported by the exchange feed, model currency
  shares: number;
  hi52: number;
  lo52: number;
  bookValuePerShare: number | null;
  history: FiscalYear[]; // oldest first
  bridge: Bridge;
  ttm: { revenue: number; ebitda: number; netIncome: number; eps: number };
  compsNetCash?: number; // net cash for EV-based comps, defaults to the bridge
  estimates: { growthThisYear: number | null; growthNextYear: number | null; note: string | null };
  beta: { value: number; r2: number; n: number; benchmark: string; window: string } | null;
  yahooBeta: number | null;
  riskFree: { rate: number; note: string; estimated: boolean };
  erp: { value: number; defaultSpread: number; note: string; estimated: boolean };
  financial: boolean;
  warnings: string[];
  asOf: string;
  source: string;
}

export interface PeerRow {
  symbol: string;
  name: string;
  industry: string;
  currency: string;
  marketCap: number | null;
  evEbitda: number | null;
  pe: number | null;
  evSales: number | null;
  pb: number | null;
  margin: number | null;
  growth: number | null;
}

/** Forecast drivers in percent, one value per forecast year. */
export interface Drivers {
  growth: number[];
  margin: number[];
  tax: number[];
  da: number[];
  capex: number[];
  wc: number[];
}

export interface UserInputs {
  scenario: ScenarioKey;
  assume: Record<ScenarioKey, Drivers>;
  rate: { rf: number; spread: number; beta: number; erp: number; kd: number; g: number }; // percents, beta raw
  price: number;
  dcfWeight: number; // 0-100
  buy: number; // percent upside
  sell: number;
  probs: Record<ScenarioKey, number>;
  usePW: boolean;
  mc: { g: number; m: number; w: number; t: number; seed: number };
  peers: Record<string, boolean>; // symbol -> included
}
