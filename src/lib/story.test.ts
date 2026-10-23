import { describe, expect, it } from "vitest";
import { compute, monteCarlo, type Valuation } from "./model";
import { returnsFor } from "./returns";
import { growthVerdict, historicalGrowth, storyFor, type Story } from "./story";
import type { HealthReport } from "./quality";
import type { Drivers, FiscalYear, PeerRow, StockData, UserInputs } from "./types";

// A business that grew revenue 10% a year for three years (2022 -> 2025), margin 10%, no debt.
const year = (y: number, revenue: number, over: Partial<FiscalYear> = {}): FiscalYear => ({
  label: String(y), end: `${y}-12-31`, revenue, ebit: revenue * 0.1, da: revenue * 0.03, pbt: revenue * 0.1, tax: revenue * 0.025, capex: revenue * 0.03, wcInc: 0,
  netIncome: revenue * 0.075, equity: revenue * 0.5, ...over,
});
function mk(over: Partial<StockData> = {}): StockData {
  return {
    symbol: "GROW", name: "Grow Co", exchange: "TEST", country: "United States", sector: "Industrials", industry: "Machinery",
    currency: "USD", financialCurrency: "USD", fxNote: null, price: 100, priceTime: "2025-12-31T00:00:00Z", marketCap: 1000, shares: 10,
    hi52: 120, lo52: 80, bookValuePerShare: 66.55,
    history: [year(2022, 1000), year(2023, 1100), year(2024, 1210), year(2025, 1331)],
    bridge: { date: "2025-12-31", cash: 50, borrowings: 0, leases: 0, nci: 0, returned: 0, returnedNote: "" },
    ttm: { revenue: 1331, ebitda: 173, netIncome: 99.8, eps: 9.98 },
    estimates: { growthThisYear: null, growthNextYear: null, note: null },
    beta: null, yahooBeta: 1,
    riskFree: { rate: 4, note: "", estimated: false }, erp: { value: 6, defaultSpread: 0, note: "", estimated: false },
    financial: false, warnings: [], asOf: "2025-12-31T00:00:00Z", source: "test", ...over,
  };
}
const rep = (v: number) => [v, v, v, v, v];
const base: Drivers = { growth: rep(10), margin: rep(10), tax: rep(25), da: rep(3), capex: rep(3), wc: rep(10) };
function inputs(price: number, over: Partial<UserInputs> = {}): UserInputs {
  return {
    scenario: "base", assume: { bear: base, base, bull: base },
    rate: { rf: 4, spread: 0, beta: 1, erp: 6, kd: 5, g: 3 },
    price, dcfWeight: 50, buy: 15, sell: -10, probs: { bear: 25, base: 50, bull: 25 }, usePW: false,
    mc: { g: 2, m: 1.5, w: 1, t: 0.5, seed: 1 }, peers: {}, ...over,
  };
}
const VAL = Date.UTC(2025, 11, 31);
function story(d: StockData, inp: UserInputs, opts: { calls?: boolean; health?: HealthReport | null; peers?: PeerRow[] } = {}): { s: Story; R: Valuation } {
  const R = compute(inp, d, opts.peers ?? [], VAL);
  const s = storyFor({ data: d, inp, R, MC: monteCarlo(inp, R, 400), ret: returnsFor(inp, d, R), health: opts.health ?? null, calls: !!opts.calls });
  return { s, R };
}
// The price at which the base case implies exactly the historical 10% growth.
const fairPrice = (() => { const d = mk(), R = compute(inputs(100), d, [], VAL); return R.dcf(base, R.wacc, R.g).vps; })();
const all = (s: Story) => [s.headline, ...s.points.map((p) => p.text)].join(" ");

