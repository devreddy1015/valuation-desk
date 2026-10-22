import { describe, expect, it } from "vitest";
import { compute } from "./model";
import { lastRoe, returnsFor, solveRoot } from "./returns";
import type { Drivers, FiscalYear, StockData, UserInputs } from "./types";

// A flat business that is easy to value by hand: revenue 1,000 every year, EBIT margin 10%,
// tax 25%, D&A = capex, no working capital. Free cash flow is 75 a year for ever.
const year = (y: number, over: Partial<FiscalYear> = {}): FiscalYear => ({
  label: String(y), end: `${y}-12-31`, revenue: 1000, ebit: 100, da: 30, pbt: 100, tax: 25, capex: 30, wcInc: 0, netIncome: 75, equity: 500, ...over,
});
function mk(over: Partial<StockData> = {}): StockData {
  return {
    symbol: "FLAT", name: "Flat Co", exchange: "TEST", country: "United States", sector: "Industrials", industry: "Machinery",
    currency: "USD", financialCurrency: "USD", fxNote: null, price: 100, priceTime: "2025-12-31T00:00:00Z", marketCap: 1000, shares: 10,
    hi52: 120, lo52: 80, bookValuePerShare: 50,
    history: [year(2023), year(2024), year(2025)],
    bridge: { date: "2025-12-31", cash: 50, borrowings: 0, leases: 0, nci: 0, returned: 0, returnedNote: "" },
    ttm: { revenue: 1000, ebitda: 130, netIncome: 75, eps: 7.5 },
    estimates: { growthThisYear: null, growthNextYear: null, note: null },
    beta: null, yahooBeta: 1,
    riskFree: { rate: 4, note: "", estimated: false }, erp: { value: 6, defaultSpread: 0, note: "", estimated: false },
    financial: false, warnings: [], asOf: "2025-12-31T00:00:00Z", source: "test", ...over,
  };
}
const rep = (v: number) => [v, v, v, v, v];
const flat: Drivers = { growth: rep(0), margin: rep(10), tax: rep(25), da: rep(3), capex: rep(3), wc: rep(0) };
function inputs(price: number, g = 0, d: Drivers = flat): UserInputs {
  return {
    scenario: "base", assume: { bear: d, base: d, bull: d },
    rate: { rf: 4, spread: 0, beta: 1, erp: 6, kd: 5, g }, // cost of equity 4% + 1 x 6% = 10%, no debt so WACC = 10%
    price, dcfWeight: 100, buy: 15, sell: -10, probs: { bear: 25, base: 50, bull: 25 }, usePW: false,
    mc: { g: 2, m: 1.5, w: 1, t: 0.5, seed: 1 }, peers: {},
  };
}
const VAL = Date.UTC(2025, 11, 31);

/** Value per share by hand: 75 a year discounted at r over the model's year fractions, plus a growing perpetuity, plus cash 50, over 10 shares. */
function byHand(r: number, t: number[], g = 0) {
  const pv = t.reduce((s, ti) => s + 75 / Math.pow(1 + r, ti), 0);
  const tv = (75 * (1 + g)) / (r - g) / Math.pow(1 + r, t[4]);
  return (pv + tv + 50) / 10;
}

