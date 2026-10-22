import "server-only";
import { cached, DAY } from "./cache";
import { DataError } from "./yahoo";
import type { Universe, UniverseInfo, UniverseMember } from "../scanTypes";

// Lists of stocks the scanner can rank. NSE indices come from NSE's own constituent files
// (refreshed daily); the Dow is a short hard-coded list because it changes only now and then.

export type UniverseFamily = "India · broad market" | "India · sectors" | "India · themes" | "United States";
export const FAMILIES: UniverseFamily[] = ["India · broad market", "India · sectors", "India · themes", "United States"];

/** A registry entry as the picker shows it. */
export interface UniverseListing extends UniverseInfo { family: UniverseFamily }

interface Def { id: string; name: string; description: string; family: UniverseFamily; size: number | null; csv?: string; members?: UniverseMember[] }

const nse = (id: string, name: string, family: UniverseFamily, description: string, size: number | null = null): Def => ({ id, name, family, description, size, csv: id });

// Sizes are given only where the index rules fix the count; sector indices vary.
const NSE: Def[] = [
  nse("nifty50", "Nifty 50", "India · broad market", "India's 50 largest, most traded companies on NSE.", 50),
  nse("niftynext50", "Nifty Next 50", "India · broad market", "The 50 companies ranked just after the Nifty 50: the next large caps.", 50),
  nse("nifty100", "Nifty 100", "India · broad market", "The Nifty 50 and Nifty Next 50 together.", 100),
  nse("niftymidcap50", "Nifty Midcap 50", "India · broad market", "The 50 largest midcaps with traded derivatives.", 50),
  nse("niftymidcap100", "Nifty Midcap 100", "India · broad market", "Midcaps ranked 101 to 200 by market value.", 100),
  nse("niftymidcap150", "Nifty Midcap 150", "India · broad market", "The full midcap band, ranked 101 to 250 by market value.", 150),
  nse("niftysmallcap50", "Nifty Smallcap 50", "India · broad market", "The 50 largest, most traded smallcaps.", 50),
  nse("niftysmallcap100", "Nifty Smallcap 100", "India · broad market", "Smallcaps ranked 251 to 350 by market value.", 100),
  nse("niftybank", "Nifty Bank", "India · sectors", "The largest and most traded banks."),
  nse("niftypsubank", "Nifty PSU Bank", "India · sectors", "Government-owned (public sector) banks."),
  nse("niftyfinance", "Nifty Financial Services", "India · sectors", "Banks, lenders, insurers, brokers and exchanges."),
  nse("niftyit", "Nifty IT", "India · sectors", "IT services and software companies."),
  nse("niftypharma", "Nifty Pharma", "India · sectors", "Drug makers."),
  nse("niftyhealthcare", "Nifty Healthcare", "India · sectors", "Drug makers, hospitals and diagnostics."),
  nse("niftyauto", "Nifty Auto", "India · sectors", "Car, truck and two-wheeler makers and their suppliers."),
  nse("niftyfmcg", "Nifty FMCG", "India · sectors", "Fast-moving consumer goods: food, drinks, tobacco and household products."),
  nse("niftymetal", "Nifty Metal", "India · sectors", "Steel, aluminium, zinc and mining."),
  nse("niftyenergy", "Nifty Energy", "India · sectors", "Oil, gas, power and capital goods for the energy sector."),
  nse("niftyoilgas", "Nifty Oil & Gas", "India · sectors", "Oil and gas producers, refiners and distributors."),
  nse("niftyrealty", "Nifty Realty", "India · sectors", "Property developers."),
  nse("niftymedia", "Nifty Media", "India · sectors", "Broadcasting, film, music and publishing."),
  nse("niftyconsumerdurables", "Nifty Consumer Durables", "India · sectors", "Appliances, electricals, jewellery and other durable goods."),
  nse("niftyinfra", "Nifty Infrastructure", "India · themes", "Power, telecom, ports, roads, construction and cement."),
  nse("niftycommodities", "Nifty Commodities", "India · themes", "Commodity businesses: oil, metals, cement, power and chemicals."),
  nse("niftycpse", "Nifty CPSE", "India · themes", "Central public sector enterprises, the basket behind the CPSE ETF."),
  nse("niftypse", "Nifty PSE", "India · themes", "Public sector enterprises: companies where the government holds a majority."),
  nse("niftymnc", "Nifty MNC", "India · themes", "Indian-listed companies majority-owned or controlled by foreign parents."),
];