describe("story headline follows implied vs historical growth", () => {
  it("historical growth is the compound rate over the reported years", () => {
    const h = historicalGrowth(mk())!;
    expect(h.rate).toBeCloseTo(0.1, 10);
    expect([h.from, h.to]).toEqual(["2022", "2025"]);
  });
  it("in line", () => {
    const { s, R } = story(mk(), inputs(fairPrice));
    expect(R.impliedGrowth).toBeCloseTo(10, 3);
    expect(s.headline).toBe("Priced roughly in line with its history");
    expect(s.headline).toContain(s.accent);
    expect(s.points[0].key).toBe("implied");
    expect(s.points[0].text).toMatch(/between 2022 and 2025/);
    expect(s.points[0].text).toContain("$");
  });
  it("slower growth at a low price", () => {
    const { s } = story(mk(), inputs(fairPrice * 0.6));
    expect(s.headline).toBe("Priced for slower growth than it has delivered");
    expect(s.tone).toBe("good");
    expect(s.points.find((p) => p.key === "implied")!.tone).toBe("good");
    expect(s.points.find((p) => p.key === "case")!.tone).toBe("good"); // DCF well above price
    expect(s.points.find((p) => p.key === "return")!.tone).toBe("good"); // expected return above WACC
  });
  it("more growth at a high price", () => {
    const { s } = story(mk(), inputs(fairPrice * 1.6));
    expect(s.headline).toBe("Priced for more growth than it has delivered");
    expect(s.tone).toBe("bad");
    expect(s.points.find((p) => p.key === "return")!.tone).toBe("bad");
  });
  it("the threshold is max(2 points, 20% of history)", () => {
    expect(growthVerdict(0.08, 0.1)).toBe("in line");
    expect(growthVerdict(0.075, 0.1)).toBe("slower");
    expect(growthVerdict(0.35, 0.3)).toBe("in line"); // 6-point band for a 30% grower
    expect(growthVerdict(0.37, 0.3)).toBe("more");
  });
});

