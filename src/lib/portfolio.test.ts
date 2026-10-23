import { describe, expect, it } from "vitest";
import {
  cleanHoldings, concentrationOf, detectDelimiter, exchangeFromCell, exportCsv, fetchFx, fetchScanRow, isSample, mapPool, mergeHoldings, mergeLots, modelCall,
  parseHoldings, parseNumber, SAMPLE_PORTFOLIO, splitDelimited, summarise, toYahooSymbol, weightedMean, xray, MAX_HOLDINGS, type Holding, type PositionInput,
} from "./portfolio";
import type { ScanRow } from "./scanTypes";

describe("parseNumber", () => {
  it("reads the ways people write numbers", () => {
    expect(parseNumber("1,450.50")).toBe(1450.5);
    expect(parseNumber("₹1,00,000")).toBe(100000);
    expect(parseNumber("Rs. 1,450")).toBe(1450);
    expect(parseNumber("@1450")).toBe(1450);
    expect(parseNumber("$ 150.25")).toBe(150.25);
    expect(parseNumber("(696.00)")).toBe(-696);
    expect(parseNumber("−12.5")).toBe(-12.5);
    expect(parseNumber("1.450,50")).toBe(1450.5);
    expect(parseNumber("1450,5", true)).toBe(1450.5);
    expect(parseNumber("1450,5")).toBe(14505);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("10 shares")).toBeNull();
  });
});

describe("splitDelimited", () => {
  it("honours quotes, escaped quotes, CRLF and commas inside quotes", () => {
    const rows = splitDelimited('a,"b, c","say ""hi"""\r\n1,"2,000",3\n', ",");
    expect(rows.map((r) => r.cells)).toEqual([["a", "b, c", 'say "hi"'], ["1", "2,000", "3"]]);
    expect(rows.map((r) => r.line)).toEqual([1, 2]);
  });
  it("detects semicolons and tabs", () => {
    expect(detectDelimiter("Ticker;Shares\nAAPL;5")).toBe(";");
    expect(detectDelimiter("Symbol\tQty\nINFY\t10")).toBe("\t");
    expect(detectDelimiter('"Instrument","Qty."\n"INFY","10"')).toBe(",");
  });
});

describe("toYahooSymbol", () => {
  const sym = (s: string, ex: "NS" | "BO" | "" = "NS") => { const r = toYahooSymbol(s, ex); return "symbol" in r ? r.symbol : `!${r.reason}`; };
  it("adds the exchange suffix and cleans series", () => {
    expect(sym("infy")).toBe("INFY.NS");
    expect(sym("RELIANCE", "BO")).toBe("RELIANCE.BO");
    expect(sym("INFY.NS", "")).toBe("INFY.NS");
    expect(sym("IDEA-BE")).toBe("IDEA.NS");
    expect(sym("BAJAJ-AUTO")).toBe("BAJAJ-AUTO.NS");
    expect(sym("M&M")).toBe("M&M.NS");
    expect(sym("NSE:TCS", "")).toBe("TCS.NS");
    expect(sym("500325")).toBe("500325.BO");
    expect(sym("AAPL", "")).toBe("AAPL");
    expect(sym("BRK.B", "")).toBe("BRK-B");
    expect(sym("BP.L")).toBe("BP.L");
    expect(sym("7203.T")).toBe("7203.T");
  });
  it("refuses gold bonds, government securities and clearly named ETFs", () => {
    expect(sym("SGBMAR29")).toMatch(/^!Sovereign Gold Bond/);
    expect(sym("SGBJ28VIII-GB")).toMatch(/^!Sovereign Gold Bond/);
    expect(sym("736GS2031-GS")).toMatch(/^!Bond/);
    expect(sym("NIFTYBEES")).toMatch(/^!Exchange-traded fund/);
    expect(sym("SETFNIF50")).toMatch(/^!Exchange-traded fund/);
    expect(sym("MON100")).toBe("MON100.NS"); // not clearly an ETF by name: the lookup decides
    expect(sym("hello world!")).toMatch(/does not look like a ticker/);
  });
});

