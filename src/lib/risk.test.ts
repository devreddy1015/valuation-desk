import { describe, expect, it } from "vitest";
import { annualVol, maxDrawdown, priceRange, riskStats, rollingYear } from "./risk";
import type { PricePoint } from "./bands";

const week = (i: number) => new Date(Date.UTC(2021, 0, 1) + i * 7 * 864e5).toISOString().slice(0, 10);
const series = (f: (i: number) => number, n: number): PricePoint[] => Array.from({ length: n }, (_, i) => ({ date: week(i), close: f(i) }));

describe("risk statistics", () => {
  it("annualises weekly volatility with the square root of 52", () => {
    // log returns alternate +a and -a, so their standard deviation is a (times a small-sample factor)
    const a = 0.03, n = 101;
    const p = series((i) => 100 * Math.exp(i % 2 ? a : 0), n);
    const want = a * Math.sqrt(n - 1) / Math.sqrt(n - 2) * Math.sqrt(52);
    expect(annualVol(p)).toBeCloseTo(want, 10);
  });

  it("finds the deepest fall and when it was recovered", () => {
    const closes = [100, 120, 90, 60, 80, 125, 110];
    const d = maxDrawdown(closes.map((c, i) => ({ date: week(i), close: c })))!;
    expect(d.depth).toBeCloseTo(60 / 120 - 1, 12);
    expect(d.peak).toBe(week(1));
    expect(d.trough).toBe(week(3));
    expect(d.recovered).toBe(week(5));
    expect(maxDrawdown(series((i) => 100 + i, 10))).toBeNull(); // only rises
  });

  it("counts 52-week returns and the share that lost money", () => {
    // flat for a year, then up 10%, then back down: some rolling years gain, some lose
    const p = series((i) => (i < 60 ? 100 : i < 90 ? 110 : 95), 140);
    const r = rollingYear(p)!;
    expect(r.n).toBe(140 - 52);
    expect(r.best).toBeCloseTo(0.1, 12);
    expect(r.worst).toBeCloseTo(95 / 110 - 1, 12);
    expect(r.lossShare).toBeGreaterThan(0);
    expect(r.lossShare).toBeLessThan(1);
  });

  it("centres the one-year band on today's price", () => {
    const r = priceRange(100, 0.3)!;
    expect(Math.sqrt(r.p10 * r.p90)).toBeCloseTo(100, 10); // symmetric in log terms
    expect(r.p10).toBeCloseTo(100 * Math.exp(-1.2815515655446004 * 0.3), 10);
    expect(r.p25).toBeGreaterThan(r.p10);
    expect(r.p75).toBeLessThan(r.p90);
    expect(priceRange(100, null)).toBeNull();
  });

  it("puts it together and compares with the benchmark over the same two years", () => {
    const p = series((i) => 100 * (1 + 0.1 * Math.sin(i / 3)), 260);
    const b = series((i) => 100 * (1 + 0.03 * Math.sin(i / 3)), 260);
    const s = riskStats(p, b, 95)!;
    expect(s.weeks).toBe(260);
    expect(s.vol!).toBeGreaterThan(s.benchVol!);
    expect(s.fromPeak).toBeCloseTo(95 / Math.max(...p.map((x) => x.close)) - 1, 10);
    expect(s.range!.p10).toBeLessThan(95);
    expect(riskStats(p.slice(0, 10), null, 95)).toBeNull();
  });
});
