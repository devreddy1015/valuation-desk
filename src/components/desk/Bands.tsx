"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import "@/styles/insight.css";
import { niceTicks, useTip } from "./charts";
import { BAND_LABEL, BAND_MAX, buildBand, type Band, type BandKind, type BandPoint, type PriceHistory } from "@/lib/bands";
import { money, money0, mult, pct } from "@/lib/format";
import type { StockData } from "@/lib/types";

type Load = { key: string; state: "ok"; h: PriceHistory } | { key: string; state: "error"; msg: string };
type Row = [string, string, string?];

const fin = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const monthLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th"));
const perShareLabel = (k: BandKind) => (k === "pe" ? "Earnings per share" : "Book value per share");

/** The headline sentence, the phrase to highlight in it, and follow-up sentences. */
function describe(b: Band, kind: BandKind, price: number, cur: string): { text: string; accent: string; more: string[] } {
  const L = BAND_LABEL[kind], s = b.stats;
  if (!s.n || !s.from) return { text: `There isn't enough history to draw a ${L} range for this stock.`, accent: "", more: [] };
  const since = monthLabel(s.from), med = mult(s.median);
  const more = [`In 8 of every 10 months it sat between ${mult(s.p10)} and ${mult(s.p90)}.`];
  if (fin(s.atMedian) && price > 0) {
    const d = s.atMedian / price - 1;
    more.push(`At its median ${L}, today's ${kind === "pe" ? "earnings" : "book value"} would be worth ${money(s.atMedian, cur)} a share, ${Math.abs(d) < 0.005 ? "in line with" : `${pct(Math.abs(d), 0)} ${d > 0 ? "above" : "below"}`} today's price: a what-if, not a forecast.`);
  }
  if (s.current === null || s.currentPercentile === null) return { text: `Today's ${L} can't be calculated; its median since ${since} was ${med}.`, accent: med, more };
  const now = mult(s.current);
  if (s.currentPercentile <= 0) return { text: `Today's ${L} of ${now} is lower than in any month since ${since} (median ${med}).`, accent: "lower than in any month", more };
  if (s.currentPercentile >= 1) return { text: `Today's ${L} of ${now} is higher than in any month since ${since} (median ${med}).`, accent: "higher than in any month", more };
  const ord = `${ordinal(Math.min(99, Math.max(1, Math.round(s.currentPercentile * 100))))} percentile`;
  return { text: `Today's ${L} of ${now} is at the ${ord} of its range since ${since} (median ${med}).`, accent: ord, more };
}