describe("parseHoldings: Zerodha Kite CSV", () => {
  const kite = '﻿"Instrument","Qty.","Avg. cost","LTP","Cur. val","P&L","Net chg.","Day chg.",""\r\n'
    + '"INFY","10","1,450.50","1,520.10","15,201.00","696.00","4.80","-0.52",""\r\n'
    + '"HDFCBANK","15","1520.00","1640.25","24,603.75","1,803.75","7.91","0.30",""\r\n'
    + '"SGBMAR29-GB","2","5,600.00","7,100.00","14,200.00","3,000.00","26.79","0.10",""\r\n'
    + '"NIFTYBEES","100","210.10","260.00","26,000.00","4,990.00","23.75","0.20",""\r\n'
    + '"IDEA-BE","500","12.50","8.10","4,050.00","(2,200.00)","-35.20","1.10",""\r\n'
    + '"INFY","5","1,300","1,520.10","7,600.50","1,100.50","16.93","-0.52",""\r\n'
    + '\r\n'
    + '"Total","","","","91,655.25","","","",""\r\n';
  const r = parseHoldings(kite, "");
  it("recognises the format, strips the BOM and reads quoted numbers with separators", () => {
    expect(r.format).toBe("zerodha-kite");
    expect(r.lots.map((l) => l.symbol)).toEqual(["INFY.NS", "HDFCBANK.NS", "IDEA.NS"]);
  });
  it("merges duplicate lines with a quantity-weighted cost", () => {
    const infy = r.lots.find((l) => l.symbol === "INFY.NS")!;
    expect(infy.qty).toBe(15);
    expect(infy.avgCost).toBeCloseTo((10 * 1450.5 + 5 * 1300) / 15, 9);
  });
  it("reports skipped lines with reasons", () => {
    expect(r.skipped.map((s) => [s.line, s.reason.split(":")[0]])).toEqual([[4, "Sovereign Gold Bond"], [5, "Exchange-traded fund"], [9, "Total row"]]);
  });
});

describe("parseHoldings: Zerodha Console report", () => {
  const csv = "Client ID,AB1234\nHoldings statement as on 2026-10-21\n\n"
    + "Symbol,ISIN,Sector,Quantity Available,Quantity Discrepant,Quantity Long Term,Quantity Pledged (Margin),Quantity Pledged (Loan),Average Price,Previous Closing Price,Unrealized P&L,Unrealized P&L Pct.\n"
    + "TCS,INE467B01029,IT,3,0,3,1,0,3200.5,3400,800,6.2\n"
    + "ITC,INE154A01025,FMCG,50,0,10,0,0,410,455,2250,10.9\n";
  it("skips the preamble and adds pledged shares to available ones", () => {
    const r = parseHoldings(csv, "");
    expect(r.format).toBe("zerodha-console");
    expect(r.lots).toEqual([{ symbol: "TCS.NS", qty: 4, avgCost: 3200.5 }, { symbol: "ITC.NS", qty: 50, avgCost: 410 }]);
    expect(r.skipped).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/pledged/);
  });
});

describe("parseHoldings: generic CSV", () => {
  it("reads semicolons with decimal commas and an exchange column", () => {
    const r = parseHoldings("Ticker;Exchange;Shares;Buy price\nRELIANCE;BSE;8;2.450,75\nAAPL;NASDAQ;3;150,5\nBRK.B;NYSE;1;\n", "NS");
    expect(r.format).toBe("csv");
    expect(r.lots).toEqual([{ symbol: "RELIANCE.BO", qty: 8, avgCost: 2450.75 }, { symbol: "AAPL", qty: 3, avgCost: 150.5 }, { symbol: "BRK-B", qty: 1 }]);
  });
  it("uses the default exchange for bare symbols and keeps rows whose cost is unreadable", () => {
    const r = parseHoldings("symbol,quantity,average cost\nINFY,10,n/a\nTCS,0,3000\nWIPRO,,\n", "NS");
    expect(r.lots).toEqual([{ symbol: "INFY.NS", qty: 10 }]);
    expect(r.skipped.map((s) => s.reason)).toEqual(["Quantity is zero or negative", "No quantity on this line"]);
    expect(r.notes[0]).toMatch(/Line 2: the average cost "n\/a"/);
  });
  it("ignores total-value columns when looking for a cost", () => {
    const r = parseHoldings("Symbol,Qty,Total cost,Current value\nITC,50,20500,22750\n", "NS");
    expect(r.lots).toEqual([{ symbol: "ITC.NS", qty: 50 }]);
    expect(r.notes.join(" ")).toMatch(/No average-cost column/);
  });
});

