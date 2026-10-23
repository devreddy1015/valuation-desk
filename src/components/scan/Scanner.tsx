"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import ScanSummary from "./ScanSummary";
import ScanTable from "./ScanTable";
import { DEFAULT_SETTINGS, SETTINGS_KEY, WATCH_KEY, useStored, type Settings, type WatchItem } from "@/lib/client/storage";
import {
  MAX_SCAN, NO_FILTERS, VIEWS, filterRows, parseTickers, scoreRows, sortRows, summarize, toCsv, viewFor,
  type BareSuffix, type Filters, type Sort,
} from "@/lib/scanMath";
import type { HealthGrade, ScanRow, UniverseMember } from "@/lib/scanTypes";
import type { UniverseListing } from "@/lib/server/universe";

const SCAN_KEY = "vd:scan:v1";
const CONCURRENCY = 4;
const RETRY_MS = 1500;

/** What this browser remembers between visits: the list, never the results. */
interface Pref { u: string; custom: string; bare: BareSuffix }
const DEFAULT_PREF: Pref = { u: "nifty50", custom: "", bare: "NS" };

type Phase = "idle" | "loading" | "running" | "done" | "stopped" | "error";
interface Failure { symbol: string; name: string; reason: string }
interface List { id: string; name: string; source: string; members: UniverseMember[] }

class RowError extends Error {
  constructor(message: string, public retry: boolean) { super(message); }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Stopped", "AbortError")); }, { once: true });
  });
}

