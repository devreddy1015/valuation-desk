"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Num from "./Num";
import Bands from "./Bands";
import ExcelButton from "./ExcelButton";
import Health from "./Health";
import { ReturnsPanel, Story } from "./Insight";
import ShareButton from "./ShareButton";
import SharedBanner from "./SharedBanner";
import { FcfChart, FootballField, Histogram, RevenueChart, type RangeRow } from "./charts";
import { compute, defaultInputs, monteCarlo, starterDrivers, FORECAST_YEARS } from "@/lib/model";
import { big, bigUnit, cap1, dateLabel, money, money0, mult, num, pct } from "@/lib/format";
import { readJSON, writeJSON, useStored, SETTINGS_KEY, DEFAULT_SETTINGS, WATCH_KEY, type Settings, type WatchItem } from "@/lib/client/storage";
import type { Drivers, PeerRow, StockData, UserInputs } from "@/lib/types";
import { applyOverrides, type Overrides } from "@/lib/overrides";
import { healthCheck } from "@/lib/quality";
import { clearShareHash, readSharedFromHash, type ExportPayload, type SharedState } from "@/lib/client/share";
import { SCENARIOS } from "@/lib/types";

const DRIVERS: { key: keyof Drivers; label: string }[] = [
  { key: "growth", label: "Revenue growth" },
  { key: "margin", label: "EBIT margin" },
  { key: "tax", label: "Tax rate" },
  { key: "da", label: "D&A % of revenue" },
  { key: "capex", label: "Capex % of revenue" },
  { key: "wc", label: "Working capital % of revenue change" },
];
interface Saved { v: 1; inputs: Omit<UserInputs, "price">; extraPeers: PeerRow[]; overrides: Overrides }

const icon = (r: string) => r === "BUY" ? <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2l5 7H2z" fill="currentColor" /></svg>
  : r === "SELL" ? <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 12L2 5h10z" fill="currentColor" /></svg>
  : <svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="6" width="10" height="2.4" rx="1.2" fill="currentColor" /></svg>;

