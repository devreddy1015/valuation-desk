"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import HoldingsTable, { type RowState } from "./HoldingsTable";
import LookCloser from "./LookCloser";
import ManageHoldings from "./ManageHoldings";
import MixPanel from "./MixPanel";
import Summary from "./Summary";
import { useStored, SETTINGS_KEY, DEFAULT_SETTINGS, type Settings } from "@/lib/client/storage";
import {
  PORTFOLIO_BASE_KEY, PORTFOLIO_KEY, SAMPLE_PORTFOLIO, baseOptions, cleanHoldings, currencyGuess, defaultBase, exportCsv,
  fetchFx, fetchScanRow, isSample, mapPool, mergeHoldings, xray, type Holding, type Lot, type MergeMode, type RowResult,
} from "@/lib/portfolio";

const fxKey = (from: string, to: string) => `${from}>${to}`;

/** The portfolio X-ray: holdings from this browser, valued one by one through the scanner's row API. */
export default function Portfolio() {
  const [raw, setRaw, loaded] = useStored<Holding[]>(PORTFOLIO_KEY, []);
  const [baseChoice, setBaseChoice] = useStored<string>(PORTFOLIO_BASE_KEY, "");
  const [settings] = useStored<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  const holdings = useMemo(() => cleanHoldings(raw), [raw]);
  const [rows, setRows] = useState<Record<string, RowResult>>({});
  const [fx, setFx] = useState<Record<string, number | "failed">>({}); // a missing key is still loading
  const [armed, setArmed] = useState(false);
  const [notice, setNotice] = useState("");
  const [tick, setTick] = useState(0); // bumped by Retry to restart the queues
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (armed) cancelBtn.current?.focus(); }, [armed]);

  // Value every holding that has no result yet, four at a time. When the holdings change (or the page
  // closes) the old queue is aborted, so removed symbols stop costing requests and concurrency stays at four.
  useEffect(() => {
    const todo = holdings.map((h) => h.symbol).filter((s) => !(s in rowsRef.current));
    if (!todo.length) return;
    const ctl = new AbortController();
    const fetcher = (u: string) => fetch(u, { signal: ctl.signal });
    void mapPool(todo, 4, async (s) => {
      if (ctl.signal.aborted) return;
      const r = await fetchScanRow(s, fetcher);
      if (!ctl.signal.aborted) setRows((p) => ({ ...p, [s]: r }));
    });
    return () => ctl.abort();
  }, [holdings, tick]);

  const currencies = useMemo(() => {
    const c = holdings.map((h) => { const r = rows[h.symbol]; return r?.ok ? r.row.currency : currencyGuess(h.symbol); });
    return [...new Set(c.filter((x): x is string => !!x))];
  }, [holdings, rows]);
  const options = baseOptions(currencies);
  // a stored base that is no longer on offer (the only Swiss holding was removed) falls back to the default
  const base = baseChoice && options.includes(baseChoice) ? baseChoice : defaultBase(currencies);

  // exchange rates into the base currency for every currency held; failures are retried with the rows
  const fxRef = useRef(fx);
  useEffect(() => { fxRef.current = fx; }, [fx]);
  useEffect(() => {
    const need = currencies.filter((c) => c !== base && !(fxKey(c, base) in fxRef.current));
    if (!need.length) return;
    let off = false;
    need.forEach((c) => {
      const k = fxKey(c, base);
      void fetchFx(c, base).then((rate) => { if (!off) setFx((p) => ({ ...p, [k]: rate ?? "failed" })); });
    });
    return () => { off = true; };
  }, [currencies, base, tick]);

  const inputs = useMemo(() => holdings.map((h) => {
    const r = rows[h.symbol], row = r?.ok ? r.row : null;
    const f = row ? fx[fxKey(row.currency, base)] : undefined;
    const rate = !row ? null : row.currency === base ? 1 : typeof f === "number" ? f : null;
    return { holding: h, row, fx: rate };
  }), [holdings, rows, fx, base]);
  const x = useMemo(() => xray(inputs, base), [inputs, base]);
  const states = useMemo(() => {
    const out: Record<string, RowState> = {};
    for (const h of holdings) {
      const r = rows[h.symbol];
      if (!r) out[h.symbol] = { kind: "loading" };
      else if (!r.ok) out[h.symbol] = { kind: "failed", error: r.error };
      else if (r.row.currency !== base && typeof fx[fxKey(r.row.currency, base)] !== "number") out[h.symbol] = { kind: "fx", pending: fx[fxKey(r.row.currency, base)] !== "failed", currency: r.row.currency };
      else out[h.symbol] = { kind: "ok", via: r.via };
    }
    return out;
  }, [holdings, rows, fx, base]);

  const done = holdings.filter((h) => h.symbol in rows).length;
  const failed = holdings.filter((h) => rows[h.symbol] && !rows[h.symbol].ok);
  const unconverted = holdings.filter((h) => states[h.symbol]?.kind === "fx" && !(states[h.symbol] as { pending: boolean }).pending);
  const now = () => new Date().toISOString();
  const say = (m: string) => { setNotice(m); setArmed(false); };

  const addLots = (lots: Lot[], mode: MergeMode) => {
    const r = mergeHoldings(holdings, lots, now(), mode);
    setRaw(r.holdings);
    const n = `${lots.length} holding${lots.length === 1 ? "" : "s"}`;
    const parts = [mode === "replace" ? `Replaced your holdings with ${n}.` : mode === "update" ? `Imported ${n}.` : `Added ${n}.`];
    if (r.combined.length) parts.push(`${mode === "update" ? "Quantities updated for" : "Added on top of existing"}: ${r.combined.join(", ")}.`);
    if (r.dropped.length) parts.push(`Over the limit, not added: ${r.dropped.join(", ")}.`);
    say(parts.join(" "));
  };
  const save = (symbol: string, qty: number, avgCost: number | undefined) => {
    setRaw(holdings.map((h) => {
      if (h.symbol !== symbol) return h;
      const n: Holding = { ...h, qty };
      if (avgCost) n.avgCost = avgCost; else delete n.avgCost;
      return n;
    }));
    say(`Saved ${symbol}.`);
  };
  const remove = (symbol: string) => { setRaw(holdings.filter((h) => h.symbol !== symbol)); say(`Removed ${symbol}.`); };
  const retry = () => {
    const drop = new Set(failed.map((h) => h.symbol));
    const nextRows = { ...rowsRef.current };
    drop.forEach((s) => delete nextRows[s]);
    rowsRef.current = nextRows;
    setRows(nextRows);
    const nextFx = Object.fromEntries(Object.entries(fxRef.current).filter(([, v]) => v !== "failed"));
    fxRef.current = nextFx;
    setFx(nextFx);
    setTick((t) => t + 1);
  };
  const download = () => {
    const blob = new Blob(["\uFEFF" + exportCsv(x)], { type: "text/csv;charset=utf-8" }); // the BOM tells Excel it is UTF-8
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `portfolio-xray-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const clear = () => { if (!armed) { setArmed(true); return; } setRaw([]); setRows({}); rowsRef.current = {}; say("Cleared every holding from this browser."); };

  if (!loaded) return <section className="card pf-skeleton" aria-busy="true"><p className="muted">Loading your holdings…</p></section>;

  const manage = <ManageHoldings count={holdings.length} held={holdings.map((h) => h.symbol)} onAdd={(l) => addLots([l], "add")} onImport={addLots} />;
  if (!holdings.length) {
    return (
      <>
        <section className="card pf-empty" aria-labelledby="pf-empty-h">
          <h2 id="pf-empty-h">Start with what you own</h2>
          <p>Add holdings one by one, upload your Zerodha holdings file, or paste a list. Each stock is valued with the desk&apos;s default inputs, then the whole portfolio is read together: what it is priced for, how healthy it is, and where it is concentrated.</p>
          <p className="muted small">Holdings are saved in this browser only.</p>
          <button type="button" className="btn primary" onClick={() => { setRaw(mergeHoldings([], SAMPLE_PORTFOLIO, now()).holdings); say("Loaded a sample portfolio."); }}>Load a sample portfolio</button>
          <p className="muted small">The sample holds five large NSE companies with made-up quantities and no costs; prices and values are live.</p>
        </section>
        {notice && <p className="small muted" role="status">{notice}</p>}
        {manage}
      </>
    );
  }

  return (
    <>
      <div className="pf-toolbar no-print">
        <label className="pf-inline">Show totals in
          <select className="pf-select" value={base} onChange={(e) => setBaseChoice(e.target.value)}>
            {options.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {done < holdings.length ? (
          <div className="pf-progress" role="status" aria-live="polite">
            <progress max={holdings.length} value={done} aria-label="Valuing holdings" />
            <span>Valued {done} of {holdings.length}</span>
          </div>
        ) : <span className="small muted" role="status">{failed.length
          ? `Valued ${holdings.length - failed.length} of ${holdings.length}; ${failed.length} could not be valued`
          : holdings.length === 1 ? "The holding is valued" : `All ${holdings.length} holdings valued`}{unconverted.length ? `; ${unconverted.length} not converted to ${base}` : ""}.</span>}
        {(failed.length > 0 || unconverted.length > 0) && done === holdings.length && <button type="button" className="btn small" onClick={retry}>Retry {failed.length + unconverted.length} that failed</button>}
        <span className="pf-spacer" />
        <a className="btn small" href="#pf-manage">Add or import</a>
        <button type="button" className="btn small" onClick={download} disabled={!x.valued}>Download CSV</button>
        <button type="button" className="btn small" onClick={() => window.print()}>Print</button>
        {armed ? (
          <span className="pf-confirm" role="alert">Remove all {holdings.length} holdings?
            <button type="button" className="btn small pf-danger" onClick={clear}>Yes, clear all</button>
            <button type="button" className="btn small ghost" ref={cancelBtn} onClick={() => setArmed(false)}>Cancel</button>
          </span>
        ) : <button type="button" className="btn small ghost" onClick={clear}>Clear all</button>}
      </div>
      {notice && <p className="pf-notice" role="status">{notice}</p>}
      {isSample(holdings) && <p className="pf-sample">This is the sample portfolio: real companies and live prices, but made-up quantities. Replace it with your own holdings below.</p>}
      {settings.calls && <p className="note">Model calls are switched on (from the stock desk). They are outputs of default inputs, for learning, not advice.</p>}
      <Summary x={x} />
      <LookCloser x={x} />
      <MixPanel x={x} />
      <HoldingsTable x={x} states={states} calls={settings.calls} onSave={save} onRemove={remove} />
      {manage}
    </>
  );
}
