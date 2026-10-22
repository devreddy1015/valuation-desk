"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Hit { symbol: string; name: string; exchange: string }

/** Company search as an ARIA combobox: type, arrow through results, Enter to open. */
export default function SearchBox({ compact = false, autoFocus = false, placeholder = "Search any listed company or ticker: Infosys, RELIANCE.NS, AAPL, 7203.T…" }: { compact?: boolean; autoFocus?: boolean; placeholder?: string }) {
  const router = useRouter();
  const id = useId();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
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
        const data = (await res.json()) as { hits: Hit[] };
        setHits(data.hits);
        setActive(data.hits.length ? 0 : -1);
        setStatus(data.hits.length ? "idle" : "empty");
        setOpen(true);
      } catch (e) {
        if ((e as Error).name !== "AbortError") { setStatus("error"); setOpen(true); }
      }
    }, 220);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const go = (symbol: string) => {
    setOpen(false);
    setQ("");
    router.push(`/stock/${encodeURIComponent(symbol)}`);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(hits.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0 && hits[active]) go(hits[active].symbol);
      else if (/^[A-Za-z0-9^.\-=]{1,20}$/.test(q.trim())) go(q.trim().toUpperCase());
    } else if (e.key === "Escape") { setOpen(false); }
  };

  const listId = `${id}-list`;
  return (
    <div className={`combo${compact ? " compact" : ""}`} ref={box}>
      <svg className="icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
        aria-label="Search companies by name or ticker"
        placeholder={placeholder}
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) { setHits([]); setStatus("idle"); setOpen(false); } }}
        onFocus={() => { if (hits.length) setOpen(true); }}
        onKeyDown={onKey}
        autoComplete="off"
        spellCheck={false}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label="Matching companies">
          {status === "loading" && hits.length === 0 && <li className="status" role="presentation">Searching…</li>}
          {status === "error" && <li className="status" role="presentation">Search is unavailable right now. Type a full ticker such as INFY.NS and press Enter.</li>}
          {status === "empty" && <li className="status" role="presentation">No listed companies match. Try the ticker with its exchange suffix, such as .NS for NSE or .BO for BSE.</li>}
          {hits.map((h, i) => (
            <li key={h.symbol} id={`${id}-opt-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); go(h.symbol); }} onMouseEnter={() => setActive(i)}>
              <b>{h.name}</b>
              <span>{h.symbol}</span>
              <small>{h.exchange}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