async function fetchRowOnce(symbol: string, signal: AbortSignal): Promise<ScanRow> {
  let res: Response;
  try {
    res = await fetch(`/api/scan/row?symbol=${encodeURIComponent(symbol)}`, { signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new RowError("The request did not reach the server (network error).", true);
  }
  const body = (await res.json().catch(() => null)) as { row?: ScanRow; error?: string } | null;
  if (res.ok && body?.row) return body.row;
  throw new RowError(body?.error ?? `The server answered with status ${res.status}.`, res.status >= 500 || res.ok);
}

/** One row, retried once after 1.5 s when Yahoo or the network failed (not when the data is missing). */
async function fetchRow(symbol: string, signal: AbortSignal): Promise<ScanRow> {
  try {
    return await fetchRowOnce(symbol, signal);
  } catch (e) {
    if (!(e instanceof RowError) || !e.retry) throw e;
  }
  await sleep(RETRY_MS, signal);
  return fetchRowOnce(symbol, signal);
}

async function loadList(pref: Pref, watch: WatchItem[], universes: UniverseListing[], signal: AbortSignal): Promise<List> {
  if (pref.u === "desk") return { id: "desk", name: "Your desk", source: "Stocks you have valued in this browser", members: watch.slice(0, MAX_SCAN).map((w) => ({ symbol: w.symbol, name: w.name })) };
  if (pref.u === "custom") {
    const { symbols } = parseTickers(pref.custom, pref.bare);
    return { id: "custom", name: "Custom list", source: "Tickers you typed", members: symbols.map((s) => ({ symbol: s, name: s })) };
  }
  const info = universes.find((u) => u.id === pref.u);
  if (!info) throw new Error("Pick a list to scan.");
  const res = await fetch(`/api/scan/universe?id=${encodeURIComponent(info.id)}`, { signal });
  const body = (await res.json().catch(() => null)) as { universe?: { members: UniverseMember[]; source: string }; error?: string } | null;
  if (!res.ok || !body?.universe) throw new Error(body?.error ?? `The ${info.name} list did not load. Try again in a minute.`);
  return { id: info.id, name: info.name, source: body.universe.source, members: body.universe.members.slice(0, MAX_SCAN) };
}

const GRADE_OPTIONS: [HealthGrade | "any", string][] = [["any", "Any grade"], ["A", "A only"], ["B", "B or better"], ["C", "C or better"], ["D", "D or better"]];

/** The opportunity scanner: pick a list, value every stock in it, then rank, filter and export. */
export default function Scanner({ universes }: { universes: UniverseListing[] }) {
  const [pref, setPref, prefLoaded] = useStored<Pref>(SCAN_KEY, DEFAULT_PREF);
  const [watch] = useStored<WatchItem[]>(WATCH_KEY, []);
  const [settings] = useStored<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  const calls = settings.calls;

  const [phase, setPhase] = useState<Phase>("idle");
  const [list, setList] = useState<List | null>(null);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>(VIEWS[0].sort);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const ctrl = useRef<AbortController | null>(null);
  const runBtn = useRef<HTMLButtonElement>(null), stopBtn = useRef<HTMLButtonElement>(null);

  // A link such as /scan?u=niftyit preselects a list (it never starts a scan by itself).
  useEffect(() => {
    if (!prefLoaded) return;
    const u = new URLSearchParams(window.location.search).get("u");
    if (u && (u === "desk" || universes.some((x) => x.id === u))) setPref((p) => (p.u === u ? p : { ...p, u }));
  }, [prefLoaded, universes, setPref]);
  useEffect(() => {
    const c = ctrl;
    return () => c.current?.abort();
  }, []);

  const busy = phase === "loading" || phase === "running";
  // Run is disabled while a scan runs, which would drop keyboard focus to the page: hand it to Stop and back.
  useEffect(() => {
    const at = document.activeElement;
    if (busy && (at === document.body || at === runBtn.current)) stopBtn.current?.focus();
    if (!busy && (at === document.body || at === stopBtn.current)) runBtn.current?.focus();
  }, [busy]);
  const families = useMemo(() => [...new Set(universes.map((u) => u.family))], [universes]);
  const selected = universes.find((u) => u.id === pref.u);
  const typed = useMemo(() => parseTickers(pref.custom, pref.bare), [pref.custom, pref.bare]);
  const canRun = pref.u === "desk" ? watch.length > 0 : pref.u === "custom" ? typed.symbols.length > 0 : !!selected;

  const groupOf = useMemo(() => {
    const m = new Map((list?.members ?? []).map((x) => [x.symbol.toUpperCase(), x.group]));
    return (s: string) => m.get(s);
  }, [list]);
  const scored = useMemo(() => scoreRows(rows, groupOf), [rows, groupOf]);
  const groups = useMemo(() => [...new Set(scored.map((r) => r.group))].sort((a, b) => a.localeCompare(b)), [scored]);
  const visible = useMemo(() => sortRows(filterRows(scored, filters), sort), [scored, filters, sort]);
  const summary = useMemo(() => summarize(visible), [visible]);
  const anyGraded = scored.some((r) => r.health.grade !== "–");
  const anyFinancial = scored.some((r) => r.financial);
  const view = viewFor(sort);

  async function run() {
    ctrl.current?.abort();
    const ac = new AbortController();
    ctrl.current = ac;
    setRows([]); setFailures([]); setDone(0); setError(null); setFilters(NO_FILTERS); setPhase("loading");
    let l: List;
    try {
      l = await loadList(pref, watch, universes, ac.signal);
    } catch (e) {
      if (ac.signal.aborted) return;
      setError((e as Error).message); setPhase("error");
      return;
    }
    if (!l.members.length) { setError("This list has no stocks to scan."); setPhase("error"); return; }
    setList(l); setPhase("running");
    let next = 0;
    const worker = async () => {
      while (next < l.members.length && !ac.signal.aborted) {
        const m = l.members[next++];
        try {
          const row = await fetchRow(m.symbol, ac.signal);
          if (ac.signal.aborted) return;
          setRows((p) => [...p, row]);
        } catch (e) {
          if (ac.signal.aborted) return;
          setFailures((p) => [...p, { symbol: m.symbol, name: m.name, reason: (e as Error).message }]);
        }
        setDone((d) => d + 1);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, l.members.length) }, worker));
    if (ctrl.current === ac) setPhase(ac.signal.aborted ? "stopped" : "done");
  }
  function stop() {
    ctrl.current?.abort();
    setPhase("stopped");
  }
  function download() {
    const blob = new Blob(["﻿" + toCsv(visible, { calls })], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scan-${list?.id ?? "list"}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const total = list?.members.length ?? 0;
  const status =
    phase === "loading" ? "Loading the list…"
    : phase === "running" ? `Valued ${rows.length} of ${total}${failures.length ? ` · ${failures.length} could not be valued` : ""}`
    : phase === "done" ? `Done: valued ${rows.length} of ${total}${failures.length ? `; ${failures.length} could not be valued` : ""}.`
    : phase === "stopped" ? `Stopped: valued ${rows.length} of ${total}.`
    : phase === "error" ? error ?? "Something went wrong."
    : "";

  return (
    <>
      <section className="card section" aria-labelledby="scan-pick-h">
        <div className="section-head">
          <h2 id="scan-pick-h">Choose a list</h2>
          <p>Every stock is valued with the desk&apos;s default inputs, then compared with the others in the same list.</p>
        </div>
        <div className="scan-pick">
          <div className="scan-field">
            <label htmlFor="scan-u">List to scan</label>
            <select id="scan-u" className="scan-select" value={pref.u} disabled={busy} onChange={(e) => setPref((p) => ({ ...p, u: e.target.value }))}>
              {families.map((f) => (
                <optgroup key={f} label={f}>
                  {universes.filter((u) => u.family === f).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </optgroup>
              ))}
              <optgroup label="Your lists">
                <option value="desk">Your desk{watch.length ? ` (${watch.length})` : ""}</option>
                <option value="custom">Custom list</option>
              </optgroup>
            </select>
            <p className="note" id="scan-u-desc">
              {pref.u === "desk" ? (watch.length ? `The ${Math.min(watch.length, MAX_SCAN)} stocks you have valued in this browser.` : <>Your desk is empty. <Link href="/india" className="accent">Value a stock</Link> and it appears here.</>)
                : pref.u === "custom" ? "Type or paste up to 150 tickers."
                : selected ? `${selected.size ? `${selected.size} stocks. ` : ""}${selected.description}` : ""}
            </p>
          </div>
          <div className="scan-actions">
            <button type="button" className="btn primary" ref={runBtn} onClick={run} disabled={busy || !canRun}>Run scan</button>
            <button type="button" className="btn" ref={stopBtn} onClick={stop} disabled={!busy}>Stop</button>
          </div>
        </div>

        {pref.u === "custom" && (
          <div className="scan-custom">
            <div className="scan-field">
              <label htmlFor="scan-custom">Tickers, separated by commas, spaces or new lines</label>
              <textarea id="scan-custom" className="scan-textarea" value={pref.custom} disabled={busy} spellCheck={false} placeholder="INFY, TCS, HCLTECH, WIPRO, TECHM" aria-describedby="scan-custom-n"
                onChange={(e) => setPref((p) => ({ ...p, custom: e.target.value }))} />
            </div>
            <div className="row">
              <span className="small" id="scan-bare-l">Tickers without a suffix are</span>
              <div className="seg" role="radiogroup" aria-labelledby="scan-bare-l">
                {([["NS", "NSE (.NS)"], ["BO", "BSE (.BO)"], ["none", "As typed (US)"]] as const).map(([k, label]) => (
                  <button key={k} type="button" role="radio" aria-checked={pref.bare === k} disabled={busy} onClick={() => setPref((p) => ({ ...p, bare: k }))}>{label}</button>
                ))}
              </div>
            </div>
            <p className="note" id="scan-custom-n">
              {typed.symbols.length ? `${typed.symbols.length} tickers: ${typed.symbols.slice(0, 8).join(", ")}${typed.symbols.length > 8 ? "…" : ""}.` : "No tickers yet."}
              {typed.truncated ? " Only the first 150 are scanned." : ""}
              {typed.invalid.length ? ` Not tickers, skipped: ${typed.invalid.slice(0, 5).join(", ")}.` : ""}
              {" "}NSE:INFY and BSE:INFY work too; six-digit BSE codes get .BO. Other markets need their Yahoo suffix, such as BP.L or 7203.T.
            </p>
          </div>
        )}

        <div className="scan-progress">
          {phase !== "idle" && phase !== "error" && total > 0 && (
            <div className="scan-bar" role="progressbar" aria-label="Scan progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
              <span style={{ width: `${Math.round((done / total) * 100)}%` }} />
            </div>
          )}
          <p className="scan-status" role="status" aria-live="polite">{status}</p>
          {failures.length > 0 && (
            <details className="scan-failed">
              <summary>{failures.length} {failures.length === 1 ? "stock" : "stocks"} could not be valued</summary>
              <ul>
                {failures.map((f) => <li key={f.symbol}><span className="mono">{f.symbol}</span>{f.name !== f.symbol ? ` (${f.name})` : ""}: {f.reason}</li>)}
              </ul>
            </details>
          )}
        </div>
      </section>

      {rows.length > 0 ? (
        <section className="card section" aria-labelledby="scan-res-h">
          <div className="section-head">
            <h2 id="scan-res-h">{list?.name}: ranked</h2>
            <p>{phase === "running" ? "The ranking updates as each stock arrives, because peer values come from the stocks valued so far." : `Source of the list: ${list?.source}.`}</p>
          </div>
          <ScanSummary s={summary} />
          <div className="scan-controls">
            <div className="seg scan-views" role="group" aria-label="Preset views">
              {VIEWS.map((v) => <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => setSort(v.sort)}>{v.label}</button>)}
            </div>
            <p className="note">{VIEWS.find((v) => v.key === view)?.hint ?? "Sorted by the column you picked. Choose a preset view to go back."}</p>
            <div className="scan-filters">
              <div className="scan-field">
                <label htmlFor="scan-g">Sector</label>
                <select id="scan-g" className="scan-select" value={filters.group} onChange={(e) => setFilters((f) => ({ ...f, group: e.target.value }))}>
                  <option value="">All sectors</option>
                  {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div className="scan-field">
                <label htmlFor="scan-h">Minimum health grade</label>
                <select id="scan-h" className="scan-select" value={filters.minGrade} disabled={!anyGraded} aria-describedby={anyGraded ? undefined : "scan-h-n"}
                  onChange={(e) => setFilters((f) => ({ ...f, minGrade: e.target.value as Filters["minGrade"] }))}>
                  {GRADE_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
                {!anyGraded && <span className="note" id="scan-h-n">No health grades in this scan yet.</span>}
              </div>
              {anyFinancial && (
                <label className="check">
                  <input type="checkbox" checked={filters.hideFinancials} onChange={(e) => setFilters((f) => ({ ...f, hideFinancials: e.target.checked }))} />
                  Hide financial firms
                </label>
              )}
              <span className="spacer" />
              <button type="button" className="btn small" onClick={download} disabled={!visible.length}>Download CSV</button>
            </div>
          </div>
          <p className="small muted">Showing {visible.length} of {scored.length} valued stocks.</p>
          <ScanTable rows={visible} sort={sort} onSort={setSort} calls={calls} />
          {calls && (
            <p className="note">
              Calls use the desk&apos;s default thresholds (gap above +15% BUY, below −10% SELL, otherwise HOLD) and are model outputs for learning.
              In India, giving buy or sell recommendations to clients can require SEBI Research Analyst registration.
            </p>
          )}
          <p className="note">Value estimates use default inputs and peers from this list only. Open a stock for full peers, your own forecast and every check. Educational, not investment advice.</p>
        </section>
      ) : phase === "idle" ? (
        <section className="card empty" aria-label="How to start">
          <p className="label">How it works</p>
          <p className="muted" style={{ maxWidth: "62ch" }}>
            Pick a list and press Run scan. Each stock takes a second or two, four at a time, so a 50-stock index usually takes under a minute; a repeat scan within the hour is quicker because results are kept.
          </p>
        </section>
      ) : null}
    </>
  );
}
