import { describe, expect, it } from "vitest";
import {
  blend, callFor, compsValueFor, filterRows, meetsGrade, parseTickers, peerGroup, peerMedians, scoreRows, sortRows, summarize, toCsv, viewFor, NO_FILTERS,
} from "./scanMath";
import type { HealthGrade, ScanRow } from "./scanTypes";

/** A synthetic row: price 100, 10 shares, no debt, with overrides. */
function row(symbol: string, o: Partial<ScanRow> = {}): ScanRow {
  return {
    symbol, name: symbol, exchange: "NSE", country: "India", sector: "Technology", industry: "Software", currency: "INR",
    price: 100, marketCap: 1000, financial: false,
    dcfValue: null, wacc: 0.12, impliedGrowth: null, histGrowth: null, expectedReturn: null, growthShare: null, fcfYield: null,
    pe: 20, evEbitda: 10, pb: 3, eps: 5, ebitda: 100, netCash: 0, shares: 10, bookValuePerShare: 30,
    health: { score: null, grade: "–", flags: [], strengths: [] }, warnings: [], asOf: "2026-10-22T00:00:00.000Z",
    ...o,
  };
}
const health = (grade: HealthGrade, score: number | null, flags: string[] = []) => ({ score, grade, flags, strengths: [] });

describe("peer groups inside the scanned list", () => {
  it("leaves the stock itself out of its own medians", () => {
    const rows = [row("A", { pe: 100 }), row("B", { pe: 10 }), row("C", { pe: 20 }), row("D", { pe: 30 })];
    const g = peerGroup(rows, 0);
    expect(g.basis).toBe("industry");
    expect(g.peers.map((p) => p.symbol)).toEqual(["B", "C", "D"]);
    expect(peerMedians(g.peers).pe).toBe(20); // A's own 100x would have pulled the median to 25
  });

  it("falls back to the sector, then the whole list, then none", () => {
    const rows = [
      row("A", { industry: "Software" }), row("B", { industry: "Software" }),
      row("C", { industry: "IT Services" }), row("D", { industry: "IT Services" }),
      row("E", { sector: "Energy", industry: "Oil" }),
    ];
    expect(peerGroup(rows, 0).basis).toBe("sector"); // only 1 other in Software, 3 in Technology
    expect(peerGroup(rows, 0).peers.map((p) => p.symbol)).toEqual(["B", "C", "D"]);
    expect(peerGroup(rows, 4).basis).toBe("list"); // alone in Energy: the other four
    expect(peerGroup(rows, 4).peers).toHaveLength(4);
    expect(peerGroup(rows.slice(0, 3), 0).basis).toBe("none"); // two others are too few for a median
  });

  it("counts only peers with usable multiples towards the threshold", () => {
    const rows = [row("A"), row("B"), row("C"), row("D", { pe: -5, evEbitda: 900 }), row("E", { industry: "Other" })];
    expect(peerGroup(rows, 0).basis).toBe("sector"); // D has no valid multiple, so Software has 2
  });

  it("applies the desk's validity filters to multiples", () => {
    const m = peerMedians([row("B", { pe: 600, evEbitda: 250, pb: 150 }), row("C", { pe: 0, evEbitda: -3, pb: 0 }), row("D", { pe: 15, evEbitda: 8, pb: 2 })]);
    expect(m).toEqual({ pe: 15, evEbitda: 8, pb: 2 });
  });

  it("compares banks and insurers only with each other", () => {
    const banks = ["H", "I", "K"].map((s) => row(s, { financial: true, sector: "Financial Services", industry: "Banks - Regional", pe: 18, pb: 2.5, evEbitda: null }));
    const rows = [...banks, row("X", { sector: "Financial Services", industry: "Banks - Regional" }), row("Y"), row("Z")];
    const g = peerGroup(rows, 0);
    expect(g.basis).toBe("none"); // two other banks only; non-banks in the same industry never count
    expect(peerGroup([...rows, row("L", { financial: true, sector: "Financial Services", industry: "Banks - Regional", pe: 20, pb: 3 })], 0).peers.map((p) => p.symbol)).toEqual(["I", "K", "L"]);
  });
});

