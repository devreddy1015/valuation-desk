"use client";
import { useEffect, useId, useRef, useState } from "react";
import SymbolPicker, { type PickHit } from "@/components/SymbolPicker";
import { FORMAT_LABEL, MAX_HOLDINGS, parseHoldings, parseNumber, type Exchange, type ImportResult, type Lot, type MergeMode } from "@/lib/portfolio";
import { num } from "@/lib/format";

/** Add one holding through search, or import many from a pasted list or a broker's CSV file. */
export default function ManageHoldings({ count, held, onAdd, onImport }: {
  count: number;
  held: string[]; // symbols already in the portfolio
  onAdd: (lot: Lot) => void;
  onImport: (lots: Lot[], mode: MergeMode) => void;
}) {
  const id = useId();
  const [picked, setPicked] = useState<PickHit | null>(null);
  const [changed, setChanged] = useState(false); // "Change" was pressed: the search box takes focus again
  const qtyInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (picked) qtyInput.current?.focus(); }, [picked]);
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [addErr, setAddErr] = useState("");
  const [text, setText] = useState("");
  const [exchange, setExchange] = useState<Exchange>("NS");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [fileMsg, setFileMsg] = useState("");

  const add = () => {
    if (!picked) { setAddErr("Pick a company first."); return; }
    const q = parseNumber(qty);
    if (q === null || !(q > 0)) { setAddErr("Enter a quantity above zero."); return; }
    const c = cost.trim() ? parseNumber(cost) : undefined;
    if (c !== undefined && (c === null || !(c > 0))) { setAddErr("Enter an average cost above zero, or leave it empty."); return; }
    onAdd({ symbol: picked.symbol.toUpperCase(), qty: q, ...(c ? { avgCost: c } : {}) });
    setPicked(null); setChanged(true); setQty(""); setCost(""); setAddErr("");
  };

  const readFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 1_000_000) { setFileMsg("That file is over 1 MB: export only your holdings and try again."); return; }
    const r = new FileReader();
    r.onload = () => { const t = String(r.result ?? ""); setText(t); setPreview(parseHoldings(t, exchange)); setFileMsg(`Read ${f.name}.`); };
    r.onerror = () => setFileMsg("The file could not be read.");
    r.readAsText(f);
  };

  return (
    <section className="card section" id="pf-manage" aria-labelledby={`${id}-h`}>
      <div className="section-head">
        <h2 id={`${id}-h`}>Add holdings</h2>
        <p>Holdings stay in this browser only: nothing is uploaded except the ticker, to fetch its price. Up to {MAX_HOLDINGS} holdings.</p>
      </div>
      <div className="pf-manage">
        <div className="pf-form">
          <h3>One at a time</h3>
          {picked ? (
            <div className="pf-picked">
              <span><b>{picked.name}</b> <span className="mono small muted">{picked.symbol}{picked.exchange ? ` · ${picked.exchange}` : ""}</span></span>
              <button type="button" className="btn small ghost" onClick={() => { setPicked(null); setChanged(true); }}>Change</button>
            </div>
          ) : <SymbolPicker autoFocus={changed} onPick={(h) => { setPicked(h); setAddErr(""); }} />}
          <div className="pf-fields">
            <label>Quantity<input ref={qtyInput} className="in" inputMode="decimal" value={qty} onChange={(e) => { setQty(e.target.value); setAddErr(""); }} onKeyDown={(e) => e.key === "Enter" && add()} /></label>
            <label>Average cost per share<small>optional, in the stock&apos;s currency</small><input className="in" inputMode="decimal" value={cost} onChange={(e) => { setCost(e.target.value); setAddErr(""); }} onKeyDown={(e) => e.key === "Enter" && add()} /></label>
          </div>
          <div className="pf-actions">
            <button type="button" className="btn primary" onClick={add}>Add holding</button>
            {addErr && <span className="pf-error" role="alert">{addErr}</span>}
          </div>
        </div>

        <div className="pf-form">
          <h3>Import a list</h3>
          <p className="pf-help">Upload the holdings CSV from Zerodha Console or Kite as it is, any CSV with symbol and quantity columns, or paste lines such as <span className="mono">INFY 10 1450</span> (symbol, quantity, optional average cost).</p>
          <ol className="pf-steps">
            <li>Zerodha: Console → Portfolio → Holdings → Download, or Kite → Holdings → Download.</li>
            <li>Other brokers: export holdings as CSV, or copy the symbol and quantity columns and paste them below.</li>
          </ol>
          <div className="pf-row">
            <label className="pf-stack">File<input className="pf-file" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => readFile(e.target.files?.[0])} /></label>
            <label className="pf-stack">Symbols without a suffix are on
              <select className="pf-select" value={exchange} onChange={(e) => { const x = e.target.value as Exchange; setExchange(x); if (text.trim()) setPreview(parseHoldings(text, x)); }}>
                <option value="NS">NSE (.NS)</option><option value="BO">BSE (.BO)</option><option value="">US (no suffix)</option>
              </select>
            </label>
          </div>
          {fileMsg && <p className="small muted" role="status">{fileMsg}</p>}
          <label className="pf-stack">Or paste here
            <textarea className="pf-textarea" value={text} spellCheck={false} placeholder={"INFY 10 1450\nHDFCBANK.NS 15\nAAPL 3"} onChange={(e) => { setText(e.target.value); setPreview(null); }} />
          </label>
          <div className="pf-actions">
            <button type="button" className="btn" disabled={!text.trim()} onClick={() => setPreview(parseHoldings(text, exchange))}>Check the list</button>
          </div>
          {preview && (
            <div className="pf-preview" aria-live="polite">
              <p><b>{preview.lots.length ? `Found ${preview.lots.length} holding${preview.lots.length === 1 ? "" : "s"}` : "No holdings found"}</b> in {FORMAT_LABEL[preview.format]}.</p>
              {preview.lots.length > 0 && (
                <div className="scroll"><table className="data">
                  <thead><tr><th scope="col">Symbol</th><th scope="col">Quantity</th><th scope="col">Avg cost</th></tr></thead>
                  <tbody>{preview.lots.slice(0, 50).map((l) => <tr key={l.symbol}><td className="mono">{l.symbol}</td><td>{num(l.qty, l.qty % 1 ? 2 : 0)}</td><td>{l.avgCost !== undefined ? num(l.avgCost, 2) : "–"}</td></tr>)}</tbody>
                </table></div>
              )}
              {preview.lots.length > 50 && <p className="small muted">and {preview.lots.length - 50} more.</p>}
              {preview.skipped.length > 0 && (
                <details className="pf-more"><summary>{preview.skipped.length} line{preview.skipped.length === 1 ? "" : "s"} skipped</summary>
                  <ul className="pf-notes">{preview.skipped.slice(0, 40).map((s, i) => <li key={i}>{s.line ? `Line ${s.line}: ` : ""}<span className="mono">{s.text}</span> · {s.reason}</li>)}</ul>
                </details>
              )}
              {preview.notes.length > 0 && <ul className="pf-notes">{preview.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
              {preview.lots.length > 0 && (() => {
                const overlap = preview.lots.filter((l) => held.includes(l.symbol)).length;
                const done = (mode: MergeMode) => { onImport(preview.lots, mode); setPreview(null); setText(""); setFileMsg(""); };
                if (!count) return <div className="pf-actions"><button type="button" className="btn primary" onClick={() => done("add")}>Use these holdings</button></div>;
                return (
                  <>
                    {overlap > 0 && <p className="small"><b>{overlap} of these {overlap === 1 ? "is" : "are"} already in your holdings.</b> A broker file is a snapshot, so updating sets those quantities to the file&apos;s; adding on top would count them twice.</p>}
                    <div className="pf-actions">
                      {overlap > 0
                        ? <><button type="button" className="btn primary" onClick={() => done("update")}>Update to these quantities</button>
                            <button type="button" className="btn" onClick={() => done("add")}>Add on top</button></>
                        : <button type="button" className="btn primary" onClick={() => done("add")}>Add to my holdings</button>}
                      <button type="button" className="btn" onClick={() => done("replace")}>Replace all {count} holding{count === 1 ? "" : "s"}</button>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
