import "server-only";
import YahooFinance from "yahoo-finance2";
import { cached, DAY, HOUR, MIN } from "./cache";
import { erpFor } from "./countryRisk";
import { BENCHMARK_BY_COUNTRY, FALLBACK_BENCHMARK, RISK_FREE_SOURCED, isFinancialFirm, majorCurrency } from "../markets";
import { fyLabel } from "../model";
import type { FiscalYear, PeerRow, StockData } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export class DataError extends Error {
  constructor(message: string, public code: "not_found" | "unsupported" | "upstream") { super(message); }
}

/**
 * yahoo-finance2 runs four calls at a time per instance with no timeout, so one hung response would
 * hold a slot for minutes and stall every page behind it. Each call gets its own deadline instead.
 */
export function yahooCall(ms = 9000): any {
  const fetchWithDeadline = (input: RequestInfo | URL, init?: RequestInit) => {
    const deadline = AbortSignal.timeout(ms);
    return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
  };
  return { fetch: fetchWithDeadline };
}
const MO = yahooCall();

/** Yahoo answered but has nothing for this symbol, as opposed to Yahoo failing or limiting requests. */
export const isNotFound = (e: unknown) => /not found|no data found|delisted|invalid symbol|no fundamentals data/i.test(String((e as Error)?.message ?? e));
/** Run a Yahoo call, retrying once after a short pause unless Yahoo said the symbol does not exist. */
async function retry<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (isNotFound(e)) throw e;
    await new Promise((r) => setTimeout(r, 800));
    return fn();
  }
}
const unavailable = (symbol: string) => new DataError(`Yahoo Finance is not answering for ${symbol} right now`, "upstream");

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const isoDate = (d: unknown) => new Date(d as string).toISOString().slice(0, 10);
const millions = (n: number) => `${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })} million`;

export interface SearchHit { symbol: string; name: string; exchange: string; type: string }

export interface QuoteLite { symbol: string; name: string; price: number; marketCap: number; changePct: number | null; currency: string }

/**
 * Price, market value and today's move for many symbols: batches of 50 in parallel. Yahoo's quotes
 * leave out the market cap for some Indian companies when asked from outside India (Reliance and TCS
 * from Vercel's US servers), so for any symbol still without one, the company summary's market cap or
 * share count fills it in. Non-equities and symbols with no market value are dropped.
 */
export async function quotesFor(symbols: string[]): Promise<QuoteLite[]> {
  const fields = ["symbol", "longName", "shortName", "regularMarketPrice", "marketCap", "sharesOutstanding", "regularMarketChangePercent", "currency", "quoteType"];
  const lite = (q: any): QuoteLite | null => {
    const price = num(q?.regularMarketPrice);
    if (!q?.symbol || (q.quoteType && q.quoteType !== "EQUITY") || !price) return null;
    const cur = majorCurrency(q.currency);
    const cap = num(q.marketCap) ?? (num(q.sharesOutstanding) ? (price / cur.factor) * q.sharesOutstanding : null);
    return cap ? { symbol: q.symbol, name: q.longName || q.shortName || q.symbol, price: price / cur.factor, marketCap: cap, changePct: num(q.regularMarketChangePercent), currency: cur.code } : null;
  };
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += 50) batches.push(symbols.slice(i, i + 50));
  const got = new Map<string, QuoteLite>();
  const results = await Promise.all(batches.map((b) => retry(() => yf.quote(b, { fields }, MO)).catch(() => null)));
  if (results.every((r) => r === null)) throw unavailable(`${symbols.length} symbols`);
  for (const rows of results) for (const q of (rows as any[] | null) ?? []) { const l = lite(q); if (l) got.set(l.symbol, l); }
  const missing = symbols.filter((s) => !got.has(s));
  for (let i = 0; i < missing.length; i += 4) {
    const again = await Promise.all(missing.slice(i, i + 4).map((s) =>
      retry(() => yf.quoteSummary(s, { modules: ["price", "defaultKeyStatistics"] }, MO)).then((r: any) => lite({
        symbol: s, quoteType: r?.price?.quoteType, currency: r?.price?.currency, longName: r?.price?.longName, shortName: r?.price?.shortName,
        regularMarketPrice: r?.price?.regularMarketPrice, regularMarketChangePercent: num(r?.price?.regularMarketChangePercent) !== null ? r.price.regularMarketChangePercent * 100 : null,
        marketCap: r?.price?.marketCap, sharesOutstanding: r?.defaultKeyStatistics?.sharesOutstanding ?? r?.defaultKeyStatistics?.impliedSharesOutstanding,
      })).catch(() => null)));
    for (const l of again) if (l) got.set(l.symbol, l);
  }
  return symbols.map((s) => got.get(s)).filter((x): x is QuoteLite => !!x);
}

