"use client";
import { useMemo } from "react";
import { mult, num, pct } from "@/lib/format";
import { BENEISH_CUTOFF, healthCheck, type HealthMetric, type HealthReport, type Verdict } from "@/lib/quality";
import type { HealthGrade } from "@/lib/scanTypes";
import type { StockData } from "@/lib/types";
import "@/styles/health.css";

const VERDICT: Record<Verdict, { text: string; cls: string }> = {
  good: { text: "Good", cls: "ok" }, ok: { text: "Fair", cls: "skip" }, bad: { text: "Weak", cls: "bad" }, info: { text: "Info", cls: "skip" }, na: { text: "n/a", cls: "skip" },
};
const verdictOf = (m: HealthMetric): Verdict => m.verdict ?? (m.good === null ? "na" : m.good ? "good" : "bad");
function metricText(m: HealthMetric): string {
  if (m.display) return m.display;
  if (m.value === null) return "–";
  return m.format === "pct" ? pct(m.value) : m.format === "x" ? mult(m.value) : m.format === "days" ? `${Math.round(m.value)} days` : num(m.value, 2);
}
const Mark = ({ pass }: { pass: boolean | null }) => (
  <span className={`badge ${pass === null ? "skip" : pass ? "ok" : "bad"}`}>{pass === null ? "N/A" : pass ? "PASS" : "FAIL"}</span>
);

/** A health grade as a small chip, for tables and headers. */
export function HealthBadge({ grade, score }: { grade: HealthGrade; score: number | null }) {
  return <span className={`hl-chip g-${grade === "–" ? "na" : grade}`} title={score !== null ? `Business health ${score}/100` : "Business health not graded"}>{grade}{score !== null && <small> {score}</small>}</span>;
}

