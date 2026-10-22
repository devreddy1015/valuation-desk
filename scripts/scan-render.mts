// Server-renders the scanner components with synthetic rows to catch runtime errors. Not a browser test.
// npx tsx scripts/scan-render.mts
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as M1 from "../src/components/scan/Scanner.tsx";
import * as M2 from "../src/components/scan/ScanTable.tsx";
import * as M3 from "../src/components/scan/ScanSummary.tsx";
import * as M4 from "../src/components/scan/ScanMethod.tsx";

// .tsx files load as CommonJS here, so the default export can arrive wrapped once more.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const unwrap = (m: any) => (typeof m.default === "function" ? m.default : m.default.default);
const Scanner = unwrap(M1), ScanTable = unwrap(M2), ScanSummary = unwrap(M3), ScanMethod = unwrap(M4);
import { scoreRows, sortRows, summarize } from "../src/lib/scanMath.ts";
import type { ScanRow } from "../src/lib/scanTypes.ts";

const base: ScanRow = {
  symbol: "A.NS", name: "Alpha Ltd", exchange: "NSE", country: "India", sector: "Technology", industry: "Software", currency: "INR",
  price: 1000, marketCap: 1e11, financial: false, dcfValue: 1200, wacc: 0.11, impliedGrowth: 4.1, histGrowth: 9.8, expectedReturn: 0.14,
  growthShare: 0.4, fcfYield: 0.05, pe: 20, evEbitda: 12, pb: 4, eps: 50, ebitda: 8e9, netCash: 1e9, shares: 1e8, bookValuePerShare: 250,
  health: { score: 82, grade: "A", flags: ["Receivables grew faster than sales"], strengths: ["Cash from operations beat profit"] }, warnings: [], asOf: new Date().toISOString(),
};
const rows: ScanRow[] = [
  base,
  { ...base, symbol: "B.NS", name: "Beta Ltd", pe: 15, dcfValue: null, health: { score: null, grade: "–", flags: [], strengths: [] } },
  { ...base, symbol: "C.NS", name: "Gamma & Sons", pe: 30, dcfValue: 700, expectedReturn: 0.08 },
  { ...base, symbol: "D.NS", name: "Delta", pe: 25, health: { score: 30, grade: "D", flags: [], strengths: [] } },
  { ...base, symbol: "H.NS", name: "Bank", financial: true, sector: "Financial Services", industry: "Banks", dcfValue: null, wacc: null, expectedReturn: null, impliedGrowth: null },
];
const S = sortRows(scoreRows(rows, (s) => (s === "A.NS" ? "Information Technology" : undefined)), { key: "valueGap", dir: -1 });
const universes = [{ id: "nifty50", name: "Nifty 50", description: "Test", size: 50, family: "India · broad market" as const }, { id: "dow30", name: "Dow", description: "Test", size: 30, family: "United States" as const }];

const out = [
  renderToStaticMarkup(h(Scanner, { universes })),
  renderToStaticMarkup(h(ScanSummary, { s: summarize(S) })),
  renderToStaticMarkup(h(ScanTable, { rows: S, sort: { key: "valueGap", dir: -1 }, onSort: () => {}, calls: true })),
  renderToStaticMarkup(h(ScanTable, { rows: [], sort: { key: "name", dir: 1 }, onSort: () => {}, calls: false })),
  renderToStaticMarkup(h(ScanMethod)),
];
console.log(out.map((o) => o.length).join(" bytes, ") + " bytes");
const table = out[2];
for (const needle of ['aria-sort="descending"', "/stock/C.NS", "DCF + ", "vs 11.0%", "4.1% vs 9.8%", "pill BUY", "badge ok", "1 flag", "Not enough data", "No stock matches"]) {
  console.log((table + out[3]).includes(needle) ? "  has" : "  MISSING", needle);
}
console.log(out[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 600));
console.log(out[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
console.log("\nTABLE TEXT:", table.replace(/<\/tr>/g, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " "));
