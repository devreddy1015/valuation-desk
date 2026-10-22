"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { money, num, pct } from "@/lib/format";
import { CALL_BUY, CALL_SELL, modelCall, parseNumber, type PositionView, type Xray } from "@/lib/portfolio";

export type RowState = { kind: "loading" } | { kind: "failed"; error: string } | { kind: "fx"; pending: boolean; currency: string } | { kind: "ok"; via?: string };
type SortKey = "name" | "qty" | "value" | "weight" | "pnl" | "gap" | "er" | "exp" | "health";
const SORTERS: Record<SortKey, (p: PositionView) => number | string | null> = {
  name: (p) => p.name.toLowerCase(), qty: (p) => p.qty, value: (p) => p.value, weight: (p) => p.weight, pnl: (p) => p.pnl,
  gap: (p) => p.gap, er: (p) => p.expectedReturn, exp: (p) => p.expGap, health: (p) => p.healthScore,
};

const qtyText = (q: number, currency: string | null) => q.toLocaleString(currency === "INR" || currency === null ? "en-IN" : "en-US", { maximumFractionDigits: 4 });
const signedMoney = (v: number | null, cur: string) => (v === null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${money(Math.abs(v), cur, 0)}`);
const tone = (v: number | null) => (v === null || v === 0 ? undefined : v > 0 ? "pf-good" : "pf-bad");

interface Edit { symbol: string; qty: string; cost: string; error: string }

/** Every holding with its value, weight and model figures: sortable, with inline edit and remove. */
export default function HoldingsTable({ x, states, calls, onSave, onRemove }: {
  x: Xray; states: Record<string, RowState>; calls: boolean;
  onSave: (symbol: string, qty: number, avgCost: number | undefined) => void; onRemove: (symbol: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "value", dir: -1 });
  const [edit, setEdit] = useState<Edit | null>(null);
  const editBtns = useRef(new Map<string, HTMLButtonElement>());
  const rows = useMemo(() => {
    const get = SORTERS[sort.key];
    return [...x.positions].sort((a, b) => {
      const va = get(a), vb = get(b);
      if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1; // missing values last either way
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [x.positions, sort]);
  const b = x.base;

  const close = (symbol: string) => { setEdit(null); requestAnimationFrame(() => editBtns.current.get(symbol)?.focus()); };
  const save = () => {
    if (!edit) return;
    const qty = parseNumber(edit.qty);
    if (qty === null || !(qty > 0)) { setEdit({ ...edit, error: "Enter a quantity above zero." }); return; }
    const cost = edit.cost.trim() ? parseNumber(edit.cost) : undefined;
    if (cost !== undefined && (cost === null || !(cost > 0))) { setEdit({ ...edit, error: "Enter an average cost above zero, or leave it empty." }); return; }
    onSave(edit.symbol, qty, cost ?? undefined);
    close(edit.symbol);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
    else if (e.key === "Escape" && edit) { e.preventDefault(); close(edit.symbol); }
  };

  const head = (key: SortKey | null, label: string, left = false, title?: string) => (
    <th scope="col" className={left ? "left" : undefined} aria-sort={key && sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined} title={title}>
      {key ? (
        <button type="button" className="sortbtn" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 }))}>
          {label}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
        </button>
      ) : label}
    </th>
  );

  return (
    <section className="card section" aria-labelledby="pf-ht-h">
      <div className="section-head">
        <h2 id="pf-ht-h">Holdings</h2>
        <p>Price and model value per share are in each stock&apos;s own currency; value and P&amp;L are in {b}. Select a column heading to sort.</p>
      </div>
      {calls && <p className="note">Model calls compare the DCF value with the price using the desk&apos;s default thresholds (BUY above {pct(CALL_BUY, 0, true)}, SELL below {pct(CALL_SELL, 0)}), for learning. In India, giving buy or sell recommendations to clients can require SEBI Research Analyst registration.</p>}
      <div className="scroll">
        <table className="data pf-table">
          <caption className="sr-only">Your holdings, sorted by {sort.key}</caption>
          <thead>
            <tr>
              {head("name", "Holding", true)}
              {head("qty", "Qty")}
              {head(null, "Avg cost")}
              {head(null, "Price")}
              {head("value", `Value (${b})`)}
              {head("weight", "Weight")}
              {head("pnl", "P&L")}
              {head(null, "Model value", false, "DCF value per share on default inputs")}
              {head("gap", "Gap", false, "Model value / price − 1")}
              {head("er", "Exp. return", false, "Yearly return at today's price if the base case comes true")}
              {head("exp", "Exp. gap", false, "Implied growth minus reported growth, percentage points")}
              {head("health", "Health")}
              {calls && head(null, "Call")}
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const st = states[p.symbol] ?? { kind: "loading" };
              const editing = edit?.symbol === p.symbol;
              const cur = p.currency ?? "";
              return (
                <tr key={p.symbol}>
                  <th scope="row" className="left" style={{ fontWeight: 400, textAlign: "left" }}>
                    <Link className="pf-name" href={`/stock/${encodeURIComponent(p.link)}`}>{p.name}</Link>
                    <span className="pf-sub">{p.symbol}{st.kind === "ok" && st.via ? ` · valued as ${st.via}` : ""}</span>
                    {st.kind === "loading" && <span className="pf-sub">Valuing…</span>}
                    {st.kind === "failed" && <span className="pf-err">Could not value: {st.error}</span>}
                    {st.kind === "fx" && <span className={st.pending ? "pf-sub" : "pf-err"}>{st.pending ? `Converting ${st.currency}…` : `No ${st.currency} to ${b} exchange rate: left out of totals`}</span>}
                  </th>
                  <td>{editing
                    ? <input className="in" inputMode="decimal" aria-label={`Quantity of ${p.symbol}`} aria-invalid={!!edit.error || undefined} aria-describedby={edit.error ? "pf-edit-err" : undefined} value={edit.qty} onChange={(e) => setEdit({ ...edit, qty: e.target.value, error: "" })} onKeyDown={onKey} autoFocus />
                    : qtyText(p.qty, p.currency)}</td>
                  <td>{editing
                    ? <input className="in" inputMode="decimal" aria-label={`Average cost per share of ${p.symbol}${cur ? `, in ${cur}` : ""}, optional`} value={edit.cost} onChange={(e) => setEdit({ ...edit, cost: e.target.value, error: "" })} onKeyDown={onKey} placeholder="optional" />
                    : p.avgCost === null ? <span className="muted">–</span> : cur ? money(p.avgCost, cur) : num(p.avgCost)}</td>
                  <td>{p.price === null ? "–" : money(p.price, cur)}</td>
                  <td>{money(p.value, b, 0)}</td>
                  <td>{pct(p.weight, 1)}</td>
                  <td className={tone(p.pnl)}>{signedMoney(p.pnl, b)}{p.pnlPct !== null && <span className="pf-pct">{pct(p.pnlPct, 1, true)}</span>}</td>
                  <td>{p.financial ? <span className="muted small">Lender: not used</span> : p.modelValue === null ? "–" : money(p.modelValue, cur)}</td>
                  <td>{pct(p.gap, 0, true)}</td>
                  <td>{pct(p.expectedReturn, 1)}</td>
                  <td>{p.expGap === null ? "–" : `${p.expGap > 0 ? "+" : p.expGap < 0 ? "−" : ""}${num(Math.abs(p.expGap), 1)}`}</td>
                  <td>{p.grade === "–" && p.healthScore === null ? "–" : <><span className={`pf-grade g-${p.grade}`}>{p.grade}</span>{p.healthScore !== null && <span className="muted small"> {Math.round(p.healthScore)}</span>}</>}</td>
                  {calls && <td className="mono">{modelCall(p.gap)}</td>}
                  <td>
                    {editing ? (
                      <span className="pf-rowbtns">
                        <button type="button" className="btn small primary" onClick={save}>Save</button>
                        <button type="button" className="btn small ghost" onClick={() => close(p.symbol)}>Cancel</button>
                      </span>
                    ) : (
                      <span className="pf-rowbtns">
                        <button type="button" className="btn small ghost" ref={(el) => { if (el) editBtns.current.set(p.symbol, el); else editBtns.current.delete(p.symbol); }}
                          onClick={() => setEdit({ symbol: p.symbol, qty: String(p.qty), cost: p.avgCost === null ? "" : String(Math.round(p.avgCost * 1e4) / 1e4), error: "" })} aria-label={`Edit ${p.symbol}`}>Edit</button>
                        <button type="button" className="btn small ghost" onClick={() => onRemove(p.symbol)} aria-label={`Remove ${p.symbol}`}>Remove</button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {x.valued > 0 && (
            <tfoot>
              <tr>
                <th scope="row" className="left" style={{ textAlign: "left" }}>Total{x.valued < x.count ? ` (${x.valued} of ${x.count} valued)` : ""}</th>
                <td /><td /><td />
                <td>{money(x.total, b, 0)}</td>
                <td>{pct(1, 0)}</td>
                <td className={tone(x.cost.pnl)}>{signedMoney(x.cost.pnl, b)}{x.cost.pnlPct !== null && <span className="pf-pct">{pct(x.cost.pnlPct, 1, true)}</span>}</td>
                <td />
                <td>{pct(x.gap.value, 0, true)}</td>
                <td>{pct(x.expectedReturn.value, 1)}</td>
                <td>{x.expGap.value === null ? "–" : `${x.expGap.value > 0 ? "+" : x.expGap.value < 0 ? "−" : ""}${num(Math.abs(x.expGap.value), 1)}`}</td>
                <td>{x.health.value === null ? "–" : Math.round(x.health.value)}</td>
                {calls && <td />}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {edit?.error && <p id="pf-edit-err" className="pf-error" role="alert">{edit.symbol}: {edit.error}</p>}
      <p className="note">Totals and averages are value-weighted over the holdings that have each number. If a company has split its shares or issued bonus shares since you bought, use the adjusted average cost (Zerodha Console shows it).</p>
    </section>
  );
}
