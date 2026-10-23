import "server-only";
import { cached, DAY } from "./cache";

export interface NseListing { symbol: string; name: string; series: string; listed: string; isin: string }

const URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv";

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === "," && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseEquityList(csv: string): NseListing[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const head = parseCsvLine(lines[0]).map((h) => h.toUpperCase());
  const idx = (name: string) => head.findIndex((h) => h.includes(name));
  const iS = idx("SYMBOL"), iN = idx("NAME"), iSe = idx("SERIES"), iD = idx("DATE OF LISTING"), iI = idx("ISIN");
  return lines.slice(1).map((l) => {
    const c = parseCsvLine(l);
    return { symbol: c[iS], name: c[iN], series: c[iSe], listed: c[iD], isin: c[iI] };
  }).filter((r) => r.symbol && r.name);
}

/** Every equity listed on the National Stock Exchange of India, from NSE's own daily file. */
export function getNseListings(): Promise<NseListing[]> {
  return cached("nse:equity_l", DAY, async () => {
    const res = await fetch(URL, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36", Accept: "text/csv,*/*" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`NSE list returned ${res.status}`);
    const list = parseEquityList(await res.text());
    if (list.length < 500) throw new Error("NSE list looks incomplete");
    return list.sort((a, b) => a.name.localeCompare(b.name));
  });
}
