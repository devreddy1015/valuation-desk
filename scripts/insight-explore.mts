// Look at Yahoo's monthly chart and split events, plus the share counts in the statements.
// npx tsx --conditions=react-server scripts/insight-explore.mts HDFCBANK.NS AAPL
import YahooFinance from "yahoo-finance2";
import { getStockData } from "../src/lib/server/yahoo.ts";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
for (const s of process.argv.slice(2)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await yf.chart(s, { period1: new Date(Date.now() - 10 * 365.25 * 864e5), interval: "1mo", events: "split" });
  const q = r.quotes ?? [];
  console.log(s, "currency", r.meta.currency, "bars", q.length, "first", q[0]?.date, q[0]?.close, "last", q.at(-1)?.date, q.at(-1)?.close, "prev", q.at(-2)?.date, q.at(-2)?.close);
  console.log("  splits", JSON.stringify(r.events?.splits ?? []));
  const sample = q.filter((_: unknown, i: number) => i % 12 === 0).map((x: { date: Date; close: number; adjclose: number }) => `${new Date(x.date).toISOString().slice(0, 7)}:${x.close?.toFixed(1)}/${x.adjclose?.toFixed(1)}`);
  console.log("  yearly close/adjclose", sample.join(" "));
  const d = await getStockData(s);
  console.log("  shares now", d.shares, "ttm eps", d.ttm.eps.toFixed(2), "bvps", d.bookValuePerShare?.toFixed(2), "price", d.price, d.currency);
  for (const y of d.history) console.log(`   ${y.label} ${y.end} NI ${(y.netIncome / 1e9).toFixed(2)}bn dilShares ${y.dilutedShares} EPS ${y.dilutedEPS?.toFixed(2)} NI/sh ${(y.netIncome / (y.dilutedShares ?? NaN)).toFixed(2)} equity ${((y.equity ?? NaN) / 1e9).toFixed(1)}bn`);
}