describe("peer value and blend", () => {
  it("averages the EV/EBITDA and P/E prices for a non-financial", () => {
    const r = row("A", { ebitda: 100, netCash: 50, shares: 10, eps: 5 });
    // EV/EBITDA: (10 x 100 + 50) / 10 = 105; P/E: 20 x 5 = 100
    expect(compsValueFor(r, { evEbitda: 10, pe: 20, pb: 3 })).toBeCloseTo(102.5, 10);
  });
  it("skips a part whose inputs are not positive", () => {
    expect(compsValueFor(row("A", { eps: -2 }), { evEbitda: 10, pe: 20, pb: null })).toBeCloseTo(100, 10); // EV part only
    expect(compsValueFor(row("A", { eps: -2, ebitda: -10 }), { evEbitda: 10, pe: 20, pb: null })).toBeNull();
    expect(compsValueFor(row("A"), { evEbitda: null, pe: null, pb: null })).toBeNull();
  });
  it("uses P/E and P/B for banks and insurers, never EV/EBITDA", () => {
    const bank = row("H", { financial: true, eps: 10, bookValuePerShare: 80, ebitda: 1e9 });
    expect(compsValueFor(bank, { evEbitda: 10, pe: 15, pb: 2 })).toBeCloseTo((150 + 160) / 2, 10);
    expect(compsValueFor({ ...bank, bookValuePerShare: null }, { evEbitda: 10, pe: 15, pb: 2 })).toBeCloseTo(150, 10);
  });
  it("blends 50/50 when both values are positive, else uses whichever is", () => {
    expect(blend(120, 80)).toEqual({ value: 100, method: "dcf+peers" });
    expect(blend(120, null)).toEqual({ value: 120, method: "dcf" });
    expect(blend(-40, 80)).toEqual({ value: 80, method: "peers" });
    expect(blend(null, -1)).toEqual({ value: null, method: "none" });
  });
});

describe("scoring a list", () => {
  const rows = [
    row("A", { dcfValue: 150, pe: 20, evEbitda: 10, impliedGrowth: 4.1, histGrowth: 9.8, expectedReturn: 0.18, health: health("A", 85) }),
    row("B", { dcfValue: 80, pe: 10, evEbitda: 6, impliedGrowth: 12, histGrowth: 6, expectedReturn: 0.08, health: health("C", 55, ["Debt is rising"]) }),
    row("C", { dcfValue: null, pe: 30, evEbitda: 14, expectedReturn: null, health: health("B", 70) }),
    row("D", { dcfValue: 110, pe: 25, evEbitda: 12, impliedGrowth: 7, histGrowth: 7, expectedReturn: 0.13 }),
    row("H", { financial: true, sector: "Financial Services", industry: "Banks", pe: 15, pb: 2, evEbitda: null }),
  ];
  const groups: Record<string, string> = { A: "Information Technology", H: "Financial Services" };
  const S = scoreRows(rows, (s) => groups[s]);

  it("fills the leave-one-out peer value, model value and gaps", () => {
    const a = S[0];
    expect(a.peers.basis).toBe("industry");
    expect(a.peers.n).toBe(3); // B, C, D: the bank is excluded
    expect(a.peers.pe).toBe(25); // median of 10, 30, 25
    expect(a.peers.evEbitda).toBe(12); // median of 6, 14, 12
    expect(a.compsValue).toBeCloseTo((120 + 125) / 2, 10); // (12 x 100 + 0) / 10 and 25 x 5
    expect(a.modelValue).toBeCloseTo((150 + 122.5) / 2, 10);
    expect(a.method).toBe("dcf+peers");
    expect(a.valueGap).toBeCloseTo(136.25 / 100 - 1, 10);
    expect(a.expectationsGap).toBeCloseTo(4.1 - 9.8, 10);
    expect(a.group).toBe("Information Technology");
    expect(S[1].group).toBe("Technology"); // no index label: Yahoo sector
  });
  it("leaves a missing DCF to the peers and a lone bank unvalued", () => {
    expect(S[2].method).toBe("peers");
    expect(S[2].modelValue).toBe(S[2].compsValue);
    expect(S[2].expectationsGap).toBeNull();
    expect(S[4].peers.basis).toBe("none");
    expect(S[4].modelValue).toBeNull();
    expect(S[4].valueGap).toBeNull();
  });
  it("sorts with missing values last in both directions", () => {
    const byGapDesc = sortRows(S, { key: "valueGap", dir: -1 }).map((r) => r.symbol);
    const byGapAsc = sortRows(S, { key: "valueGap", dir: 1 }).map((r) => r.symbol);
    expect(byGapDesc.at(-1)).toBe("H");
    expect(byGapAsc.at(-1)).toBe("H");
    expect(byGapDesc[0]).toBe("A");
    expect(sortRows(S, { key: "expectationsGap", dir: 1 }).map((r) => r.symbol).slice(0, 3)).toEqual(["A", "D", "B"]);
    expect(sortRows(S, { key: "health", dir: -1 }).map((r) => r.symbol).slice(0, 3)).toEqual(["A", "C", "B"]);
    expect(sortRows(S, { key: "name", dir: 1 }).map((r) => r.symbol)).toEqual(["A", "B", "C", "D", "H"]);
    expect(viewFor({ key: "valueGap", dir: -1 })).toBe("gap");
    expect(viewFor({ key: "pe", dir: 1 })).toBeNull();
  });
  it("filters by group, kind and minimum health grade", () => {
    expect(filterRows(S, { ...NO_FILTERS, hideFinancials: true }).map((r) => r.symbol)).not.toContain("H");
    expect(filterRows(S, { ...NO_FILTERS, minGrade: "B" }).map((r) => r.symbol)).toEqual(["A", "C"]);
    expect(filterRows(S, { ...NO_FILTERS, group: "Technology" }).map((r) => r.symbol)).toEqual(["B", "C", "D"]);
    expect(meetsGrade("–", "E")).toBe(false);
    expect(meetsGrade("–", "any")).toBe(true);
  });
  it("summarises the list", () => {
    const s = summarize(S);
    expect(s.n).toBe(5);
    expect(s.valued).toBe(4);
    expect(s.above15).toBe(S.filter((r) => (r.valueGap ?? -1) > 0.15).length);
    expect(s.graded).toBe(3);
    expect(s.healthAB).toBe(2);
    expect(s.medianReturn).toBeCloseTo(0.13, 10);
    expect(s.medianWacc).toBeCloseTo(0.12, 10);
    expect(summarize([])).toMatchObject({ n: 0, medianGap: null, medianReturn: null });
  });
  it("gives calls on the desk's default thresholds", () => {
    expect(callFor(0.2)).toBe("BUY");
    expect(callFor(0.15)).toBe("HOLD");
    expect(callFor(-0.1)).toBe("HOLD");
    expect(callFor(-0.11)).toBe("SELL");
    expect(callFor(null)).toBeNull();
  });
  it("builds a CSV with escaping and an optional call column", () => {
    const csv = toCsv([{ ...S[0], name: 'Alpha, "the" Co' }], { calls: true });
    const [head, line] = csv.trim().split("\r\n");
    expect(head.split(",")).toContain("Call (model output)");
    expect(line).toContain('"Alpha, ""the"" Co"');
    expect(line).toContain(",BUY,");
    expect(toCsv(S, { calls: false })).not.toContain("Call");
    expect(toCsv(S, { calls: false }).trim().split("\r\n")).toHaveLength(6);
  });
});