function BandChart({ band, kind, currency, nowDate }: { band: Band; kind: BandKind; currency: string; nowDate: string }) {
  const { ref, node, place, setTip } = useTip();
  const svgRef = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(720);
  const [idx, setIdx] = useState<number | null>(null);
  // Size the viewBox to the real width so text stays legible on a phone.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  const S = band.series, st = band.stats, L = BAND_LABEL[kind], n = S.length;
  const narrow = W < 520;
  const H = narrow ? 250 : 300, left = 44, right = narrow ? 84 : 112, top = 16, bottom = 28;
  const t0 = Date.parse(S[0].date), t1 = Math.max(Date.parse(nowDate) || 0, Date.parse(S[n - 1].date), t0 + 864e5);
  const X = (t: number) => left + ((t - t0) / (t1 - t0)) * (W - left - right);
  const vals = S.map((p) => p.multiple).filter(fin);
  const hiD = Math.max(...vals, st.p90), loD = Math.min(...vals, st.p10);
  const cur = st.current;
  const curOn = cur !== null && cur <= hiD * 1.6 && cur >= loD / 1.6; // a far-off value would flatten the history
  const ticks = niceTicks(Math.max(0, Math.min(loD, curOn ? cur : loD) * 0.9), Math.max(hiD, curOn ? cur : hiD) * 1.06, narrow ? 4 : 5);
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const Y = (v: number) => top + ((hi - v) / (hi - lo)) * (H - top - bottom);

  // line segments, broken at gaps; a lone month between gaps becomes a dot
  const segs: { d: string; pts: number }[] = [];
  let cur_d = "", cur_n = 0;
  for (const p of S) {
    if (p.multiple === null) { if (cur_n) segs.push({ d: cur_d, pts: cur_n }); cur_d = ""; cur_n = 0; continue; }
    cur_d += `${cur_n ? "L" : "M"}${X(Date.parse(p.date)).toFixed(1)} ${Y(p.multiple).toFixed(1)}`;
    cur_n++;
  }
  if (cur_n) segs.push({ d: cur_d, pts: cur_n });

  const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
  const years = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i).map((y) => ({ y, t: Date.UTC(y, 0, 1) })).filter((v) => v.t >= t0 && v.t <= t1);
  const yStep = Math.max(1, Math.ceil((years.length * 44) / (W - left - right)));
  const xEnd = X(t1), curY = cur === null ? null : curOn ? Y(cur) : top;
  const medY = Y(st.median), medInGutter = curY === null || Math.abs(curY - medY) >= 16;

  const rows = (p: BandPoint): Row[] => [
    [L, p.multiple === null ? "gap" : mult(p.multiple), "var(--s1)"],
    ["Share price", money(p.close, currency)],
    [`${perShareLabel(kind)}${p.fy ? ` (${p.fy})` : ""}`, money(p.perShare, currency)],
  ];
  const valueText = (i: number) => { const p = S[i]; return `${monthLabel(p.date)}: ${L} ${p.multiple === null ? "not meaningful" : mult(p.multiple)}, share price ${money(p.close, currency)}`; };
  const showAt = (i: number) => {
    const k = Math.max(0, Math.min(n - 1, i));
    setIdx(k);
    const p = S[k], b = svgRef.current?.getBoundingClientRect();
    if (b) place(b.left + (X(Date.parse(p.date)) / W) * b.width, b.top + ((p.multiple === null ? medY : Y(p.multiple)) / H) * b.height, monthLabel(p.date), rows(p));
  };
  const nearest = (clientX: number) => {
    const b = svgRef.current!.getBoundingClientRect();
    const t = t0 + ((((clientX - b.left) / b.width) * W - left) / (W - left - right)) * (t1 - t0);
    let best = 0;
    S.forEach((p, i) => { if (Math.abs(Date.parse(p.date) - t) < Math.abs(Date.parse(S[best].date) - t)) best = i; });
    return best;
  };
  const fp = idx !== null ? S[idx] : null;

  return (
    <div className="chart band-chart" ref={ref}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${L} by month with its middle 80% range, median and today's value`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={left} x2={xEnd} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" />
            <text x={left - 8} y={Y(v) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{mult(v)}</text>
          </g>
        ))}
        {fin(st.p10) && fin(st.p90) && <rect className="band-range" x={left} width={xEnd - left} y={Y(st.p90)} height={Math.max(1, Y(st.p10) - Y(st.p90))} />}
        {years.filter((_, i) => i % yStep === 0).map((v) => <text key={v.y} x={X(v.t)} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--muted)">{v.y}</text>)}
        {fin(st.median) && <line x1={left} x2={xEnd} y1={medY} y2={medY} stroke="var(--ink-2)" strokeWidth="1.5" />}
        {segs.map((s, i) => s.pts > 1
          ? <path key={i} d={s.d} fill="none" stroke="var(--s1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          : <circle key={i} cx={s.d.slice(1).split(" ")[0]} cy={s.d.split(" ")[1]} r="2.5" fill="var(--s1)" />)}
        {fin(st.median) && (medInGutter
          ? <text x={xEnd + 10} y={medY + 4} fontSize="12" fill="var(--ink-2)">Median {mult(st.median)}</text>
          : <text x={left + 6} y={medY - 6} fontSize="12" fill="var(--ink-2)">Median {mult(st.median)}</text>)}
        {cur !== null && curY !== null && (
          <g>
            <circle cx={xEnd} cy={curY} r="5" fill="var(--accent)" stroke="var(--card)" strokeWidth="2" />
            <text x={xEnd + 10} y={curY + 4} fontSize="12.5" fontWeight="700" fill="var(--ink)">Today {mult(cur)}{curOn ? "" : " ↑"}</text>
          </g>
        )}
        {fp && (
          <g pointerEvents="none">
            <line x1={X(Date.parse(fp.date))} x2={X(Date.parse(fp.date))} y1={top} y2={H - bottom} stroke="var(--ink-2)" />
            {fp.multiple !== null && <circle cx={X(Date.parse(fp.date))} cy={Y(fp.multiple)} r="4.5" fill="var(--s1)" stroke="var(--card)" strokeWidth="2" />}
          </g>
        )}
        <rect className="hit" x={left} y={top} width={Math.max(1, xEnd - left)} height={H - top - bottom} fill="transparent" tabIndex={0}
          role="slider" aria-label={`Month on the ${L} chart; use the arrow keys`} aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={idx ?? n - 1} aria-valuetext={valueText(idx ?? n - 1)}
          onPointerMove={(e) => showAt(nearest(e.clientX))}
          onPointerLeave={() => { setIdx(null); setTip(null); }}
          onFocus={() => showAt(idx ?? n - 1)}
          onBlur={() => { setIdx(null); setTip(null); }}
          onKeyDown={(e) => {
            const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1, PageDown: -12, PageUp: 12 };
            if (e.key in step) { e.preventDefault(); showAt((idx ?? n - 1) + step[e.key]); }
            else if (e.key === "Home") { e.preventDefault(); showAt(0); }
            else if (e.key === "End") { e.preventDefault(); showAt(n - 1); }
          }} />
      </svg>
      {node}
    </div>
  );
}

