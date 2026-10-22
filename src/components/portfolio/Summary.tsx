"use client";
import { useState } from "react";
import { money, num, pct } from "@/lib/format";
import { summarise, type Weighted, type Xray } from "@/lib/portfolio";

const covers = (w: Weighted, what = "value") => (w.n ? `covers ${pct(w.coverage, 0)} of ${what}` : "not available for these holdings");
const signed = (v: number, f: (a: number) => string) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${f(Math.abs(v))}`;

function Mini({ k, v, n, tone }: { k: string; v: string; n: string; tone?: "good" | "bad" }) {
  return (
    <div className="mini">
      <span className="k">{k}</span>
      <span className={`v num${tone ? ` pf-${tone}` : ""}`}>{v}</span>
      <span className="n">{n}</span>
    </div>
  );
}

/** Headline numbers for the whole portfolio, what they mean, and a plain-English reading. */
export default function Summary({ x }: { x: Xray }) {
  const b = x.base, c = x.concentration;
  const [copied, setCopied] = useState("");
  const lines = summarise(x);
  const copy = async () => {
    try { await navigator.clipboard.writeText(lines.join(" ")); setCopied("Summary copied."); }
    catch { setCopied("Copying is blocked in this browser: select the text and copy it instead."); }
  };
  const pnl = x.cost.pnl;
  return (
    <section className="card section" aria-labelledby="pf-sum-h">
      <div className="section-head">
        <h2 id="pf-sum-h">The whole portfolio</h2>
        <p>Live prices from Yahoo Finance (delayed), in {b} at today&apos;s exchange rates. Model figures use each company&apos;s default desk inputs and are averaged by value.</p>
      </div>
      <div className="minis">
        <Mini k="Value today" v={money(x.total, b, 0)} n={x.valued === x.count ? `${x.count} holding${x.count === 1 ? "" : "s"}` : `${x.valued} of ${x.count} holdings valued`} />
        <Mini k="Unrealised P&L" v={pnl === null ? "–" : signed(pnl, (a) => money(a, b, 0))} tone={pnl === null || pnl === 0 ? undefined : pnl > 0 ? "good" : "bad"}
          n={pnl === null ? "Add your average costs to see this" : `${pct(x.cost.pnlPct, 1, true)} on ${x.cost.n} holding${x.cost.n === 1 ? "" : "s"} with a cost`} />
        <Mini k="Effective holdings" v={num(c.effectiveN, 1)} n={c.effectiveN === null ? "–" : `Spreads risk like ${num(c.effectiveN, 1)} equal holdings`} />
        <Mini k="Largest holding" v={pct(c.top?.weight, 0)} n={c.top ? `${c.top.name}${x.valued > 5 ? ` · top 5: ${pct(c.top5, 0)}` : ""}` : "–"} />
        <Mini k="Model value gap" v={pct(x.gap.value, 0, true)} n={`DCF vs price · ${covers(x.gap)}`} />
        <Mini k="Expected return" v={x.expectedReturn.value === null ? "–" : `${pct(x.expectedReturn.value, 1)} a yr`} n={`${x.wacc.value !== null ? `vs ${pct(x.wacc.value, 1)} required · ` : ""}${covers(x.expectedReturn)}`} />
        <Mini k="Expectations gap" v={x.expGap.value === null ? "–" : `${signed(x.expGap.value, (a) => num(a, 1))} pts`} n={`Implied minus delivered growth · ${covers(x.expGap)}`} />
        <Mini k="Business health" v={x.health.value === null ? "–" : `${Math.round(x.health.value)}/100`} n={x.health.n ? `${pct(x.weakHealth, 0)} of value graded D or E · ${covers(x.health)}` : "Not available for these holdings"} />
      </div>
      {x.financials.length > 0 && <p className="note">Banks and insurers ({x.financials.join(", ")}) are left out of the model value gap, expected return and expectations gap: a free-cash-flow DCF does not suit lenders, whose debt is their raw material.</p>}
      <details className="pf-explain">
        <summary>What these numbers mean</summary>
        <dl>
          <dt>Unrealised P&amp;L</dt><dd>Today&apos;s value minus what you paid, for holdings where you entered an average cost. For holdings in another currency the cost is converted at today&apos;s rate, so this shows the share price move, not currency gains or losses.</dd>
          <dt>Effective holdings</dt><dd>One divided by the sum of squared weights (the inverse Herfindahl index). Ten equal holdings score 10; one stock at 90% scores close to 1. It is how many independent bets the portfolio really makes.</dd>
          <dt>Model value gap</dt><dd>The DCF value of the holdings the model can value, against what they cost on the market today, minus one. Positive means the default assumptions value them above today&apos;s price. Assumptions can be wrong: open a stock to change them.</dd>
          <dt>Expected return</dt><dd>The yearly return at which each company&apos;s base-case cash flows are worth exactly today&apos;s price (an internal rate of return). &quot;Required&quot; is their value-weighted cost of capital (WACC), the return investors need for the risk.</dd>
          <dt>Expectations gap</dt><dd>Revenue growth that today&apos;s price implies (a reverse DCF) minus the growth the company actually reported, in percentage points. A big positive gap means the market expects much more than the record shows.</dd>
          <dt>Business health</dt><dd>Each company&apos;s 0 to 100 health score from tests on its reported accounts (profitability, balance sheet strength and accounting red flags), weighted by value.</dd>
          <dt>Coverage</dt><dd>Averages use only the holdings where the number exists, so each says how much of the portfolio&apos;s value it covers.</dd>
        </dl>
      </details>
      {lines.length > 0 && (
        <div className="pf-reading">
          <h3>In plain English</h3>
          {lines.map((l) => <p key={l}>{l}</p>)}
          <div className="pf-actions no-print">
            <button type="button" className="btn small" onClick={copy}>Copy this summary</button>
            <span className="small muted" role="status">{copied}</span>
          </div>
        </div>
      )}
    </section>
  );
}
