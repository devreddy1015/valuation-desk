"use client";
import { useEffect, useMemo, useState } from "react";
import { Scale } from "./AnalystPanel";
import { money0 as money, pct } from "@/lib/format";
import { BENCHMARK_BY_COUNTRY, FALLBACK_BENCHMARK } from "@/lib/markets";
import { riskStats } from "@/lib/risk";
import type { PricePoint } from "@/lib/bands";
import type { StockData } from "@/lib/types";
import "@/styles/outlook.css";

type Series = { points: PricePoint[] } | null;
type State = { kind: "loading" } | { kind: "error"; msg: string } | { kind: "ok"; stock: PricePoint[]; bench: PricePoint[] | null };

const monthLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * How much the shares swing and how far they have fallen, from five years of weekly prices, and the
 * one-year price range those swings span. A range, not a forecast of direction.
 */
export default function RiskRange({ data, price, value, valueLabel, analystMean }: {
  data: StockData; price: number; value: number | null; valueLabel: string; analystMean: number | null;
}) {
  const bench = BENCHMARK_BY_COUNTRY[data.country] ?? FALLBACK_BENCHMARK;
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/risk?symbol=${encodeURIComponent(data.symbol)}&bench=${encodeURIComponent(bench.symbol)}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as { stock?: Series; bench?: Series; error?: string } | null;
        if (!r.ok || !j?.stock) throw new Error(j?.error || `the server answered ${r.status}`);
        setState({ kind: "ok", stock: j.stock.points, bench: j.bench?.points ?? null });
      })
      .catch((e) => { if (!ctl.signal.aborted) setState({ kind: "error", msg: (e as Error).message }); });
    return () => ctl.abort();
  }, [data.symbol, bench.symbol]);

  const s = useMemo(() => (state.kind === "ok" ? riskStats(state.stock, state.bench, price) : null), [state, price]);
  const cur = data.currency;
  const head = (
    <div className="section-head">
      <h2 id="rk-h">Risk and likely range</h2>
      <p>How much the shares have swung and how far they have fallen over five years. Risk repeats far more reliably than direction, so this is the honest kind of forecast: how far the price may move, not which way.</p>
    </div>
  );
  if (state.kind === "loading") return <section className="card section" aria-labelledby="rk-h" aria-busy="true">{head}<p className="muted">Loading five years of prices…</p></section>;
  if (state.kind === "error" || !s) return <section className="card section" aria-labelledby="rk-h">{head}<p className="muted">{state.kind === "error" ? `Price history is unavailable right now (${state.msg}).` : "Not enough price history to measure risk: the shares need at least 30 weeks of trading."}</p></section>;

  const dd = s.maxDrawdown, r = s.rolling, rg = s.range;
  const ratio = s.vol !== null && s.benchVol ? s.vol / s.benchVol : null;
  const marks = [
    { at: price, text: "Price today", cls: "ol-m-price" },
    ...(value !== null && Number.isFinite(value) ? [{ at: value, text: valueLabel.charAt(0).toUpperCase() + valueLabel.slice(1), cls: "ol-m-value" }] : []),
    ...(analystMean !== null ? [{ at: analystMean, text: "Analysts' average", cls: "ol-m-an" }] : []),
  ];
  const lo = rg ? Math.min(rg.p10, ...marks.map((m) => m.at)) * 0.95 : 0, hi = rg ? Math.max(rg.p90, ...marks.map((m) => m.at)) * 1.05 : 1;
  const years = Math.max(1, Math.round(s.weeks / 52));
  return (
    <section className="card section" aria-labelledby="rk-h">
      {head}
      <div className="minis">
        <div className="mini">
          <span className="k">Swings (volatility)</span>
          <span className="v num">{pct(s.vol, 0)} a year</span>
          <span className="n">{ratio !== null ? `${ratio.toFixed(1)}× the ${bench.name}'s ${pct(s.benchVol, 0)}` : "from two years of weekly prices"}</span>
        </div>
        <div className="mini">
          <span className="k">Worst fall in {years} years</span>
          <span className="v num">{dd ? pct(dd.depth, 0) : "None"}</span>
          <span className="n">{dd ? `${monthLabel(dd.peak)} to ${monthLabel(dd.trough)}; ${dd.recovered ? `back to the high by ${monthLabel(dd.recovered)}` : "not yet back to that high"}` : "the shares only rose"}</span>
        </div>
        <div className="mini">
          <span className="k">Below its {years}-year high</span>
          <span className="v num">{s.fromPeak === null ? "–" : s.fromPeak > -0.005 ? "At the high" : pct(s.fromPeak, 0)}</span>
          <span className="n">highest weekly close in the window</span>
        </div>
        <div className="mini">
          <span className="k">Years that lost money</span>
          <span className="v num">{r ? pct(r.lossShare, 0) : "–"}</span>
          <span className="n">{r ? `of ${r.n} rolling 1-year periods; worst ${pct(r.worst, 0, true)}, best ${pct(r.best, 0, true)}` : "needs more than a year of prices"}</span>
        </div>
      </div>
      {rg && (
        <>
          <p className="ol-lead">If the shares keep swinging as they have for two years, half of one-year outcomes would land between <b>{money(rg.p25, cur)}</b> and <b>{money(rg.p75, cur)}</b>, and 8 in 10 between <b>{money(rg.p10, cur)}</b> and <b>{money(rg.p90, cur)}</b>. The middle is today&apos;s price because this measures how far, not which way.</p>
          <Scale lo={lo} hi={hi} currency={cur} label={`One-year range: half of outcomes between ${money(rg.p25, cur)} and ${money(rg.p75, cur)}, 8 in 10 between ${money(rg.p10, cur)} and ${money(rg.p90, cur)}`}
            bands={[{ from: rg.p10, to: rg.p90, cls: "ol-band-80" }, { from: rg.p25, to: rg.p75, cls: "ol-band-50" }]} marks={marks} />
          <div className="ol-legend" aria-hidden="true"><span><i className="ol-dot ol-band-80" />8 in 10 outcomes</span><span><i className="ol-dot ol-band-50" />half of outcomes</span></div>
        </>
      )}
      <p className="small">
        {s.worstWeek ? `Worst single week: ${pct(s.worstWeek.ret, 0)} (to ${dayLabel(s.worstWeek.date)}). ` : ""}
        {data.beta ? `Their beta against the ${data.beta.benchmark} is ${data.beta.value.toFixed(2)}: on a week the index moves 1%, the shares tend to move about ${data.beta.value.toFixed(2)}%.` : ""}
        {data.beta && ratio !== null && ratio > 1.2 && data.beta.value < 1 ? " They swing more than the index yet move less with it, because much of their movement comes from the company's own news rather than the market's." : ""}
      </p>
      <details className="tableview"><summary>Show as table</summary>
        <div className="scroll"><table className="data">
          <tbody>
            <tr><td className="left">Volatility, last 2 years</td><td>{pct(s.vol, 1)} a year</td></tr>
            <tr><td className="left">Volatility, {years} years</td><td>{pct(s.volFull, 1)} a year</td></tr>
            {s.benchVol !== null && <tr><td className="left">{bench.name} volatility, last 2 years</td><td>{pct(s.benchVol, 1)} a year</td></tr>}
            {dd && <tr><td className="left">Worst fall</td><td>{pct(dd.depth, 1)} ({dayLabel(dd.peak)} to {dayLabel(dd.trough)})</td></tr>}
            {r && <tr><td className="left">Rolling 1-year returns</td><td>worst {pct(r.worst, 1, true)}, median {pct(r.median, 1, true)}, best {pct(r.best, 1, true)}</td></tr>}
            {rg && <tr><td className="left">One-year range, 50%</td><td>{money(rg.p25, cur)} to {money(rg.p75, cur)}</td></tr>}
            {rg && <tr><td className="left">One-year range, 80%</td><td>{money(rg.p10, cur)} to {money(rg.p90, cur)}</td></tr>}
          </tbody>
        </table></div>
      </details>
      <p className="note">Weekly closes adjusted for dividends and splits, {dayLabel(s.from)} to {dayLabel(s.to)}. Five years may miss a crisis: falls in 2008 or early 2020 were deeper than most five-year windows show, and volatility itself changes. A statistical range, not a prediction.</p>
    </section>
  );
}