describe("typed tickers", () => {
  it("adds the bare suffix, honours prefixes and BSE codes, and drops duplicates", () => {
    const r = parseTickers("infy, TCS.NS\nNSE:HDFCBANK BSE:RELIANCE 500325 tcs ^NSEI", "NS");
    expect(r.symbols).toEqual(["INFY.NS", "TCS.NS", "HDFCBANK.NS", "RELIANCE.BO", "500325.BO", "^NSEI"]);
    expect(parseTickers("AAPL MSFT", "none").symbols).toEqual(["AAPL", "MSFT"]);
    expect(parseTickers("M&M BAJAJ-AUTO", "BO").symbols).toEqual(["M&M.BO", "BAJAJ-AUTO.BO"]);
    expect(parseTickers("BAD/TICKER", "NS").invalid).toEqual(["BAD/TICKER"]);
  });
  it("caps a list at 150", () => {
    const r = parseTickers(Array.from({ length: 160 }, (_, i) => `S${i}`).join(" "));
    expect(r.symbols).toHaveLength(150);
    expect(r.truncated).toBe(true);
  });
});

describe("review regressions", () => {
  it("never values a financial firm on a different kind of financial firm", () => {
    const rows = [
      row("LIFE1", { financial: true, sector: "Financial Services", industry: "Insurance - Life", pe: 60, pb: 8 }),
      row("LIFE2", { financial: true, sector: "Financial Services", industry: "Insurance - Life", pe: 70, pb: 9 }),
      row("BANK1", { financial: true, sector: "Financial Services", industry: "Banks - Regional", pe: 12, pb: 2 }),
      row("BANK2", { financial: true, sector: "Financial Services", industry: "Banks - Regional", pe: 14, pb: 2.2 }),
      row("BANK3", { financial: true, sector: "Financial Services", industry: "Banks - Regional", pe: 13, pb: 2.1 }),
      row("NBFC", { financial: true, sector: "Financial Services", industry: "Credit Services", pe: 25, pb: 4 }),
    ];
    expect(peerGroup(rows, 0).basis).toBe("none"); // one other insurer: no peer value, never the banks
    const bank = peerGroup(rows, 2);
    expect(bank.basis).toBe("family"); // two other banks are too few; banks and NBFCs are both lenders
    expect(bank.peers.map((p) => p.symbol).sort()).toEqual(["BANK2", "BANK3", "NBFC"]);
  });
  it("gives no call to a value far from the price and marks it in the CSV", () => {
    const rows = scoreRows([row("X", { dcfValue: 900 }), row("Y"), row("Z"), row("W")]); // (900 DCF + 100 peers) / 2 = 5x the price
    const x = rows.find((r) => r.symbol === "X")!;
    expect(x.extreme).toBe(true);
    expect(callFor(x.valueGap, x.extreme)).toBeNull();
    const csv = toCsv(rows, { calls: true });
    expect(csv.split("\r\n")[0]).toMatch(/Check first/);
    expect(csv.split("\r\n").find((l) => l.startsWith("X,"))).toMatch(/,yes,.*CHECK/);
  });
  it("defuses spreadsheet formulas in text cells", () => {
    const csv = toCsv(scoreRows([row("Q", { name: '=HYPERLINK("http://x","y")' })]), { calls: false });
    expect(csv).toMatch(/"'=HYPERLINK/);
  });
});

