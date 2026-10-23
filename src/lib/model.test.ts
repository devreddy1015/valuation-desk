import { describe, expect, it } from "vitest";
import { compute, histAverages, impliedRoot, monteCarlo, percentile, roundTarget, starterDrivers } from "./model";
import type { PeerRow, StockData, UserInputs } from "./types";

// Infosys, as verified in the Excel workbook and the earlier Claude page (Rs crore, shares in crore).
const years = ["2022", "2023", "2024", "2025", "2026"];
const h = {
  revenue: [121641, 146767, 153670, 162990, 178650],
  ebit: [28015, 30905, 31747, 34424, 36089],
  da: [3476, 4225, 4678, 4812, 4902],
  pbt: [30110, 33322, 35988, 37608, 39995],
  tax: [7964, 9214, 9740, 10858, 10521],
  capex: [2161, 2579, 2201, 2237, 2727],
  wcInc: [1424, 6344, 5082, 295, 2639],
};
const infy: StockData = {
  symbol: "INFY.NS", name: "Infosys", exchange: "NSE", country: "India", sector: "Technology", industry: "Information Technology Services",
  currency: "INR", financialCurrency: "INR", fxNote: null, price: 1163.25, priceTime: "2026-10-21T08:49:00Z", marketCap: 472241, shares: 405.29,
  hi52: 1728, lo52: 980.4, bookValuePerShare: null,
  history: years.map((y, i) => ({ label: "FY" + y.slice(2), end: `${y}-03-31`, revenue: h.revenue[i], ebit: h.ebit[i], da: h.da[i], pbt: h.pbt[i], tax: h.tax[i], capex: h.capex[i], wcInc: h.wcInc[i], netIncome: 0 })),
  bridge: { date: "2026-03-31", cash: 43075, borrowings: 0, leases: 9176, nci: 0, returned: 10123, returnedNote: "" },
  ttm: { revenue: 184582, ebitda: 43911, netIncome: 30288, eps: 30288 / 405.29 },
  compsNetCash: 37065 - 8737,
  estimates: { growthThisYear: null, growthNextYear: null, note: null },
  beta: null, yahooBeta: null,
  riskFree: { rate: 7.437, note: "", estimated: false }, erp: { value: 6.92, defaultSpread: 1.75, note: "", estimated: false },
  financial: false, warnings: [], asOf: "2026-10-21", source: "test",
};
const uni = [
  ["TCS.NS", 2460.9, 361.8, 54640, 0, 11808, 283248, 74916, 51608],
  ["HCLTECH.NS", 1379.9, 271.4, 25457, 954, 5059, 138052, 28471, 18320],
  ["WIPRO.NS", 182.14, 990.5, 43654, 18502, 3604, 97023, 18969, 13173],
  ["TECHM.NS", 1779.1, 88.6, 7321, 59, 2125, 61361, 10552, 5527],
  ["LTM.NS", 4264.9, 29.65, 15189, 0, 2383, 45488, 8130, 5195],
] as const;
const peers: PeerRow[] = uni.map(([symbol, price, sh, cash, borr, lease, rev, ebitda, np]) => {
  const mc = price * sh, ev = mc - cash + borr + lease;
  return { symbol, name: symbol, industry: "", currency: "INR", marketCap: mc, evEbitda: ev / ebitda, pe: mc / np, evSales: ev / rev, pb: null, margin: null, growth: null };
});
const rep5 = (v: number) => [v, v, v, v, v];
const inputs: UserInputs = {
  scenario: "base",
  assume: {
    bear: { growth: [6, 3, 4, 4, 4], margin: [20, 19.5, 19, 19, 19], tax: rep5(28), da: rep5(2.9), capex: rep5(1.6), wc: rep5(25) },
    base: { growth: [9.5, 7, 7, 7, 7], margin: rep5(21), tax: rep5(28), da: rep5(2.9), capex: rep5(1.6), wc: rep5(20) },
    bull: { growth: [11.5, 10, 9.5, 9, 8.5], margin: [21.5, 22, 22.5, 22.5, 22.5], tax: rep5(28), da: rep5(2.9), capex: rep5(1.6), wc: rep5(15) },
  },
  rate: { rf: 7.437, spread: 1.75, beta: 0.8, erp: 6.92, kd: 8, g: 5 },
  price: 1163.25, dcfWeight: 50, buy: 15, sell: -10,
  probs: { bear: 25, base: 50, bull: 25 }, usePW: false, mc: { g: 2, m: 1.5, w: 1, t: 0.5, seed: 1 },
  peers: Object.fromEntries(peers.map((p) => [p.symbol, true])),
};
const VAL = Date.UTC(2026, 9, 21);

