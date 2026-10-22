"use client";
import { money, pct } from "@/lib/format";
import type { MixRow, Xray } from "@/lib/portfolio";

const SHOWN = 6;

/** The largest rows, with everything after them folded into one "Other" row. */
function fold(rows: MixRow[]): (MixRow & { other?: boolean })[] {
  if (rows.length <= SHOWN + 1) return rows;
  const rest = rows.slice(SHOWN);
  return [...rows.slice(0, SHOWN), { key: `Other (${rest.length})`, value: rest.reduce((s, r) => s + r.value, 0), weight: rest.reduce((s, r) => s + r.weight, 0), count: rest.reduce((s, r) => s + r.count, 0), other: true }];
}

/** Share of value by sector, country and currency: labelled bars with the percentage as text. */
export default function MixPanel({ x }: { x: Xray }) {
  const dims = [
    { id: "sector", label: "Sector", rows: x.mix.sector },
    { id: "country", label: "Country", rows: x.mix.country },
    { id: "currency", label: "Currency", rows: x.mix.currency },
  ];
  return (
    <section className="card section" aria-labelledby="pf-mix-h">
      <div className="section-head">
        <h2 id="pf-mix-h">Where the money is</h2>
        <p>Share of the valued holdings by sector, country of the company and the currency its shares trade in. Sectors are Yahoo Finance&apos;s.</p>
      </div>
      {x.valued ? (
        <div className="grid-3">
          {dims.map((d) => (
            <div key={d.id} className="pf-mix">
              <h3 id={`pf-mix-${d.id}`}>{d.label}</h3>
              <ul className="pf-bars" aria-labelledby={`pf-mix-${d.id}`}>
                {fold(d.rows).map((r) => (
                  <li key={r.key} className={r.other ? "pf-other" : undefined}>
                    <span className="pf-bar-label" title={r.key}>{r.key}</span>
                    <span className="pf-bar-pct">{pct(r.weight, 1)}</span>
                    <span className="pf-bar-track" aria-hidden="true"><span className="pf-bar-fill" style={{ width: `${Math.max(0, Math.min(100, r.weight * 100))}%` }} /></span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : <p className="muted">The mix appears once your holdings are valued.</p>}
      {x.valued > 0 && (
        <details className="tableview">
          <summary>Show the mix as a table</summary>
          <div className="scroll">
            <table className="data">
              <caption className="sr-only">Portfolio value by sector, country and currency</caption>
              <thead><tr><th scope="col">Group</th><th scope="col" className="left">Name</th><th scope="col">Holdings</th><th scope="col">Value ({x.base})</th><th scope="col">Weight</th></tr></thead>
              <tbody>
                {dims.flatMap((d) => d.rows.map((r) => (
                  <tr key={d.id + r.key}><td>{d.label}</td><td className="left">{r.key}</td><td>{r.count}</td><td>{money(r.value, x.base, 0)}</td><td>{pct(r.weight, 1)}</td></tr>
                )))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