describe("parseHoldings: free text", () => {
  it("reads symbol, quantity and optional cost in several styles", () => {
    const r = parseHoldings("INFY.NS 10 1450\nTCS 4\nITC, 50, 410.5\nRELIANCE,8,2450\nHDFCBANK x 15 @ ₹1,520\n10 WIPRO\n# my notes\n\n", "NS");
    expect(r.format).toBe("text");
    expect(r.lots).toEqual([
      { symbol: "INFY.NS", qty: 10, avgCost: 1450 }, { symbol: "TCS.NS", qty: 4 }, { symbol: "ITC.NS", qty: 50, avgCost: 410.5 },
      { symbol: "RELIANCE.NS", qty: 8, avgCost: 2450 }, { symbol: "HDFCBANK.NS", qty: 15, avgCost: 1520 }, { symbol: "WIPRO.NS", qty: 10 },
    ]);
    expect(r.skipped).toEqual([]);
  });
  it("applies the default exchange and reports junk lines", () => {
    const r = parseHoldings("AAPL 5 190\nX 10\nInfosys Ltd 10\nhello\nTotal 25000\nINFY -3\nsymbol qty cost\nA B C D E\n", "");
    expect(r.lots).toEqual([{ symbol: "AAPL", qty: 5, avgCost: 190 }, { symbol: "X", qty: 10 }]);
    expect(r.skipped.map((s) => s.line)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(r.skipped[0].reason).toMatch(/not a number/);
    expect(r.skipped[1].reason).toMatch(/Expected a symbol and a quantity/);
    expect(r.skipped[2].reason).toBe("Total row");
    expect(r.skipped[3].reason).toBe("Quantity is zero or negative");
    expect(r.skipped[4].reason).toBe("Header line");
  });
  it("caps the number of holdings", () => {
    const lines = Array.from({ length: MAX_HOLDINGS + 5 }, (_, i) => `S${i} 1`).join("\n");
    const r = parseHoldings(lines, "");
    expect(r.lots).toHaveLength(MAX_HOLDINGS);
    expect(r.skipped.filter((s) => /limit/.test(s.reason))).toHaveLength(5);
  });
});

describe("merging", () => {
  it("drops the cost when only some lots have one", () => {
    const m = mergeLots([{ symbol: "INFY.NS", qty: 10, avgCost: 1400 }, { symbol: "INFY.NS", qty: 5 }]);
    expect(m.lots).toEqual([{ symbol: "INFY.NS", qty: 15 }]);
    expect(m.notes[0]).toMatch(/no average cost/);
  });
  it("adds to or replaces stored holdings", () => {
    const now = "2026-10-22T00:00:00.000Z";
    const have: Holding[] = [{ symbol: "INFY.NS", qty: 10, avgCost: 1400, added: "2026-01-01" }];
    const add = mergeHoldings(have, [{ symbol: "INFY.NS", qty: 10, avgCost: 1500 }, { symbol: "TCS.NS", qty: 2 }], now);
    expect(add.holdings).toEqual([{ symbol: "INFY.NS", qty: 20, avgCost: 1450, added: "2026-01-01" }, { symbol: "TCS.NS", qty: 2, added: now }]);
    expect(add.combined).toEqual(["INFY.NS"]);
    expect(have[0].qty).toBe(10); // input untouched
    const rep = mergeHoldings(have, [{ symbol: "TCS.NS", qty: 2 }], now, "replace");
    expect(rep.holdings).toEqual([{ symbol: "TCS.NS", qty: 2, added: now }]);
  });
  it("cleans what comes back from storage", () => {
    expect(cleanHoldings([{ symbol: "INFY.NS", qty: 1, added: "x" }, { symbol: "INFY.NS", qty: 2 }, { symbol: "bad sym", qty: 1 }, { symbol: "TCS.NS", qty: -1 }, null, { symbol: "ITC.NS", qty: 3, avgCost: 0 }]))
      .toEqual([{ symbol: "INFY.NS", qty: 1, added: "x" }, { symbol: "ITC.NS", qty: 3, added: "" }]);
    expect(cleanHoldings("nope")).toEqual([]);
  });
  it("knows the sample portfolio", () => {
    expect(isSample(SAMPLE_PORTFOLIO.map((l) => ({ ...l, added: "" })))).toBe(true);
    expect(isSample([{ symbol: "INFY.NS", qty: 10, added: "" }])).toBe(false);
  });
});

// ---------------------------------------------------------------- maths

function row(p: Partial<ScanRow> & { symbol: string; price: number }): ScanRow {
  return {
    name: p.symbol, exchange: "NSE", country: "India", sector: "Technology", industry: "IT Services", currency: "INR", marketCap: 1e12, financial: false,
    dcfValue: null, wacc: null, impliedGrowth: null, histGrowth: null, expectedReturn: null, growthShare: null, fcfYield: null,
    pe: null, evEbitda: null, pb: null, eps: 0, ebitda: 0, netCash: 0, shares: 1, bookValuePerShare: null,
    health: { score: null, grade: "–", flags: [], strengths: [] }, warnings: [], asOf: "2026-10-22T00:00:00Z", ...p,
  };
}
const h = (symbol: string, qty: number, avgCost?: number): Holding => ({ symbol, qty, ...(avgCost ? { avgCost } : {}), added: "" });

describe("xray", () => {
  const inputs: PositionInput[] = [
    // value 1000 x 10 = 10,000
    { holding: h("A.NS", 10, 800), row: row({ symbol: "A.NS", price: 1000, dcfValue: 1200, expectedReturn: 0.14, wacc: 0.12, impliedGrowth: 18, histGrowth: 9, health: { score: 40, grade: "D", flags: ["Cash from operations trails profit"], strengths: [] } }), fx: 1 },
    // bank: value 5000, excluded from the DCF-based averages
    { holding: h("BANK.NS", 5), row: row({ symbol: "BANK.NS", price: 1000, sector: "Financial Services", financial: true, dcfValue: 900, expectedReturn: 0.3, impliedGrowth: 2, histGrowth: 1, health: { score: 70, grade: "B", flags: [], strengths: [] } }), fx: 1 },
    // US stock: 25 x $2 x 100 = 5,000 in INR
    { holding: h("U", 25, 4), row: row({ symbol: "U", price: 2, currency: "USD", country: "United States", sector: "Technology", dcfValue: 1.5, expectedReturn: 0.06, wacc: 0.09, impliedGrowth: 5, histGrowth: 6, health: { score: 80, grade: "A", flags: [], strengths: [] } }), fx: 100 },
    // not loaded yet
    { holding: h("PENDING.NS", 3), row: null, fx: null },
  ];
  const x = xray(inputs, "INR");
  const [a, bank, u, pending] = x.positions;

  it("converts with FX and weights the valued holdings only", () => {
    expect(x.total).toBe(20000);
    expect([a.value, bank.value, u.value, pending.value]).toEqual([10000, 5000, 5000, null]);
    expect([a.weight, bank.weight, u.weight, pending.weight]).toEqual([0.5, 0.25, 0.25, null]);
    expect(x.valued).toBe(3);
    expect(x.count).toBe(4);
  });
  it("computes P&L only where there is a cost, at today's exchange rate", () => {
    expect(a.pnl).toBe(2000);
    expect(u.cost).toBe(10000);
    expect(u.pnlPct).toBeCloseTo(-0.5, 12);
    expect(x.cost).toMatchObject({ total: 18000, value: 15000, pnl: -3000, n: 2, coverage: 0.75 });
    expect(x.cost.pnlPct).toBeCloseTo(-3000 / 18000, 12);
  });
  it("value-weights the DCF figures over what they cover, leaving out banks", () => {
    // gaps: A +20% (w .5), U -25% (w .25); bank left out -> coverage 75%
    expect(x.gap.coverage).toBeCloseTo(0.75, 12);
    expect(x.gap.value).toBeCloseTo((0.5 * 0.2 + 0.25 * -0.25) / 0.75, 12);
    // equals the aggregate model value over market value - 1
    expect(x.gap.value).toBeCloseTo((10 * 1200 + 25 * 1.5 * 100) / (10000 + 5000) - 1, 12);
    expect(x.expectedReturn.value).toBeCloseTo((0.5 * 0.14 + 0.25 * 0.06) / 0.75, 12);
    expect(x.expGap.value).toBeCloseTo((0.5 * 9 + 0.25 * -1) / 0.75, 12);
    expect(x.health.value).toBeCloseTo(0.5 * 40 + 0.25 * 70 + 0.25 * 80, 12);
    expect(x.health.coverage).toBe(1);
    expect(x.weakHealth).toBe(0.5);
    expect(x.financials).toEqual(["BANK.NS"]);
    expect(bank.gap).toBeNull();
  });
  it("measures concentration", () => {
    expect(x.concentration.top?.symbol).toBe("A.NS");
    expect(x.concentration.top5).toBe(1);
    expect(x.concentration.hhi).toBeCloseTo(0.375, 12);
    expect(x.concentration.effectiveN).toBeCloseTo(1 / 0.375, 12);
    expect(concentrationOf([0.25, 0.25, 0.25, 0.25]).effectiveN).toBeCloseTo(4, 12);
    expect(concentrationOf([]).effectiveN).toBeNull();
  });
  it("builds the sector, country and currency mix", () => {
    expect(x.mix.sector.map((m) => [m.key, m.weight, m.count])).toEqual([["Technology", 0.75, 2], ["Financial Services", 0.25, 1]]);
    expect(x.mix.currency.map((m) => [m.key, m.weight])).toEqual([["INR", 0.75], ["USD", 0.25]]);
    expect(x.mix.country.map((m) => m.key)).toEqual(["India", "United States"]);
  });
  it("lists observations to look closer at", () => {
    const keys = x.observations.map((o) => o.key);
    expect(keys).toEqual(expect.arrayContaining(["pos:A.NS", "pos:BANK.NS", "pos:U", "sec:Technology", "hl:A.NS", "ex:A.NS"]));
    expect(keys).not.toContain("ex:U");
    expect(keys).not.toContain("cost:A.NS");
    expect(x.observations.find((o) => o.key === "ex:A.NS")?.detail).toMatch(/18\.0% a year.*9\.0% a year, 9\.0 points less/);
    const y = xray([{ holding: h("S.NS", 1, 100), row: row({ symbol: "S.NS", price: 1000 }), fx: 1 }], "INR");
    expect(y.observations.map((o) => o.kind)).toEqual(["position", "sector", "cost"]);
  });
  it("handles an empty or unvalued portfolio", () => {
    const e = xray([{ holding: h("P.NS", 1), row: null, fx: null }], "INR");
    expect(e.total).toBe(0);
    expect(e.gap).toEqual({ value: null, coverage: 0, n: 0 });
    expect(e.concentration).toEqual({ top: null, top5: null, hhi: null, effectiveN: null });
    expect(summarise(e)).toEqual([]);
  });
  it("leaves out a holding with no exchange rate", () => {
    const e = xray([{ holding: h("U", 1), row: row({ symbol: "U", price: 2, currency: "USD" }), fx: null }, { holding: h("A.NS", 1), row: row({ symbol: "A.NS", price: 10 }), fx: 1 }], "INR");
    expect(e.valued).toBe(1);
    expect(e.positions[0].value).toBeNull();
    expect(e.positions[1].weight).toBe(1);
  });
  it("writes a plain-English summary and a CSV that imports back", () => {
    const s = summarise(x).join(" ");
    expect(s).toMatch(/The 3 of 4 holdings valued so far are worth ₹20,000/);
    expect(s).toMatch(/a loss of ₹3,000 \(-16\.7%\)/);
    expect(s).toMatch(/not advice/);
    const csv = exportCsv(x);
    expect(csv.split("\r\n")[0]).toMatch(/^symbol,name,qty,avg_cost,currency,price,value_INR,weight/);
    const back = parseHoldings(csv, "");
    expect(back.format).toBe("csv");
    expect(back.lots).toEqual([{ symbol: "A.NS", qty: 10, avgCost: 800 }, { symbol: "BANK.NS", qty: 5 }, { symbol: "U", qty: 25, avgCost: 4 }, { symbol: "PENDING.NS", qty: 3 }]);
  });
  it("weightedMean and modelCall", () => {
    expect(weightedMean([{ w: 1, v: null }, { w: 3, v: 2 }])).toEqual({ value: 2, coverage: 0.75, n: 1 });
    expect([modelCall(0.2), modelCall(0.15), modelCall(0), modelCall(-0.11), modelCall(null)]).toEqual(["BUY", "HOLD", "HOLD", "SELL", "–"]);
  });
});

// ---------------------------------------------------------------- fetching

type Reply = { status: number; body?: unknown } | "network";
function fakeFetch(replies: Record<string, Reply[]>) {
  const calls: string[] = [];
  const f = async (url: string) => {
    calls.push(url);
    const q = replies[url];
    const r = q?.length ? q.shift()! : { status: 404, body: null };
    if (r === "network") throw new TypeError("Failed to fetch");
    return { ok: r.status < 400, status: r.status, json: async () => { if (r.body === undefined) throw new SyntaxError("not json"); return r.body; } };
  };
  return { f, calls };
}
const noWait = async () => {};

describe("fetchScanRow", () => {
  const good = row({ symbol: "INFY.NS", price: 1500 });
  it("retries once on a gateway error or network failure", async () => {
    const { f, calls } = fakeFetch({ "/api/scan/row?symbol=INFY.NS": [{ status: 502, body: { error: "x", code: "upstream" } }, { status: 200, body: { row: good } }] });
    expect(await fetchScanRow("INFY.NS", f, noWait)).toEqual({ ok: true, row: good });
    expect(calls).toHaveLength(2);
    const n = fakeFetch({ "/api/scan/row?symbol=INFY.NS": ["network", "network"] });
    expect(await fetchScanRow("INFY.NS", n.f, noWait)).toMatchObject({ ok: false, code: "network" });
    expect(n.calls).toHaveLength(2);
  });
  it("does not retry a 4xx and passes the server's message on", async () => {
    const { f, calls } = fakeFetch({ "/api/scan/row?symbol=GOLD.L": [{ status: 422, body: { error: "Funds can't be valued", code: "unsupported" } }] });
    expect(await fetchScanRow("GOLD.L", f, noWait)).toEqual({ ok: false, error: "Funds can't be valued", code: "unsupported" });
    expect(calls).toHaveLength(1);
  });
  it("tries the BSE listing when an NSE symbol is unknown", async () => {
    const bse = row({ symbol: "XYZ.BO", price: 50 });
    const { f } = fakeFetch({ "/api/scan/row?symbol=XYZ.NS": [{ status: 404, body: { error: "No data", code: "not_found" } }], "/api/scan/row?symbol=XYZ.BO": [{ status: 200, body: { row: bse } }] });
    expect(await fetchScanRow("XYZ.NS", f, noWait)).toEqual({ ok: true, row: bse, via: "XYZ.BO" });
  });
  it("reads FX rates", async () => {
    const { f } = fakeFetch({ "/api/fx?from=USD&to=INR": [{ status: 200, body: { from: "USD", to: "INR", rate: 88.2 } }], "/api/fx?from=ZZZ&to=INR": [{ status: 502, body: { error: "no" } }, { status: 502, body: { error: "no" } }] });
    expect(await fetchFx("USD", "INR", f, noWait)).toBe(88.2);
    expect(await fetchFx("INR", "INR", f, noWait)).toBe(1);
    expect(await fetchFx("ZZZ", "INR", f, noWait)).toBeNull();
  });
});

describe("mapPool", () => {
  it("keeps order and never runs more than the limit at once", async () => {
    let live = 0, peak = 0;
    const out = await mapPool([5, 1, 4, 2, 3, 6, 0], 3, async (n) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, n)); live--; return n * 2; });
    expect(out).toEqual([10, 2, 8, 4, 6, 12, 0]);
    expect(peak).toBe(3);
  });
});