describe("returnsFor on a flat business", () => {
  it("expected return solves value = price, near the perpetuity answer 75 / EV", () => {
    const d = mk(), inp = inputs(80), R = compute(inp, d, [], VAL);
    expect(R.wacc).toBeCloseTo(0.1, 12);
    const r = returnsFor(inp, d, R);
    expect(r.irrStatus).toBe("ok");
    expect(byHand(r.irr!, R.t)).toBeCloseTo(80, 6); // equity 800 => EV 750 => r = 75 / 750 = 10% with whole years
    expect(r.irr!).toBeCloseTo(0.1, 3);
    expect(r.spread!).toBeCloseTo(r.irr! - 0.1, 12);
  });

  it("a higher price means a lower expected return", () => {
    const d = mk(), inp = inputs(100), R = compute(inp, d, [], VAL);
    const r = returnsFor(inp, d, R);
    expect(byHand(r.irr!, R.t)).toBeCloseTo(100, 6);
    expect(r.irr!).toBeCloseTo(75 / 950, 3); // EV 950
    expect(r.spread!).toBeLessThan(0);
  });

  it("handles terminal growth", () => {
    const d = mk(), inp = inputs(150, 2), R = compute(inp, d, [], VAL);
    const r = returnsFor(inp, d, R);
    expect(byHand(r.irr!, R.t, 0.02)).toBeCloseTo(150, 6);
    expect(r.irr!).toBeGreaterThan(0.02 + 0.0025);
  });

  it("earnings power value, growth share and yields", () => {
    const d = mk(), inp = inputs(100), R = compute(inp, d, [], VAL);
    const r = returnsFor(inp, d, R);
    expect(r.epv!).toBeCloseTo((75 / 0.1 + 50) / 10, 10); // 80 a share
    expect(r.growthShare!).toBeCloseTo(0.2, 10);
    expect(r.epvParts!.nopat).toBeCloseTo(75, 10);
    expect(r.earningsYield!).toBeCloseTo(0.075, 12);
    expect(r.bondYield).toBeCloseTo(0.04, 12);
    expect(r.fcfYield!).toBeCloseTo(75 / 1000, 12);
    expect(r.roe!).toBeCloseTo(75 / 500, 12);
    expect(r.notes.length).toBeGreaterThanOrEqual(4);
  });

  it("growth share is 0 when today's profits cover the price", () => {
    const d = mk({ price: 70 }), inp = inputs(70), R = compute(inp, d, [], VAL);
    const r = returnsFor(inp, d, R);
    expect(r.growthShare).toBe(0);
    expect(r.notes.join(" ")).toMatch(/profits alone cover the price/);
  });

  it("no earnings power value after an operating loss", () => {
    const d = mk({ history: [year(2023), year(2024), year(2025, { ebit: -20 })] }), inp = inputs(100), R = compute(inp, d, [], VAL);
    const r = returnsFor(inp, d, R);
    expect(r.epv).toBeNull();
    expect(r.growthShare).toBeNull();
    expect(r.notes.join(" ")).toMatch(/no operating profit/);
  });

  it("negative earnings power value when debt exceeds capitalised profit", () => {
    const d = mk({ bridge: { date: "2025-12-31", cash: 0, borrowings: 900, leases: 0, nci: 0, returned: 0, returnedNote: "" } });
    // debt at 12% (9% after tax) keeps the WACC near 9-10%, so 75 / WACC is about 800, below the 900 of debt
    const inp = { ...inputs(20), rate: { ...inputs(20).rate, kd: 12 } }, R = compute(inp, d, [], VAL);
    const r = returnsFor(inp, d, R);
    expect((75 / R.wacc - 900) / 10).toBeCloseTo(r.epv!, 10);
    expect(r.epv!).toBeLessThan(0);
    expect(r.growthShare).toBe(1);
  });

  it("says why there is no expected return", () => {
    const d = mk();
    const hi = returnsFor(inputs(1e6), d, compute(inputs(1e6), d, [], VAL));
    expect(hi.irr).toBeNull();
    expect(hi.irrStatus).toBe("below-range");
    const lo = returnsFor(inputs(1), d, compute(inputs(1), d, [], VAL));
    expect(lo.irr).toBeNull();
    expect(lo.irrStatus).toBe("above-range");
  });

  it("banks and insurers get no DCF-based outputs", () => {
    const d = mk({ financial: true }), inp = inputs(100), R = compute(inp, d, [], VAL);
    const r = returnsFor(inp, d, R);
    expect(r.irr).toBeNull();
    expect(r.irrStatus).toBe("financial");
    expect(r.epv).toBeNull();
    expect(r.fcfYield).toBeNull();
    expect(r.earningsYield!).toBeCloseTo(0.075, 12);
  });

  it("survives a broken DCF and missing numbers", () => {
    const d = mk({ ttm: { revenue: 1000, ebitda: 130, netIncome: NaN, eps: NaN } });
    const inp = inputs(100, 12); // g above the WACC: no DCF
    const R = compute(inp, d, [], VAL);
    const r = returnsFor(inp, d, R);
    expect(r.irr).toBeNull();
    expect(r.irrStatus).toBe("no-dcf");
    expect(r.earningsYield).toBeNull();
  });
});

describe("helpers", () => {
  it("solveRoot finds the first crossing", () => {
    expect(solveRoot((x) => x * x - 2, 0, 3)).toBeCloseTo(Math.SQRT2, 10);
    expect(solveRoot((x) => x + 10, 0, 3)).toBeNaN();
  });
  it("ROE uses average equity when the prior year is known", () => {
    expect(lastRoe([year(2024, { equity: 400 }), year(2025, { equity: 600, netIncome: 100 })]).roe).toBeCloseTo(0.2, 12);
    expect(lastRoe([year(2025, { equity: null })]).roe).toBeNull();
  });
});

describe("a realistic case (Infosys starter figures, Rs crore)", () => {
  const years = ["2022", "2023", "2024", "2025", "2026"];
  const rev = [121641, 146767, 153670, 162990, 178650], ebit = [28015, 30905, 31747, 34424, 36089];
  const infy = mk({
    symbol: "INFY.NS", currency: "INR", price: 1163.25, shares: 405.29, marketCap: 472241,
    history: years.map((y, i) => ({ ...year(+y), label: "FY" + y.slice(2), end: `${y}-03-31`, revenue: rev[i], ebit: ebit[i] })),
    bridge: { date: "2026-03-31", cash: 43075, borrowings: 0, leases: 9176, nci: 0, returned: 10123, returnedNote: "" },
    ttm: { revenue: 184582, ebitda: 43911, netIncome: 30288, eps: 30288 / 405.29 },
  });
  const base: Drivers = { growth: [9.5, 7, 7, 7, 7], margin: rep(21), tax: rep(28), da: rep(2.9), capex: rep(1.6), wc: rep(20) };
  const inp: UserInputs = { ...inputs(1163.25, 5, base), rate: { rf: 7.437, spread: 1.75, beta: 0.8, erp: 6.92, kd: 8, g: 5 } };
  const R = compute(inp, infy, [], Date.UTC(2026, 9, 21));
  const r = returnsFor(inp, infy, R);
  it("expected return reprices the DCF to today's price and beats the WACC when the DCF is above the price", () => {
    expect(R.live.vps).toBeGreaterThan(inp.price);
    expect(R.dcf(base, r.irr!, R.g).vps).toBeCloseTo(inp.price, 6);
    expect(r.irr!).toBeGreaterThan(R.wacc);
    expect(r.irr!).toBeLessThan(0.2);
  });
  it("earnings power value is FY26 EBIT after tax over the WACC, plus the bridge", () => {
    expect(r.epv!).toBeCloseTo(((36089 * 0.72) / R.wacc + R.bridge) / 405.29, 8);
    expect(r.growthShare!).toBeGreaterThan(0);
    expect(r.growthShare!).toBeLessThan(1);
  });
});