describe("valuation engine reproduces the verified Infosys workbook", () => {
  const R = compute(inputs, infy, peers, VAL);
  it("DCF values per scenario", () => {
    expect(R.scen.bear.vps).toBeCloseTo(1150.4049001614067, 9);
    expect(R.scen.base.vps).toBeCloseTo(1406.846815659972, 9);
    expect(R.scen.bull.vps).toBeCloseTo(1649.695235023863, 9);
    expect(R.wacc).toBeCloseTo(0.11118702451987494, 12);
  });
  it("comps value, price target and rating", () => {
    expect(R.compsValue).toBeCloseTo(1474.3765344554781, 9);
    expect(R.pt).toBe(1440);
    expect(R.rating).toBe("BUY");
    expect(R.sens[2][2]).toBeCloseTo(R.live.vps, 9);
  });
  it("reverse DCF gives back today's price", () => {
    const back = R.dcf({ ...inputs.assume.base, growth: Array(5).fill(R.impliedGrowth) }, R.wacc, R.g).vps;
    expect(back).toBeCloseTo(1163.25, 4);
    expect(R.impliedGrowth).toBeLessThan(R.liveAvgGrowth);
  });
  it("probability-weighted DCF is the weighted mean", () => {
    expect(R.pw).toBeCloseTo((25 * 1150.4049001614067 + 50 * 1406.846815659972 + 25 * 1649.695235023863) / 100, 6);
  });
});

describe("edge cases", () => {
  it("terminal growth at or above WACC invalidates the DCF but keeps comps", () => {
    const R = compute({ ...inputs, rate: { ...inputs.rate, g: 12 } }, infy, peers, VAL);
    expect(R.live.valid).toBe(false);
    expect(R.pt).toBe(roundTarget(R.compsValue));
  });
  it("no peers falls back to the DCF alone", () => {
    const R = compute({ ...inputs, peers: Object.fromEntries(peers.map((p) => [p.symbol, false])) }, infy, peers, VAL);
    expect(Number.isNaN(R.compsValue)).toBe(true);
    expect(R.pt).toBe(roundTarget(R.live.vps));
  });
  it("Monte Carlo is deterministic for a seed and centred near the DCF", () => {
    const R = compute(inputs, infy, peers, VAL);
    const a = monteCarlo(inputs, R), b = monteCarlo(inputs, R);
    expect(a.p50).toBe(b.p50);
    expect(Math.abs(a.p50 / R.live.vps - 1)).toBeLessThan(0.15);
    expect(a.probAbove).toBeGreaterThan(0.5);
  });
  it("starter drivers come from history", () => {
    const s = starterDrivers(infy);
    expect(s.base.margin[0]).toBeCloseTo(20.2, 1);
    expect(s.bear.growth[0]).toBeLessThan(s.base.growth[0]);
  });
  it("percentile matches Excel PERCENTILE.INC", () => {
    expect(percentile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12);
  });
});

describe("reverse DCF root choice", () => {
  // value rises with growth up to a peak, then falls: two prices-equal points, like a large working-capital driver
  const hump = (x: number) => 100 - (x - 5) * (x - 5) - 60; // zero at x = -1.32 and x = 11.32, peak at 5
  it("takes the crossing on the same side of the curve as the user's own case", () => {
    expect(impliedRoot(hump, 3, -60, 100)).toBeCloseTo(5 - Math.sqrt(40), 6); // value rising at 3: the lower root
    expect(impliedRoot(hump, 9, -60, 100)).toBeCloseTo(5 + Math.sqrt(40), 6); // value falling at 9: the upper root
  });
  it("ignores a far 'shrink to riches' root on the wrong branch", () => {
    // falling from -60 to -40, then rising: the -40 root is not on the rising branch the case sits on
    const f = (x: number) => (x < -40 ? -(x + 40) * 2 : (x + 40) * 0.5) - 25; // crossings near -52.5 and +10
    expect(impliedRoot(f, 6, -60, 100)).toBeCloseTo(10, 6);
  });
  it("is NaN when no crossing exists", () => {
    expect(Number.isNaN(impliedRoot((x) => x * x + 1, 0, -60, 100))).toBe(true);
  });
});

describe("working capital from history", () => {
  it("pools years of real growth and ignores near-flat years", () => {
    const flat = [
      { revenue: 1000, wcInc: 0 }, { revenue: 1100, wcInc: 20 }, { revenue: 1105, wcInc: 50 }, { revenue: 1215, wcInc: 22 },
    ].map((x, i) => ({ ...infy.history[i], ...x }));
    // the +0.5% year (50 on a change of 5) would be 1000% on its own; pooled over the other two: 42 / 210
    expect(histAverages(flat).wc).toBeCloseTo(42 / 210, 10);
  });
});
