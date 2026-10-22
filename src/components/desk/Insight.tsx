"use client";
import { useMemo, type ReactNode } from "react";
import "@/styles/insight.css";
import type { MonteCarlo, Valuation } from "@/lib/model";
import type { HealthReport } from "@/lib/quality";
import { returnsFor, type Returns } from "@/lib/returns";
import { storyFor, type Tone } from "@/lib/story";
import type { StockData, UserInputs } from "@/lib/types";
import { big, bigUnit, money, mult, pct } from "@/lib/format";

const fin = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

const TONE: Record<Tone, { word: string; icon: ReactNode }> = {
  good: { word: "Favourable", icon: <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.2v7.6M2.2 6h7.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg> },
  bad: { word: "Caution", icon: <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v4.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="6" cy="9.6" r="1.2" fill="currentColor" /></svg> },
  neutral: { word: "Context", icon: <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.4 6h7.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg> },
};

/** Tone as an icon and a word, never colour alone. */
export function ToneTag({ tone }: { tone: Tone }) {
  return <span className={`ins-tone ${tone}`}>{TONE[tone].icon}{TONE[tone].word}</span>;
}

function Headline({ text, accent }: { text: string; accent: string }) {
  const i = accent ? text.indexOf(accent) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<span className="accent">{accent}</span>{text.slice(i + accent.length)}</>;
}

export function Story({ data, inp, R, MC, health, calls }: { data: StockData; inp: UserInputs; R: Valuation; MC: MonteCarlo | null; health?: HealthReport | null; calls: boolean }) {
  const ret = useMemo(() => returnsFor(inp, data, R), [inp, data, R]);
  const s = useMemo(() => storyFor({ data, inp, R, MC, ret, health, calls }), [data, inp, R, MC, ret, health, calls]);
  return (
    <section className="card section" aria-labelledby="story-h">
      <div className="section-head">
        <h2 id="story-h">In plain English</h2>
        <p>The model&apos;s numbers as sentences. Every figure comes from the live data and your inputs, so the story changes when you change an input.</p>
      </div>
      <p className="ins-headline"><Headline text={s.headline} accent={s.accent} /></p>
      {s.points.length > 0 ? (
        <ul className="ins-points">
          {s.points.map((p) => <li key={p.key}><ToneTag tone={p.tone} /><p>{p.text}</p></li>)}
        </ul>
      ) : <p className="muted">Not enough data to describe this valuation in words.</p>}
      <p className="note">{calls ? "Calls are model outputs for learning. In India, giving buy or sell recommendations to clients can require SEBI Research Analyst registration." : "Educational, not investment advice. “Favourable” means the numbers lean in today's price's favour; “Caution” means the price asks a lot of the future."}</p>
    </section>
  );
}

interface BarRow { key: string; label: string; sub: string; value: number | null; color: string; na?: string }

function Bars({ rows, label }: { rows: BarRow[]; label: string }) {
  const vals = rows.map((r) => r.value).filter(fin);
  const top = Math.max(0.01, ...vals) * 1.12;
  return (
    <ul className="ins-bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key}>
          <span className="lab">{r.label}<small>{r.sub}</small></span>
          {fin(r.value) ? (
            <>
              <span className="track" aria-hidden="true"><i style={{ width: `${(Math.max(0, r.value) / top) * 100}%`, background: r.color }} /></span>
              <b className="val">{pct(r.value)}</b>
            </>
          ) : <><span className="na">{r.na ?? "Not available"}</span><b className="val">–</b></>}
        </li>
      ))}
    </ul>
  );
}

function Mini({ k, v, n }: { k: string; v: string; n: string }) {
  return <div className="mini"><span className="k">{k}</span><span className="v num">{v}</span><span className="n">{n}</span></div>;
}

/** One sentence on the expected return against the WACC, with its tone. */
function returnVerdict(ret: Returns, scenario: string): { tone: Tone; text: string } {
  if (ret.irr === null || !fin(ret.spread)) return { tone: ret.irrStatus === "below-range" ? "bad" : "neutral", text: ret.notes[0] ?? "No expected return with these inputs." };
  const s = ret.spread, close = Math.abs(s) <= 0.005;
  return {
    tone: close ? "neutral" : s > 0 ? "good" : "bad",
    text: `If your ${scenario} case comes true, today's price earns about ${pct(ret.irr)} a year, ${close ? "about the same as" : `${pct(Math.abs(s))} ${s > 0 ? "more" : "less"} than`} the ${pct(ret.wacc)} the model requires.`,
  };
}

