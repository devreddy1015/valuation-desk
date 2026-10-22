import "server-only";
import YahooFinance from "yahoo-finance2";
import { cached, DAY, HOUR, MIN } from "./cache";
import { erpFor } from "./countryRisk";
import { BENCHMARK_BY_COUNTRY, FALLBACK_BENCHMARK, RISK_FREE_SOURCED, isFinancialIndustry, majorCurrency } from "../markets";
import { fyLabel } from "../model";
import type { FiscalYear, PeerRow, StockData } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export class DataError extends Error {
  constructor(message: string, public code: "not_found" | "unsupported" | "upstream") { super(message); }
}

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const isoDate = (d: unknown) => new Date(d as string).toISOString().slice(0, 10);

export interface SearchHit { symbol: string; name: string; exchange: string; type: string }

export function searchSymbols(q: string): Promise<SearchHit[]> {
  const query = q.trim().slice(0, 60);
  return cached("search:" + query.toLowerCase(), 6 * HOUR, async () => {
    const r: any = await yf.search(query, { quotesCount: 15, newsCount: 0 });
    return (r.quotes ?? [])
      .filter((x: any) => x.symbol && (x.quoteType === "EQUITY" || x.typeDisp === "Equity"))
      .map((x: any) => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, exchange: x.exchDisp || x.exchange || "", type: x.typeDisp || x.quoteType }));
  });
}

/** Monthly FX closes for from->to, keyed "YYYY-MM". */
async function fxMonthly(from: string, to: string, start: Date): Promise<Map<string, number>> {
  return cached(`fx:${from}${to}:${start.getUTCFullYear()}`, 12 * HOUR, async () => {
    const r: any = await yf.chart(`${from}${to}=X`, { period1: start, interval: "1mo" });
    const m = new Map<string, number>();
    for (const q of r.quotes ?? []) if (num(q.close)) m.set(new Date(q.date).toISOString().slice(0, 7), q.close);
    if (!m.size) throw new DataError(`No exchange rate found for ${from}/${to}`, "upstream");
    return m;
  });
}
/** Live exchange rate: units of `to` per unit of `from`. */
export async function fxSpot(from: string, to: string): Promise<number> {
  return cached(`fxspot:${from}${to}`, 30 * MIN, async () => {
    const q: any = await yf.quote(`${from}${to}=X`);
    const v = num(q?.regularMarketPrice);
    if (!v) throw new DataError(`No live exchange rate for ${from}/${to}`, "upstream");
    return v;
  });
}
function fyAverage(m: Map<string, number>, fyEnd: string): number | null {
  const end = new Date(fyEnd), vals: number[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    const v = m.get(d.toISOString().slice(0, 7));
    if (v) vals.push(v);
  }
  return vals.length >= 6 ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
}

async function usTenYear(): Promise<number | null> {
  return cached("tnx", 30 * MIN, async () => num(((await yf.quote("^TNX")) as any)?.regularMarketPrice)).catch(() => null);
}

/** OLS beta of weekly returns against a benchmark over the last two years. */
async function computeBeta(symbol: string, benchmark: string): Promise<{ value: number; r2: number; n: number } | null> {
  return cached(`beta:${symbol}:${benchmark}`, 12 * HOUR, async () => {
    const start = new Date(Date.now() - (2 * 365 + 10) * 864e5);
    const [a, b]: any[] = await Promise.all([yf.chart(symbol, { period1: start, interval: "1wk" }), yf.chart(benchmark, { period1: start, interval: "1wk" })]);
    const key = (d: any) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
    const series = (r: any) => { const m = new Map<string, number>(); for (const q of r.quotes ?? []) { const v = num(q.adjclose) ?? num(q.close); if (v) m.set(key(q.date), v); } return m; };
    const sa = series(a), sb = series(b);
    const dates = [...sa.keys()].filter((d) => sb.has(d)).sort();
    const xs: number[] = [], ys: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      const x = sb.get(dates[i])! / sb.get(dates[i - 1])! - 1, y = sa.get(dates[i])! / sa.get(dates[i - 1])! - 1;
      if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
    }
    if (xs.length < 40) return null;
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    const beta = sxy / sxx;
    return { value: beta, r2: (sxy * sxy) / (sxx * syy), n: xs.length };
  }).catch(() => null);
}

