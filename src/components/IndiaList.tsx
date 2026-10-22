"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { NseListing } from "@/lib/server/nse";

const PAGE = 60;
const LETTERS = ["All", "0-9", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

/** Every NSE-listed company: filter by name, symbol or ISIN, jump by letter, page through. */
export default function IndiaList({ listings }: { listings: NseListing[] }) {
  const [q, setQ] = useState("");
  const [letter, setLetter] = useState("All");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return listings.filter((l) => {
      if (letter !== "All") {
        const c = l.name[0]?.toUpperCase() ?? "";
        if (letter === "0-9" ? !/[0-9]/.test(c) : c !== letter) return false;
      }
      return !t || l.name.toLowerCase().includes(t) || l.symbol.toLowerCase().includes(t) || l.isin.toLowerCase() === t;
    });
  }, [listings, q, letter]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const p = Math.min(page, pages - 1);
  const rows = filtered.slice(p * PAGE, p * PAGE + PAGE);
  return (
    <section className="card section" aria-labelledby="in-h">
      <div className="section-head">
        <h2 id="in-h">{filtered.length.toLocaleString("en-IN")} companies</h2>
        <p>Open any company to value it with live Yahoo Finance data (NSE symbol plus .NS).</p>
      </div>
      <div className="field" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
        <label htmlFor="in-q" className="sr-only">Filter by company name, NSE symbol or ISIN</label>
        <input id="in-q" className="in" style={{ textAlign: "left", height: 40, color: "var(--ink)" }} placeholder="Filter by name, symbol or ISIN" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
      </div>
      <div className="az" role="group" aria-label="Jump to letter">
        {LETTERS.map((L) => <button key={L} type="button" aria-pressed={letter === L} onClick={() => { setLetter(L); setPage(0); }}>{L}</button>)}
      </div>
      <div className="scroll">
        <table className="data">
          <thead><tr><th>Company</th><th className="left">NSE symbol</th><th className="left">Series</th><th className="left">Listed</th><th className="left">ISIN</th><th><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.symbol + l.series}>
                <td style={{ whiteSpace: "normal" }}>{l.name}</td>
                <td className="left mono">{l.symbol}</td>
                <td className="left mono">{l.series}</td>
                <td className="left">{l.listed}</td>
                <td className="left mono small">{l.isin}</td>
                <td><Link className="btn small" href={`/stock/${encodeURIComponent(l.symbol + ".NS")}`} aria-label={`Value ${l.name}`}>Value</Link></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="left muted">No company matches that filter.</td></tr>}
          </tbody>
        </table>
      </div>
      <nav className="pager" aria-label="Pages">
        <span className="muted small">Page {p + 1} of {pages}</span>
        <button type="button" className="btn small" disabled={p === 0} onClick={() => setPage(p - 1)}>Previous</button>
        <button type="button" className="btn small" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>Next</button>
      </nav>
    </section>
  );
}