describe("review regressions", () => {
  it("never turns an unrecognised exchange label into a US listing", () => {
    expect(exchangeFromCell("NSE_EQ", "NS")).toBe("NS");
    expect(exchangeFromCell("N", "BO")).toBe("NS");
    expect(exchangeFromCell("BSE EQ", "NS")).toBe("BO");
    expect(exchangeFromCell("Bombay Stock Exchange", "NS")).toBe("BO");
    expect(exchangeFromCell("NASDAQ", "NS")).toBe("");
    const unknown = new Set<string>();
    expect(exchangeFromCell("MCX-SX", "NS", unknown)).toBe("NS");
    expect([...unknown]).toEqual(["MCX-SX"]);
    const r = parseHoldings("Symbol,Exchange,Quantity\nIEX,NSE_EQ,200\nHAL,N,5\nINFY,BSE_EQ,3", "NS");
    expect(r.lots.map((l) => l.symbol)).toEqual(["IEX.NS", "HAL.NS", "INFY.BO"]);
  });
  it("reads dot thousands in decimal-comma files", () => {
    expect(parseNumber("45.000", true)).toBe(45000);
    expect(parseNumber("1.200", true)).toBe(1200);
    expect(parseNumber("125.000,50", true)).toBe(125000.5);
    expect(parseNumber("1.200")).toBe(1.2); // a comma-free file keeps the dot as the decimal mark
  });
  it("reads a quantity followed by a BSE code", () => {
    const r = parseHoldings("10 500325", "NS");
    expect(r.lots).toEqual([{ symbol: "500325.BO", qty: 10 }]);
  });
  it("updates quantities from a fresh broker snapshot instead of doubling them", () => {
    const held = [h("INFY.NS", 10, 1400), h("TCS.NS", 4)];
    const add = mergeHoldings(held, [{ symbol: "INFY.NS", qty: 12, avgCost: 1450 }], "", "add");
    expect(add.holdings.find((x) => x.symbol === "INFY.NS")!.qty).toBe(22);
    const upd = mergeHoldings(held, [{ symbol: "INFY.NS", qty: 12, avgCost: 1450 }, { symbol: "ITC.NS", qty: 50 }], "", "update");
    expect(upd.holdings.map((x) => [x.symbol, x.qty, x.avgCost])).toEqual([["INFY.NS", 12, 1450], ["TCS.NS", 4, undefined], ["ITC.NS", 50, undefined]]);
    expect(upd.combined).toEqual(["INFY.NS"]);
  });
  it("leaves a DCF value far from the price out of the averages and the calls", () => {
    const rows = [row({ symbol: "A.NS", price: 100, dcfValue: 800 }), row({ symbol: "B.NS", price: 100, dcfValue: 100 })];
    const x = xray(rows.map((r) => ({ holding: h(r.symbol, 10), row: r, fx: 1 })), "INR");
    expect(x.positions.find((p) => p.symbol === "A.NS")!.extreme).toBe(true);
    expect(x.gap.value).toBeCloseTo(0, 10); // only B counts
    expect(x.gap.coverage).toBeCloseTo(0.5, 10);
    expect(x.observations.some((o) => o.kind === "check")).toBe(true);
    expect(modelCall(7, true)).toBe("CHECK");
  });
});
