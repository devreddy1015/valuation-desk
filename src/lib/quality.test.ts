import { describe, expect, it } from "vitest";
import { altmanZ, altmanZone, beneishM, gradeFor, healthCheck, shareSteps, BENEISH_CUTOFF } from "./quality";
import type { FiscalYear, StockData } from "./types";

// A steady, cash-generative company: revenue +10% a year, margin 20%, little debt, cash above profit.
function yr(y: number, revenue: number, o: Partial<FiscalYear> = {}): FiscalYear {
  return {
    label: `FY${String(y).slice(2)}`, end: `${y}-03-31`, revenue, ebit: revenue * 0.2, da: revenue * 0.03, pbt: revenue * 0.2, tax: revenue * 0.05,
    capex: revenue * 0.03, wcInc: revenue * 0.01, netIncome: revenue * 0.15, cfo: revenue * 0.18,
    totalAssets: revenue * 1.2, currentAssets: revenue * 0.6, currentLiabilities: revenue * 0.25, totalLiabilities: revenue * 0.4, equity: revenue * 0.8,
    retainedEarnings: revenue * 0.5, longTermDebt: revenue * 0.02, totalDebt: revenue * 0.02, cash: revenue * 0.2, receivables: revenue * 0.15,
    grossProfit: revenue * 0.4, sga: revenue * 0.1, netPPE: revenue * 0.2, interestExpense: revenue * 0.002, dilutedShares: 100, dilutedEPS: revenue * 0.0015,
    dividendsPaid: revenue * 0.05, buybacks: 0, sbc: revenue * 0.005, ...o,
  };
}
function stock(history: FiscalYear[], o: Partial<StockData> = {}): StockData {
  return {
    symbol: "T", name: "Test Co", exchange: "NSE", country: "India", sector: "Technology", industry: "Software", currency: "INR", financialCurrency: "INR",
    fxNote: null, price: 100, priceTime: "", marketCap: 1e4, shares: 100, hi52: 0, lo52: 0, bookValuePerShare: null, history,
    bridge: { date: "", cash: 0, borrowings: 0, leases: 0, nci: 0, returned: 0, returnedNote: "" },
    ttm: { revenue: 0, ebitda: 0, netIncome: 0, eps: 0 }, estimates: { growthThisYear: null, growthNextYear: null, note: null },
    beta: null, yahooBeta: null, riskFree: { rate: 7, note: "", estimated: false }, erp: { value: 6, defaultSpread: 0, note: "", estimated: false },
    financial: false, warnings: [], asOf: "", source: "test", ...o,
  };
}
const healthy = [yr(2023, 1000), yr(2024, 1100), yr(2025, 1210), yr(2026, 1331)];

describe("published screens", () => {
  it("Altman Z'' = 6.56 X1 + 3.26 X2 + 6.72 X3 + 1.05 X4", () => {
    const y = yr(2026, 1000);
    // X1 = (600 - 250) / 1200, X2 = 500 / 1200, X3 = 200 / 1200, X4 = 800 / 400
    const want = 6.56 * (350 / 1200) + 3.26 * (500 / 1200) + 6.72 * (200 / 1200) + 1.05 * 2;
    expect(altmanZ(y)!.z).toBeCloseTo(want, 10);
    expect(altmanZone(2.61)).toBe("safe");
    expect(altmanZone(2.6)).toBe("grey");
    expect(altmanZone(1.09)).toBe("distress");
  });

  it("Beneish M-score is neutral (about -2.48 with TATA) for a company that changed nothing", () => {
    const b = beneishM(yr(2025, 1000), yr(2026, 1000));
    // every index is 1; TATA = (150 - 180) / 1200
    const want = -4.84 + 0.92 + 0.528 + 0.404 + 0.892 + 0.115 - 0.172 + 4.679 * (-30 / 1200) - 0.327;
    expect(b.m).toBeCloseTo(want, 10);
    expect(b.m! > BENEISH_CUTOFF).toBe(false);
  });

  it("flags receivables racing ahead of sales and profit without cash", () => {
    const p = yr(2025, 1000), t = yr(2026, 1100, { receivables: 1100 * 0.4, cfo: 1100 * 0.02 });
    const b = beneishM(p, t);
    expect(b.parts.find((x) => x.key === "dsri")!.value).toBeCloseTo(0.4 / 0.15, 10);
    expect(b.m! > BENEISH_CUTOFF).toBe(true);
  });

  it("grades by score band", () => {
    expect([gradeFor(80), gradeFor(79.9), gradeFor(65), gradeFor(50), gradeFor(35), gradeFor(34), gradeFor(null)]).toEqual(["A", "B", "B", "C", "D", "E", "–"]);
  });
});