export function ReturnsPanel({ data, inp, R }: { data: StockData; inp: UserInputs; R: Valuation }) {
  const ret = useMemo(() => returnsFor(inp, data, R), [inp, data, R]);
  const cur = data.currency, price = inp.price, u = bigUnit(cur);
  const eps = data.ttm.eps;
  const bondSub = `what a ${cur} 10-year government bond pays`;

  if (data.financial) {
    return (
      <section className="card section" aria-labelledby="ret-h">
        <div className="section-head"><h2 id="ret-h">What the equity earns</h2><p>For a bank or insurer, debt is raw material rather than financing, so the expected return and earnings power value (both built on free cash flow to the firm) are not shown. What the equity earns against what shareholders require tells the same story.</p></div>
        <Bars label="Return on equity against required returns" rows={[
          { key: "roe", label: "Return on equity", sub: `${ret.roeYear ?? "last year"} net income ÷ average equity`, value: ret.roe ?? null, color: "var(--s1)", na: "No equity figure on Yahoo" },
          { key: "ke", label: "Cost of equity", sub: "what shareholders require", value: ret.ke, color: "var(--neutral-mark)" },
          { key: "bond", label: "Government bond", sub: bondSub, value: ret.bondYield, color: "var(--s1-soft)" },
        ]} />
        <div className="minis">
          <Mini k="Earnings yield" v={pct(ret.earningsYield)} n={`${money(eps, cur)} trailing EPS ÷ ${money(price, cur)}`} />
          <Mini k="10-year bond" v={pct(ret.bondYield)} n="interest a year" />
          <Mini k="Price to book" v={mult(R.subject.pb)} n={`book value ${money(data.bookValuePerShare, cur)} a share`} />
          <Mini k="P/E" v={mult(R.subject.pe)} n={`peer median ${mult(R.stats.pe.med)}`} />
        </div>
        <p className="note">A bank that earns more on its equity than its shareholders require usually deserves to trade above book value; one that earns less, below it.</p>
      </section>
    );
  }

  const v = returnVerdict(ret, inp.scenario);
  const gs = ret.growthShare, epv = ret.epv, P = ret.epvParts;
  const todayPart = fin(gs) ? 1 - gs : null;
  const todayMoney = fin(epv) ? Math.max(0, Math.min(epv, price)) : null;
  const stackLabel = fin(gs) && fin(todayPart) && todayMoney !== null
    ? `Of today's price of ${money(price, cur)}: ${pct(todayPart, 0)} (${money(todayMoney, cur)}) is today's business with no growth, ${pct(gs, 0)} (${money(price - todayMoney, cur)}) pays for future growth.`
    : "";
  return (
    <section className="card section" aria-labelledby="ret-h">
      <div className="section-head"><h2 id="ret-h">What you&apos;d earn at today&apos;s price</h2><p>The yearly return on the whole business at today&apos;s price if your {inp.scenario} case comes true, against the return the model requires and what a government bond pays.</p></div>

      <div className="ins-verdict"><ToneTag tone={v.tone} /><p>{v.text}</p></div>
      <Bars label="Expected return against required returns" rows={[
        { key: "irr", label: "Expected return", sub: `if your ${inp.scenario} case comes true`, value: ret.irr, color: "var(--s1)", na: ret.irrStatus === "below-range" ? "Below the range tested" : ret.irrStatus === "above-range" ? `Above ${pct(ret.irrRange?.[1] ?? 0.6, 0)}` : "Not available" },
        { key: "wacc", label: "Required return (WACC)", sub: "what the model discounts at", value: ret.wacc, color: "var(--neutral-mark)" },
        { key: "bond", label: "Government bond", sub: bondSub, value: ret.bondYield, color: "var(--s1-soft)" },
      ]} />

      <div className="ins-sub">
        <h3>What the price pays for</h3>
        {fin(gs) && fin(todayPart) && todayMoney !== null ? (
          <>
            <div className="ins-stack" role="img" aria-label={stackLabel}>
              {todayPart > 0 && <i style={{ flexBasis: `${todayPart * 100}%`, background: "var(--s1)" }} />}
              {gs > 0 && <i style={{ flexBasis: `${gs * 100}%`, background: "var(--s2)" }} />}
            </div>
            <div className="ins-stack-key">
              <div><span className="k"><i className="key-box" style={{ background: "var(--s1)" }} />Today&apos;s business, no growth</span><span className="v num">{pct(todayPart, 0)}</span><span className="n">{money(todayMoney, cur)} a share: earnings power value{fin(epv) && epv > price ? ` (${money(epv, cur)}, above the price)` : ""}</span></div>
              <div><span className="k"><i className="key-box" style={{ background: "var(--s2)" }} />Future growth</span><span className="v num">{pct(gs, 0)}</span><span className="n">{money(price - todayMoney, cur)} a share{gs === 0 ? ": today's profits alone cover the price" : ""}</span></div>
            </div>
          </>
        ) : <p className="muted small">{ret.notes.find((n) => /operating profit|earnings power/.test(n)) ?? "Earnings power value is not available with these inputs."}</p>}
      </div>

      <div className="minis">
        <Mini k="Earnings yield" v={pct(ret.earningsYield)} n={`${money(eps, cur)} trailing EPS ÷ price`} />
        <Mini k="Free cash flow yield" v={pct(ret.fcfYield)} n={`${R.fyLabels[0]} forecast ÷ market value`} />
        <Mini k="10-year bond" v={pct(ret.bondYield)} n="interest a year" />
        <Mini k="Cost of equity" v={pct(ret.ke)} n="what shareholders require" />
      </div>
      {fin(ret.earningsYield) && fin(ret.bondYield) && (
        <div className="ins-verdict">
          <ToneTag tone={ret.earningsYield >= ret.bondYield ? "good" : "neutral"} />
          <p className="small">{`Every ${money(100, cur, 0)} of share price buys ${money(ret.earningsYield * 100, cur)} of today's profit a year, `}{ret.earningsYield >= ret.bondYield
            ? `more than the ${money(ret.bondYield * 100, cur)} of interest the bond pays, though profit is less certain than interest.`
            : `less than the ${money(ret.bondYield * 100, cur)} of interest the bond pays: the price counts on profits growing.`}</p>
        </div>
      )}

      <details className="ins-explain">
        <summary>How these are worked out</summary>
        <div className="body">
          <p><b>Expected return (an internal rate of return).</b> Imagine buying the whole company at today&apos;s price: its shares and its debt, less its cash. The expected return is the yearly rate that makes the free cash flows in your {inp.scenario} case, plus the value after {R.fyLabels[R.fyLabels.length - 1]} growing at {pct(R.g)}, add up to exactly today&apos;s price. When it is above the WACC, the price sits below your DCF value. It only comes true if the forecast does.</p>
          <p><b>Earnings power value.</b> What the business is worth if its last reported operating profit never grows or shrinks (a simplified version of Bruce Greenwald&apos;s method). It treats depreciation as the spending needed to stand still, and uses reported rather than average profit, so one unusual year moves it.</p>
          {P && (
            <dl aria-label={`Earnings power value, ${u.label}`}>
              <dt>{P.fy} operating profit (EBIT), {u.label}</dt><dd>{big(P.ebit, cur)}</dd>
              <dt>After tax at {pct(P.tax)}</dt><dd>{big(P.nopat, cur)}</dd>
              <dt>Held flat for ever: ÷ WACC of {pct(ret.wacc)}</dt><dd>{big(P.capitalised, cur)}</dd>
              <dt>+ Cash − debt, leases, minorities and dividends since the balance sheet</dt><dd>{big(P.bridge, cur)}</dd>
              <dt>÷ Shares, per share</dt><dd>{money(epv, cur)}</dd>
            </dl>
          )}
          <p><b>Earnings yield</b> is the profit a year you buy with each unit of price (the P/E turned upside down). <b>Free cash flow yield</b> is the same idea with next year&apos;s forecast cash flow.</p>
        </div>
      </details>
      <details className="tableview"><summary>Show as table</summary>
        <div className="scroll"><table className="data"><thead><tr><th>Measure</th><th>Value</th></tr></thead><tbody>
          <tr><td>Expected return (IRR), {inp.scenario} case</td><td>{pct(ret.irr)}</td></tr>
          <tr><td>Required return (WACC)</td><td>{pct(ret.wacc)}</td></tr>
          <tr><td>Expected minus required</td><td>{pct(ret.spread, 1, true)}</td></tr>
          <tr><td>Cost of equity</td><td>{pct(ret.ke)}</td></tr>
          <tr><td>10-year government bond</td><td>{pct(ret.bondYield)}</td></tr>
          <tr><td>Earnings power value per share</td><td>{money(epv, cur)}</td></tr>
          <tr><td>Share of price paying for growth</td><td>{pct(gs, 0)}</td></tr>
          <tr><td>Earnings yield</td><td>{pct(ret.earningsYield)}</td></tr>
          <tr><td>Free cash flow yield</td><td>{pct(ret.fcfYield)}</td></tr>
        </tbody></table></div>
      </details>
    </section>
  );
}