// Members checked on 22 Oct 2026. The last change was Alphabet replacing Verizon before the open on
// 29 Jun 2026 (S&P Dow Jones Indices, 23 Jun 2026); the one before was Nvidia and Sherwin-Williams in Nov 2024.
const DOW_AS_OF = "22 Oct 2026";
const DOW: UniverseMember[] = ([
  ["MMM", "3M"], ["AXP", "American Express"], ["AMGN", "Amgen"], ["AMZN", "Amazon"], ["AAPL", "Apple"],
  ["BA", "Boeing"], ["CAT", "Caterpillar"], ["CVX", "Chevron"], ["CSCO", "Cisco Systems"], ["KO", "Coca-Cola"],
  ["DIS", "Walt Disney"], ["GOOGL", "Alphabet"], ["GS", "Goldman Sachs"], ["HD", "Home Depot"], ["HON", "Honeywell"],
  ["IBM", "IBM"], ["JNJ", "Johnson & Johnson"], ["JPM", "JPMorgan Chase"], ["MCD", "McDonald's"], ["MRK", "Merck & Co."],
  ["MSFT", "Microsoft"], ["NKE", "Nike"], ["NVDA", "Nvidia"], ["PG", "Procter & Gamble"], ["CRM", "Salesforce"],
  ["SHW", "Sherwin-Williams"], ["TRV", "Travelers"], ["UNH", "UnitedHealth Group"], ["V", "Visa"], ["WMT", "Walmart"],
] as const).map(([symbol, name]) => ({ symbol, name }));

const DEFS: Def[] = [
  ...NSE,
  {
    id: "dow30", name: "Dow Jones Industrial Average (30)", family: "United States", size: DOW.length, members: DOW,
    description: `The 30 US blue chips in the Dow, members as of ${DOW_AS_OF} (Alphabet replaced Verizon on 29 Jun 2026).`,
  },
];
const BY_ID = new Map(DEFS.map((d) => [d.id, d]));

export function listUniverses(): UniverseListing[] {
  return DEFS.map(({ id, name, description, size, family }) => ({ id, name, description, size, family }));
}
export function isUniverseId(id: string): boolean {
  return BY_ID.has(id);
}

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36";
const indexCsvUrl = (id: string) => `https://archives.nseindia.com/content/indices/ind_${id}list.csv`;

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

/** NSE's constituent file (Company Name, Industry, Symbol, Series, ISIN Code) as Yahoo symbols. */
export function parseIndexCsv(csv: string): UniverseMember[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = parseCsvLine(lines[0]).map((h) => h.toUpperCase());
  const iS = head.indexOf("SYMBOL"), iN = head.findIndex((h) => h.includes("COMPANY")), iI = head.indexOf("INDUSTRY");
  if (iS < 0 || iN < 0) return [];
  const seen = new Set<string>();
  const out: UniverseMember[] = [];
  for (const l of lines.slice(1)) {
    const c = parseCsvLine(l);
    const sym = (c[iS] ?? "").toUpperCase();
    if (!/^[A-Z0-9&-]{1,20}$/.test(sym) || seen.has(sym)) continue;
    seen.add(sym);
    out.push({ symbol: `${sym}.NS`, name: c[iN] || sym, ...(iI >= 0 && c[iI] ? { group: c[iI] } : {}) });
  }
  return out;
}

/** A universe with its members; NSE files are cached for a day. Throws DataError. */
export function getUniverse(id: string): Promise<Universe> {
  const d = BY_ID.get(id);
  if (!d) return Promise.reject(new DataError(`No list called "${id}"`, "not_found"));
  if (d.members) {
    return Promise.resolve({ id, name: d.name, description: d.description, source: `S&P Dow Jones Indices announcements; list checked ${DOW_AS_OF}`, members: d.members });
  }
  const url = indexCsvUrl(d.csv!);
  return cached("universe:" + id, DAY, async () => {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/csv,*/*" }, cache: "no-store" }).catch(() => null);
    if (!res?.ok) throw new DataError(`NSE's ${d.name} file did not load${res ? ` (status ${res.status})` : ""}`, "upstream");
    const members = parseIndexCsv(await res.text());
    if (members.length < 5) throw new DataError(`NSE's ${d.name} file looks incomplete`, "upstream");
    return { id, name: d.name, description: d.description, source: `NSE index constituents (${url}), refreshed daily`, members: members.slice(0, 150) };
  });
}
