// Excel export: the valuation rebuilt as a working model with live formulas, one tab per step,
// in the house style of a sell-side workbook (blue inputs, black formulas, green links). Every
// formula cell also carries the engine's result, so the file reads correctly before Excel
// recalculates; fullCalcOnLoad makes Excel recompute everything on open anyway.
// Only pre-365 functions are used (no FILTER, LET, LAMBDA or dynamic arrays).
import ExcelJS from "exceljs";
import { bigUnit, dateLabel } from "./format";
import { FORECAST_YEARS, type DcfOut, type Valuation } from "./model";
import type { Drivers, PeerRow, ScenarioKey, StockData, UserInputs } from "./types";
import { SCENARIOS } from "./types";

export interface WorkbookOptions {
  /** Add the BUY/HOLD/SELL row (off unless the user turned calls on). */
  calls?: boolean;
  /** Link back to the stock page, shown on the Start tab. */
  link?: string;
}

type Res = number | string | boolean | Date | ExcelJS.CellErrorValue;
type Kind = "in" | "f" | "link";

const BLUE = "FF0000FF", GREEN = "FF008000", BLACK = "FF000000", GREY = "FF5F6878";
const INPUT_FILL = "FFFFF7D6", HEAD_FILL = "FFEEF1F6";
const NA: ExcelJS.CellErrorValue = { error: "#N/A" };
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
/** Result of a formula that yields #N/A when the engine has no number. */
const n = (x: number): Res => (fin(x) ? x : NA);
/** Result of a formula that yields the text "n/a" when the engine has no number. */
const t = (x: number): Res => (fin(x) ? x : "n/a");
const pc = (x: number) => x / 100;