export function searchSymbols(q: string): Promise<SearchHit[]> {
  const query = q.trim().slice(0, 60);
  return cached("search:" + query.toLowerCase(), 6 * HOUR, async () => {
    const r: any = await yf.search(query, { quotesCount: 15, newsCount: 0 }, MO);
    return (r.quotes ?? [])
      .filter((x: any) => x.symbol && (x.quoteType === "EQUITY" || x.typeDisp === "Equity"))
      .map((x: any) => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, exchange: x.exchDisp || x.exchange || "", type: x.typeDisp || x.quoteType }));
  });
}

/**
 * Monthly FX closes for from->to, keyed "YYYY-MM". Yahoo stamps FX bars at London midnight, which
 * falls on the previous day in UTC during British summer time, so dates are shifted to local time first.
 */
async function fxMonthly(from: string, to: string, start: Date): Promise<Map<string, number>> {
  return cached(`fx:${from}${to}:${start.getUTCFullYear()}`, 12 * HOUR, async () => {
    const r: any = await retry(() => yf.chart(`${from}${to}=X`, { period1: start, interval: "1mo" }, MO));
    const off = num(r?.meta?.gmtoffset) ?? 0;
    const m = new Map<string, number>();
    for (const q of r.quotes ?? []) if (num(q.close)) m.set(new Date(+new Date(q.date) + off * 1000 + 6 * 36e5).toISOString().slice(0, 7), q.close);
    if (!m.size) throw new DataError(`No exchange rate found for ${from}/${to}`, "upstream");
    return m;
  });
}
/** Live exchange rate: units of `to` per unit of `from`. */
export async function fxSpot(from: string, to: string): Promise<number> {
  return cached(`fxspot:${from}${to}`, 30 * MIN, async () => {
    const q: any = await retry(() => yf.quote(`${from}${to}=X`, {}, MO));
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
  return cached("tnx", 30 * MIN, async () => num(((await yf.quote("^TNX", {}, MO)) as any)?.regularMarketPrice)).catch(() => null);
}

interface Weekly { closes: Map<string, number>; dividends: { date: string; amount: number }[] }
/**
 * Two years of weekly closes plus dividend events, in one call per symbol. Shared by the beta (the
 * country index is fetched once, not once per stock) and by the dividends paid since the balance sheet.
 */
function weekly(symbol: string): Promise<Weekly> {
  return cached(`wk:${symbol}`, 12 * HOUR, async () => {
    const start = new Date(Date.now() - (2 * 365 + 10) * 864e5);
    const r: any = await retry(() => yf.chart(symbol, { period1: start, interval: "1wk", events: "div" }, MO));
    const key = (d: any) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
    const closes = new Map<string, number>();
    for (const q of r.quotes ?? []) { const v = num(q.adjclose) ?? num(q.close); if (v) closes.set(key(q.date), v); }
    const dividends = (r.events?.dividends ?? []).map((d: any) => ({ date: isoDate(d.date), amount: d.amount })).filter((d: any) => num(d.amount));
    return { closes, dividends };
  });
}

/** OLS beta of weekly returns against a benchmark over the last two years. */
async function computeBeta(symbol: string, benchmark: string): Promise<{ value: number; r2: number; n: number } | null> {
  const [a, b] = await Promise.all([weekly(symbol), weekly(benchmark)]).catch(() => [null, null]);
  if (!a || !b) return null;
  const sa = a.closes, sb = b.closes;
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
  return { value: sxy / sxx, r2: (sxy * sxy) / (sxx * syy), n: xs.length };
}

/** Dividends (per share, quote currency) with ex-dates after the balance-sheet date; null when they could not be checked. */
async function dividendsSince(symbol: string, since: string): Promise<{ perShare: number; events: { date: string; amount: number }[] } | null> {
  const w = await weekly(symbol).catch(() => null);
  if (!w) return null;
  const events = w.dividends.filter((d) => d.date > since);
  return { perShare: events.reduce((s, d) => s + d.amount, 0), events };
}

const pick = (row: any, ...keys: string[]) => { for (const k of keys) { const v = num(row?.[k]); if (v !== null) return v; } return null; };
const opt = (v: number | null, k: number) => (v === null ? null : v * k);
const abs = (v: number | null) => (v === null ? null : Math.abs(v));

/** A bonus issue, split or consolidation between two share counts: the whole-number factor, or 1. */
function splitFactor(now: number, then: number): number {
  const r = now / then;
  if (r >= 1.9) { const k = Math.round(r); return Math.abs(r / k - 1) <= 0.1 ? k : 1; }
  if (r <= 1 / 1.9) { const k = Math.round(1 / r); return Math.abs(r * k - 1) <= 0.1 ? 1 / k : 1; }
  return 1;
}

export function getStockData(rawSymbol: string): Promise<StockData> {
  const symbol = rawSymbol.trim().toUpperCase();
  return cached("stock:" + symbol, 15 * MIN, async () => {
    let quote: any;
    try { quote = await retry(() => yf.quote(symbol, {}, MO)); } catch (e) {
      if (isNotFound(e)) throw new DataError(`Yahoo Finance has no quote for ${symbol}`, "not_found");
      throw unavailable(symbol);
    }
    if (!quote || !num(quote.regularMarketPrice)) throw new DataError(`Yahoo Finance has no price for ${symbol}`, "not_found");
    if (quote.quoteType && quote.quoteType !== "EQUITY") throw new DataError(`${symbol} is a ${String(quote.quoteType).toLowerCase()}, not a company share`, "unsupported");

    const warnings: string[] = [];
    // A failed profile or statements call must not pass for "no data": a bank whose profile failed
    // would be valued as an ordinary company, and that result would be cached. Only Yahoo saying the
    // data does not exist counts as missing; anything else fails the request so the next view retries.
    const [summary, fts]: any[] = await Promise.all([
      retry(() => yf.quoteSummary(symbol, { modules: ["assetProfile", "defaultKeyStatistics", "financialData", "summaryDetail", "earningsTrend"] }, MO)).catch((e) => {
        if (!isNotFound(e)) throw unavailable(symbol);
        warnings.push("Yahoo has no company profile for this symbol, so its sector, country, peers and analyst estimates are missing.");
        return {};
      }),
      retry(() => yf.fundamentalsTimeSeries(symbol, { period1: new Date(Date.now() - 7 * 365 * 864e5), type: "annual", module: "all" }, MO)).catch((e) => {
        if (!isNotFound(e)) throw unavailable(symbol);
        return [];
      }),
    ]);

    const cur = majorCurrency(quote.currency);
    const finCur = majorCurrency(quote.financialCurrency || summary?.financialData?.financialCurrency || quote.currency).code;

    const rows = (fts as any[])
      .filter((r) => r && r.date && pick(r, "totalRevenue", "operatingRevenue"))
      .sort((a, b) => +new Date(a.date) - +new Date(b.date))
      .slice(-5);
    if (rows.length < 2) throw new DataError(`Yahoo Finance has fewer than two years of annual statements for ${symbol}`, "unsupported");

    // currency conversion: flows at each fiscal year's average rate, the balance sheet at today's rate
    // Yahoo sometimes labels statements in one currency and serves them in another (HCL Tech: financialCurrency
    // USD, annual statements in INR). financialData is in financialCurrency, so its trailing revenue against the
    // latest annual revenue tells which currency the statements are really in.
    const fdSpot = finCur !== cur.code ? await fxSpot(finCur, cur.code) : 1;
    let stmtCur = finCur;
    const fdRev = num(summary?.financialData?.totalRevenue), lastRev = pick(rows[rows.length - 1], "totalRevenue", "operatingRevenue");
    if (finCur !== cur.code && fdRev && lastRev) {
      const r = lastRev / fdRev;
      if (r > fdSpot / 2 && r < fdSpot * 2 && !(r > 0.5 && r < 2)) stmtCur = cur.code;
    }
    let fxNote: string | null = stmtCur !== finCur ? `Yahoo labels these statements ${finCur} but serves them in ${cur.code}, so they are used as ${cur.code} without conversion.` : null;
    let flowRate: (end: string) => number = () => 1, spot = 1;
    if (stmtCur !== cur.code) {
      const start = new Date(new Date(rows[0].date).getTime() - 400 * 864e5);
      const m = await fxMonthly(stmtCur, cur.code, start);
      spot = fdSpot;
      flowRate = (end: string) => fyAverage(m, end) ?? fdSpot;
      fxNote = `Statements are reported in ${stmtCur}; converted to ${cur.code} at each year's average exchange rate (balance sheet and trailing figures at today's ${stmtCur}/${cur.code} rate of ${fdSpot.toFixed(4)}).`;
    }

    const last = rows[rows.length - 1];
    const marchFY = new Date(last.date).getUTCMonth() !== 11;
    const ebitRepaired: string[] = [];
    const history: FiscalYear[] = rows.map((r) => {
      const end = isoDate(r.date), k = flowRate(end), label = fyLabel(end, marchFY);
      const revenue = pick(r, "totalRevenue", "operatingRevenue")!;
      const da = pick(r, "reconciledDepreciation", "depreciationAndAmortization", "depreciationAmortizationDepletion") ?? 0;
      // Operating profit can't exceed EBITDA. When Yahoo's operatingIncome does (HCL Tech: revenue minus an
      // incomplete expense total, 31% against a true 18%), use EBITDA less depreciation instead.
      let ebit = pick(r, "operatingIncome", "totalOperatingIncomeAsReported", "EBIT") ?? 0;
      const ebitda = pick(r, "EBITDA", "normalizedEBITDA");
      if (ebitda !== null && ebit > ebitda * 1.02 && ebitda - da > 0) { ebit = ebitda - da; ebitRepaired.push(label); }
      return {
        label, end,
        revenue: revenue * k,
        ebit: ebit * k,
        da: da * k,
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
    if (ebitRepaired.length) warnings.push(`Yahoo's operating profit was larger than EBITDA in ${ebitRepaired.join(", ")}, which can't be right, so EBITDA less depreciation is used as operating profit there. Check it against the annual report.`);

    const leases = (pick(last, "capitalLeaseObligations") ?? ((pick(last, "currentCapitalLeaseObligation") ?? 0) + (pick(last, "longTermCapitalLeaseObligation") ?? 0))) * spot;
    const totalDebt = (pick(last, "totalDebt") ?? 0) * spot;
    const cash = (pick(last, "cashCashEquivalentsAndShortTermInvestments") ?? ((pick(last, "cashAndCashEquivalents") ?? 0) + (pick(last, "otherShortTermInvestments") ?? 0))) * spot;
    const nci = (pick(last, "minorityInterest") ?? 0) * spot;
    const equity = pick(last, "stockholdersEquity", "commonStockEquity");
    const fd = summary?.financialData ?? {}, ks = summary?.defaultKeyStatistics ?? {};

    const price = quote.regularMarketPrice / cur.factor;
    let shares = num(quote.sharesOutstanding) ?? num(ks.sharesOutstanding) ?? (pick(last, "dilutedAverageShares", "ordinarySharesNumber") ?? 0);
    if (!shares) throw new DataError(`No share count for ${symbol}`, "unsupported");
    // Yahoo reports market cap in major units for most markets; guard against minor-unit (pence) feeds.
    const rawCap = num(quote.marketCap) ?? price * shares;
    const marketCap = rawCap / (price * shares) > 20 ? rawCap / cur.factor : rawCap;
    // Yahoo's share count can cover one class only (Alphabet's A shares, Samsung's common) while profits,
    // equity and the market cap cover them all. Then the per-share figures would be too high.
    const capRatio = marketCap / (price * shares);
    let multiClass = false;
    if (Math.abs(capRatio - 1) > 0.03) {
      const all = num(ks.impliedSharesOutstanding) ?? marketCap / price;
      if (all > 0 && Math.abs(all / shares - 1) > 0.03) {
        warnings.push(`Yahoo's share count (${millions(shares)}) covers only part of the company, probably one share class; the model uses ${millions(all)}, the market value of every class divided by the price.`);
        shares = all;
        multiClass = true;
      }
    }

    const bsDate = isoDate(last.date);
    // Buybacks or new shares since the balance sheet: its cash and equity belong to the share count of
    // that date, so value per share is adjusted by the shares retired (or issued) at today's price.
    // Bonus issues and splits change the count without moving cash, so they are allowed for first.
    // (Skipped with several share classes: the balance-sheet count may cover one class only.)
    const bsSharesRaw = multiClass ? null : pick(last, "ordinarySharesNumber");
    const bsShares = bsSharesRaw && bsSharesRaw > 0 ? bsSharesRaw * splitFactor(shares, bsSharesRaw) : null;
    const shareChange = bsShares ? (bsShares - shares) / shares : 0; // > 0: shares retired since the balance sheet
    const adjustShares = Math.abs(shareChange) > 0.01 && Math.abs(shareChange) <= 0.3;
    if (bsShares && Math.abs(shareChange) > 0.3) warnings.push(`The share count today (${millions(shares)}) is far from the ${millions(bsShares)} on the ${bsDate} balance sheet. Check the share count in the Company data table.`);

    const [div, beta, erp, tnx] = await Promise.all([
      dividendsSince(symbol, bsDate),
      computeBeta(symbol, (BENCHMARK_BY_COUNTRY[summary?.assetProfile?.country] ?? FALLBACK_BENCHMARK).symbol),
      erpFor(summary?.assetProfile?.country ?? ""),
      usTenYear(),
    ]);
    const dividendsPaid = div ? (div.perShare / cur.factor) * shares : 0;
    const buybackValue = adjustShares && bsShares ? (bsShares - shares) * price : 0;
    const returned = dividendsPaid + buybackValue;
    const notes: string[] = [];
    notes.push(!div ? `Dividends since ${bsDate} could not be checked (Yahoo did not answer); none are deducted` : div.events.length ? `Dividends with ex-dates after ${bsDate}: ${div.events.map((e) => `${e.date} (${(e.amount / cur.factor).toFixed(2)} per share)`).join(", ")}` : `No dividends with ex-dates after ${bsDate}`);
    if (buybackValue > 0) notes.push(`about ${millions(bsShares! - shares)} shares bought back since then, valued at today's price`);
    if (buybackValue < 0) notes.push(`about ${millions(shares - bsShares!)} shares issued since then, counted as cash raised at today's price`);

    // trailing figures: financialData is in financialCurrency, the statement fallbacks in the statements' currency
    const trailing = (v: unknown, fallback: number | null) => (num(v) !== null ? (v as number) * fdSpot : (fallback ?? 0) * spot);
    const ttmRevenue = trailing(fd.totalRevenue, history[history.length - 1].revenue / flowRate(bsDate));
    const ttmEbitda = trailing(fd.ebitda, pick(last, "EBITDA", "normalizedEBITDA"));
    const ttmNet = trailing(ks.netIncomeToCommon, pick(last, "netIncomeCommonStockholders"));

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
    const assets = pick(last, "totalAssets"), loans = pick(last, "netLoan", "grossLoan", "loansReceivable");
    const interestIncome = pick(last, "interestIncome");
    const financial = isFinancialFirm(sector, industry, {
      loansToAssets: loans !== null && assets ? loans / assets : null,
      interestToRevenue: interestIncome !== null && lastRev ? interestIncome / lastRev : null,
      revenueToAssets: lastRev && assets ? lastRev / assets : null,
    });
    if (financial) warnings.push("Lenders, insurers and investment holding companies are not suited to a free-cash-flow DCF: the value starts on peer multiples only (P/E and P/B).");
    if (g0raw === null) warnings.push("No consensus revenue estimate: the first forecast years start from history.");
    const debtShare = (Math.max(0, totalDebt - leases) + leases) / Math.max(1, marketCap);
    if (debtShare > 0.5 && !financial) warnings.push(`Debt is ${(debtShare * 100).toFixed(0)}% of market value. If part of it funds a lending or finance arm (car makers, conglomerates), the DCF will understate equity value: check the bridge.`);
    const ageDays = (Date.now() - +new Date(bsDate)) / 864e5;
    if (ageDays > 550) warnings.push("The latest annual report on Yahoo is more than 18 months old.");

    const bench = BENCHMARK_BY_COUNTRY[country] ?? FALLBACK_BENCHMARK;
    const data: StockData = {
      symbol, name: quote.longName || quote.shortName || symbol, exchange: quote.fullExchangeName || quote.exchange || "",
      country, sector, industry,
      currency: cur.code, financialCurrency: stmtCur, fxNote,
      price, priceTime: new Date(quote.regularMarketTime ?? Date.now()).toISOString(),
      marketCap, shares,
      hi52: (num(quote.fiftyTwoWeekHigh) ?? price * cur.factor) / cur.factor,
      lo52: (num(quote.fiftyTwoWeekLow) ?? price * cur.factor) / cur.factor,
      // book value per share on the share count of the balance-sheet date, like Yahoo's own figure
      bookValuePerShare: equity ? (equity * spot) / (bsShares ?? shares) : null,
      history,
      bridge: { date: bsDate, cash, borrowings: Math.max(0, totalDebt - leases), leases, nci, returned, returnedNote: notes.join("; ") },
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
  const bv = num(ks.bookValue);
  const ev = mcap !== null && Number.isFinite(fx) ? mcap - (cash ?? 0) * fx + (debt ?? 0) * fx : null;
  return {
    symbol, name: p.longName || p.shortName || symbol, industry: s?.assetProfile?.industry ?? "", sector: s?.assetProfile?.sector ?? "", currency: cur.code,
    marketCap: mcap,
    evEbitda: ev !== null && ebitda && ebitda > 0 ? ev / (ebitda * fx) : fx === 1 ? num(ks.enterpriseToEbitda) : null,
    pe: mcap !== null && ni && ni > 0 && Number.isFinite(fx) ? mcap / (ni * fx) : fx === 1 ? num(s?.summaryDetail?.trailingPE) : null,
    evSales: ev !== null && rev && rev > 0 ? ev / (rev * fx) : null,
    // bookValue is already per share in the quote currency (unlike the financialData totals), so no FX here
    pb: price !== null && bv && bv > 0 ? price / cur.factor / bv : null,
    margin: num(fd.operatingMargins), growth: num(fd.revenueGrowth),
  };
}

/** One peer's multiples. Null when Yahoo has no such equity; throws when Yahoo fails, so failures are never cached. */
export function getPeerRow(symbol: string): Promise<(PeerRow & { sector: string }) | null> {
  const sym = symbol.trim().toUpperCase();
  return cached("peer:" + sym, 6 * HOUR, async () => {
    let s: any;
    try { s = await retry(() => yf.quoteSummary(sym, { modules: ["price", "assetProfile", "defaultKeyStatistics", "summaryDetail", "financialData"] }, MO)); } catch (e) {
      if (isNotFound(e)) return null;
      throw unavailable(sym);
    }
    return peerRowFrom(sym, s);
  });
}

/**
 * Peers in the same industry, found through Yahoo's "people also watch" links (two hops). Throws when
 * Yahoo fails rather than returning an empty list that would be cached; a genuinely empty answer is
 * kept for 20 minutes only, a full one for 6 hours.
 */
export function getPeers(symbol: string, industry: string, sector: string): Promise<PeerRow[]> {
  return cached(`peers:${symbol}:${industry}`, (rows: PeerRow[]) => (rows.length ? 6 * HOUR : 20 * MIN), async () => {
    const recs = async (s: string) => ((await retry(() => yf.recommendationsBySymbol(s, {}, MO))) as any)?.recommendedSymbols?.map((r: any) => r.symbol) ?? [];
    let first: string[];
    try { first = await recs(symbol); } catch (e) {
      if (isNotFound(e)) return [];
      throw unavailable(symbol);
    }
    const second = (await Promise.all(first.slice(0, 5).map((s) => recs(s).catch(() => [])))).flat();
    const candidates = [...new Set([...first, ...second])].filter((s) => s && s !== symbol).slice(0, 18);
    const rows: (PeerRow & { sector: string })[] = [];
    let failed = 0;
    for (let i = 0; i < candidates.length; i += 6) {
      const batch = await Promise.all(candidates.slice(i, i + 6).map((c) => getPeerRow(c).catch(() => { failed++; return null; })));
      batch.forEach((r) => { if (r) rows.push(r); });
    }
    if (candidates.length && failed > candidates.length / 2) throw unavailable(symbol);
    const same = rows.filter((r) => industry && r.industry === industry);
    const strip = (r: PeerRow & { sector: string }): PeerRow => { const o: Partial<PeerRow & { sector: string }> = { ...r }; delete o.sector; return o as PeerRow; };
    if (same.length >= 3) return same.slice(0, 8).map(strip);
    const sameSector = rows.filter((r) => !same.includes(r) && sector && r.sector === sector);
    return [...same, ...sameSector].slice(0, 6).map(strip);
  });
}

export const CACHE_DAY = DAY;
