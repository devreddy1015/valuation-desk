// Reference data about markets: the benchmark index used for beta, currency units,
// and default risk-free rates. Everything here is a default the user can override.

/** Benchmark index (Yahoo symbol) for computing beta, by country name as Yahoo reports it. */
export const BENCHMARK_BY_COUNTRY: Record<string, { symbol: string; name: string }> = {
  India: { symbol: "^NSEI", name: "Nifty 50" },
  "United States": { symbol: "^GSPC", name: "S&P 500" },
  "United Kingdom": { symbol: "^FTSE", name: "FTSE 100" },
  Japan: { symbol: "^N225", name: "Nikkei 225" },
  Germany: { symbol: "^GDAXI", name: "DAX" },
  France: { symbol: "^FCHI", name: "CAC 40" },
  Netherlands: { symbol: "^AEX", name: "AEX" },
  Switzerland: { symbol: "^SSMI", name: "SMI" },
  Spain: { symbol: "^IBEX", name: "IBEX 35" },
  Italy: { symbol: "FTSEMIB.MI", name: "FTSE MIB" },
  Canada: { symbol: "^GSPTSE", name: "S&P/TSX Composite" },
  Australia: { symbol: "^AXJO", name: "S&P/ASX 200" },
  "Hong Kong": { symbol: "^HSI", name: "Hang Seng" },
  China: { symbol: "000001.SS", name: "SSE Composite" },
  Taiwan: { symbol: "^TWII", name: "TAIEX" },
  "South Korea": { symbol: "^KS11", name: "KOSPI" },
  Singapore: { symbol: "^STI", name: "Straits Times" },
  Indonesia: { symbol: "^JKSE", name: "Jakarta Composite" },
  Malaysia: { symbol: "^KLSE", name: "FTSE Bursa Malaysia KLCI" },
  Brazil: { symbol: "^BVSP", name: "Bovespa" },
  Mexico: { symbol: "^MXX", name: "IPC Mexico" },
  "South Africa": { symbol: "^J203.JO", name: "FTSE/JSE All Share" },
  Israel: { symbol: "^TA125.TA", name: "TA-125" },
  "Saudi Arabia": { symbol: "^TASI.SR", name: "Tadawul All Share" },
  Sweden: { symbol: "^OMX", name: "OMX Stockholm 30" },
  Norway: { symbol: "OBX.OL", name: "OBX" },
  Denmark: { symbol: "^OMXC25", name: "OMX Copenhagen 25" },
  Belgium: { symbol: "^BFX", name: "BEL 20" },
  "New Zealand": { symbol: "^NZ50", name: "S&P/NZX 50" },
};
export const FALLBACK_BENCHMARK = { symbol: "^GSPC", name: "S&P 500 (no local index mapped)" };

/** Quote currencies that Yahoo reports in minor units (pence, cents, agorot). */
const MINOR_UNITS: Record<string, { major: string; factor: number }> = {
  GBp: { major: "GBP", factor: 100 },
  GBX: { major: "GBP", factor: 100 },
  ZAc: { major: "ZAR", factor: 100 },
  ZAC: { major: "ZAR", factor: 100 },
  ILA: { major: "ILS", factor: 100 },
};
export function majorCurrency(code: string | undefined): { code: string; factor: number } {
  if (!code) return { code: "USD", factor: 1 };
  const m = MINOR_UNITS[code];
  return m ? { code: m.major, factor: m.factor } : { code: code.toUpperCase(), factor: 1 };
}

/**
 * Default risk-free rate (10-year government bond yield, %) by currency.
 * INR is a sourced value; USD is replaced by the live 10-year Treasury yield (^TNX) at request time.
 * Other currencies get an estimate that the page flags for the user to replace.
 */
export const RISK_FREE_SOURCED: Record<string, { rate: number; note: string }> = {
  INR: { rate: 7.437, note: "India 10-year government bond, 21 Oct 2026 (World Government Bonds; Trading Economics 7.44%)" },
};

/** Damodaran's mature-market equity risk premium (July 2026), used when a country is not in his table. */
export const MATURE_ERP = { value: 4.2, note: "Damodaran mature-market ERP, July 2026" };

/** Damodaran's July 2026 India figures, more recent than the January table the server parses. */
export const DAMODARAN_OVERRIDES: Record<string, { erp: number; defaultSpread: number; note: string }> = {
  India: { erp: 6.92, defaultSpread: 1.75, note: "Damodaran, July 2026 update" },
};

/** Banks and insurers are not suited to a free-cash-flow-to-firm DCF. */
export function isFinancialIndustry(sector?: string, industry?: string): boolean {
  const s = `${sector ?? ""} ${industry ?? ""}`.toLowerCase();
  return /bank|insurance|capital markets|credit services|mortgage|asset management|financial data|exchange|conglomerate/.test(s) && /financial/.test((sector ?? "").toLowerCase());
}