export default function Desk({ data: raw, peers: autoPeers, now }: { data: StockData; peers: PeerRow[]; now: number }) {
  const key = `vd:desk:v1:${raw.symbol}`;
  const [settings, setSettings] = useStored<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [extraPeers, setExtraPeers] = useState<PeerRow[]>([]);
  const data = useMemo(() => applyOverrides(raw, overrides), [raw, overrides]);
  const peers = useMemo(() => [...autoPeers, ...extraPeers.filter((p) => !autoPeers.some((a) => a.symbol === p.symbol))], [autoPeers, extraPeers]);
  const [inp, setInp] = useState<UserInputs>(() => defaultInputs(raw, autoPeers));
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [peerMsg, setPeerMsg] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  const [forceDcf, setForceDcf] = useState(false);
  const [shared, setShared] = useState(false); // showing someone's share link: not saved until kept
  const showDcf = !raw.financial || forceDcf;

  // load saved inputs for this stock (prices always start from the live quote)
  /* eslint-disable react-hooks/set-state-in-effect -- per-stock state lives in localStorage, read after mount */
  const loadOwn = () => {
    const s = readJSON<Saved | null>(key, null);
    const ok = !!(s && s.v === 1 && s.inputs?.assume);
    setOverrides(ok ? s!.overrides ?? {} : {});
    setExtraPeers(ok ? s!.extraPeers ?? [] : []);
    setInp(ok ? { ...defaultInputs(raw, autoPeers), ...s!.inputs, price: raw.price } : defaultInputs(raw, autoPeers));
  };
  useEffect(() => {
    loadOwn();
    setLoaded(true);
    // a share link (#v=...) wins over saved inputs, on today's live price, until the user keeps it
    let off = false;
    const fromHash = () => void readSharedFromHash(raw.symbol).then((sh) => {
      if (off || !sh) return;
      setShared(true);
      setOverrides(sh.overrides);
      setExtraPeers(sh.extraPeers);
      setInp({ ...defaultInputs(raw, autoPeers), ...sh.inputs, price: raw.price });
    });
    fromHash();
    window.addEventListener("hashchange", fromHash); // a link pasted into a tab already on this stock
    return () => { off = true; window.removeEventListener("hashchange", fromHash); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadOwn reads the same key, raw and autoPeers
  }, [key, raw, autoPeers]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!loaded || shared) return;
    const rest: Omit<UserInputs, "price"> & { price?: number } = { ...inp };
    delete rest.price;
    writeJSON(key, { v: 1, inputs: rest, extraPeers, overrides } satisfies Saved);
  }, [inp, extraPeers, overrides, loaded, shared, key]);

  const R = useMemo(() => compute(inp, data, peers, now), [inp, data, peers, now]);
  const MC = useMemo(() => monteCarlo(inp, R), [inp, R]);
  const cur = data.currency;
  const calls = settings.calls;
  const targetLabel = calls ? "Target" : "Value";
  const st = inp.assume[inp.scenario];

  // keep the home-page desk list current
  const lastSnap = useRef("");
  useEffect(() => {
    if (!loaded || shared) return;
    const item: WatchItem = { symbol: data.symbol, name: data.name, currency: cur, price: inp.price, pt: R.ok ? R.pt : null, upside: R.ok ? R.upside : null, rating: R.rating, viewed: new Date(now).toISOString() };
    const sig = JSON.stringify([item.pt, item.price, item.rating]);
    if (sig === lastSnap.current) return;
    lastSnap.current = sig;
    const list = readJSON<WatchItem[]>(WATCH_KEY, []).filter((w) => w.symbol !== item.symbol);
    writeJSON(WATCH_KEY, [item, ...list].slice(0, 50));
  }, [R.pt, R.upside, R.rating, R.ok, inp.price, loaded, shared, data.symbol, data.name, cur, now]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2400); };
  const set = (patch: Partial<UserInputs>) => setInp((p) => ({ ...p, ...patch }));
  const setRate = (k: keyof UserInputs["rate"], v: number) => setInp((p) => ({ ...p, rate: { ...p.rate, [k]: v } }));
  const setDriver = (k: keyof Drivers, i: number, v: number) => setInp((p) => {
    const a = { ...p.assume[p.scenario], [k]: p.assume[p.scenario][k].map((x, j) => (j === i ? v : x)) };
    return { ...p, assume: { ...p.assume, [p.scenario]: a } };
  });
  const u = bigUnit(cur);

  // ---------- derived display rows ----------
  const sensFlat = R.sens.flat().filter(Number.isFinite);
  const ffAll: RangeRow[] = [
    { label: "DCF scenarios", sub: "bear to bull", lo: Math.min(...SCENARIOS.map((k) => R.scen[k].vps)), hi: Math.max(...SCENARIOS.map((k) => R.scen[k].vps)), mid: R.live.vps, midLabel: "Live scenario" },
    { label: "DCF sensitivity", sub: "WACC and g ±1 point", lo: sensFlat.length ? Math.min(...sensFlat) : NaN, hi: sensFlat.length ? Math.max(...sensFlat) : NaN, mid: R.live.vps, midLabel: "Current pair" },
    { label: "Monte Carlo", sub: "middle 80% of 2,000 runs", lo: MC.p10, hi: MC.p90, mid: MC.p50, midLabel: "Median" },
    ...(data.financial
      ? [{ label: "P/B comps", sub: "25th to 75th percentile", lo: R.implied.pb.q1, hi: R.implied.pb.q3, mid: R.implied.pb.med, midLabel: "Median" }]
      : [{ label: "EV/EBITDA comps", sub: "25th to 75th percentile", lo: R.implied.evE.q1, hi: R.implied.evE.q3, mid: R.implied.evE.med, midLabel: "Median" }]),
    { label: "P/E comps", sub: "25th to 75th percentile", lo: R.implied.pe.q1, hi: R.implied.pe.q3, mid: R.implied.pe.med, midLabel: "Median" },
    { label: "52-week share price", sub: "trading range", lo: data.lo52, hi: data.hi52, neutral: true },
  ];
  const ffRows = showDcf ? ffAll : ffAll.filter((r) => !/^(DCF|Monte Carlo)/.test(r.label));
  const histYears = data.history.map((y) => y.label);
  const scenRev = { bear: R.scen.bear.rev, base: R.scen.base.rev, bull: R.scen.bull.rev };

  const health = useMemo(() => healthCheck(data), [data]);

  // ---------- client outputs ----------
  const withoutPrice = (): SharedState["inputs"] => { const rest: SharedState["inputs"] = { ...inp }; delete rest.price; return rest; };
  const shareState = (): SharedState => ({ v: 1, symbol: data.symbol, inputs: withoutPrice(), overrides, extraPeers });
  const excelPayload = (): ExportPayload => ({ symbol: data.symbol, inputs: inp, overrides, extraPeers, calls, now });
  const shareText = `${data.name} (${data.symbol}): ${calls ? "price target" : "value estimate"} ${R.ok ? money(R.pt, cur) : "–"} vs a price of ${money(inp.price, cur)}${R.ok ? ` (${pct(R.upside, 1, true)})` : ""}. Educational model, not investment advice.`;
  const keepShared = () => { setShared(false); clearShareHash(); flash("Saved as your own valuation"); };
  const dropShared = () => { setShared(false); clearShareHash(); loadOwn(); flash("Back to your own inputs"); };
  function summaryText(): string {
    const L = R.live, lines: string[] = [];
    lines.push(`${data.name} (${data.symbol}), valuation summary, ${dateLabel(new Date(now).toISOString())}`);
    lines.push(calls ? `Call: ${R.rating}. Price target ${money(R.pt, cur)} (${pct(R.upside, 1, true)} vs ${money(inp.price, cur)}).` : `Value estimate ${money(R.pt, cur)} (${pct(R.upside, 1, true)} vs today's price of ${money(inp.price, cur)}).`);
    lines.push("");
    lines.push(`• DCF (${inp.usePW ? "probability-weighted" : inp.scenario + " case"}): ${R.dcfOk ? money(R.dcfUsed, cur) : "not meaningful with these inputs"} per share. WACC ${pct(R.wacc, 2)}, terminal growth ${pct(R.g)}; terminal value is ${pct(L.tvShare, 0)} of enterprise value.`);
    lines.push(`• Peers: ${money(R.compsValue, cur)} per share (${R.compsMethod}; ${R.peers.filter((p) => p.included).length} peers).`);
    lines.push(`• Scenarios: bear ${money(R.scen.bear.vps, cur)}, base ${money(R.scen.base.vps, cur)}, bull ${money(R.scen.bull.vps, cur)}; probability-weighted ${money(R.pw, cur)}.`);
    lines.push(`• What the price implies: ${Number.isFinite(R.impliedGrowth) ? R.impliedGrowth.toFixed(1) + "% revenue growth a year" : "outside the range tested"} for ${R.fyLabels[0]}–${R.fyLabels[FORECAST_YEARS - 1]}, against ${R.liveAvgGrowth.toFixed(1)}% in this forecast.`);
    lines.push(`• Monte Carlo: ${pct(MC.probAbove, 0)} of ${MC.n.toLocaleString()} simulated outcomes are above today's price; middle 80% ${money(MC.p10, cur)} to ${money(MC.p90, cur)}.`);
    lines.push(`• Key assumptions (${inp.scenario}): revenue growth ${st.growth.map((g) => g.toFixed(1) + "%").join(" → ")}; EBIT margin ${st.margin[0].toFixed(1)}% to ${st.margin[FORECAST_YEARS - 1].toFixed(1)}%; tax ${st.tax[0].toFixed(1)}%.`);
    const failed = R.checks.filter((c) => c.pass === false).map((c) => c.what);
    lines.push(`• Checks: ${failed.length ? "to review: " + failed.join("; ") : "all pass"}.`);
    lines.push("");
    lines.push(`Data: ${data.source}, as of ${dateLabel(data.asOf)}. Educational model, not investment advice.`);
    return lines.join("\n");
  }
  async function copySummary() {
    const t = summaryText();
    try { await navigator.clipboard.writeText(t); flash("Client summary copied"); }
    catch { flash("Copying is blocked in this browser"); }
  }
  function csv(): string {
    const rows: (string | number)[][] = [];
    const add = (...r: (string | number)[]) => rows.push(r);
    add("Valuation Desk export", data.name, data.symbol, dateLabel(new Date(now).toISOString()));
    add("Currency", cur, "Large amounts in", u.label);
    add("");
    add("OUTPUT", "Value");
    add(calls ? "Price target" : "Value estimate", R.pt); add("Current price", inp.price); add("Upside", R.upside);
    if (calls) add("Call", R.rating);
    for (const k of SCENARIOS) add(`DCF value, ${k}`, R.scen[k].vps);
    add("DCF value, probability-weighted", R.pw); add("Comps value", R.compsValue); add("WACC", R.wacc); add("Terminal growth", R.g);
    add("Implied revenue growth", R.impliedGrowth / 100); add("Implied EBIT margin", R.impliedMargin / 100);
    add("Monte Carlo P(value > price)", MC.probAbove); add("Monte Carlo P10", MC.p10); add("Monte Carlo P50", MC.p50); add("Monte Carlo P90", MC.p90);
    add("");
    add("INPUTS", "Scenario", ...R.fyLabels);
    for (const d of DRIVERS) for (const k of SCENARIOS) add(d.label, k, ...inp.assume[k][d.key]);
    add("Risk-free rate (%)", inp.rate.rf); add("Default spread (%)", inp.rate.spread); add("Beta", inp.rate.beta); add("Equity risk premium (%)", inp.rate.erp); add("Cost of debt (%)", inp.rate.kd); add("Terminal growth (%)", inp.rate.g);
    add("DCF weight (%)", inp.dcfWeight); add("Scenario probabilities (%)", inp.probs.bear, inp.probs.base, inp.probs.bull);
    add("");
    add("FORECAST, " + inp.scenario + " case (" + u.label + ")", ...R.fyLabels);
    const L = R.live, d = (a: number[]) => a.map((x) => +(x / u.div).toFixed(2));
    add("Revenue", ...d(L.rev)); add("EBIT", ...d(L.ebit)); add("NOPAT", ...d(L.nopat)); add("D&A", ...d(L.da)); add("Capex", ...d(L.capex)); add("Increase in working capital", ...d(L.wcInc)); add("Free cash flow", ...d(L.fcf)); add("Present value", ...d(L.pv));
    add("");
    add("HISTORY (" + u.label + ")", ...histYears);
    for (const f of ["revenue", "ebit", "da", "pbt", "tax", "capex", "wcInc"] as const) add(f, ...data.history.map((y) => +(y[f] / u.div).toFixed(2)));
    add("");
    add("PEERS", "Included", "EV/EBITDA", "P/E", "EV/Sales", "P/B");
    for (const p of R.peers) add(p.symbol, p.included ? "yes" : "no", p.evEbitda ?? "", p.pe ?? "", p.evSales ?? "", p.pb ?? "");
    add("");
    add("Source", data.source); add("Educational model, not investment advice");
    return rows.map((r) => r.map((c) => { const s = String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
  }
  function downloadCsv() {
    const blob = new Blob([csv()], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${data.symbol.replace(/[^A-Za-z0-9.-]/g, "_")}-valuation.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function resetAll() {
    if (!resetArmed) { setResetArmed(true); setTimeout(() => setResetArmed(false), 3500); return; }
    setResetArmed(false);
    try { localStorage.removeItem(key); } catch { /* storage blocked */ }
    if (shared) { setShared(false); clearShareHash(); }
    setOverrides({}); setExtraPeers([]); setInp(defaultInputs(raw, autoPeers));
    flash("Back to the starting data");
  }
  async function addPeer(symbol: string) {
    setPeerMsg(null);
    if (symbol === data.symbol || peers.some((p) => p.symbol === symbol)) { setPeerMsg(`${symbol} is already in the list.`); return; }
    try {
      const res = await fetch(`/api/peer?symbol=${encodeURIComponent(symbol)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Not found");
      setExtraPeers((p) => [...p, j.peer as PeerRow]);
      setInp((p) => ({ ...p, peers: { ...p.peers, [symbol]: true } }));
      setPeerMsg(`Added ${j.peer.name}.`);
    } catch (e) { setPeerMsg(`Could not add ${symbol}: ${(e as Error).message}.`); }
  }

  const setOv = (k: string, displayValue: number, scale: number) => setOverrides((o) => ({ ...o, [k]: displayValue * scale }));
  const H = R.H;
  const marchFY = histYears[0]?.startsWith("FY");
  const checksPassed = R.checks.filter((c) => c.pass === true).length, checksFailed = R.checks.filter((c) => c.pass === false).length;

  return (
    <div className="wrap">
      <div className="desk-head">
        <div>
          <p className="label">{data.exchange} · {data.country || "–"} · {data.industry || data.sector || "–"}</p>
          <h1>{data.name} <span className="accent mono">{data.symbol}</span></h1>
          <div className="meta">
            <span className="chip">Price {money(inp.price, cur)}</span>
            <span className="chip">Mkt cap {big(data.marketCap, cur)} {u.label.replace(/^. /, "")}</span>
            <span className="chip">Reports in {data.financialCurrency}</span>
            <span className="chip">Data {dateLabel(data.asOf)}</span>
          </div>
        </div>
        <div className="desk-actions">
          <div className="seg" role="radiogroup" aria-label="Show buy, hold and sell calls">
            <button type="button" role="radio" aria-checked={!calls} onClick={() => setSettings({ ...settings, calls: false })}>Valuation only</button>
            <button type="button" role="radio" aria-checked={calls} onClick={() => setSettings({ ...settings, calls: true })}>Show calls</button>
          </div>
          <button type="button" className="btn primary" onClick={copySummary}>Copy client summary</button>
          <ShareButton getState={shareState} summary={shareText} />
          <ExcelButton getPayload={excelPayload} symbol={data.symbol} />
          <button type="button" className="btn" onClick={downloadCsv}>Download CSV</button>
          <button type="button" className="btn" onClick={() => window.print()}>Print report</button>
          <button type="button" className={`btn${resetArmed ? " primary" : ""}`} onClick={resetAll}>{resetArmed ? "Click again to reset" : "Reset"}</button>
        </div>
      </div>
      {shared && <SharedBanner onKeep={keepShared} onDiscard={dropShared} />}
      {calls && <p className="note no-print" style={{ marginBottom: 10 }}>Calls are model outputs for learning. In India, giving buy or sell recommendations to clients can require SEBI Research Analyst registration.</p>}

      <section className="verdict" aria-live="polite" aria-label="Result">
        <div className="card hero-stat">
          <span className="label">{calls ? "Price target" : "Value estimate"} · {R.dcfOk ? `${Math.round(R.w * 100)}% DCF, ${100 - Math.round(R.w * 100)}% peers` : "peers only"}</span>
          <span className="v num">{R.ok ? money(R.pt, cur) : "–"}</span>
          {calls ? <span className={`pill ${R.rating === "–" ? "na" : R.rating}`}>{icon(R.rating)}{R.rating}</span> : <span className={`pill VALUE`}>{R.ok ? pct(R.upside, 1, true) : "–"}</span>}
          <span className="n">{R.ok ? `${pct(R.upside, 1, true)} vs ${money(inp.price, cur)}${calls ? ` · BUY above ${inp.buy}%, SELL below ${String(inp.sell).replace("-", "−")}%` : ""}` : "Fix the inputs flagged in the checks to get a value"}</span>
        </div>
        {showDcf
          ? <div className="card stat"><span className="label">DCF ({inp.usePW ? "weighted" : inp.scenario})</span><span className="v num">{R.dcfOk ? money(R.dcfUsed, cur) : "–"}</span><span className="n">{R.dcfOk ? `${pct(R.dcfUsed / inp.price - 1, 1, true)} vs price · WACC ${pct(R.wacc, 1)}` : "not meaningful with these inputs"}</span></div>
          : <div className="card stat"><span className="label">DCF</span><span className="v">Not used</span><span className="n">a free-cash-flow DCF doesn&apos;t suit a bank or insurer</span></div>}
        <div className="card stat"><span className="label">Peers</span><span className="v num">{money(R.compsValue, cur)}</span><span className="n">{R.peers.filter((p) => p.included).length} peers · {data.financial ? `median P/E ${mult(R.stats.pe.med)}` : `median EV/EBITDA ${mult(R.stats.evE.med)}`}</span></div>
        {showDcf ? <>
          <div className="card stat"><span className="label">Price implies</span><span className="v num">{Number.isFinite(R.impliedGrowth) ? R.impliedGrowth.toFixed(1) + "%" : "–"}</span><span className="n">revenue growth a year; your case {R.liveAvgGrowth.toFixed(1)}%</span></div>
          <div className="card stat"><span className="label">Chance worth more</span><span className="v num">{pct(MC.probAbove, 0)}</span><span className="n">of {MC.n.toLocaleString()} simulated outcomes</span></div>
        </> : <>
          <div className="card stat"><span className="label">P/E vs peers</span><span className="v num">{pct(R.discount, 1, true)}</span><span className="n">{mult(R.subject.pe)} against a peer median of {mult(R.stats.pe.med)}</span></div>
          <div className="card stat"><span className="label">Price to book</span><span className="v num">{mult(R.subject.pb)}</span><span className="n">peer median {mult(R.stats.pb.med)}</span></div>
        </>}
      </section>

      <div className="layout">
        <aside className="rail" aria-label="Inputs">
          <details className="card group" open>
            <summary><h2>Scenario</h2><span className="hint">drives the result</span></summary>
            <div className="body">
              <div className="seg" role="radiogroup" aria-label="Live scenario" style={{ width: "100%", gridAutoColumns: "1fr" }}>
                {SCENARIOS.map((k) => <button key={k} type="button" role="radio" aria-checked={inp.scenario === k} onClick={() => set({ scenario: k })}>{cap1(k)}</button>)}
              </div>
              <p className="label" style={{ marginTop: 4 }}>Scenario probabilities (%)</p>
              <div className="probs">
                {SCENARIOS.map((k) => <label key={k}>{cap1(k)}<Num value={inp.probs[k]} step={5} min={0} max={100} label={`${k} probability`} onChange={(v) => set({ probs: { ...inp.probs, [k]: v } })} /></label>)}
              </div>
              <label className="check"><input type="checkbox" checked={inp.usePW} onChange={(e) => set({ usePW: e.target.checked })} /><span>Use the probability-weighted DCF instead of the live scenario</span></label>
            </div>
          </details>

          <details className="card group" open>
            <summary><h2>Forecast drivers</h2><span className="hint">{cap1(inp.scenario)} case, %</span></summary>
            <div className="body">
              <div className="scroll">
                <table className="drivers">
                  <thead><tr><th>Driver</th>{R.fyLabels.map((y) => <th key={y}>{y}</th>)}</tr></thead>
                  <tbody>
                    {DRIVERS.map((d) => (
                      <tr key={d.key}>
                        <td className="lab"><b>{d.label}</b><span>{histYears[0]}–{histYears[histYears.length - 1]} avg {pct(H[d.key as keyof typeof H] as number)}</span></td>
                        {st[d.key].map((v, i) => <td key={i}><Num value={v} label={`${d.label}, ${R.fyLabels[i]}, percent`} onChange={(x) => setDriver(d.key, i, x)} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="note">{data.estimates.note ?? "No usable consensus estimate: the first years start from history."} The base case fades to {(inp.rate.g + 2).toFixed(1)}% by year five; bear and bull sit 3 points of growth and 1.5 points of margin either side.</p>
              <button type="button" className="btn small" onClick={() => { setInp((p) => ({ ...p, assume: starterDrivers(data) })); flash("Drivers rebuilt from history"); }}>Rebuild starter drivers from the data</button>
            </div>
          </details>

          <details className="card group" open>
            <summary><h2>Discount rate</h2><span className="hint">WACC build</span></summary>
            <div className="body">
              <div className="field"><label htmlFor="rf">{cur} 10-year government bond yield (%)<small>{data.riskFree.note}</small></label><Num id="rf" value={inp.rate.rf} step={0.05} flag={data.riskFree.estimated} onChange={(v) => setRate("rf", v)} /></div>
              <div className="field"><label htmlFor="sp">Less: country default spread (%)<small>{cur === "INR" ? "Damodaran; the Indian bond yield carries some default risk" : "0 when the bond above is default-free"}</small></label><Num id="sp" value={inp.rate.spread} step={0.05} onChange={(v) => setRate("spread", v)} /></div>
              <div className="slider-field">
                <label htmlFor="beta-r"><span>Beta</span><span className="muted small">{data.beta ? `${data.beta.window} vs ${data.beta.benchmark}: ${data.beta.value.toFixed(2)} (R² ${data.beta.r2.toFixed(2)})` : `Yahoo: ${num(data.yahooBeta)}`}</span></label>
                <input id="beta-r" type="range" min="0.3" max="2" step="0.01" value={inp.rate.beta} onChange={(e) => setRate("beta", parseFloat(e.target.value))} />
                <Num value={inp.rate.beta} step={0.01} label="Beta" onChange={(v) => setRate("beta", v)} />
              </div>
              <div className="field"><label htmlFor="erp">Equity risk premium (%)<small>{data.erp.note}</small></label><Num id="erp" value={inp.rate.erp} step={0.05} flag={data.erp.estimated} onChange={(v) => setRate("erp", v)} /></div>
              <div className="field"><label htmlFor="kd">Pre-tax cost of debt (%)<small>starter: bond yield + 1.5 points</small></label><Num id="kd" value={inp.rate.kd} step={0.1} onChange={(v) => setRate("kd", v)} /></div>
              <div className="slider-field">
                <label htmlFor="g-r"><span>Terminal growth g (%)</span><span className="muted small">must stay below WACC</span></label>
                <input id="g-r" type="range" min="0" max="8" step="0.1" value={inp.rate.g} onChange={(e) => setRate("g", parseFloat(e.target.value))} />
                <Num value={inp.rate.g} step={0.1} label="Terminal growth" onChange={(v) => setRate("g", v)} />
              </div>
              <dl className="derived">
                <dt>Risk-free rate</dt><dd>{pct(R.rf, 2)}</dd>
                <dt>Cost of equity</dt><dd>{pct(R.ke, 2)}</dd>
                <dt>Weight of equity</dt><dd>{pct(R.we, 1)}</dd>
                <dt>After-tax cost of debt</dt><dd>{pct(R.kdAT, 2)}</dd>
                <dt className="total">WACC</dt><dd className="total">{pct(R.wacc, 2)}</dd>
              </dl>
            </div>
          </details>

          <details className="card group" open>
            <summary><h2>Result rules</h2><span className="hint">set before you look</span></summary>
            <div className="body">
              <div className="slider-field">
                <label htmlFor="w-r"><span>DCF weight (%)</span><span className="muted small">peers get {100 - Math.round(inp.dcfWeight)}%</span></label>
                <input id="w-r" type="range" min="0" max="100" step="5" value={inp.dcfWeight} onChange={(e) => set({ dcfWeight: parseFloat(e.target.value) })} />
                <Num value={inp.dcfWeight} step={5} min={0} max={100} label="DCF weight" onChange={(v) => set({ dcfWeight: v })} />
              </div>
              {calls && <>
                <div className="field"><label htmlFor="buy">BUY if upside is above (%)</label><Num id="buy" value={inp.buy} step={1} onChange={(v) => set({ buy: v })} /></div>
                <div className="field"><label htmlFor="sell">SELL if upside is below (%)</label><Num id="sell" value={inp.sell} step={1} onChange={(v) => set({ sell: v })} /></div>
              </>}
              <div className="field"><label htmlFor="px">Share price ({cur})<small>Yahoo, {dateLabel(data.priceTime)} (delayed)</small></label><Num id="px" value={inp.price} step="any" onChange={(v) => set({ price: v })} /></div>
            </div>
          </details>
        </aside>

        <div className="results">
          {data.warnings.length > 0 && (
            <div className="warnbox" role="note"><b>Check before you rely on this</b>{data.warnings.map((w) => <span key={w}>{w}</span>)}</div>
          )}

          <Story data={data} inp={inp} R={R} MC={showDcf ? MC : null} health={health} calls={calls} />

          <section className="card section" aria-labelledby="ff-h">
            <div className="section-head"><h2 id="ff-h">Football field</h2><p>Every valuation range side by side, against today&apos;s price and the {calls ? "price target" : "value estimate"}. Per share, in {cur}.</p></div>
            <FootballField rows={ffRows} price={inp.price} target={R.ok ? R.pt : null} currency={cur} targetLabel={targetLabel} />
            <details className="tableview"><summary>Show as table</summary>
              <div className="scroll"><table className="data"><thead><tr><th>Range</th><th>Low</th><th>Mid</th><th>High</th></tr></thead><tbody>
                {ffRows.map((r) => <tr key={r.label}><td>{r.label} ({r.sub})</td><td>{money0(r.lo, cur)}</td><td>{r.mid !== undefined ? money0(r.mid, cur) : "–"}</td><td>{money0(r.hi, cur)}</td></tr>)}
              </tbody></table></div>
            </details>
          </section>

          <Health data={data} report={health} />

          {!showDcf && (
            <section className="card section" aria-labelledby="fin-h">
              <div className="section-head"><h2 id="fin-h">DCF sections are hidden for banks and insurers</h2><p>For a lender, debt is raw material rather than financing, so free cash flow to the firm and the WACC bridge don&apos;t describe the business. The value above uses peer P/E and P/B only.</p></div>
              <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => setForceDcf(true)}>Show the DCF sections anyway</button>
            </section>
          )}
          {showDcf && <>
          <section className="card section" aria-labelledby="imp-h">
            <div className="section-head"><h2 id="imp-h">What the price implies</h2><p>A reverse DCF: the constant revenue growth, or the constant EBIT margin, that makes the DCF equal today&apos;s price, holding everything else in your {inp.scenario} case.</p></div>
            <div className="implied">
              <div className="imp"><span className="label">Implied revenue growth, a year</span><span className="v num">{Number.isFinite(R.impliedGrowth) ? R.impliedGrowth.toFixed(1) + "%" : "–"}</span><span className="small" style={{ color: "var(--ink-2)" }}>Your {inp.scenario} case averages {R.liveAvgGrowth.toFixed(1)}%. {Number.isFinite(R.impliedGrowth) ? (R.impliedGrowth < R.liveAvgGrowth ? "The market expects less growth than you do." : "The market expects more growth than you do.") : "No growth rate between −60% and +100% matches the price."}</span></div>
              <div className="imp"><span className="label">Implied EBIT margin</span><span className="v num">{Number.isFinite(R.impliedMargin) ? R.impliedMargin.toFixed(1) + "%" : "–"}</span><span className="small" style={{ color: "var(--ink-2)" }}>Your {inp.scenario} case averages {R.liveAvgMargin.toFixed(1)}%; the last reported year was {pct(H.marginLast)}.</span></div>
            </div>
          </section>

          <ReturnsPanel data={data} inp={inp} R={R} />

          <section className="card section" aria-labelledby="sc-h">
            <div className="section-head"><h2 id="sc-h">Three scenarios</h2><p>Revenue path for each scenario and its value per share with the same WACC and terminal growth.</p></div>
            <div className="minis">
              {SCENARIOS.map((k) => (
                <div key={k} className={`mini${k === inp.scenario && !inp.usePW ? " live" : ""}`}>
                  <span className="k"><i className="key-line" style={{ background: k === "bear" ? "var(--s2)" : k === "base" ? "var(--s1)" : "var(--s3)" }} />{cap1(k)} · {inp.probs[k]}%</span>
                  <span className="v num">{R.scen[k].valid ? money(R.scen[k].vps, cur) : "–"}</span>
                  <span className="n">{pct(R.scen[k].vps / inp.price - 1, 1, true)} vs price</span>
                </div>
              ))}
              <div className={`mini${inp.usePW ? " live" : ""}`}><span className="k">Probability-weighted</span><span className="v num">{money(R.pw, cur)}</span><span className="n">{pct(R.pw / inp.price - 1, 1, true)} vs price</span></div>
            </div>
            <div className="legend"><span><i className="key-line" style={{ background: "var(--neutral-mark)" }} />Reported</span><span><i className="key-line" style={{ background: "var(--s2)" }} />Bear</span><span><i className="key-line" style={{ background: "var(--s1)" }} />Base</span><span><i className="key-line" style={{ background: "var(--s3)" }} />Bull</span></div>
            <RevenueChart years={[...histYears, ...R.fyLabels]} actual={data.history.map((y) => y.revenue)} series={scenRev} live={inp.scenario} currency={cur} />
            <details className="tableview"><summary>Show as table</summary>
              <div className="scroll"><table className="data"><thead><tr><th>Revenue, {u.label}</th>{[...histYears, ...R.fyLabels].map((y) => <th key={y}>{y}</th>)}</tr></thead><tbody>
                <tr><td>Reported</td>{data.history.map((y) => <td key={y.label}>{big(y.revenue, cur)}</td>)}{R.fyLabels.map((y) => <td key={y} />)}</tr>
                {SCENARIOS.map((k) => <tr key={k} className={k === inp.scenario ? "hl" : ""}><td>{cap1(k)}</td>{histYears.map((y) => <td key={y} />)}{R.scen[k].rev.map((v, i) => <td key={i}>{big(v, cur)}</td>)}</tr>)}
              </tbody></table></div>
            </details>
          </section>

          <section className="card section" aria-labelledby="mc-h">
            <div className="section-head"><h2 id="mc-h">Monte Carlo</h2><p>2,000 simulated futures around your {inp.scenario} case. Each run shifts growth, margin, WACC and terminal growth at random using the spreads below (one standard deviation).</p></div>
            <div className="mc-controls no-print">
              <label>Growth spread (± pts)<Num value={inp.mc.g} step={0.5} min={0} label="Growth spread" onChange={(v) => set({ mc: { ...inp.mc, g: v } })} /></label>
              <label>Margin spread (± pts)<Num value={inp.mc.m} step={0.5} min={0} label="Margin spread" onChange={(v) => set({ mc: { ...inp.mc, m: v } })} /></label>
              <label>WACC spread (± pts)<Num value={inp.mc.w} step={0.25} min={0} label="WACC spread" onChange={(v) => set({ mc: { ...inp.mc, w: v } })} /></label>
              <label>Terminal growth spread (± pts)<Num value={inp.mc.t} step={0.25} min={0} label="Terminal growth spread" onChange={(v) => set({ mc: { ...inp.mc, t: v } })} /></label>
              <button type="button" className="btn small" onClick={() => set({ mc: { ...inp.mc, seed: inp.mc.seed + 1 } })}>Run again</button>
            </div>
            <div className="minis">
              <div className="mini"><span className="k">Worth more than the price</span><span className="v num">{pct(MC.probAbove, 0)}</span><span className="n">of runs above {money(inp.price, cur)}</span></div>
              <div className="mini"><span className="k">Median outcome</span><span className="v num">{money(MC.p50, cur)}</span><span className="n">{pct(MC.p50 / inp.price - 1, 1, true)} vs price</span></div>
              <div className="mini"><span className="k">Downside (10th pct)</span><span className="v num">{money(MC.p10, cur)}</span><span className="n">1 run in 10 is lower</span></div>
              <div className="mini"><span className="k">Upside (90th pct)</span><span className="v num">{money(MC.p90, cur)}</span><span className="n">1 run in 10 is higher</span></div>
            </div>
            <Histogram vals={MC.vals} price={inp.price} target={R.ok ? R.pt : null} currency={cur} targetLabel={targetLabel} />
          </section>

          <section className="card section" aria-labelledby="fcf-h">
            <div className="section-head"><h2 id="fcf-h">Free cash flow, {inp.scenario} case</h2><p>FCF = EBIT × (1 − tax) + D&amp;A − capex − increase in working capital, discounted at the WACC from today to each fiscal year end.</p></div>
            <div className="legend"><span><i className="key-box" style={{ background: "var(--s1)" }} />Free cash flow</span><span><i className="key-box" style={{ background: "var(--s1-soft)" }} />Present value</span></div>
            <FcfChart years={R.fyLabels} fcf={R.live.fcf} pv={R.live.pv} df={R.live.df} currency={cur} />
            <div className="scroll"><table className="data"><thead><tr><th>{u.label}</th>{R.fyLabels.map((y) => <th key={y}>{y}</th>)}</tr></thead><tbody>
              {([["Revenue", R.live.rev], ["EBIT", R.live.ebit], ["NOPAT = EBIT × (1 − tax)", R.live.nopat], ["+ D&A", R.live.da], ["− Capex", R.live.capex], ["− Increase in working capital", R.live.wcInc], ["Free cash flow", R.live.fcf, "em"], ["Present value", R.live.pv, "em"]] as [string, number[], string?][]).map(([l, v, c]) => <tr key={l} className={c}><td>{l}</td>{v.map((x, i) => <td key={i}>{big(x, cur)}</td>)}</tr>)}
              <tr><td>Years to year end (t)</td>{R.t.map((x, i) => <td key={i}>{x.toFixed(2)}</td>)}</tr>
            </tbody></table></div>
          </section>

          <section className="card section" aria-labelledby="br-h">
            <div className="section-head"><h2 id="br-h">From cash flows to a share price</h2><p>Enterprise value plus cash, minus debt, leases, minority interests and cash already returned to shareholders since the balance sheet, divided by the shares.</p></div>
            <div className="two">
              <dl className="bridge">
                <dt className="sub">Present value of FCF</dt><dd>{big(R.live.sumPv, cur)}</dd>
                <dt className="sub">Present value of terminal value</dt><dd>{big(R.live.pvTv, cur)}</dd>
                <dt className="sum">Enterprise value</dt><dd className="sum">{big(R.live.ev, cur)}</dd>
                <dt className="sub">+ Cash and short-term investments ({dateLabel(data.bridge.date)})</dt><dd>{big(data.bridge.cash, cur)}</dd>
                <dt className="sub">− Borrowings</dt><dd>{big(data.bridge.borrowings, cur)}</dd>
                <dt className="sub">− Lease liabilities</dt><dd>{big(data.bridge.leases, cur)}</dd>
                <dt className="sub">− Minority interests</dt><dd>{big(data.bridge.nci, cur)}</dd>
                <dt className="sub">− Dividends since the balance sheet</dt><dd>{big(data.bridge.returned, cur)}</dd>
                <dt className="sum">Equity value</dt><dd className="sum">{big(R.live.equity, cur)}</dd>
                <dt className="sub">÷ Shares outstanding</dt><dd>{(data.shares / (cur === "INR" ? 1e7 : 1e6)).toLocaleString("en-US", { maximumFractionDigits: 2 })} {cur === "INR" ? "crore" : "mn"}</dd>
                <dt className="sum">Value per share</dt><dd className="sum">{R.live.valid ? money(R.live.vps, cur) : "–"}</dd>
              </dl>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <p className="small muted">All amounts in {u.label}. {data.bridge.returnedNote}.</p>
                <div className="mini"><span className="k">Terminal value share of enterprise value</span><span className="v num">{pct(R.live.tvShare, 1)}</span><span className="n">{R.live.tvShare > 0.75 ? "Above 75%: most of the value comes after the forecast years." : "The forecast years carry a good share of the value."}</span></div>
                {data.fxNote && <p className="small muted">{data.fxNote}</p>}
              </div>
            </div>
          </section>

          <section className="card section" aria-labelledby="se-h">
            <div className="section-head"><h2 id="se-h">Sensitivity: WACC against terminal growth</h2><p>DCF value per share, {inp.scenario} case. Blue cells sit above today&apos;s price, red cells below; the outlined cell is your current pair.</p></div>
            <div className="scroll">
              <table className="heat">
                <thead><tr><th>g ↓ · WACC →</th>{R.sensW.map((w) => <th key={w} scope="col">{pct(w, 2)}</th>)}</tr></thead>
                <tbody>
                  {R.sens.map((row, j) => (
                    <tr key={j}><th scope="row">{pct(R.sensG[j], 1)}</th>
                      {row.map((v, i) => {
                        if (!Number.isFinite(v)) return <td key={i} style={{ background: "var(--div-mid)" }}>n/a</td>;
                        const f = Math.round(Math.min(1, Math.abs(v / inp.price - 1) / 0.4) * 90);
                        const pos = v >= inp.price;
                        return <td key={i} className={i === 2 && j === 2 ? "centre" : ""} style={{ background: `color-mix(in oklab, var(${pos ? "--div-pos" : "--div-neg"}) ${f}%, var(--div-mid))`, color: f >= 55 ? "#ffffff" : "var(--ink)" }} title={`WACC ${pct(R.sensW[i], 2)}, g ${pct(R.sensG[j], 1)}: ${money0(v, cur)} (${pct(v / inp.price - 1, 1, true)} vs price)`}>{money0(v, cur)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          </>}

          <section className="card section" aria-labelledby="cp-h">
            <div className="section-head"><h2 id="cp-h">Peers</h2><p>Found from Yahoo&apos;s related stocks in the same industry; multiples rebuilt here so currencies match. Untick a peer to drop it, or add your own.</p></div>
            {R.peers.length === 0 && <p className="warnbox"><b>No peers found automatically</b><span>Add two or more companies from the same industry below, so the peer value can be calculated.</span></p>}
            <div className="scroll"><table className="data">
              <thead><tr><th>Company</th><th>In median</th><th>EV/EBITDA</th><th>P/E</th><th>EV/Sales</th><th>P/B</th><th>Op. margin</th><th>Rev. growth</th></tr></thead>
              <tbody>
                {R.peers.map((p) => (
                  <tr key={p.symbol} className={p.included ? "" : "off"}>
                    <td className="left"><b style={{ fontWeight: 600 }}>{p.name}</b> <span className="muted mono small">{p.symbol}</span>{p.industry && <div className="muted small">{p.industry}</div>}</td>
                    <td><input type="checkbox" className="check" style={{ width: 18, height: 18, accentColor: "var(--accent)" }} checked={p.included} aria-label={`Include ${p.name}`} onChange={(e) => set({ peers: { ...inp.peers, [p.symbol]: e.target.checked } })} /></td>
                    <td>{mult(p.evEbitda)}</td><td>{mult(p.pe)}</td><td>{mult(p.evSales)}</td><td>{mult(p.pb)}</td><td>{pct(p.margin)}</td><td>{pct(p.growth)}</td>
                  </tr>
                ))}
                <tr className="em"><td className="left">Median of included</td><td>{R.peers.filter((p) => p.included).length}</td><td>{mult(R.stats.evE.med)}</td><td>{mult(R.stats.pe.med)}</td><td>{mult(R.stats.evS.med)}</td><td>{mult(R.stats.pb.med)}</td><td /><td /></tr>
                <tr className="em hl"><td className="left">{data.name}</td><td>–</td><td>{mult(R.subject.evE)}</td><td>{mult(R.subject.pe)}</td><td>{mult(R.subject.evS)}</td><td>{mult(R.subject.pb)}</td><td>{pct(H.marginLast)}</td><td>{pct(H.growthLast)}</td></tr>
              </tbody>
            </table></div>
            <div className="no-print" style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 520 }}>
              <span className="label">Add a peer</span>
              <PickBox onPick={addPeer} />
              {peerMsg && <span className="note" role="status">{peerMsg}</span>}
            </div>
            <div className="scroll"><table className="data">
              <thead><tr><th>Implied value per share</th><th>25th pct</th><th>Median</th><th>75th pct</th></tr></thead>
              <tbody>
                {([["EV/EBITDA × EBITDA + net cash", R.implied.evE, R.stats.evE], ["P/E × earnings per share", R.implied.pe, R.stats.pe], ["P/B × book value per share", R.implied.pb, R.stats.pb], ["EV/Sales × revenue + net cash (check only)", R.implied.evS, R.stats.evS]] as const).map(([l, v, m]) => (
                  <tr key={l}><td>{l}</td><td>{money0(v.q1, cur)} <span className="muted">({mult(m.q1)})</span></td><td><b>{money0(v.med, cur)}</b> <span className="muted">({mult(m.med)})</span></td><td>{money0(v.q3, cur)} <span className="muted">({mult(m.q3)})</span></td></tr>
                ))}
                <tr className="em hl"><td>Peer value ({R.compsMethod})</td><td /><td>{money(R.compsValue, cur)}</td><td /></tr>
              </tbody>
            </table></div>
          </section>

          <Bands data={data} price={inp.price} />

          <section className="card section" aria-labelledby="pi-h">
            <div className="section-head"><h2 id="pi-h">Pitch summary</h2><p>Three pieces of evidence that lead to a view. The client summary button copies all of this as text.</p></div>
            <div className="evidence">
              <div className="ev"><span className="label">1 · Margins</span><span className="v num">{Number.isFinite(R.marginChangeBps) ? `${R.marginChangeBps > 0 ? "+" : ""}${Math.round(R.marginChangeBps)} bps` : "–"}</span><span className="w">EBIT margin change from the last reported year ({pct(H.marginLast)}) to {R.fyLabels[FORECAST_YEARS - 1]} ({st.margin[FORECAST_YEARS - 1].toFixed(1)}%)</span></div>
              <div className="ev"><span className="label">2 · Valuation vs peers</span><span className="v num">{pct(R.discount, 1, true)}</span><span className="w">{data.name} {R.discountMetric} against the peer median; negative means cheaper</span></div>
              <div className="ev"><span className="label">3 · Cash</span><span className="v num">{pct(R.fcfYield, 1)}</span><span className="w">FCF yield: {R.fyLabels[0]} free cash flow ÷ market value at today&apos;s price</span></div>
            </div>
            <pre className="small" style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-ui)", background: "var(--bg-raise)", padding: 14, borderRadius: 10, margin: 0, lineHeight: 1.55 }}>{summaryText()}</pre>
          </section>

          <section className="card section" aria-labelledby="ck-h">
            <div className="section-head"><h2 id="ck-h">Model checks</h2><p>{checksPassed} pass, {checksFailed} to review.</p></div>
            <ul className="checks">
              {R.checks.map((c) => (
                <li key={c.what}>
                  <span className={`badge ${c.pass === null ? "skip" : c.pass ? "ok" : "bad"}`}>{c.pass === null ? "N/A" : c.pass ? "PASS" : "CHECK"}</span>
                  <span>{c.what}</span>
                  {c.pass === false && <span className="fix">{c.fix}</span>}
                </li>
              ))}
            </ul>
          </section>

          <section className="card section" aria-labelledby="dt-h">
            <div className="section-head"><h2 id="dt-h">Company data</h2><p>What the model uses, from {data.source}. Edit any number that looks wrong; your edits stay in this browser and are marked.</p></div>
            <div className="scroll"><table className="data">
              <thead><tr><th>{u.label}</th>{histYears.map((y) => <th key={y}>{y}</th>)}<th>Avg ratio</th></tr></thead>
              <tbody>
                {([["revenue", "Revenue"], ["ebit", "EBIT (operating profit)"], ["da", "D&A"], ["pbt", "Profit before tax"], ["tax", "Tax"], ["capex", "Capex"], ["wcInc", "Increase in working capital"]] as const).map(([f, l]) => (
                  <tr key={f}><td>{l}</td>
                    {data.history.map((y, i) => <td key={i}><Num className="in" value={+(y[f] / u.div).toFixed(2)} step="any" flag={overrides[`h:${i}:${f}`] !== undefined} label={`${l} ${y.label}`} onChange={(v) => setOv(`h:${i}:${f}`, v, u.div)} /></td>)}
                    <td>{f === "revenue" ? `growth ${pct(H.growth)}` : f === "ebit" ? `margin ${pct(H.margin)}` : f === "tax" ? `rate ${pct(H.tax)}` : f === "da" ? pct(H.da) : f === "capex" ? pct(H.capex) : f === "wcInc" ? pct(H.wc) + " of Δrev" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="two">
              <div className="scroll"><table className="data"><tbody>
                {([["b", "cash", "Cash and short-term investments"], ["b", "borrowings", "Borrowings"], ["b", "leases", "Lease liabilities"], ["b", "nci", "Minority interests"], ["b", "returned", "Dividends since the balance sheet"]] as const).map(([k, f, l]) => (
                  <tr key={f}><td>{l} ({u.label})</td><td><Num value={+((data.bridge[f] as number) / u.div).toFixed(2)} step="any" flag={overrides[`${k}:${f}`] !== undefined} label={l} onChange={(v) => setOv(`${k}:${f}`, v, u.div)} /></td></tr>
                ))}
              </tbody></table></div>
              <div className="scroll"><table className="data"><tbody>
                {([["revenue", "Revenue, trailing 12 months"], ["ebitda", "EBITDA, trailing 12 months"], ["netIncome", "Net income, trailing 12 months"]] as const).map(([f, l]) => (
                  <tr key={f}><td>{l} ({u.label})</td><td><Num value={+(data.ttm[f] / u.div).toFixed(2)} step="any" flag={overrides[`t:${f}`] !== undefined} label={l} onChange={(v) => setOv(`t:${f}`, v, u.div)} /></td></tr>
                ))}
                <tr><td>Shares outstanding ({cur === "INR" ? "crore" : "mn"})</td><td><Num value={+(data.shares / (cur === "INR" ? 1e7 : 1e6)).toFixed(3)} step="any" flag={overrides["s:shares"] !== undefined} label="Shares outstanding" onChange={(v) => setOv("s:shares", v, cur === "INR" ? 1e7 : 1e6)} /></td></tr>
              </tbody></table></div>
            </div>
            {Object.keys(overrides).length > 0 && <button type="button" className="btn small no-print" style={{ alignSelf: "flex-start" }} onClick={() => setOverrides({})}>Undo my data edits ({Object.keys(overrides).length})</button>}
            <p className="note">{marchFY ? "FY labels follow Indian fiscal years ending in March." : "Years are calendar fiscal years."} {data.fxNote ?? ""} Shares: {data.shares.toLocaleString("en-US")}. Price {money(data.price, cur)} at {new Date(data.priceTime).toUTCString()}.</p>
          </section>
        </div>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function PickBox({ onPick }: { onPick: (symbol: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ symbol: string; name: string; exchange: string }[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) return;
    const ctl = new AbortController();
    const h = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(t)}`, { signal: ctl.signal }).then((r) => r.json()).then((j) => { setHits(j.hits ?? []); setActive(0); }).catch(() => {});
    }, 220);
    return () => { clearTimeout(h); ctl.abort(); };
  }, [q]);
  const pick = (s: string) => { onPick(s); setQ(""); setHits([]); };
  return (
    <div className="combo compact">
      <svg className="icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      <input role="combobox" aria-expanded={hits.length > 0} aria-controls="peer-list" aria-activedescendant={hits.length ? `peer-opt-${active}` : undefined} aria-label="Search a company to add as a peer" placeholder="Company or ticker, e.g. SHEL.L" value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) setHits([]); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); if (hits[active]) pick(hits[active].symbol); else if (q.trim()) pick(q.trim().toUpperCase()); }
          else if (e.key === "Escape") setHits([]);
        }} />
      {hits.length > 0 && (
        <ul id="peer-list" role="listbox" aria-label="Matching companies">
          {hits.map((h, i) => <li key={h.symbol} id={`peer-opt-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(h.symbol); }}><b>{h.name}</b><span>{h.symbol}</span><small>{h.exchange}</small></li>)}
        </ul>
      )}
    </div>
  );
}