describe("healthCheck", () => {
  it("rates a steady, cash-generative business highly", () => {
    const r = healthCheck(stock(healthy));
    expect(["A", "B"]).toContain(r.grade);
    expect(r.altman!.zone).toBe("safe");
    expect(r.beneish!.flag).toBe(false);
    expect(r.flags).toHaveLength(0);
    expect(r.summary.startsWith(`Grade ${r.grade} (${r.score}/100): `)).toBe(true);
    expect(r.summary).toContain(r.verdict!);
  });

  it("rates a loss-making, over-borrowed business poorly and words the loss without a double minus", () => {
    const bad = [1000, 950, 900, 850].map((rev, i) => yr(2023 + i, rev, {
      ebit: -rev * 0.05, netIncome: -rev * 0.1, pbt: -rev * 0.1, cfo: -rev * 0.05, equity: -rev * 0.2, retainedEarnings: -rev * 0.8,
      totalLiabilities: rev * 1.4, currentLiabilities: rev * 0.9, currentAssets: rev * 0.3, longTermDebt: rev * (0.5 + i * 0.1), totalDebt: rev * (0.6 + i * 0.1),
    }));
    const r = healthCheck(stock(bad));
    expect(["D", "E"]).toContain(r.grade);
    expect(r.altman!.zone).toBe("distress");
    const loss = r.flags.find((f) => f.startsWith("Loss-making"))!;
    expect(loss).toMatch(/a net loss of ₹/);
    expect(loss).not.toMatch(/loss of −/);
  });

  it("does not call a high score with a serious red flag 'mostly healthy'", () => {
    // a strong record with a loss in the last year: still grade B on the blend, but loss-making
    const h = healthy.map((y, i) => (i === 3 ? { ...y, netIncome: -20, pbt: -20 } : y));
    const r = healthCheck(stock(h));
    expect(r.grade).toBe("B");
    expect(r.flags.some((f) => /^Loss-making|^Weak fundamentals/.test(f))).toBe(true);
    expect(r.verdict).toMatch(/^shows a mixed picture/);
  });

  it("treats a 1:1 bonus issue as no dilution", () => {
    const h = healthy.map((y, i) => ({ ...y, dilutedShares: i < 3 ? 100 : 200 }));
    const s = shareSteps(h);
    expect(s[2]!.split).toBe(2);
    expect(s[2]!.real).toBeCloseTo(1, 10);
    const r = healthCheck(stock(h));
    expect(r.piotroski!.tests.find((t) => t.key === "shares")!.pass).toBe(true);
    expect(r.flags.some((f) => /diluted/.test(f))).toBe(false);
  });

  it("grades a lender on lender ratios, without the industrial screens", () => {
    // a growing lender: loan growth makes operating cash flow negative every year
    const h = [1000, 1150, 1320, 1520].map((rev, i) => yr(2023 + i, rev, { cfo: -rev * 0.8, totalAssets: rev * 10, equity: rev * 1.8, netIncome: rev * 0.25, longTermDebt: rev * (6 + i * 0.3) }));
    const r = healthCheck(stock(h, { financial: true, sector: "Financial Services", industry: "Credit Services" }));
    expect(r.piotroski).toBeNull();
    expect(r.altman).toBeNull();
    expect(r.beneish).toBeNull();
    expect(r.flags.some((f) => /Operations used cash/.test(f))).toBe(false);
    expect(r.metrics.find((m) => m.key === "roa")!.verdict).toBe("good"); // 2.5% on assets
    expect(["A", "B"]).toContain(r.grade); // profitable, well capitalised and growing: no screen drags it down
  });

  it("does not judge an insurer's assets by a bank's yardstick", () => {
    const h = [1000, 1100, 1210, 1331].map((rev, i) => yr(2023 + i, rev, { totalAssets: rev * 20, equity: rev * 0.8, netIncome: rev * 0.08 }));
    const r = healthCheck(stock(h, { financial: true, sector: "Financial Services", industry: "Insurance - Life" }));
    expect(r.metrics.find((m) => m.key === "roa")!.verdict).toBe("info");
    expect(r.metrics.find((m) => m.key === "eqassets")!.verdict).toBe("info");
    expect(r.flags.some((f) => /capital cushion|Thin profitability/.test(f))).toBe(false);
  });

  it("flags a financial firm's loss", () => {
    const h = healthy.map((y, i) => ({ ...y, netIncome: i === 3 ? -50 : y.netIncome }));
    const r = healthCheck(stock(h, { financial: true, sector: "Financial Services", industry: "Banks - Regional" }));
    expect(r.flags.some((f) => /^Loss-making: a net loss of ₹/.test(f))).toBe(true);
  });

  it("measures ROE on average equity", () => {
    const r = healthCheck(stock(healthy));
    const L = healthy[3], P = healthy[2];
    expect(r.metrics.find((m) => m.key === "roe")!.value).toBeCloseTo(L.netIncome / ((L.equity! + P.equity!) / 2), 10);
  });

  it("needs two years", () => {
    const r = healthCheck(stock([healthy[0]]));
    expect(r.grade).toBe("–");
    expect(r.score).toBeNull();
  });

  it("survives missing lines", () => {
    const sparse = healthy.map((y) => ({ label: y.label, end: y.end, revenue: y.revenue, ebit: y.ebit, da: y.da, pbt: y.pbt, tax: y.tax, capex: y.capex, wcInc: y.wcInc, netIncome: y.netIncome }));
    const r = healthCheck(stock(sparse));
    expect(r.altman).toBeNull();
    expect(r.beneish).toBeNull();
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it("does not claim a currency conversion when the statements were already in the quote currency", () => {
    const r = healthCheck(stock(healthy, { fxNote: "Yahoo labels these statements USD but serves them in INR", financialCurrency: "INR", currency: "INR" }));
    expect(r.notes.some((n) => /converted from/.test(n))).toBe(false);
  });
});