/** Dividends (per share, quote currency) with ex-dates after the balance-sheet date. */
async function dividendsSince(symbol: string, since: string): Promise<{ perShare: number; events: { date: string; amount: number }[] }> {
  return cached(`div:${symbol}:${since}`, 6 * HOUR, async () => {
    const r: any = await yf.chart(symbol, { period1: new Date(since), interval: "1d", events: "div" });
    const ev = (r.events?.dividends ?? []).map((d: any) => ({ date: isoDate(d.date), amount: d.amount })).filter((d: any) => d.date > since && num(d.amount));
    return { perShare: ev.reduce((s: number, d: any) => s + d.amount, 0), events: ev };
  }).catch(() => ({ perShare: 0, events: [] }));
}

const pick = (row: any, ...keys: string[]) => { for (const k of keys) { const v = num(row?.[k]); if (v !== null) return v; } return null; };
const opt = (v: number | null, k: number) => (v === null ? null : v * k);
const abs = (v: number | null) => (v === null ? null : Math.abs(v));

export function getStockData(rawSymbol: string): Promise<StockData> {
  const symbol = rawSymbol.trim().toUpperCase();
  return cached("stock:" + symbol, 15 * MIN, async () => {
    let quote: any;
    try { quote = await yf.quote(symbol); } catch { throw new DataError(`Yahoo Finance has no quote for ${symbol}`, "not_found"); }
    if (!quote || !num(quote.regularMarketPrice)) throw new DataError(`Yahoo Finance has no price for ${symbol}`, "not_found");
    if (quote.quoteType && quote.quoteType !== "EQUITY") throw new DataError(`${symbol} is a ${String(quote.quoteType).toLowerCase()}, not a company share`, "unsupported");

    const [summary, fts]: any[] = await Promise.all([
      yf.quoteSummary(symbol, { modules: ["assetProfile", "defaultKeyStatistics", "financialData", "summaryDetail", "earningsTrend"] }).catch(() => ({})),
      yf.fundamentalsTimeSeries(symbol, { period1: new Date(Date.now() - 7 * 365 * 864e5), type: "annual", module: "all" }).catch(() => []),
    ]);

    const cur = majorCurrency(quote.currency);
    const finCur = majorCurrency(quote.financialCurrency || summary?.financialData?.financialCurrency || quote.currency).code;
    const warnings: string[] = [];

    const rows = (fts as any[])
      .filter((r) => r && r.date && pick(r, "totalRevenue", "operatingRevenue"))
      .sort((a, b) => +new Date(a.date) - +new Date(b.date))
      .slice(-5);
    if (rows.length < 2) throw new DataError(`Yahoo Finance has fewer than two years of annual statements for ${symbol}`, "unsupported");

    // currency conversion: flows at each fiscal year's average rate, the balance sheet at today's rate
    let fxNote: string | null = null;
    let flowRate: (end: string) => number = () => 1, spot = 1;
    if (finCur !== cur.code) {
      const start = new Date(new Date(rows[0].date).getTime() - 400 * 864e5);
      const [m, s] = await Promise.all([fxMonthly(finCur, cur.code, start), fxSpot(finCur, cur.code)]);
      spot = s;
      flowRate = (end: string) => fyAverage(m, end) ?? s;
      fxNote = `Statements are reported in ${finCur}; converted to ${cur.code} at each year's average exchange rate (balance sheet and trailing figures at today's ${finCur}/${cur.code} rate of ${s.toFixed(4)}).`;
    }

    const last = rows[rows.length - 1];
    const marchFY = new Date(last.date).getUTCMonth() !== 11;
    const history: FiscalYear[] = rows.map((r) => {
      const end = isoDate(r.date), k = flowRate(end);
      const revenue = pick(r, "totalRevenue", "operatingRevenue")!;
      const ebit = pick(r, "operatingIncome", "totalOperatingIncomeAsReported", "EBIT") ?? 0;
      return {
        label: fyLabel(end, marchFY), end,
        revenue: revenue * k,
        ebit: ebit * k,
        da: (pick(r, "reconciledDepreciation", "depreciationAndAmortization", "depreciationAmortizationDepletion") ?? 0) * k,
        pbt: (pick(r, "pretaxIncome") ?? 0) * k,
        tax: (pick(r, "taxProvision") ?? 0) * k,
        capex: Math.abs(pick(r, "capitalExpenditure", "capitalExpenditureReported") ?? 0) * k,
        wcInc: -(pick(r, "changeInWorkingCapital") ?? 0) * k,
        netIncome: (pick(r, "netIncomeCommonStockholders", "netIncome") ?? 0) * k,
        cfo: opt(pick(r, "operatingCashFlow", "cashFlowFromContinuingOperatingActivities"), k),
        totalAssets: opt(pick(r, "totalAssets"), k),
        currentAssets: opt(pick(r, "currentAssets"), k),
        currentLiabilities: opt(pick(r, "currentLiabilities"), k),
        totalLiabilities: opt(pick(r, "totalLiabilitiesNetMinorityInterest"), k),
        equity: opt(pick(r, "stockholdersEquity", "commonStockEquity"), k),
        retainedEarnings: opt(pick(r, "retainedEarnings"), k),
        longTermDebt: opt(pick(r, "longTermDebt", "longTermDebtAndCapitalLeaseObligation"), k),
        totalDebt: opt(pick(r, "totalDebt"), k),
        cash: opt(pick(r, "cashCashEquivalentsAndShortTermInvestments", "cashAndCashEquivalents"), k),
        receivables: opt(pick(r, "accountsReceivable", "receivables"), k),
        grossProfit: opt(pick(r, "grossProfit"), k),
        sga: opt(pick(r, "sellingGeneralAndAdministration"), k),
        netPPE: opt(pick(r, "netPPE"), k),
        interestExpense: abs(opt(pick(r, "interestExpense", "interestExpenseNonOperating"), k)),
        dilutedShares: pick(r, "dilutedAverageShares", "basicAverageShares", "ordinarySharesNumber"),
        dilutedEPS: opt(pick(r, "dilutedEPS", "basicEPS"), k),
        dividendsPaid: abs(opt(pick(r, "cashDividendsPaid", "commonStockDividendPaid"), k)),
        buybacks: abs(opt(pick(r, "repurchaseOfCapitalStock", "commonStockPayments"), k)),
        sbc: opt(pick(r, "stockBasedCompensation"), k),
      };
    });
    if (history.some((y) => !y.ebit)) warnings.push("Operating profit is missing for at least one year; check the history table.");

    const leases = (pick(last, "capitalLeaseObligations") ?? ((pick(last, "currentCapitalLeaseObligation") ?? 0) + (pick(last, "longTermCapitalLeaseObligation") ?? 0))) * spot;
    const totalDebt = (pick(last, "totalDebt") ?? 0) * spot;
    const cash = (pick(last, "cashCashEquivalentsAndShortTermInvestments") ?? ((pick(last, "cashAndCashEquivalents") ?? 0) + (pick(last, "otherShortTermInvestments") ?? 0))) * spot;
    const nci = (pick(last, "minorityInterest") ?? 0) * spot;
    const equity = pick(last, "stockholdersEquity", "commonStockEquity");

    const price = quote.regularMarketPrice / cur.factor;
    const shares = num(quote.sharesOutstanding) ?? num(summary?.defaultKeyStatistics?.sharesOutstanding) ?? (pick(last, "dilutedAverageShares", "ordinarySharesNumber") ?? 0);
    if (!shares) throw new DataError(`No share count for ${symbol}`, "unsupported");
    // Yahoo reports market cap in major units for most markets; guard against minor-unit (pence) feeds.
    const rawCap = num(quote.marketCap) ?? price * shares;
    const marketCap = rawCap / (price * shares) > 20 ? rawCap / cur.factor : rawCap;

    const bsDate = isoDate(last.date);
    const [div, beta, erp, tnx] = await Promise.all([
      dividendsSince(symbol, bsDate),
      computeBeta(symbol, (BENCHMARK_BY_COUNTRY[summary?.assetProfile?.country] ?? FALLBACK_BENCHMARK).symbol),
      erpFor(summary?.assetProfile?.country ?? ""),
      usTenYear(),
    ]);
    const returned = (div.perShare / cur.factor) * shares;

    const fd = summary?.financialData ?? {}, ks = summary?.defaultKeyStatistics ?? {};
    const ttmRevenue = (num(fd.totalRevenue) ?? history[history.length - 1].revenue / flowRate(bsDate)) * spot;
    const ttmEbitda = (num(fd.ebitda) ?? (last ? (pick(last, "EBITDA", "normalizedEBITDA") ?? 0) : 0)) * spot;
    const ttmNet = (num(ks.netIncomeToCommon) ?? pick(last, "netIncomeCommonStockholders") ?? 0) * spot;

    const trend = (summary?.earningsTrend?.trend ?? []) as any[];
    const lastGrowth = history.length > 1 ? history[history.length - 1].revenue / history[history.length - 2].revenue - 1 : 0;
    const gs = history.slice(1).map((y, i) => y.revenue / history[i].revenue - 1);
    const avgGrowth = gs.length ? gs.reduce((a, b) => a + b, 0) / gs.length : lastGrowth;
    const sane = (g: number | null) => (g !== null && g > -0.15 && g < 0.3 && Math.abs(g - lastGrowth) < 0.25 && Math.abs(g - avgGrowth) < 0.2 ? g : null);
    const g0raw = num(trend.find((t) => t.period === "0y")?.revenueEstimate?.growth);
    const g1raw = num(trend.find((t) => t.period === "+1y")?.revenueEstimate?.growth);
    const g0 = sane(g0raw), g1 = g0 === null ? null : sane(g1raw);
    if (g0raw !== null && g0 === null) warnings.push(`Yahoo's consensus revenue growth (${(g0raw * 100).toFixed(0)}%) looks inconsistent with the reported history, so the forecast starts from history instead.`);
    const nAnalysts = num(trend.find((t) => t.period === "0y")?.revenueEstimate?.numberOfAnalysts);

    const sourced = RISK_FREE_SOURCED[cur.code];
    const riskFree = sourced
      ? { rate: sourced.rate, note: sourced.note, estimated: false }
      : cur.code === "USD" && tnx
        ? { rate: tnx, note: "US 10-year Treasury yield, live (^TNX)", estimated: false }
        : { rate: tnx ?? 4.2, note: `Estimate: US 10-year Treasury yield. Replace it with the ${cur.code} 10-year government bond yield.`, estimated: true };
    if (riskFree.estimated) warnings.push(`The risk-free rate is an estimate for ${cur.code}: enter the local 10-year government bond yield.`);
    if (erp.estimated) warnings.push("The equity risk premium is the mature-market default: this country was not found in Damodaran's table.");

    const country = summary?.assetProfile?.country ?? "";
    const sector = summary?.assetProfile?.sector ?? "";
    const industry = summary?.assetProfile?.industry ?? "";
    const financial = isFinancialIndustry(sector, industry);
    if (financial) warnings.push("Banks and insurers are not suited to a free-cash-flow DCF: the price target starts on peer multiples only (P/E and P/B).");
    if (g0raw === null) warnings.push("No consensus revenue estimate: the first forecast years start from history.");
    const debtShare = (Math.max(0, totalDebt - leases) + leases) / Math.max(1, marketCap);
    if (debtShare > 0.5) warnings.push(`Debt is ${(debtShare * 100).toFixed(0)}% of market value. If part of it funds a lending or finance arm (car makers, conglomerates), the DCF will understate equity value: check the bridge.`);
    const ageDays = (Date.now() - +new Date(bsDate)) / 864e5;
    if (ageDays > 550) warnings.push("The latest annual report on Yahoo is more than 18 months old.");

    const bench = BENCHMARK_BY_COUNTRY[country] ?? FALLBACK_BENCHMARK;
    const data: StockData = {
      symbol, name: quote.longName || quote.shortName || symbol, exchange: quote.fullExchangeName || quote.exchange || "",
      country, sector, industry,
      currency: cur.code, financialCurrency: finCur, fxNote,
      price, priceTime: new Date(quote.regularMarketTime ?? Date.now()).toISOString(),
      marketCap, shares,
      hi52: (num(quote.fiftyTwoWeekHigh) ?? price * cur.factor) / cur.factor,
      lo52: (num(quote.fiftyTwoWeekLow) ?? price * cur.factor) / cur.factor,
      bookValuePerShare: equity ? (equity * spot) / shares : null,
      history,
      bridge: {
        date: bsDate, cash, borrowings: Math.max(0, totalDebt - leases), leases, nci, returned,
        returnedNote: div.events.length ? `Dividends with ex-dates after ${bsDate}: ${div.events.map((e) => `${e.date} (${(e.amount / cur.factor).toFixed(2)} per share)`).join(", ")}` : `No dividends with ex-dates after ${bsDate}`,
      },
      ttm: { revenue: ttmRevenue, ebitda: ttmEbitda, netIncome: ttmNet, eps: ttmNet / shares },
      estimates: { growthThisYear: g0, growthNextYear: g1, note: g0 ? `Consensus revenue growth${nAnalysts ? ` (${nAnalysts} analysts)` : ""}: ${(g0 * 100).toFixed(1)}% this fiscal year${g1 !== null ? `, ${(g1 * 100).toFixed(1)}% next` : ""} (Yahoo Finance).` : null },
      beta: beta ? { ...beta, benchmark: bench.name, window: "2 years, weekly" } : null,
      yahooBeta: num(summary?.summaryDetail?.beta) ?? num(ks.beta),
      riskFree, erp, financial, warnings,
      asOf: new Date().toISOString(), source: "Yahoo Finance via yahoo-finance2 (unofficial; delayed prices)",
    };
    return data;
  });
}