/** Business health: three published screens on the reported accounts plus plain ratios, each with its number. */
export default function Health({ data, report }: { data: StockData; report?: HealthReport }) {
  const computed = useMemo(() => report ?? healthCheck(data), [report, data]);
  const r = computed, P = r.piotroski, A = r.altman, B = r.beneish;
  const years = r.years?.length ? `${r.years[0]}–${r.years[r.years.length - 1]}` : "";
  return (
    <section className="card section hl" aria-labelledby="hl-h">
      <div className="section-head">
        <h2 id="hl-h">Business health</h2>
        <p>Is this a good, honest business, not just a cheap one? Published screens on the reported annual accounts{years ? ` (${years})` : ""}, plus plain ratios. Screens, not verdicts: read the accounts before relying on any of them.</p>
      </div>

      <div className="hl-top">
        <div className={`hl-grade g-${r.grade === "–" ? "na" : r.grade}`}>
          <span className="label">Grade</span>
          <span className="v">{r.grade}</span>
          <span className="n">{r.score !== null ? `${r.score} / 100` : "not graded"}</span>
        </div>
        <div className="hl-lead">
          <p className="hl-summary">{r.summary}</p>
          <div className="minis">
            <div className="mini"><span className="k">Piotroski F-score</span><span className="v num">{P ? `${P.score} / ${P.max}` : "–"}</span><span className="n">{P ? (P.max < 9 ? `${P.max} of 9 tests computable` : "nine tests of strength") : r.financial ? "partly used for lenders" : "not enough data"}</span></div>
            <div className="mini"><span className="k">Altman Z&apos;&apos;</span><span className="v num">{A ? num(A.z, 2) : "–"}</span><span className="n">{A ? `${A.zone === "safe" ? "Safe" : A.zone === "grey" ? "Grey" : "Distress"} zone · safe above 2.60` : r.financial ? "not used for lenders" : "not enough data"}</span></div>
            <div className="mini"><span className="k">Beneish M-score</span><span className="v num">{B ? num(B.m, 2).replace("-", "−") : "–"}</span><span className="n">{B ? (B.flag ? `Flag: above ${String(BENEISH_CUTOFF).replace("-", "−")}` : `No flag · cut-off ${String(BENEISH_CUTOFF).replace("-", "−")}`) : r.financial ? "not used for lenders" : "not enough data"}</span></div>
          </div>
        </div>
      </div>

      {(r.flags.length > 0 || r.strengths.length > 0) && (
        <div className="two">
          <div className="hl-list">
            <h3><span className="badge bad">Red flags</span> {r.flags.length || "none"}</h3>
            {r.flags.length ? <ul>{r.flags.map((f) => <li key={f}>{f}</li>)}</ul> : <p className="muted small">None of the checks raised a red flag.</p>}
          </div>
          <div className="hl-list">
            <h3><span className="badge ok">Strengths</span> {r.strengths.length || "none"}</h3>
            {r.strengths.length ? <ul>{r.strengths.map((f) => <li key={f}>{f}</li>)}</ul> : <p className="muted small">No standout strengths on these checks.</p>}
          </div>
        </div>
      )}

      {r.metrics.length > 0 && (
        <div className="hl-metrics">
          {r.metrics.map((m) => {
            const v = verdictOf(m);
            return (
              <div className="mini" key={m.key}>
                <span className="k">{m.label} <span className={`badge ${VERDICT[v].cls}`}>{VERDICT[v].text}</span></span>
                <span className="v num">{metricText(m)}</span>
                <span className="n">{m.note}</span>
              </div>
            );
          })}
        </div>
      )}

      {P && (
        <details className="tableview">
          <summary>Piotroski&apos;s tests, one by one ({P.score} passed of {P.max})</summary>
          <ul className="checks hl-tests">
            {P.tests.map((t) => (
              <li key={t.key}>
                <Mark pass={t.pass} />
                <div><b>{t.label}</b> <span className="muted small">{t.value}</span></div>
                <span className="fix">{t.why}</span>
              </li>
            ))}
          </ul>
          {P.history && P.history.length > 1 && <p className="note">F-score by year: {P.history.map((x) => `${x.label} ${x.score}/${x.max}`).join(" · ")}</p>}
        </details>
      )}

      {(A || B) && (
        <details className="tableview">
          <summary>How the Altman and Beneish scores are built</summary>
          <div className="two">
            {A && (
              <div className="scroll">
                <table className="data">
                  <caption className="hl-cap">Altman Z&apos;&apos; = {num(A.z, 2)} ({A.zone})</caption>
                  <thead><tr><th scope="col">Ratio</th><th scope="col">Value</th><th scope="col">Weight</th><th scope="col">Adds</th></tr></thead>
                  <tbody>{(A.parts ?? []).map((p) => <tr key={p.key}><td className="left">{p.label}</td><td>{num(p.value, 3)}</td><td>{num(p.weight, 2)}</td><td>{num(p.value * p.weight, 2)}</td></tr>)}</tbody>
                </table>
                <p className="note">{A.note}</p>
                {A.history && A.history.length > 1 && <p className="note">Z&apos;&apos; by year: {A.history.map((x) => `${x.label} ${num(x.z, 2)}`).join(" · ")}</p>}
              </div>
            )}
            {B && (
              <div className="scroll">
                <table className="data">
                  <caption className="hl-cap">Beneish M = {num(B.m, 2)}{B.flag ? " (flag)" : ""}</caption>
                  <thead><tr><th scope="col">Index</th><th scope="col">Value</th><th scope="col" title="Average in Beneish's sample of companies that manipulated earnings">Manipulators</th><th scope="col" title="Average for companies that did not">Others</th></tr></thead>
                  <tbody>{B.parts.map((p) => <tr key={p.key}><td className="left">{p.label}{p.neutral ? " *" : ""}</td><td>{p.value === null ? "–" : num(p.value, 3)}</td><td>{p.manipulators !== undefined ? num(p.manipulators, 3) : "–"}</td><td>{p.others !== undefined ? num(p.others, 3) : "–"}</td></tr>)}</tbody>
                </table>
                <p className="note">{B.note}{B.neutral?.length ? ` * Not in the data, so set to the neutral 1.0: ${B.neutral.join(", ")}.` : ""}</p>
              </div>
            )}
          </div>
        </details>
      )}

      <details className="tableview">
        <summary>How to read this</summary>
        <div className="hl-read">
          <p><b>Piotroski F-score</b> (Joseph Piotroski, 2000): nine pass-or-fail tests of profitability, debt, liquidity and efficiency, each comparing the latest year with the one before. 7 or more is strong; 3 or fewer is weak.</p>
          <p><b>Altman Z&apos;&apos;</b> (Edward Altman, 1995, the version for non-manufacturers and emerging markets): combines working capital, retained earnings, operating profit and book equity relative to the balance sheet. Above 2.60 is the safe zone, below 1.10 the distress zone.</p>
          <p><b>Beneish M-score</b> (Messod Beneish, 1999): eight ratios that, in his study, separated companies later found to have manipulated earnings. Above −1.78 resembles that pattern. It is a prompt to read the notes to the accounts, not an accusation.</p>
          <p><b>Grade</b>: a 0 to 100 blend (Piotroski 40%, Altman 20%, Beneish 15%, the ratios 25%, re-weighted when a part is missing): A from 80, B from 65, C from 50, D from 35, E below.</p>
          <p className="muted">All three screens were built on US companies and annual accounts from Yahoo Finance, which can be incomplete. Banks and insurers get lender-specific ratios instead of the Altman and Beneish screens.</p>
        </div>
      </details>
      {r.notes.length > 0 && <ul className="hl-notes">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
    </section>
  );
}