export default function Bands({ data, price }: { data: StockData; price: number }) {
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load | null>(null);
  const [picked, setPicked] = useState<BandKind | null>(null);
  const order: BandKind[] = data.financial ? ["pb", "pe"] : ["pe", "pb"];
  const kind = picked ?? order[0];
  const key = `${data.symbol}#${attempt}`;

  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/history?symbol=${encodeURIComponent(data.symbol)}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || !Array.isArray(j.points)) throw new Error(j?.error || `The price history request failed (${r.status}).`);
        return j as PriceHistory;
      })
      .then((h) => setLoad({ key, state: "ok", h }))
      .catch((e: Error) => {
        if (ctl.signal.aborted) return;
        setLoad({ key, state: "error", msg: e.name === "TypeError" ? "Couldn't reach the server. Check your connection and try again." : e.message });
      });
    return () => ctl.abort();
  }, [data.symbol, key]);

  const cur = load && load.key === key ? load : null;
  const mismatch = cur?.state === "ok" && cur.h.currency !== data.currency;
  const band = useMemo(() => (cur?.state === "ok" && !mismatch ? buildBand(cur.h.points, cur.h.splits, data, kind, { price, date: data.asOf }) : null), [cur, mismatch, data, kind, price]);
  const L = BAND_LABEL[kind];
  const head = band ? describe(band, kind, price, data.currency) : null;
  const st = band?.stats;
  const fixedNotes = [
    `Each fiscal year's ${kind === "pe" ? "earnings are" : "book value is"} used from two months after the year end, when annual results are usually out, so the line steps once a year while the price moves every month. Today's ${L} uses ${kind === "pe" ? "trailing twelve-month earnings" : "the latest book value"}, so it can differ from the last step.`,
    "Yahoo Finance has only four to five years of annual statements, so the range covers a few years, not a full business cycle. A stock can stay cheap or dear for longer than that.",
    `Prices are adjusted for splits and bonus issues and share counts are adjusted to match; dividends are not added back. Loss years, negative book value and ${L} above ${BAND_MAX[kind]}x are gaps.`,
  ];

  return (
    <section className="card section" aria-labelledby="band-h">
      <div className="section-head">
        <h2 id="band-h">Against its own past</h2>
        <p>Is today&apos;s multiple high or low for this stock? Its P/E (price ÷ earnings per share) or P/B (price ÷ book value per share) month by month, against the range it has traded in.</p>
      </div>
      <div className="band-top">
        <div className="seg" role="group" aria-label="Multiple to show">
          {order.map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setPicked(k)}>{BAND_LABEL[k]}</button>)}
        </div>
      </div>
      <div aria-live="polite" aria-busy={!cur}>
        {!cur ? (
          <><p className="muted small">Loading ten years of monthly prices…</p><div className="band-skeleton" aria-hidden="true" /></>
        ) : cur.state === "error" ? (
          <div className="warnbox"><b>Price history unavailable</b><span>{cur.msg}</span><button type="button" className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => setAttempt((a) => a + 1)}>Try again</button></div>
        ) : mismatch ? (
          <div className="warnbox"><b>Currencies don&apos;t match</b><span>Price history is quoted in {cur.h.currency} but the statements are in {data.currency}, so the multiples can&apos;t be compared.</span></div>
        ) : head && (
          <div className="band-head">
            <p>{head.accent && head.text.includes(head.accent) ? <>{head.text.slice(0, head.text.indexOf(head.accent))}<b className="accent">{head.accent}</b>{head.text.slice(head.text.indexOf(head.accent) + head.accent.length)}</> : head.text}</p>
            {st && st.n > 0 && <p className="small muted">{head.more.join(" ")}</p>}
          </div>
        )}
      </div>
      {band && st && st.n > 0 && (
        <>
          <div className="legend">
            <span><i className="key-line" style={{ background: "var(--s1)" }} />Monthly {L}</span>
            <span><i className="key-box" style={{ background: "color-mix(in oklab, var(--s1) 15%, transparent)", boxShadow: "inset 0 0 0 1px var(--line-2)" }} />Middle 80% of months, {mult(st.p10)} to {mult(st.p90)}</span>
            <span><i className="key-line" style={{ background: "var(--ink-2)" }} />Median {mult(st.median)}</span>
            {st.current !== null && <span><i className="key-dot" style={{ background: "var(--accent)" }} />Today {mult(st.current)}</span>}
          </div>
          <BandChart band={band} kind={kind} currency={data.currency} nowDate={data.asOf} />
          <details className="tableview"><summary>Show as table</summary>
            <div className="scroll band-table"><table className="data">
              <thead><tr><th>Month</th><th>Share price</th><th>Year used</th><th>{perShareLabel(kind)}</th><th>{L}</th></tr></thead>
              <tbody>
                {[...band.series].reverse().map((p) => <tr key={p.date}><td>{monthLabel(p.date)}</td><td>{money0(p.close, data.currency)}</td><td>{p.fy ?? "–"}</td><td>{money(p.perShare, data.currency)}</td><td>{p.multiple === null ? "gap" : mult(p.multiple)}</td></tr>)}
                <tr className="em hl"><td>Today</td><td>{money0(price, data.currency)}</td><td>trailing</td><td>{money(kind === "pe" ? data.ttm.eps : data.bookValuePerShare, data.currency)}</td><td>{mult(st.current)}</td></tr>
              </tbody>
            </table></div>
            <p className="note">Median {mult(st.median)}, mean {mult(st.mean)}, standard deviation {mult(st.sd)}, 10th to 90th percentile {mult(st.p10)} to {mult(st.p90)}, over {st.n} months.</p>
          </details>
        </>
      )}
      {cur?.state === "ok" && <ul className="band-notes note">{[...(band?.notes ?? []), ...fixedNotes].map((t) => <li key={t}>{t}</li>)}</ul>}
    </section>
  );
}
