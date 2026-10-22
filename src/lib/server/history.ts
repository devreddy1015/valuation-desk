import "server-only";
import YahooFinance from "yahoo-finance2";
import { cached, HOUR } from "./cache";
import { DataError } from "./yahoo";
import { majorCurrency } from "../markets";
import type { PriceHistory, PricePoint, SplitEvent } from "../bands";

/* eslint-disable @typescript-eslint/no-explicit-any */
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

/**
 * Yahoo stamps monthly bars at local midnight (Indian bars read 18:30 UTC the day before), so
 * shift by the exchange's UTC offset plus a few hours of slack for daylight saving before taking the date.
 */
const localDate = (d: unknown, offsetSec: number) => new Date(+new Date(d as string) + offsetSec * 1000 + 6 * 36e5).toISOString().slice(0, 10);

/** Ten years of month-end closes (split-adjusted, major currency units) and split or bonus events, cached 12 hours. */
export function getPriceHistory(rawSymbol: string): Promise<PriceHistory> {
  const symbol = rawSymbol.trim().toUpperCase();
  return cached("hist:" + symbol, 12 * HOUR, async () => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear() - 10, now.getUTCMonth(), 1));
    let r: any;
    try {
      r = await yf.chart(symbol, { period1: start, interval: "1mo", events: "split" });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (/no data|not found|delisted|invalid/i.test(msg)) throw new DataError(`Yahoo Finance has no price history for ${symbol}`, "not_found");
      throw new DataError(`Price history for ${symbol} is unavailable right now`, "upstream");
    }
    const cur = majorCurrency(r?.meta?.currency);
    const off = typeof r?.meta?.gmtoffset === "number" ? r.meta.gmtoffset : 0;
    // One point per month: Yahoo appends today's quote as an extra bar in the current month, keep the latest.
    const byMonth = new Map<string, PricePoint>();
    for (const q of r?.quotes ?? []) {
      if (typeof q?.close !== "number" || !Number.isFinite(q.close) || q.close <= 0) continue;
      const date = localDate(q.date, off);
      byMonth.set(date.slice(0, 7), { date, close: q.close / cur.factor });
    }
    const points = [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (!points.length) throw new DataError(`Yahoo Finance has no price history for ${symbol}`, "not_found");
    const splits: SplitEvent[] = (r?.events?.splits ?? [])
      .map((s: any) => ({ date: localDate(s.date, off), ratio: s.numerator / s.denominator }))
      .filter((s: SplitEvent) => Number.isFinite(s.ratio) && s.ratio > 0 && s.ratio !== 1)
      .sort((a: SplitEvent, b: SplitEvent) => a.date.localeCompare(b.date));
    return { symbol, currency: cur.code, points, splits };
  });
}
