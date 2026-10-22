"use client";
import { useEffect, useId, useRef, useState } from "react";

export interface PickHit { symbol: string; name: string; exchange: string; type?: string }

/**
 * Company search as an ARIA combobox that hands the choice to the parent instead of navigating:
 * type, arrow through the results, Enter or click to pick. Enter on a typed ticker with no result
 * open picks it as written, so symbols search does not know can still be added.
 */
export default function SymbolPicker({ onPick, label = "Company or ticker", hideLabel = false, placeholder = "Search: Infosys, RELIANCE.NS, AAPL…", compact = false, describedBy, autoFocus = false }: {
  onPick: (hit: PickHit) => void; label?: string; hideLabel?: boolean; placeholder?: string; compact?: boolean; describedBy?: string; autoFocus?: boolean;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PickHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "empty">("idle");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setStatus("loading");
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { hits: PickHit[] };
        setHits(data.hits);
        setActive(data.hits.length ? 0 : -1);
        setStatus(data.hits.length ? "idle" : "empty");
        setOpen(true);
      } catch (e) {
        if ((e as Error).name !== "AbortError") { setStatus("error"); setHits([]); setOpen(true); }
      }
    }, 220);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (h: PickHit) => {
    setOpen(false);
    setQ("");
    setHits([]);
    setStatus("idle");
    onPick(h);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (hits.length) { setOpen(true); setActive((a) => Math.min(hits.length - 1, a + 1)); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Home" && open && hits.length) { e.preventDefault(); setActive(0); }
    else if (e.key === "End" && open && hits.length) { e.preventDefault(); setActive(hits.length - 1); }
    else if (e.key === "Enter") {
      e.preventDefault(); // never submit the surrounding form from the search box
      const typed = q.trim().toUpperCase();
      if (open && active >= 0 && hits[active]) pick(hits[active]);
      else if (/^[A-Z0-9^.\-=&]{1,24}$/.test(typed)) pick({ symbol: typed, name: typed, exchange: "" });
    } else if (e.key === "Escape") { if (open) { e.preventDefault(); setOpen(false); } else if (q) setQ(""); }
    else if (e.key === "Tab") setOpen(false);
  };

  const listId = `${id}-list`, inputId = `${id}-input`;
  const message = status === "loading" ? "Searching…"
    : status === "error" ? "Search is unavailable right now. Type a full ticker such as INFY.NS and press Enter."
    : status === "empty" ? "No listed companies match. Try the ticker with its exchange suffix, such as .NS for NSE or .BO for BSE, and press Enter."
    : open && hits.length ? `${hits.length} result${hits.length > 1 ? "s" : ""}. Use the up and down arrows, then Enter to choose.` : "";
  return (
    <div className="combo-field" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label htmlFor={inputId} className={hideLabel ? "sr-only" : undefined} style={hideLabel ? undefined : { fontSize: 13.5 }}>{label}</label>
      <div className={`combo${compact ? " compact" : ""}`} ref={box}>
        <svg className="icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 && hits[active] ? `${id}-opt-${active}` : undefined}
          aria-describedby={describedBy}
          placeholder={placeholder}
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) { setHits([]); setStatus("idle"); setOpen(false); } }}
          onFocus={() => { if (hits.length) setOpen(true); }}
          onKeyDown={onKey}
          autoComplete="off"
          spellCheck={false}
        />
        <ul id={listId} role="listbox" aria-label="Matching companies" hidden={!open}>
          {status !== "idle" && hits.length === 0 && <li className="status" role="presentation">{message}</li>}
          {hits.map((h, i) => (
            <li key={h.symbol} id={`${id}-opt-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(h); }} onMouseEnter={() => setActive(i)}>
              <b>{h.name}</b>
              <span>{h.symbol}</span>
              <small>{h.exchange}</small>
            </li>
          ))}
        </ul>
      </div>
      <span className="sr-only" role="status" aria-live="polite">{message}</span>
    </div>
  );
}
