import { describe, expect, it } from "vitest";
import { buildBand, sharesOnTodayBasis, type BandData, type PricePoint } from "./bands";
import { percentile } from "./model";
import type { FiscalYear } from "./types";

const fy = (y: number, ni: number, shares: number | null, equity: number | null = 1000): FiscalYear => ({
  label: `FY${String(y).slice(2)}`, end: `${y}-03-31`, revenue: 1, ebit: 1, da: 0, pbt: 1, tax: 0, capex: 0, wcInc: 0,
  netIncome: ni, dilutedShares: shares, equity,
});
/** Monthly closes from start (YYYY-MM) for n months, close = f(i). */
function months(start: string, n: number, f: (i: number) => number): PricePoint[] {
  const [y, m] = start.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 10), close: f(i) }));
}

// Three years of statements. A 2:1 split on 2024-08-20 sits after FY24's year end, so FY23 and FY24
// counts (reported before the split, 100 shares) become 200 on today's basis; FY25 is already 200.
const data: BandData = {
  history: [fy(2023, 200, 100), fy(2024, -50, 100), fy(2025, 400, 200)],
  shares: 200,
  ttm: { revenue: 1, ebitda: 1, netIncome: 440, eps: 2.2 },
  bookValuePerShare: 6,
};
const splits = [{ date: "2024-08-20", ratio: 2 }];
const points = months("2022-01", 48, () => 40); // flat split-adjusted price of 40, Jan 2022 to Dec 2025

describe("buildBand P/E", () => {
  const b = buildBand(points, splits, data, "pe", { price: 44, date: "2025-12-15" });
  const at = (d: string) => b.series.find((s) => s.date === d)!;

  it("starts once the first annual results are out (year end + 2 months)", () => {
    expect(b.series[0].date).toBe("2023-05-01");
    expect(at("2023-05-01").fy).toBe("FY23");
    expect(b.notes.join(" ")).toMatch(/history starts in May 2023/);
  });
  it("adjusts pre-split share counts so EPS matches split-adjusted prices", () => {
    // FY23 EPS = 200 / (100 x 2) = 1, so P/E = 40
    expect(at("2023-05-01").perShare).toBeCloseTo(1, 12);
    expect(at("2023-05-01").multiple).toBeCloseTo(40, 12);
    // FY25 count is already post-split: EPS = 400 / 200 = 2, P/E = 20
    expect(at("2025-06-01").fy).toBe("FY25");
    expect(at("2025-06-01").multiple).toBeCloseTo(20, 12);
  });
  it("leaves the loss year as a gap", () => {
    expect(at("2024-05-01").fy).toBe("FY24");
    expect(at("2024-05-01").multiple).toBeNull();
    expect(at("2025-04-01").fy).toBe("FY24"); // FY25 results not out until May
    expect(at("2025-04-01").multiple).toBeNull();
    expect(at("2025-05-01").fy).toBe("FY25");
    expect(b.notes.join(" ")).toMatch(/FY24: a loss year/);
  });
  it("stats come from valid months only", () => {
    // FY23 months May 2023 - Apr 2024 (12 at 40x), FY25 months May 2025 - Dec 2025 (8 at 20x)
    const vals = [...Array(12).fill(40), ...Array(8).fill(20)];
    expect(b.stats.n).toBe(20);
    expect(b.stats.median).toBe(40);
    expect(b.stats.mean).toBeCloseTo(vals.reduce((s, x) => s + x, 0) / 20, 12);
    expect(b.stats.p10).toBeCloseTo(percentile(vals, 0.1), 12);
    expect(b.stats.p90).toBe(40);
    expect(b.stats.from).toBe("2023-05-01");
    expect(b.stats.to).toBe("2025-12-01");
  });
  it("today's multiple uses the live price and trailing EPS", () => {
    expect(b.stats.current).toBeCloseTo(20, 12); // 44 / 2.2
    expect(b.stats.currentPercentile).toBeCloseTo(4 / 20, 12); // 8 ties count half
    expect(b.stats.atMedian).toBeCloseTo(40 * 2.2, 12);
  });
});

describe("buildBand P/B and edge cases", () => {
  it("P/B uses equity per share on today's basis", () => {
    const b = buildBand(points, splits, data, "pb", { price: 30, date: "2025-12-15" });
    // FY23 book = 1000 / 200 = 5 a share => 8x
    expect(b.series.find((s) => s.date === "2023-06-01")!.multiple).toBeCloseTo(8, 12);
    expect(b.stats.current).toBeCloseTo(5, 12); // 30 / 6
  });
  it("drops absurd multiples and notes them", () => {
    const tiny = { ...data, history: [fy(2023, 0.01, 100)] };
    const b = buildBand(points, [], tiny, "pe", { price: 40, date: "2025-12-15" });
    expect(b.stats.n).toBe(0);
    expect(b.series.every((s) => s.multiple === null)).toBe(true);
    expect(b.notes.join(" ")).toMatch(/above 300x/);
    expect(Number.isNaN(b.stats.median)).toBe(true);
    expect(b.stats.currentPercentile).toBeNull();
  });
  it("falls back to today's share count when the statement has none", () => {
    const b = buildBand(points, splits, { ...data, history: [fy(2023, 200, null)] }, "pe", { price: 40, date: "2025-12-15" });
    expect(b.series[0].perShare).toBeCloseTo(1, 12); // 200 / 200, no split adjustment
    expect(b.notes.join(" ")).toMatch(/no reported share count/);
  });
  it("no current multiple after a trailing loss", () => {
    const b = buildBand(points, splits, { ...data, ttm: { ...data.ttm, eps: -1 } }, "pe", { price: 40, date: "2025-12-15" });
    expect(b.stats.current).toBeNull();
    expect(b.stats.atMedian).toBeNull();
    expect(b.notes.join(" ")).toMatch(/can't be calculated/);
  });
  it("ignores prices after now and handles empty input", () => {
    const b = buildBand(points, splits, data, "pe", { price: 44, date: "2024-01-10" });
    expect(b.series[b.series.length - 1].date).toBe("2024-01-01");
    const e = buildBand([], [], data, "pe", { price: 44, date: "2025-12-15" });
    expect(e.series).toEqual([]);
    expect(e.stats.n).toBe(0);
  });
});

describe("sharesOnTodayBasis", () => {
  it("does not adjust a count Yahoo has already restated", () => {
    // HDFC Bank FY25 (Mar 2025) was reported after the Aug 2025 1:1 bonus at 15.3bn shares
    const r = sharesOnTodayBasis(fy(2025, 1, 15.32e9), [{ date: "2025-08-26", ratio: 2 }], 15.42e9);
    expect(r.shares).toBe(15.32e9);
    expect(r.note).toMatch(/already reflects/);
  });
  it("adjusts a pre-bonus count", () => {
    const r = sharesOnTodayBasis(fy(2024, 1, 7.11e9), [{ date: "2019-09-19", ratio: 2 }, { date: "2025-08-26", ratio: 2 }], 15.42e9);
    expect(r.shares).toBe(14.22e9);
    expect(r.note).toBeNull();
  });
  it("rejects a count far from today's (e.g. depositary receipts)", () => {
    const r = sharesOnTodayBasis(fy(2024, 1, 5e9), [], 1e9);
    expect(r.shares).toBe(1e9);
    expect(r.note).toMatch(/inconsistent/);
  });
});