/** Column letter for a 1-based index. */
export function colName(c: number): string {
  let s = "";
  for (let k = c; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}
const at = (c: number, r: number) => colName(c) + r;
const ab = (c: number, r: number) => `$${colName(c)}$${r}`;

const PCT = "0.0%", PCT2 = "0.00%", MULT = '0.0"x"', DF = "0.0000", T = "0.00", BETA = "0.00", DATE = "dd mmm yyyy";

function currencySymbol(cur: string): string {
  try {
    const p = new Intl.NumberFormat(cur === "INR" ? "en-IN" : "en-US", { style: "currency", currency: cur }).formatToParts(1).find((x) => x.type === "currency");
    return p?.value ?? cur;
  } catch {
    return cur;
  }
}
/** Per-share number format with the currency symbol, e.g. "₹"#,##0.00. */
function shareFmt(cur: string): string {
  const s = currencySymbol(cur).replace(/"/g, "");
  const q = `"${s}${/^[A-Za-z]+$/.test(s) ? " " : ""}"`;
  return `${q}#,##0.00;-${q}#,##0.00`;
}

/** A worksheet with small helpers for the three kinds of cell. */
class Sheet {
  constructor(readonly ws: ExcelJS.Worksheet, readonly name: string) {}
  ref(addr: string) { return `${this.name}!${addr}`; }
  private style(addr: string, kind: Kind, fmt?: string) {
    const c = this.ws.getCell(addr);
    c.font = { color: { argb: kind === "in" ? BLUE : kind === "link" ? GREEN : BLACK } };
    if (kind === "in") c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT_FILL } };
    if (fmt) c.numFmt = fmt;
    return c;
  }
  /** A typed value the user can change (blue). */
  input(addr: string, v: number | string | Date | null, fmt?: string) {
    const c = this.style(addr, "in", fmt);
    c.value = v === null || (typeof v === "number" && !Number.isFinite(v)) ? "n/a" : v;
    return c;
  }
  /** A formula with its cached result. Pure links to another tab and scenario picks are green. */
  f(addr: string, formula: string, result: Res, fmt?: string) {
    const link = /^[A-Za-z]+!\$?[A-Z]{1,3}\$?\d+$/.test(formula) || formula.startsWith("CHOOSE(");
    const c = this.style(addr, link ? "link" : "f", fmt);
    c.value = { formula, result };
    return c;
  }
  text(addr: string, v: string, o: { bold?: boolean; size?: number; note?: boolean; wrap?: boolean; color?: string } = {}) {
    const c = this.ws.getCell(addr);
    c.value = v;
    c.font = { bold: o.bold, size: o.size, italic: o.note, color: { argb: o.color ?? (o.note ? GREY : BLACK) } };
    if (o.wrap) c.alignment = { wrapText: true, vertical: "top" };
    return c;
  }
  title(addr: string, v: string) { return this.text(addr, v, { bold: true, size: 14 }); }
  /** A section header across columns B..last. */
  head(row: number, cells: string[], lastCol = Math.max(8, cells.length + 1)) {
    for (let c = 2; c <= lastCol; c++) {
      const cell = this.ws.getCell(row, c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
      cell.font = { bold: true };
      cell.border = { bottom: { style: "thin", color: { argb: "FFC9CFD9" } } };
      if (cells[c - 2] !== undefined) { cell.value = cells[c - 2]; if (c > 2) cell.alignment = { horizontal: "right" }; }
    }
  }
}

const DRIVER_ROWS: { key: keyof Drivers; label: string }[] = [
  { key: "growth", label: "Revenue growth" },
  { key: "margin", label: "EBIT margin" },
  { key: "tax", label: "Tax rate" },
  { key: "da", label: "D&A, % of revenue" },
  { key: "capex", label: "Capex, % of revenue" },
  { key: "wc", label: "Working capital, % of revenue change" },
];

function addYearsUTC(iso: string, k: number): Date {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear() + k, d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Builds the .xlsx: Start, Inputs, Reported, DCF, Scenarios, Sensitivity, Peers, Summary.
 * `R` must be compute(inputs, data, peers, valDate); amounts are written in bigUnit (crore for INR).
 */
export async function buildWorkbook(data: StockData, inputs: UserInputs, peers: PeerRow[], R: Valuation, valDate: number, opts: WorkbookOptions = {}): Promise<Buffer> {
  const cur = data.currency, u = bigUnit(cur), D = u.div;
  const H = data.history, nY = H.length, last = H[nY - 1];
  const PS = shareFmt(cur);
  const AM = Math.abs(last.revenue / D) >= 1000 ? "#,##0;(#,##0)" : "#,##0.0;(#,##0.0)";
  const unitShares = cur === "INR" ? "crore" : u.label.replace(/^\S+ /, "");
  const calls = !!opts.calls;
  const valueLabel = calls ? "Price target" : "Value estimate";
  const live = inputs.assume[inputs.scenario];
  const allPeers = R.peers.length || !peers.length ? R.peers : peers.map((p) => ({ ...p, included: inputs.peers[p.symbol] !== false }));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Valuation Desk";
  wb.created = new Date(valDate);
  wb.title = `${data.name} (${data.symbol}) valuation`;
  wb.calcProperties.fullCalcOnLoad = true;
  const mk = (name: string, widths: number[], freeze = 0, tab?: string) => {
    const ws = wb.addWorksheet(name, { views: [freeze ? { state: "frozen", xSplit: freeze, ySplit: 0 } : { state: "normal" }], properties: tab ? { tabColor: { argb: tab } } : undefined });
    ws.columns = widths.map((width) => ({ width }));
    ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    return new Sheet(ws, name);
  };
  const st = mk("Start", [2, 30, 70, 12]);
  const ip = mk("Inputs", [2, 44, 13, 12, 12, 12, 12, 12], 2, "FF2348D6");
  const hs = mk("Reported", [2, 40, ...Array(nY).fill(13), 13], 2);
  const dc = mk("DCF", [2, 46, 14, 13, 13, 13, 13, 13], 2);
  const sc = mk("Scenarios", [2, 46, 14, 13, 13, 13, 13, 13], 2);
  const se = mk("Sensitivity", [2, 30, 13, 13, 13, 13, 13]);
  const pr = mk("Peers", [2, 44, 14, 13, 13, 13, 13, 3, 13, 13, 13, 13], 2);
  const sm = mk("Summary", [2, 52, 16, 60]);

  // ---------- History: reported years, ratios as formulas ----------
  const yc = (i: number) => 3 + i, avgC = 3 + nY, lastC = yc(nY - 1);
  const HR = { end: 5, rev: 6, ebit: 7, da: 8, pbt: 9, tax: 10, capex: 11, wc: 12, ni: 13, cfo: 14, growth: 17, margin: 18, taxRate: 19, daPct: 20, capexPct: 21, wcPct: 22, net: 23, conv: 24, cash: 27, borr: 28, lease: 29, nci: 30, ret: 31, ttmRev: 34, ttmEbitda: 35, ttmNi: 36, eps: 37, bvps: 38, mcap: 39, netCash: 40 };
  hs.title("B1", `Reported history, ${u.label}`);
  hs.text("B2", `As reported, from ${data.source}. Each year's amounts use that year's exchange rate where conversion was needed.`, { note: true });
  hs.head(4, ["Line", ...H.map((y) => y.label), "Average"], avgC);
  const lines: [number, string, (y: (typeof H)[number]) => number | null | undefined][] = [
    [HR.rev, "Revenue", (y) => y.revenue], [HR.ebit, "EBIT (operating profit)", (y) => y.ebit], [HR.da, "Depreciation and amortisation (D&A)", (y) => y.da],
    [HR.pbt, "Profit before tax", (y) => y.pbt], [HR.tax, "Tax", (y) => y.tax], [HR.capex, "Capex (cash spent)", (y) => y.capex],
    [HR.wc, "Increase in working capital (cash used)", (y) => y.wcInc], [HR.ni, "Net income", (y) => y.netIncome], [HR.cfo, "Cash from operations", (y) => y.cfo],
  ];
  hs.text(at(2, HR.end), "Fiscal year end");
  H.forEach((y, i) => hs.input(at(yc(i), HR.end), new Date(y.end), DATE));
  for (const [r, label, get] of lines) {
    hs.text(at(2, r), label);
    H.forEach((y, i) => { const v = get(y); hs.input(at(yc(i), r), fin(v) ? v / D : null, AM); });
  }
  hs.head(16, ["Ratios (formulas)"], avgC);
  const ratio = (r: number, label: string, from: number, cell: (c: number) => string, val: (i: number) => number | null, fmt = PCT, avg?: { formula: string; result: number }) => {
    hs.text(at(2, r), label);
    const vals: number[] = [];
    for (let i = from; i < nY; i++) {
      const v = val(i);
      if (fin(v)) vals.push(v);
      hs.f(at(yc(i), r), cell(yc(i)), fin(v) ? v : "", fmt);
    }
    const mean = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : NaN;
    if (avg) hs.f(at(avgC, r), avg.formula, t(avg.result), fmt);
    else hs.f(at(avgC, r), `IFERROR(AVERAGE(${at(yc(0), r)}:${at(lastC, r)}),"n/a")`, t(mean), fmt);
  };
  const P = (c: number, r: number) => at(c - 1, r), Q = at;
  ratio(HR.growth, "Revenue growth", 1, (c) => `IF(${P(c, HR.rev)}>0,${Q(c, HR.rev)}/${P(c, HR.rev)}-1,"")`, (i) => (H[i - 1].revenue > 0 ? H[i].revenue / H[i - 1].revenue - 1 : null));
  ratio(HR.margin, "EBIT margin", 0, (c) => `IF(${Q(c, HR.rev)}>0,${Q(c, HR.ebit)}/${Q(c, HR.rev)},"")`, (i) => (H[i].revenue > 0 ? H[i].ebit / H[i].revenue : null));
  ratio(HR.taxRate, "Tax rate (tax ÷ profit before tax)", 0, (c) => `IF(${Q(c, HR.pbt)}>0,${Q(c, HR.tax)}/${Q(c, HR.pbt)},"")`, (i) => (H[i].pbt > 0 ? H[i].tax / H[i].pbt : null));
  ratio(HR.daPct, "D&A, % of revenue", 0, (c) => `IF(${Q(c, HR.rev)}>0,${Q(c, HR.da)}/${Q(c, HR.rev)},"")`, (i) => (H[i].revenue > 0 ? H[i].da / H[i].revenue : null));
  ratio(HR.capexPct, "Capex, % of revenue", 0, (c) => `IF(${Q(c, HR.rev)}>0,${Q(c, HR.capex)}/${Q(c, HR.rev)},"")`, (i) => (H[i].revenue > 0 ? H[i].capex / H[i].revenue : null));
  // the average is pooled (total working capital ÷ total revenue change) over years with 3%+ growth, as in the model
  const revT = `${at(yc(1), HR.rev)}:${at(lastC, HR.rev)}`, revP = `${at(yc(0), HR.rev)}:${at(lastC - 1, HR.rev)}`, wcT = `${at(yc(1), HR.wc)}:${at(lastC, HR.wc)}`;
  const grew = `((${revT})-(${revP})>=0.03*(${revP}))*((${revP})>0)`;
  ratio(HR.wcPct, "Working capital, % of revenue change (average pooled over years with 3%+ growth)", 1, (c) => `IF(${Q(c, HR.rev)}-${P(c, HR.rev)}>0,${Q(c, HR.wc)}/(${Q(c, HR.rev)}-${P(c, HR.rev)}),"")`, (i) => (H[i].revenue - H[i - 1].revenue > 0 ? H[i].wcInc / (H[i].revenue - H[i - 1].revenue) : null), PCT,
    { formula: `IFERROR(SUMPRODUCT(${grew}*(${wcT}))/SUMPRODUCT(${grew}*((${revT})-(${revP}))),"n/a")`, result: R.H.wc });
  ratio(HR.net, "Net margin", 0, (c) => `IF(${Q(c, HR.rev)}>0,${Q(c, HR.ni)}/${Q(c, HR.rev)},"")`, (i) => (H[i].revenue > 0 ? H[i].netIncome / H[i].revenue : null));
  ratio(HR.conv, "Cash conversion (cash from operations ÷ net income)", 0, (c) => `IF(AND(ISNUMBER(${Q(c, HR.cfo)}),${Q(c, HR.ni)}>0),${Q(c, HR.cfo)}/${Q(c, HR.ni)},"")`, (i) => (fin(H[i].cfo) && H[i].netIncome > 0 ? (H[i].cfo as number) / H[i].netIncome : null), "0.00");
  hs.head(26, [`Balance sheet bridge, ${dateLabel(data.bridge.date)}`], avgC);
  const B = data.bridge;
  ([[HR.cash, "Cash and short-term investments", B.cash], [HR.borr, "Borrowings (debt excluding leases)", B.borrowings], [HR.lease, "Lease liabilities", B.leases], [HR.nci, "Minority interests", B.nci], [HR.ret, "Dividends paid since the balance sheet", B.returned]] as const)
    .forEach(([r, label, v]) => { hs.text(at(2, r), label); hs.input(at(3, r), v / D, AM); });
  hs.text(at(4, HR.ret), B.returnedNote, { note: true });
  hs.head(33, ["Latest twelve months, per share and market"], avgC);
  ([[HR.ttmRev, "Revenue, trailing 12 months", data.ttm.revenue / D, AM], [HR.ttmEbitda, "EBITDA, trailing 12 months", data.ttm.ebitda / D, AM], [HR.ttmNi, "Net income, trailing 12 months", data.ttm.netIncome / D, AM],
    [HR.eps, `Earnings per share, trailing 12 months (${cur})`, data.ttm.eps, PS], [HR.bvps, `Book value per share (${cur})`, data.bookValuePerShare, PS], [HR.mcap, "Market cap as reported by the exchange feed", data.marketCap / D, AM]] as const)
    .forEach(([r, label, v, fmt]) => { hs.text(at(2, r), label); hs.input(at(3, r), v, fmt); });
  hs.text(at(2, HR.netCash), "Net cash used for EV multiples (cash − borrowings − leases − minority interests)");
  const netCash = data.compsNetCash ?? B.cash - B.borrowings - B.leases - B.nci;
  if (data.compsNetCash !== undefined) { hs.input(at(3, HR.netCash), data.compsNetCash / D, AM); hs.text(at(4, HR.netCash), "from the latest quarterly balance sheet", { note: true }); }
  else hs.f(at(3, HR.netCash), `${at(3, HR.cash)}-${at(3, HR.borr)}-${at(3, HR.lease)}-${at(3, HR.nci)}`, netCash / D, AM);
  if (data.fxNote) hs.text("B42", data.fxNote, { note: true });
  const hRef = (c: number, r: number) => hs.ref(ab(c, r));

  // ---------- Inputs ----------
  const I = { price: 5, shares: 6, rf: 9, spread: 10, beta: 11, erp: 12, kd: 13, g: 14, w: 17, buy: 18, sell: 19, usePW: 20, scen: 23, scenNo: 24, names: 26, probs: 27, years: 29 };
  const BLOCK: Record<ScenarioKey, number> = { bear: 31, base: 39, bull: 47 };
  const iRef = (r: number, c = 3) => ip.ref(ab(c, r));
  const yearsDrivers = (k: ScenarioKey, d: number, y: number) => ip.ref(at(4 + y, BLOCK[k] + d));
  ip.title("B1", "Inputs");
  ip.text("B2", "Blue cells are typed values: change any of them and every other tab recalculates.", { note: true });
  ip.head(4, ["Market data"]);
  ip.text(at(2, I.price), `Share price (${cur})`); ip.input(at(3, I.price), inputs.price, PS);
  ip.text(at(4, I.price), inputs.price === data.price ? `Yahoo Finance, ${dateLabel(data.priceTime)} (delayed)` : `your price; Yahoo showed ${data.price} on ${dateLabel(data.priceTime)}`, { note: true });
  ip.text(at(2, I.shares), `Shares outstanding (${unitShares})`); ip.input(at(3, I.shares), data.shares / D, "#,##0.000");
  ip.text(at(4, I.shares), `${data.shares.toLocaleString("en-US")} shares`, { note: true });
  ip.head(8, ["Discount rate (WACC build)"]);
  const rateRows: [number, string, number, string, string][] = [
    [I.rf, `${cur} 10-year government bond yield`, pc(inputs.rate.rf), PCT2, data.riskFree.note + (data.riskFree.estimated ? " (an estimate: replace it)" : "")],
    [I.spread, "Less: country default spread", pc(inputs.rate.spread), PCT2, cur === "INR" ? "Damodaran; the Indian bond yield carries some default risk" : "0 when the bond above is default-free"],
    [I.beta, "Beta", inputs.rate.beta, BETA, data.beta ? `${data.beta.window} vs ${data.beta.benchmark}: ${data.beta.value.toFixed(2)} (R² ${data.beta.r2.toFixed(2)})` : `Yahoo beta: ${data.yahooBeta ?? "n/a"}`],
    [I.erp, "Equity risk premium", pc(inputs.rate.erp), PCT2, data.erp.note],
    [I.kd, "Pre-tax cost of debt", pc(inputs.rate.kd), PCT2, "starter: bond yield + 1.5 points"],
    [I.g, "Terminal growth g (must stay below WACC)", pc(inputs.rate.g), PCT2, "long-run growth of free cash flow after year 5"],
  ];
  for (const [r, label, v, fmt, note] of rateRows) { ip.text(at(2, r), label); ip.input(at(3, r), v, fmt); ip.text(at(4, r), note, { note: true }); }
  ip.head(16, ["Result rules"]);
  ip.text(at(2, I.w), "DCF weight in the value estimate"); ip.input(at(3, I.w), pc(inputs.dcfWeight), "0%"); ip.text(at(4, I.w), data.financial ? "0% for a financial firm: peers get the rest" : "peers get the rest", { note: true });
  ip.text(at(2, I.buy), "BUY if upside is above"); ip.input(at(3, I.buy), pc(inputs.buy), PCT);
  ip.text(at(2, I.sell), "SELL if upside is below"); ip.input(at(3, I.sell), pc(inputs.sell), PCT);
  ip.text(at(4, I.buy), calls ? "thresholds for the model call on Summary" : "used only when calls are on in Valuation Desk", { note: true });
  ip.text(at(2, I.usePW), "Use the probability-weighted DCF (yes or no)"); ip.input(at(3, I.usePW), inputs.usePW ? "yes" : "no");
  ip.ws.getCell(at(3, I.usePW)).dataValidation = { type: "list", allowBlank: false, formulae: ['"yes,no"'], showErrorMessage: true, errorTitle: "yes or no", error: "Type yes or no." };
  ip.head(22, ["Scenario"]);
  ip.text(at(2, I.scen), "Live scenario: pick bear, base or bull"); ip.input(at(3, I.scen), inputs.scenario);
  ip.ws.getCell(at(3, I.scen)).dataValidation = { type: "list", allowBlank: false, formulae: ['"bear,base,bull"'], showErrorMessage: true, errorTitle: "Pick a scenario", error: "Choose bear, base or bull." };
  ip.text(at(4, I.scen), "the DCF tab follows this choice", { note: true });
  ip.text(at(2, I.scenNo), "Scenario number (1 bear, 2 base, 3 bull)");
  ip.f(at(3, I.scenNo), `MATCH(${at(3, I.scen)},${at(4, I.names)}:${at(6, I.names)},0)`, SCENARIOS.indexOf(inputs.scenario) + 1, "0");
  ip.text(at(2, I.names), "Scenario");
  SCENARIOS.forEach((k, i) => { ip.text(at(4 + i, I.names), k, { bold: true }); ip.ws.getCell(at(4 + i, I.names)).alignment = { horizontal: "right" }; ip.input(at(4 + i, I.probs), pc(inputs.probs[k]), "0%"); });
  ip.text(at(2, I.probs), "Probability of each scenario");
  ip.head(I.years, ["Forecast drivers", "History avg", ...R.fyLabels]);
  const histAvgRow: Record<keyof Drivers, number> = { growth: HR.growth, margin: HR.margin, tax: HR.taxRate, da: HR.daPct, capex: HR.capexPct, wc: HR.wcPct };
  const histAvgVal: Record<keyof Drivers, number> = { growth: R.H.growth, margin: R.H.margin, tax: R.H.tax, da: R.H.da, capex: R.H.capex, wc: R.H.wc };
  for (const k of SCENARIOS) {
    ip.text(at(2, BLOCK[k] - 1), `${k[0].toUpperCase() + k.slice(1)} case`, { bold: true });
    DRIVER_ROWS.forEach((d, j) => {
      const r = BLOCK[k] + j;
      ip.text(at(2, r), d.label);
      ip.f(at(3, r), hRef(avgC, histAvgRow[d.key]), t(histAvgVal[d.key]), PCT);
      inputs.assume[k][d.key].forEach((v, y) => ip.input(at(4 + y, r), pc(v), PCT));
    });
  }
  ip.text("B54", data.estimates.note ?? "No usable consensus estimate: the first forecast years start from history.", { note: true });

  // ---------- DCF ----------
  const DR = { rf: 6, ke: 7, mcap: 8, debt: 9, we: 10, kd: 11, tax1: 12, kdAT: 13, wacc: 14, g: 15, head: 17, end: 18, t: 19, drv: 20, rev: 27, ebit: 28, nopat: 29, da: 30, capex: 31, wcInc: 32, fcf: 33, df: 34, pv: 35, sumPv: 38, tv: 39, pvTv: 40, ev: 41, tvShare: 42, cash: 43, borr: 44, lease: 45, nci: 46, ret: 47, bridge: 48, equity: 49, shares: 50, vps: 51 };
  const F = (y: number) => 4 + y; // forecast year column, y = 0..4
  const dRef = (c: number, r: number) => dc.ref(ab(c, r));
  const L = R.live;
  dc.title("B1", "DCF: free cash flow to the firm");
  dc.f("B2", `"Live scenario: "&${iRef(I.scen)}&" case"`, `Live scenario: ${inputs.scenario} case`);
  dc.text("B3", `Amounts in ${u.label}; per-share values in ${cur}. Change the live scenario on the Inputs tab.`, { note: true });
  dc.head(5, ["Cost of capital (WACC)"]);
  const debt = B.borrowings + B.leases;
  const wrow = (r: number, label: string, formula: string, res: Res, fmt: string) => { dc.text(at(2, r), label); dc.f(at(3, r), formula, res, fmt); };
  wrow(DR.rf, "Risk-free rate = bond yield − default spread", `${iRef(I.rf)}-${iRef(I.spread)}`, R.rf, PCT2);
  wrow(DR.ke, "Cost of equity = risk-free + beta × equity risk premium", `${at(3, DR.rf)}+${iRef(I.beta)}*${iRef(I.erp)}`, R.ke, PCT2);
  wrow(DR.mcap, "Market value of equity = price × shares", `${iRef(I.price)}*${iRef(I.shares)}`, R.mcap / D, AM);
  wrow(DR.debt, "Borrowings + lease liabilities", `${hRef(3, HR.borr)}+${hRef(3, HR.lease)}`, debt / D, AM);
  wrow(DR.we, "Weight of equity = equity ÷ (equity + debt)", `${at(3, DR.mcap)}/(${at(3, DR.mcap)}+${at(3, DR.debt)})`, R.we, PCT);
  wrow(DR.kd, "Pre-tax cost of debt", iRef(I.kd), pc(inputs.rate.kd), PCT2);
  wrow(DR.tax1, "Tax rate, year 1 of the live scenario", at(F(0), DR.drv + 2), pc(live.tax[0]), PCT);
  wrow(DR.kdAT, "After-tax cost of debt = cost of debt × (1 − tax)", `${at(3, DR.kd)}*(1-${at(3, DR.tax1)})`, R.kdAT, PCT2);
  wrow(DR.wacc, "WACC = We × Ke + (1 − We) × after-tax Kd", `${at(3, DR.we)}*${at(3, DR.ke)}+(1-${at(3, DR.we)})*${at(3, DR.kdAT)}`, R.wacc, PCT2);
  wrow(DR.g, "Terminal growth g", iRef(I.g), R.g, PCT2);
  dc.head(DR.head, [`Forecast, ${u.label}`, `${last.label} reported`, ...R.fyLabels]);
  dc.text(at(2, DR.end), "Fiscal year end");
  dc.text(at(2, DR.t), `Years from the valuation date (${dateLabel(new Date(valDate).toISOString())}) to year end, t`);
  for (let y = 0; y < FORECAST_YEARS; y++) {
    dc.input(at(F(y), DR.end), addYearsUTC(last.end, y + 1), DATE);
    dc.input(at(F(y), DR.t), R.t[y], T);
  }
  DRIVER_ROWS.forEach((d, j) => {
    dc.text(at(2, DR.drv + j), `${d.label} (from Inputs)`);
    for (let y = 0; y < FORECAST_YEARS; y++)
      dc.f(at(F(y), DR.drv + j), `CHOOSE(${iRef(I.scenNo)},${SCENARIOS.map((k) => yearsDrivers(k, j, y)).join(",")})`, pc(live[d.key][y]), PCT);
  });
  dc.text(at(2, DR.rev), "Revenue");
  dc.f(at(3, DR.rev), hRef(lastC, HR.rev), last.revenue / D, AM);
  const drv = (j: number, y: number) => at(F(y), DR.drv + j);
  for (let y = 0; y < FORECAST_YEARS; y++) {
    const c = F(y), prev = at(c - 1, DR.rev), rev = at(c, DR.rev);
    dc.f(rev, `${prev}*(1+${drv(0, y)})`, L.rev[y] / D, AM);
    dc.f(at(c, DR.ebit), `${rev}*${drv(1, y)}`, L.ebit[y] / D, AM);
    dc.f(at(c, DR.nopat), `${at(c, DR.ebit)}*(1-${drv(2, y)})`, L.nopat[y] / D, AM);
    dc.f(at(c, DR.da), `${rev}*${drv(3, y)}`, L.da[y] / D, AM);
    dc.f(at(c, DR.capex), `${rev}*${drv(4, y)}`, L.capex[y] / D, AM);
    dc.f(at(c, DR.wcInc), `(${rev}-${prev})*${drv(5, y)}`, L.wcInc[y] / D, AM);
    dc.f(at(c, DR.fcf), `${at(c, DR.nopat)}+${at(c, DR.da)}-${at(c, DR.capex)}-${at(c, DR.wcInc)}`, L.fcf[y] / D, AM);
    dc.f(at(c, DR.df), `1/(1+${ab(3, DR.wacc)})^${at(c, DR.t)}`, L.df[y], DF);
    dc.f(at(c, DR.pv), `${at(c, DR.fcf)}*${at(c, DR.df)}`, L.pv[y] / D, AM);
  }
  ([[DR.ebit, "EBIT = revenue × margin"], [DR.nopat, "NOPAT = EBIT × (1 − tax)"], [DR.da, "+ D&A"], [DR.capex, "− Capex"], [DR.wcInc, "− Increase in working capital"], [DR.fcf, "Free cash flow (FCF)"], [DR.df, "Discount factor = 1 ÷ (1 + WACC)^t"], [DR.pv, "Present value of FCF"]] as const)
    .forEach(([r, l]) => dc.text(at(2, r), l, { bold: r === DR.fcf }));
  dc.head(37, ["From enterprise value to value per share"]);
  const y5 = F(FORECAST_YEARS - 1);
  const bridge = B.cash - B.borrowings - B.leases - B.nci - B.returned;
  const vrows: [number, string, string, Res, string][] = [
    [DR.sumPv, "Sum of present values, years 1–5", `SUM(${at(F(0), DR.pv)}:${at(y5, DR.pv)})`, L.sumPv / D, AM],
    [DR.tv, "Terminal value = FCF year 5 × (1 + g) ÷ (WACC − g)", `IF(${at(3, DR.wacc)}>${at(3, DR.g)},${at(y5, DR.fcf)}*(1+${at(3, DR.g)})/(${at(3, DR.wacc)}-${at(3, DR.g)}),NA())`, n(L.tv / D), AM],
    [DR.pvTv, "Present value of the terminal value", `${at(3, DR.tv)}*${at(y5, DR.df)}`, n(L.pvTv / D), AM],
    [DR.ev, "Enterprise value", `${at(3, DR.sumPv)}+${at(3, DR.pvTv)}`, n(L.ev / D), AM],
    [DR.tvShare, "Terminal value share of enterprise value", `${at(3, DR.pvTv)}/${at(3, DR.ev)}`, n(L.tvShare), PCT],
    [DR.cash, "+ Cash and short-term investments", hRef(3, HR.cash), B.cash / D, AM],
    [DR.borr, "− Borrowings", hRef(3, HR.borr), B.borrowings / D, AM],
    [DR.lease, "− Lease liabilities", hRef(3, HR.lease), B.leases / D, AM],
    [DR.nci, "− Minority interests", hRef(3, HR.nci), B.nci / D, AM],
    [DR.ret, "− Dividends paid since the balance sheet", hRef(3, HR.ret), B.returned / D, AM],
    [DR.bridge, "Net cash and other claims (the bridge)", `${at(3, DR.cash)}-${at(3, DR.borr)}-${at(3, DR.lease)}-${at(3, DR.nci)}-${at(3, DR.ret)}`, bridge / D, AM],
    [DR.equity, "Equity value = enterprise value + bridge", `${at(3, DR.ev)}+${at(3, DR.bridge)}`, n(L.equity / D), AM],
    [DR.shares, `Shares outstanding (${unitShares})`, iRef(I.shares), data.shares / D, "#,##0.000"],
    [DR.vps, `Value per share (${cur})`, `${at(3, DR.equity)}/${at(3, DR.shares)}`, n(L.vps), PS],
  ];
  for (const [r, label, formula, res, fmt] of vrows) { dc.text(at(2, r), label, { bold: r === DR.ev || r === DR.equity || r === DR.vps }); dc.f(at(3, r), formula, res, fmt); }
  if (data.financial) dc.text("B53", "A financial firm (lender, insurer or holding company): debt is raw material rather than financing, so this DCF is shown for learning and carries 0% weight by default.", { note: true });

  // ---------- Scenarios ----------
  const SR = { first: 5, pw: 8, block: { bear: 11, base: 27, bull: 43 } as Record<ScenarioKey, number>, rev: 62 };
  type Refs = (j: number, y: number) => string;
  /** One DCF in 15 rows, reusing the DCF tab's WACC, discount factors and bridge. Returns the value-per-share cell. */
  const block = (top: number, title: string, driver: Refs, growthOverride: string | null, o: DcfOut) => {
    sc.head(top, [title, `${last.label} reported`, ...R.fyLabels]);
    const r = (k: number) => top + k;
    const labels = ["Revenue", "EBIT", "NOPAT", "+ D&A", "− Capex", "− Increase in working capital", "Free cash flow", "Present value (DCF tab discount factors)", "Sum of present values", "Terminal value", "Present value of terminal value", "Enterprise value", "Equity value = EV + bridge", `Value per share (${cur})`];
    labels.forEach((l, k) => sc.text(at(2, r(k + 1)), l, { bold: k === 13 }));
    sc.f(at(3, r(1)), dRef(3, DR.rev), last.revenue / D, AM);
    for (let y = 0; y < FORECAST_YEARS; y++) {
      const c = F(y), rev = at(c, r(1)), prev = at(c - 1, r(1));
      sc.f(rev, `${prev}*(1+${growthOverride ?? driver(0, y)})`, o.rev[y] / D, AM);
      sc.f(at(c, r(2)), `${rev}*${driver(1, y)}`, o.ebit[y] / D, AM);
      sc.f(at(c, r(3)), `${at(c, r(2))}*(1-${driver(2, y)})`, o.nopat[y] / D, AM);
      sc.f(at(c, r(4)), `${rev}*${driver(3, y)}`, o.da[y] / D, AM);
      sc.f(at(c, r(5)), `${rev}*${driver(4, y)}`, o.capex[y] / D, AM);
      sc.f(at(c, r(6)), `(${rev}-${prev})*${driver(5, y)}`, o.wcInc[y] / D, AM);
      sc.f(at(c, r(7)), `${at(c, r(3))}+${at(c, r(4))}-${at(c, r(5))}-${at(c, r(6))}`, o.fcf[y] / D, AM);
      sc.f(at(c, r(8)), `${at(c, r(7))}*${dRef(c, DR.df)}`, o.pv[y] / D, AM);
    }
    sc.f(at(3, r(9)), `SUM(${at(F(0), r(8))}:${at(y5, r(8))})`, o.sumPv / D, AM);
    sc.f(at(3, r(10)), `IF(${dRef(3, DR.wacc)}>${dRef(3, DR.g)},${at(y5, r(7))}*(1+${dRef(3, DR.g)})/(${dRef(3, DR.wacc)}-${dRef(3, DR.g)}),NA())`, n(o.tv / D), AM);
    sc.f(at(3, r(11)), `${at(3, r(10))}*${dRef(y5, DR.df)}`, n(o.pvTv / D), AM);
    sc.f(at(3, r(12)), `${at(3, r(9))}+${at(3, r(11))}`, n(o.ev / D), AM);
    sc.f(at(3, r(13)), `${at(3, r(12))}+${dRef(3, DR.bridge)}`, n(o.equity / D), AM);
    sc.f(at(3, r(14)), `${at(3, r(13))}/${dRef(3, DR.shares)}`, n(o.vps), PS);
    return at(3, r(14));
  };
  sc.title("B1", "Scenarios: bear, base and bull");
  sc.text("B2", "Each case uses its own drivers from the Inputs tab with the same WACC, terminal growth and bridge as the DCF tab.", { note: true });
  sc.head(4, ["Scenario", "Value per share", "vs price", "Probability"]);
  const vpsCell = {} as Record<ScenarioKey, string>;
  for (const k of SCENARIOS) vpsCell[k] = block(SR.block[k], `${k[0].toUpperCase() + k.slice(1)} case, ${u.label}`, (j, y) => yearsDrivers(k, j, y), null, R.scen[k]);
  SCENARIOS.forEach((k, i) => {
    const r = SR.first + i;
    sc.text(at(2, r), k[0].toUpperCase() + k.slice(1));
    sc.f(at(3, r), vpsCell[k], n(R.scen[k].vps), PS);
    sc.f(at(4, r), `${at(3, r)}/${iRef(I.price)}-1`, n(R.scen[k].vps / inputs.price - 1), PCT);
    sc.f(at(5, r), ip.ref(ab(4 + i, I.probs)), pc(inputs.probs[k]), "0%");
  });
  const pr0 = at(3, SR.first), pr2 = at(3, SR.first + 2), pb0 = at(5, SR.first), pb2 = at(5, SR.first + 2);
  sc.text(at(2, SR.pw), "Probability-weighted", { bold: true });
  sc.f(at(3, SR.pw), `IF(SUM(${pb0}:${pb2})>0,SUMPRODUCT(${pr0}:${pr2},${pb0}:${pb2})/SUM(${pb0}:${pb2}),NA())`, n(R.pw), PS);
  sc.f(at(4, SR.pw), `${at(3, SR.pw)}/${iRef(I.price)}-1`, n(R.pw / inputs.price - 1), PCT);
  // reverse DCF: one constant growth rate in place of the live growth path
  const ig = fin(R.impliedGrowth) ? R.impliedGrowth : R.liveAvgGrowth;
  const rev = R.dcf({ ...live, growth: Array(FORECAST_YEARS).fill(ig) }, R.wacc, R.g);
  sc.head(SR.rev - 2, ["Reverse DCF: the constant growth that makes the value equal today's price"]);
  sc.text(at(2, SR.rev - 1), fin(R.impliedGrowth)
    ? "Goal Seek reproduces it: Data › What-If Analysis › Goal Seek, set the last cell below to 0 by changing the blue growth cell."
    : "No constant growth between −60% and +100% matches the price; the blue cell holds your live average growth instead.", { note: true });
  sc.text(at(2, SR.rev), "Constant revenue growth, every forecast year"); sc.input(at(3, SR.rev), pc(ig), "0.00%");
  const growthCell = ab(3, SR.rev);
  const revVps = block(SR.rev + 1, "Live scenario drivers with that growth", (j, y) => dRef(F(y), DR.drv + j), growthCell, rev);
  const diffRow = SR.rev + 16;
  sc.text(at(2, diffRow), "Value per share minus today's price (Goal Seek target: 0)", { bold: true });
  sc.f(at(3, diffRow), `${revVps}-${iRef(I.price)}`, n(rev.vps - inputs.price), PS);

  // ---------- Sensitivity ----------
  se.title("B1", "Sensitivity: WACC against terminal growth");
  se.text("B2", `Value per share (${cur}), live scenario. Each cell redoes the DCF: SUMPRODUCT discounts the five free cash flows, then adds the terminal value and the bridge.`, { note: true });
  se.text("B3", "Today's share price"); se.f("C3", iRef(I.price), inputs.price, PS);
  se.text("B4", "Step between columns and rows"); se.input("C4", 0.005, PCT2);
  se.head(6, ["g ↓  ·  WACC →"], 7);
  const offs = [-2, -1, 0, 1, 2];
  const shift = (base: string, o: number) => (o === 0 ? base : `${base}${o > 0 ? "+" : "-"}${Math.abs(o) === 1 ? "" : Math.abs(o) + "*"}$C$4`);
  offs.forEach((o, i) => {
    se.f(at(3 + i, 6), shift(dRef(3, DR.wacc), o), R.sensW[i], PCT2);
    se.f(at(2, 7 + i), shift(dRef(3, DR.g), o), R.sensG[i], PCT2);
    se.ws.getCell(at(2, 7 + i)).font = { bold: true };
    se.ws.getCell(at(3 + i, 6)).font = { bold: true };
  });
  const fcfR = `${dRef(F(0), DR.fcf)}:${ab(y5, DR.fcf)}`, tR = `${dRef(F(0), DR.t)}:${ab(y5, DR.t)}`;
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
    const w = `${colName(3 + i)}$6`, g = `$B${7 + j}`;
    const formula = `IF(${w}>${g},(SUMPRODUCT(${fcfR}/(1+${w})^${tR})+${dRef(y5, DR.fcf)}*(1+${g})/(${w}-${g})/(1+${w})^${dRef(y5, DR.t)}+${dRef(3, DR.bridge)})/${dRef(3, DR.shares)},"n/a")`;
    const c = se.f(at(3 + i, 7 + j), formula, t(R.sens[j][i]), PS);
    if (i === 2 && j === 2) c.border = { top: { style: "medium" }, bottom: { style: "medium" }, left: { style: "medium" }, right: { style: "medium" } };
  }
  se.ws.addConditionalFormatting({ ref: "C7:G11", rules: [
    { type: "cellIs", operator: "greaterThan", priority: 1, formulae: ["$C$3"], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFDCE8FA" } } } },
    { type: "cellIs", operator: "lessThan", priority: 2, formulae: ["$C$3"], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFBE0E0" } } } },
  ] });
  se.text("B13", "Blue-shaded cells are above today's price, red-shaded below; the outlined cell is the current WACC and g.", { note: true });

  // ---------- Peers ----------
  const inc = allPeers.filter((p) => p.included), exc = allPeers.filter((p) => !p.included);
  const P0 = 6, PE = P0 + Math.max(1, inc.length) - 1;
  const MULTS = [
    { key: "evEbitda", label: "EV/EBITDA", hi: 200 }, { key: "pe", label: "P/E", hi: 500 }, { key: "evSales", label: "EV/Sales", hi: 100 }, { key: "pb", label: "P/B", hi: 100 },
  ] as const;
  const used = (m: number) => 9 + m; // columns I..L
  pr.title("B1", "Peer comparison (comps)");
  pr.text("B2", "Multiples rebuilt by Valuation Desk from Yahoo Finance so currencies match. Only peers ticked in the app are in the medians.", { note: true });
  pr.text("B3", "The 'in median' columns drop missing values and outliers (EV/EBITDA above 200x, P/E above 500x, EV/Sales or P/B above 100x, anything at or below zero).", { note: true });
  pr.head(5, ["Company", "Symbol", ...MULTS.map((m) => m.label), "", ...MULTS.map((m) => `${m.label} in median`)], 12);
  if (!inc.length) pr.text(at(2, P0), "No peers included: add peers in Valuation Desk", { note: true });
  inc.forEach((p, i) => {
    const r = P0 + i;
    pr.text(at(2, r), p.name); pr.text(at(3, r), p.symbol);
    MULTS.forEach((m, k) => {
      const v = p[m.key], c = 4 + k, raw = at(c, r);
      pr.input(raw, v, MULT);
      pr.f(at(used(k), r), `IF(AND(ISNUMBER(${raw}),${raw}>0,${raw}<${m.hi}),${raw},"")`, fin(v) && v > 0 && v < m.hi ? v : "", MULT);
    });
  });
  const PS_ = { med: PE + 2, q1: PE + 3, q3: PE + 4, cnt: PE + 5, ev: PE + 7, subj: PE + 8, prem: PE + 9, impHead: PE + 11, imp: PE + 12, comps: PE + 16, exc: PE + 18 };
  const statKey = { evEbitda: "evE", pe: "pe", evSales: "evS", pb: "pb" } as const;
  ([[PS_.med, "Median", "med"], [PS_.q1, "25th percentile (QUARTILE.INC)", "q1"], [PS_.q3, "75th percentile (QUARTILE.INC)", "q3"]] as const).forEach(([r, label, q]) => {
    pr.text(at(2, r), label, { bold: q === "med" });
    MULTS.forEach((m, k) => {
      const rg = `${at(used(k), P0)}:${at(used(k), PE)}`;
      const fn = q === "med" ? `MEDIAN(${rg})` : `_xlfn.QUARTILE.INC(${rg},${q === "q1" ? 1 : 3})`;
      pr.f(at(used(k), r), `IF(COUNT(${rg})>0,${fn},"n/a")`, t(R.stats[statKey[m.key]][q]), MULT);
    });
  });
  pr.text(at(2, PS_.cnt), "Peers with a usable multiple");
  MULTS.forEach((m, k) => pr.f(at(used(k), PS_.cnt), `COUNT(${at(used(k), P0)}:${at(used(k), PE)})`, R.stats[statKey[m.key]].n, "0"));
  const evNow = R.mcap - netCash;
  pr.text(at(2, PS_.ev), "Enterprise value at today's price = market value − net cash"); pr.f(at(3, PS_.ev), `${dRef(3, DR.mcap)}-${hRef(3, HR.netCash)}`, evNow / D, AM);
  pr.text(at(2, PS_.subj), `${data.name} today`, { bold: true });
  const evC = ab(3, PS_.ev), ebitda = hRef(3, HR.ttmEbitda), eps = hRef(3, HR.eps), bv = hRef(3, HR.bvps), ttmRev = hRef(3, HR.ttmRev), price = iRef(I.price), shares = iRef(I.shares), nc = hRef(3, HR.netCash);
  pr.f(at(4, PS_.subj), `IF(${ebitda}>0,${evC}/${ebitda},"n/a")`, t(R.subject.evE), MULT);
  pr.f(at(5, PS_.subj), `IF(${eps}>0,${price}/${eps},"n/a")`, t(R.subject.pe), MULT);
  pr.f(at(6, PS_.subj), `IF(${ttmRev}>0,${evC}/${ttmRev},"n/a")`, t(R.subject.evS), MULT);
  pr.f(at(7, PS_.subj), `IF(ISNUMBER(${bv}),IF(${bv}>0,${price}/${bv},"n/a"),"n/a")`, t(R.subject.pb), MULT);
  const premCol = data.financial ? 1 : 0; // P/E for lenders, EV/EBITDA otherwise
  pr.text(at(2, PS_.prem), `Premium (+) or discount (−) to the peer median ${R.discountMetric}`);
  pr.f(at(3, PS_.prem), `IF(AND(ISNUMBER(${at(4 + premCol, PS_.subj)}),ISNUMBER(${at(used(premCol), PS_.med)})),${at(4 + premCol, PS_.subj)}/${at(used(premCol), PS_.med)}-1,"n/a")`, t(R.discount), PCT);
  pr.head(PS_.impHead, [`Implied value per share (${cur})`, "25th pct", "Median", "75th pct"], 5);
  const impRows = [
    { k: 0, label: "EV/EBITDA × EBITDA + net cash, ÷ shares", s: R.implied.evE, f: (m: string) => `IF(AND(ISNUMBER(${m}),${ebitda}>0),(${m}*${ebitda}+${nc})/${shares},"n/a")` },
    { k: 1, label: "P/E × earnings per share", s: R.implied.pe, f: (m: string) => `IF(AND(ISNUMBER(${m}),${eps}>0),${m}*${eps},"n/a")` },
    { k: 3, label: "P/B × book value per share", s: R.implied.pb, f: (m: string) => `IF(AND(ISNUMBER(${m}),ISNUMBER(${bv})),IF(${bv}>0,${m}*${bv},"n/a"),"n/a")` },
    { k: 2, label: "EV/Sales × revenue + net cash, ÷ shares (a check only)", s: R.implied.evS, f: (m: string) => `IF(AND(ISNUMBER(${m}),${ttmRev}>0),(${m}*${ttmRev}+${nc})/${shares},"n/a")` },
  ];
  const impCell: Record<number, string> = {};
  impRows.forEach((row, i) => {
    const r = PS_.imp + i;
    pr.text(at(2, r), row.label);
    ([["q1", PS_.q1], ["med", PS_.med], ["q3", PS_.q3]] as const).forEach(([q, sr], j) => pr.f(at(3 + j, r), row.f(at(used(row.k), sr)), t(row.s[q]), PS));
    impCell[row.k] = at(4, r);
  });
  const pair = data.financial ? [impCell[1], impCell[3]] : [impCell[0], impCell[1]];
  pr.text(at(2, PS_.comps), `Peer value per share: ${R.compsMethod}`, { bold: true });
  const compsCell = at(4, PS_.comps);
  pr.f(compsCell, `IF(COUNT(${pair.join(",")})>0,AVERAGE(${pair.join(",")}),"n/a")`, t(R.compsValue), PS);
  if (exc.length) {
    pr.head(PS_.exc, ["Not in the medians (unticked in Valuation Desk)", "Symbol", ...MULTS.map((m) => m.label)], 7);
    exc.forEach((p, i) => {
      const r = PS_.exc + 1 + i;
      pr.text(at(2, r), p.name, { color: GREY }); pr.text(at(3, r), p.symbol, { color: GREY });
      MULTS.forEach((m, k) => pr.input(at(4 + k, r), p[m.key], MULT));
    });
  }

  // ---------- Summary ----------
  const SM = { price: 5, dcf: 6, dcfOk: 7, comps: 8, compsOk: 9, w: 10, raw: 11, step: 12, pt: 13, up: 14, call: 15, wacc: 18, g: 19, tvs: 20, ig: 23, avgG: 24, im: 25, avgM: 26, gs: 27, checks: 30 };
  const s = (r: number) => at(3, r);
  sm.title("B1", `${data.name} (${data.symbol}): valuation summary`);
  sm.text("B2", `Valuation date ${dateLabel(new Date(valDate).toISOString())} · per-share values in ${cur} · amounts in ${u.label}`, { note: true });
  sm.head(4, ["Result"], 4);
  const step = (x: number) => (Math.abs(x) >= 1000 ? 10 : Math.abs(x) >= 100 ? 1 : Math.abs(x) >= 10 ? 0.1 : 0.01);
  const srow = (r: number, label: string, formula: string, res: Res, fmt?: string, note?: string, bold = false) => {
    sm.text(at(2, r), label, { bold });
    const c = sm.f(s(r), formula, res, fmt);
    if (bold) c.font = { ...c.font, bold: true };
    if (note) sm.text(at(4, r), note, { note: true, wrap: true });
  };
  srow(SM.price, `Share price (${cur})`, iRef(I.price), inputs.price, PS);
  srow(SM.dcf, "DCF value per share (live scenario, or probability-weighted if chosen)", `IF(${iRef(I.usePW)}="yes",${sc.ref(ab(3, SR.pw))},${dRef(3, DR.vps)})`, n(R.dcfUsed), PS);
  srow(SM.dcfOk, "DCF usable? (positive, and WACC above g)", `IF(ISNUMBER(${s(SM.dcf)}),IF(AND(${s(SM.dcf)}>0,${dRef(3, DR.wacc)}>${dRef(3, DR.g)}),"yes","no"),"no")`, R.dcfOk ? "yes" : "no");
  srow(SM.comps, "Peer value per share", pr.ref(ab(4, PS_.comps)), t(R.compsValue), PS);
  srow(SM.compsOk, "Peer value usable?", `IF(ISNUMBER(${s(SM.comps)}),"yes","no")`, fin(R.compsValue) ? "yes" : "no");
  srow(SM.w, "DCF weight (kept between 0% and 100%)", `MIN(1,MAX(0,${iRef(I.w)}))`, R.w, "0%");
  srow(SM.raw, "Blended value before rounding", `IF(AND(${s(SM.dcfOk)}="yes",${s(SM.compsOk)}="yes"),${s(SM.dcf)}*${s(SM.w)}+${s(SM.comps)}*(1-${s(SM.w)}),IF(${s(SM.dcfOk)}="yes",${s(SM.dcf)},IF(${s(SM.compsOk)}="yes",${s(SM.comps)},"n/a")))`, t(R.ptRaw), PS, "if only one method is usable, it is used alone");
  srow(SM.step, "Rounding step", `IF(ISNUMBER(${s(SM.raw)}),IF(ABS(${s(SM.raw)})>=1000,10,IF(ABS(${s(SM.raw)})>=100,1,IF(ABS(${s(SM.raw)})>=10,0.1,0.01))),"n/a")`, fin(R.ptRaw) ? step(R.ptRaw) : "n/a", "General");
  srow(SM.pt, valueLabel, `IF(ISNUMBER(${s(SM.raw)}),ROUND(ROUND(${s(SM.raw)}/${s(SM.step)},0)*${s(SM.step)},2),"n/a")`, t(R.pt), PS, undefined, true);
  srow(SM.up, "Upside (+) or downside (−) vs today's price", `IF(ISNUMBER(${s(SM.pt)}),${s(SM.pt)}/${s(SM.price)}-1,"n/a")`, t(R.upside), PCT, undefined, true);
  if (calls) srow(SM.call, "Model call", `IF(ISNUMBER(${s(SM.up)}),IF(${s(SM.up)}>${iRef(I.buy)},"BUY",IF(${s(SM.up)}<${iRef(I.sell)},"SELL","HOLD")),"–")`, R.rating, undefined,
    "A model output for learning. In India, giving buy or sell recommendations to clients can require SEBI Research Analyst registration.", true);
  else { sm.text(at(2, SM.call), "Model call"); sm.text(s(SM.call), "off", { note: true }); sm.text(at(4, SM.call), "Calls are off in Valuation Desk. Turn on 'Show calls' and download again to add the BUY/HOLD/SELL formula.", { note: true, wrap: true }); }
  sm.head(17, ["Cost of capital and growth"], 4);
  srow(SM.wacc, "WACC", dRef(3, DR.wacc), R.wacc, PCT2);
  srow(SM.g, "Terminal growth g", dRef(3, DR.g), R.g, PCT2);
  srow(SM.tvs, "Terminal value share of enterprise value", dRef(3, DR.tvShare), n(L.tvShare), PCT);
  sm.head(22, ["What the price implies (reverse DCF)"], 4);
  if (fin(R.impliedGrowth)) srow(SM.ig, "Implied revenue growth a year, all five years", sc.ref(growthCell), pc(R.impliedGrowth), "0.00%", "the growth that makes the DCF equal today's price, other drivers as in the live scenario");
  else { sm.text(at(2, SM.ig), "Implied revenue growth a year, all five years"); sm.text(s(SM.ig), "n/a"); sm.text(at(4, SM.ig), "no growth rate between −60% and +100% matches the price", { note: true }); }
  srow(SM.avgG, "Average growth in your live scenario", `AVERAGE(${dRef(F(0), DR.drv)}:${ab(y5, DR.drv)})`, pc(R.liveAvgGrowth), "0.00%");
  sm.text(at(2, SM.im), "Implied EBIT margin, all five years");
  sm.input(s(SM.im), fin(R.impliedMargin) ? pc(R.impliedMargin) : null, "0.00%");
  sm.text(at(4, SM.im), "a value from Valuation Desk's solver: the constant margin that makes the DCF equal today's price", { note: true, wrap: true });
  srow(SM.avgM, "Average EBIT margin in your live scenario", `AVERAGE(${dRef(F(0), DR.drv + 1)}:${ab(y5, DR.drv + 1)})`, pc(R.liveAvgMargin), "0.00%");
  sm.text(at(2, SM.gs), `To reproduce the implied growth: Data › What-If Analysis › Goal Seek. Set Scenarios!${at(3, diffRow)} to 0 by changing Scenarios!${at(3, SR.rev)}.`, { note: true });
  sm.head(SM.checks - 1, ["Model checks", "Result", "If it says CHECK"], 4);
  const pass = (p: boolean | null) => (p === null ? "N/A" : p ? "PASS" : "CHECK");
  const W = dRef(3, DR.wacc), G = dRef(3, DR.g);
  const checkF = [
    `IF(${W}>${G},"PASS","CHECK")`,
    `IF(${W}>${G},IF(${dRef(3, DR.vps)}>0,"PASS","CHECK"),"N/A")`,
    `IF(${hRef(3, HR.mcap)}>0,IF(ABS(${dRef(3, DR.mcap)}/${hRef(3, HR.mcap)}-1)<0.02,"PASS","CHECK"),"N/A")`,
    `IFERROR(IF(AND(${sc.ref(ab(3, SR.first))}<=${sc.ref(ab(3, SR.first + 1))},${sc.ref(ab(3, SR.first + 1))}<=${sc.ref(ab(3, SR.first + 2))}),"PASS","CHECK"),"CHECK")`,
    `IF(COUNTA(${pr.ref(`$C$${P0}:$C$${PE}`)})>=3,"PASS","CHECK")`,
    `IF(${W}>${G},IF(${dRef(3, DR.tvShare)}<0.85,"PASS","CHECK"),"N/A")`,
    `IF(${dRef(F(0), DR.t)}>0,"PASS","CHECK")`,
  ];
  R.checks.forEach((c, i) => {
    const r = SM.checks + i;
    sm.text(at(2, r), c.what, { wrap: true });
    sm.f(s(r), checkF[i] ?? `"${pass(c.pass)}"`, pass(c.pass));
    sm.text(at(4, r), c.fix, { note: true, wrap: true });
  });
  const xr = SM.checks + R.checks.length;
  sm.text(at(2, xr), "The DCF tab matches the selected case on the Scenarios tab", { wrap: true });
  sm.f(s(xr), `IFERROR(IF(ABS(${dRef(3, DR.vps)}-INDEX(${sc.ref(`$C$${SR.first}:$C$${SR.first + 2}`)},${iRef(I.scenNo)}))<=0.000001*ABS(${dRef(3, DR.vps)}),"PASS","CHECK"),"N/A")`, fin(L.vps) ? "PASS" : "N/A");
  sm.text(at(4, xr), "a check on this workbook's own formulas", { note: true });
  sm.text(at(2, xr + 2), "Educational model, not investment advice. Check every number against the company's filings before relying on it.", { bold: true });

  // ---------- Start ----------
  st.title("B1", `Valuation Desk · ${data.name} (${data.symbol})`);
  st.text("B2", "An equity research model with live formulas, built from the inputs you chose on Valuation Desk.", { note: true });
  st.head(4, ["This file"], 3);
  const about: [string, string][] = [
    ["Company", `${data.name} (${data.symbol})`],
    ["Listed on", [data.exchange, data.country].filter(Boolean).join(", ")],
    ["Sector and industry", [data.sector, data.industry].filter(Boolean).join(" · ") || "–"],
    ["Currency", `${cur}: per-share values in ${cur}, amounts in ${u.label}, shares in ${unitShares}`],
    ["Valuation date", dateLabel(new Date(valDate).toISOString())],
    ["Share price", `${inputs.price} ${cur}${inputs.price === data.price ? `, Yahoo Finance at ${new Date(data.priceTime).toUTCString()} (delayed)` : " (your own price)"}`],
    ["Data", `${data.source}, as of ${dateLabel(data.asOf)}; statements reported in ${data.financialCurrency}${data.fxNote ? `. ${data.fxNote}` : ""}`],
  ];
  about.forEach(([k, v], i) => { st.text(at(2, 5 + i), k); st.text(at(3, 5 + i), v, { wrap: true }); });
  st.text("B12", valueLabel); st.f("C12", sm.ref(ab(3, SM.pt)), t(R.pt), PS);
  st.text("B13", "Upside vs price"); st.f("C13", sm.ref(ab(3, SM.up)), t(R.upside), PCT);
  if (opts.link) { st.text("B14", "Open on the web"); const c = st.ws.getCell("C14"); c.value = { text: opts.link, hyperlink: opts.link }; c.font = { color: { argb: "FF2348D6" }, underline: true }; }
  st.head(16, ["How the tabs connect"], 3);
  const tabs: [string, string][] = [
    ["Inputs", "Your assumptions: price, shares, the WACC build, result rules, the live scenario picker and five years of drivers for bear, base and bull."],
    ["Reported", "The reported years the drivers are based on, with each ratio worked out by a formula, plus the balance-sheet bridge and trailing figures."],
    ["DCF", "Picks the live scenario's drivers from Inputs, builds the WACC, forecasts free cash flow, discounts it, adds the terminal value and bridges to value per share."],
    ["Scenarios", "Bear, base and bull side by side with the same WACC, a probability-weighted value, and a reverse DCF you can reproduce with Goal Seek."],
    ["Sensitivity", "The DCF redone for WACC and terminal growth one point either side of your inputs."],
    ["Peers", "Peer multiples, their median and quartiles, the value per share each implies, and the peer value."],
    ["Summary", `Blends DCF and peers into the ${valueLabel.toLowerCase()}, the upside, what the price implies, and the model checks.`],
  ];
  tabs.forEach(([k, v], i) => { st.text(at(2, 17 + i), k, { bold: true }); st.text(at(3, 17 + i), v, { wrap: true }); });
  st.head(25, ["Colour key"], 3);
  st.input("B26", 1234.5, "#,##0.0"); st.text("C26", "Blue on yellow: a typed input or reported number. Change it.");
  const fk = st.ws.getCell("B27"); fk.value = { formula: "B26*2", result: 2469 }; fk.numFmt = "#,##0.0"; fk.font = { color: { argb: BLACK } };
  st.text("C27", "Black: a formula on this tab.");
  const lk = st.ws.getCell("B28"); lk.value = { formula: "Inputs!C5", result: inputs.price }; lk.numFmt = PS; lk.font = { color: { argb: GREEN } };
  st.text("C28", "Green: a number pulled straight from another tab (or picked from the Inputs scenarios).");
  st.text("B29", "Values show the website's results until Excel recalculates, which it does when the file opens.", { note: true });
  st.head(31, ["Read this first"], 3);
  const notes = [
    "Educational model, not investment advice.",
    "Market data comes from Yahoo Finance through the open-source yahoo-finance2 library: it is unofficial, delayed, can be wrong or missing, and is not licensed for commercial use. Check every number against the company's filings.",
    ...(data.financial ? ["A financial firm: a free-cash-flow DCF doesn't describe a lender, an insurer or a holding company, so the DCF weight starts at 0% and the value uses peer P/E and P/B."] : []),
    ...(calls ? ["Calls are model outputs for learning. In India, giving buy or sell recommendations to clients can require SEBI Research Analyst registration."] : []),
    ...data.warnings,
  ];
  notes.forEach((x, i) => st.text(at(2, 32 + i), x, { wrap: i > 0, bold: i === 0 }));
  notes.forEach((_, i) => { if (i > 0) st.ws.mergeCells(32 + i, 2, 32 + i, 3); });
  for (let r = 32; r < 32 + notes.length; r++) st.ws.getRow(r).height = r === 32 ? 18 : 32;

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