async function peerRowFrom(symbol: string, s: any): Promise<(PeerRow & { sector: string }) | null> {
  const p = s?.price ?? {}, ks = s?.defaultKeyStatistics ?? {}, fd = s?.financialData ?? {};
  if (p.quoteType && p.quoteType !== "EQUITY") return null;
  const cur = majorCurrency(p.currency);
  const finCur = majorCurrency(fd.financialCurrency || p.currency).code;
  // Yahoo's own EV/EBITDA mixes currencies when statements and price differ (e.g. US-dollar filers listed in India),
  // so the multiples are rebuilt here with everything in the quote currency.
  const fx = finCur === cur.code ? 1 : await fxSpot(finCur, cur.code).catch(() => NaN);
  const rawCap = num(p.marketCap);
  const price = num(p.regularMarketPrice);
  const mcap = rawCap !== null && price !== null && num(ks.sharesOutstanding) ? (rawCap / (price * ks.sharesOutstanding) > 20 ? rawCap / cur.factor : rawCap) : rawCap;
  const cash = num(fd.totalCash), debt = num(fd.totalDebt), ebitda = num(fd.ebitda), rev = num(fd.totalRevenue), ni = num(ks.netIncomeToCommon);
  const bv = num(ks.bookValue), sh = num(ks.sharesOutstanding);
  const ev = mcap !== null && Number.isFinite(fx) ? mcap - (cash ?? 0) * fx + (debt ?? 0) * fx : null;
  return {
    symbol, name: p.longName || p.shortName || symbol, industry: s?.assetProfile?.industry ?? "", sector: s?.assetProfile?.sector ?? "", currency: cur.code,
    marketCap: mcap,
    evEbitda: ev !== null && ebitda && ebitda > 0 ? ev / (ebitda * fx) : fx === 1 ? num(ks.enterpriseToEbitda) : null,
    pe: mcap !== null && ni && ni > 0 && Number.isFinite(fx) ? mcap / (ni * fx) : fx === 1 ? num(s?.summaryDetail?.trailingPE) : null,
    evSales: ev !== null && rev && rev > 0 ? ev / (rev * fx) : null,
    pb: mcap !== null && bv && sh && bv > 0 && Number.isFinite(fx) ? mcap / (bv * sh * fx) : null,
    margin: num(fd.operatingMargins), growth: num(fd.revenueGrowth),
  };
}