describe("story points", () => {
  const { s } = story(mk(), inputs(fairPrice * 0.9));
  it("has 4-6 sentences, each tied to a number", () => {
    expect(s.points.length).toBeGreaterThanOrEqual(4);
    expect(s.points.length).toBeLessThanOrEqual(6);
    for (const p of s.points) expect(p.text).toMatch(/\d/);
    expect(s.points.map((p) => p.key)).toEqual(["implied", "case", "return", "growth", "range"]);
  });
  it("never gives buy or sell language when calls are off", () => {
    expect(all(s)).not.toMatch(/\b(buy|sell|hold)\b/i);
    expect(all(s)).not.toMatch(/NaN|undefined|Infinity/);
  });
  it("calls it the model's call when calls are on", () => {
    const { s: c, R } = story(mk(), inputs(fairPrice * 0.6), { calls: true });
    expect(R.rating).toBe("BUY");
    expect(c.points.find((p) => p.key === "case")!.text).toMatch(/The model's call is BUY/);
  });
  it("adds the health verdict once, without repeating the grade", () => {
    const health = {
      score: 72, grade: "B", flags: ["Margins are shrinking."], strengths: ["a", "b", "c"],
      summary: "Grade B (72/100): looks mostly healthy, with 3 strengths and 1 red flag (top concern: margins are shrinking).",
      verdict: "looks mostly healthy, with 3 strengths and 1 red flag (top concern: margins are shrinking)",
    } as HealthReport;
    const { s: h } = story(mk(), inputs(fairPrice), { health });
    const p = h.points.find((x) => x.key === "health")!;
    expect(p.tone).toBe("good");
    expect(p.text).toBe("Business health grade B (72 out of 100): looks mostly healthy, with 3 strengths and 1 red flag (top concern: margins are shrinking).");
    // an older report without the verdict field still loses the duplicate prefix
    const { s: h2 } = story(mk(), inputs(fairPrice), { health: { ...health, verdict: undefined } });
    expect(h2.points.find((x) => x.key === "health")!.text).not.toMatch(/Grade B \(72\/100\)/);
  });
  it("a high grade with as many red flags as strengths is not tagged favourable", () => {
    const health = { score: 68, grade: "B", flags: ["a", "b", "c"], strengths: ["d"], summary: "Grade B (68/100): shows a mixed picture.", verdict: "shows a mixed picture" } as HealthReport;
    const { s: h } = story(mk(), inputs(fairPrice), { health });
    expect(h.points.find((x) => x.key === "health")!.tone).toBe("neutral");
  });
  it("today's profits covering the price", () => {
    const { s: c } = story(mk(), inputs(40));
    expect(c.points.find((p) => p.key === "growth")!.text).toMatch(/profits alone cover the price/);
  });
});

describe("robust to missing numbers", () => {
  it("no DCF (terminal growth above WACC), no Monte Carlo, no returns", () => {
    const d = mk(), inp = inputs(100, { rate: { rf: 4, spread: 0, beta: 1, erp: 6, kd: 5, g: 12 } });
    const R = compute(inp, d, [], VAL);
    const s = storyFor({ data: d, inp, R, MC: null, ret: null, health: null, calls: false });
    expect(s.headline).toBe("The DCF can't value it with these inputs");
    expect(all(s)).not.toMatch(/NaN|undefined/);
  });
  it("NaN everywhere", () => {
    const d = mk({ history: [year(2025, NaN)], ttm: { revenue: NaN, ebitda: NaN, netIncome: NaN, eps: NaN } });
    const inp = inputs(NaN);
    const R = compute(inp, d, [], VAL);
    const s = storyFor({ data: d, inp, R, MC: monteCarlo(inp, R, 50), ret: returnsFor(inp, d, R), health: { grade: "–" } as HealthReport, calls: true });
    expect(typeof s.headline).toBe("string");
    expect(all(s)).not.toMatch(/NaN|undefined/);
  });
});

describe("banks and insurers", () => {
  const peers: PeerRow[] = [10, 12, 14].map((pe, i) => ({ symbol: `P${i}`, name: `Peer ${i}`, industry: "Banks", currency: "USD", marketCap: 1, evEbitda: null, pe, evSales: null, pb: [1.5, 2, 2.5][i], margin: null, growth: null }));
  const bank = mk({ financial: true, sector: "Financial Services", industry: "Banks - Regional", ttm: { revenue: 1331, ebitda: 0, netIncome: 99.8, eps: 9.98 }, bookValuePerShare: 66.55 });
  const inp = inputs(80, { dcfWeight: 0, peers: { P0: true, P1: true, P2: true } }); // P/E 8.0x vs a 12x median, P/B 1.2x vs 2x
  const { s } = story(bank, inp, { peers });
  it("talks peers and ROE instead of the DCF", () => {
    expect(s.headline).toBe("Valued below its peers on earnings");
    expect(s.points.map((p) => p.key)).toEqual(["pe", "pb", "roe", "yield"]);
    expect(all(s)).not.toMatch(/DCF|simulated/);
    expect(s.points[0].text).toMatch(/33% below the median of 3 peers \(12\.0x\)/);
    expect(s.points.find((p) => p.key === "roe")!.text).toMatch(/Return on equity was 15\.7% in 2025/);
  });
  it("model's call for a bank uses peers only", () => {
    const { s: c } = story(bank, inp, { peers, calls: true });
    expect(c.points[0].text).toMatch(/The model's call is BUY: a price target of .* \(peers only\)/);
  });
});

describe("loss-makers", () => {
  it("never quotes a negative DCF as the value of the shares", () => {
    const loss: Drivers = { ...base, margin: rep(-40) };
    const { s: st, R } = story(mk(), inputs(100, { assume: { bear: loss, base: loss, bull: loss } }));
    expect(R.live.vps).toBeLessThan(0);
    const c = st.points.find((p) => p.key === "case")!;
    expect(c.text).toMatch(/doesn't give a usable DCF value/);
    expect(st.points.some((p) => /-\$|−\$|values the shares at -/.test(p.text))).toBe(false);
    expect(st.points.find((p) => p.key === "range")).toBeUndefined();
  });
});

