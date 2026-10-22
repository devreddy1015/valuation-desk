"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { money, money0, mult, pct } from "@/lib/format";
import { callFor, type Scored, type Sort, type SortKey } from "@/lib/scanMath";

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const pp = (x: number | null) => (fin(x) ? `${x.toFixed(1)}%` : "–");

const LABEL: Record<SortKey, string> = {
  name: "company", group: "group", price: "price", modelValue: "model value", valueGap: "value gap",
  expectedReturn: "expected return", expectationsGap: "growth the price implies against history", pe: "P/E", health: "health grade", flags: "number of flags",
};
// Text columns start A to Z; numbers start with the largest, except the expectations gap, where the
// interesting end is the most negative (the price assumes far less growth than the record).
const firstDir = (k: SortKey): 1 | -1 => (k === "name" || k === "group" || k === "expectationsGap" ? 1 : -1);

/** How the model value was built, e.g. "DCF + 6 industry peers". */
function method(r: Scored): string {
  const { basis, n } = r.peers;
  const peers = basis === "list" ? `${n} peers from the list` : `${n} ${basis} peers`;
  if (r.method === "dcf+peers") return `DCF + ${peers}`;
  if (r.method === "dcf") return "DCF only";
  if (r.method === "peers") return r.financial ? `P/E, P/B vs ${peers}` : peers;
  return "Not enough data";
}

function gradeClass(g: string): string {
  return g === "A" || g === "B" ? "ok" : g === "D" || g === "E" ? "bad" : "skip";
}

/** The ranked list: one row per stock, sortable by every numeric column. */
export default function ScanTable({ rows, sort, onSort, calls }: { rows: Scored[]; sort: Sort; onSort: (s: Sort) => void; calls: boolean }) {
  const th = (key: SortKey, label: ReactNode, cls?: string) => (
    <th aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={cls} scope="col">
      <button type="button" className="sortbtn" onClick={() => onSort({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : firstDir(key) })}>
        {label}<span aria-hidden="true">{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</span>
      </button>
    </th>
  );
  return (
    <div className="scroll">
      <table className="data scan-table">
        <caption className="sr-only">
          Scanned stocks sorted by {LABEL[sort.key]}, {sort.dir === 1 ? "ascending" : "descending"}. Prices and values are per share in each stock&apos;s own currency.
        </caption>
        <thead>
          <tr>
            {th("name", "Company")}
            {th("group", "Group", "left")}
            {th("price", "Price")}
            {th("modelValue", "Model value")}
            {th("valueGap", "Gap")}
            {th("expectedReturn", "Return / yr vs WACC")}
            {th("expectationsGap", "Price implies vs history")}
            {th("pe", "P/E")}
            {th("health", "Health")}
            {th("flags", "Flags", "left")}
            {calls && <th scope="col">Call</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => <ScanRowView key={r.symbol} r={r} calls={calls} />)}
          {!rows.length && <tr><td colSpan={calls ? 11 : 10} className="left muted">No stock matches these filters.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function ScanRowView({ r, calls }: { r: Scored; calls: boolean }) {
  const cur = r.currency;
  const call = calls ? callFor(r.valueGap) : null;
  const ungraded = r.health.grade === "–";
  return (
    <tr>
      <td className="co">
        <Link href={`/stock/${encodeURIComponent(r.symbol)}`}>{r.name}</Link>
        <span className="sub mono">{r.symbol}{r.financial ? " · bank or insurer" : ""}</span>
      </td>
      <td className="left grp">{r.group}</td>
      <td>{money(r.price, cur)}</td>
      <td>{money0(r.modelValue, cur)}<span className="sub">{method(r)}</span></td>
      <td>{fin(r.valueGap) ? <span className={r.valueGap >= 0 ? "scan-pos" : "scan-neg"}>{pct(r.valueGap, 1, true)}</span> : "–"}
        {r.extreme && <span className="sub scan-check">Check first: far from the price, so the data or the default inputs may not fit</span>}</td>
      <td>
        {fin(r.expectedReturn) ? <>{pct(r.expectedReturn)} <span className="muted">vs {pct(r.wacc)}</span></> : "–"}
        {fin(r.expectedReturn) && fin(r.wacc) && <span className="sub">{r.expectedReturn >= r.wacc ? "above" : "below"} the required return</span>}
      </td>
      <td>
        {fin(r.impliedGrowth) ? <>{pp(r.impliedGrowth)} <span className="muted">vs {pp(r.histGrowth)}</span></> : "–"}
        {!fin(r.impliedGrowth) && fin(r.histGrowth) && <span className="sub">record {pp(r.histGrowth)} a year</span>}
        {fin(r.expectationsGap) && <span className="sub">{r.expectationsGap > 0 ? "+" : r.expectationsGap < 0 ? "−" : ""}{Math.abs(r.expectationsGap).toFixed(1)} pts {r.expectationsGap < 0 ? "below" : "above"} its record</span>}
      </td>
      <td>{mult(r.pe)}</td>
      <td>
        <span className={`badge ${gradeClass(r.health.grade)}`} aria-hidden="true">{r.health.grade}</span>
        <span className="sr-only">{ungraded ? "Not graded" : `Grade ${r.health.grade}`}</span>
        {fin(r.health.score) && <span className="sub">{Math.round(r.health.score)} / 100</span>}
      </td>
      <td className="left">
        {ungraded ? <span className="muted">–</span> : r.health.flags.length || r.health.strengths.length ? (
          <details className="scan-flags">
            <summary>{r.health.flags.length} {r.health.flags.length === 1 ? "flag" : "flags"}<span className="sr-only"> for {r.name}</span></summary>
            <ul aria-label={`Health notes for ${r.name}`}>
              {r.health.flags.map((f) => <li key={f} className="bad">{f}</li>)}
              {r.health.strengths.map((s) => <li key={s} className="good">Strength: {s}</li>)}
            </ul>
          </details>
        ) : <span className="muted">None</span>}
      </td>
      {calls && <td>{call ? <span className={`pill ${call}`}>{call}</span> : <span className="muted">–</span>}</td>}
    </tr>
  );
}