export function getPeerRow(symbol: string): Promise<(PeerRow & { sector: string }) | null> {
  const sym = symbol.trim().toUpperCase();
  return cached("peer:" + sym, 6 * HOUR, async () => {
    const s: any = await yf.quoteSummary(sym, { modules: ["price", "assetProfile", "defaultKeyStatistics", "summaryDetail", "financialData"] });
    return peerRowFrom(sym, s);
  }).catch(() => null);
}

/** Peers in the same industry, found through Yahoo's "people also watch" links (two hops). */
export function getPeers(symbol: string, industry: string, sector: string): Promise<PeerRow[]> {
  return cached(`peers:${symbol}`, 6 * HOUR, async () => {
    const recs = async (s: string) => ((await yf.recommendationsBySymbol(s).catch(() => null)) as any)?.recommendedSymbols?.map((r: any) => r.symbol) ?? [];
    const first: string[] = await recs(symbol);
    const second = (await Promise.all(first.slice(0, 5).map(recs))).flat();
    const candidates = [...new Set([...first, ...second])].filter((s) => s && s !== symbol).slice(0, 18);
    const rows: (PeerRow & { sector: string })[] = [];
    for (let i = 0; i < candidates.length; i += 6) {
      const batch = await Promise.all(candidates.slice(i, i + 6).map(getPeerRow));
      batch.forEach((r) => { if (r) rows.push(r); });
    }
    const same = rows.filter((r) => industry && r.industry === industry);
    const strip = (r: PeerRow & { sector: string }): PeerRow => { const o: Partial<PeerRow & { sector: string }> = { ...r }; delete o.sector; return o as PeerRow; };
    if (same.length >= 3) return same.slice(0, 8).map(strip);
    const sameSector = rows.filter((r) => !same.includes(r) && sector && r.sector === sector);
    return [...same, ...sameSector].slice(0, 6).map(strip);
  });
}

export const CACHE_DAY = DAY;
