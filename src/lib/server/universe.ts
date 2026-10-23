import "server-only";
import { cached, DAY, MIN } from "./cache";
import { DataError, fxSpot, quotesFor } from "./yahoo";
import { TOP_MARKETS, type TopMarket } from "../topMarkets";
import type { Universe, UniverseInfo, UniverseMember } from "../scanTypes";

// Lists of stocks the scanner can rank. NSE indices come from NSE's own constituent files
// (refreshed daily); the Dow is a short hard-coded list because it changes only now and then.

export type UniverseFamily = "India · broad market" | "India · sectors" | "India · themes" | "United States" | "United Kingdom" | "Japan" | "Germany" | "China";
export const FAMILIES: UniverseFamily[] = ["India · broad market", "India · sectors", "India · themes", "United States", "United Kingdom", "Japan", "Germany", "China"];

/** A registry entry as the picker shows it. */
export interface UniverseListing extends UniverseInfo { family: UniverseFamily }

interface Def { id: string; name: string; description: string; family: UniverseFamily; size: number | null; csv?: string; members?: UniverseMember[]; ranked?: TopMarket }

const nse = (id: string, name: string, family: UniverseFamily, description: string, size: number | null = null): Def => ({ id, name, family, description, size, csv: id });

// Sizes are given only where the index rules fix the count; sector indices vary.
const NSE: Def[] = [
  { id: "top50", name: "India's 50 most valuable", family: "India · broad market", size: 50, ranked: "india", description: "The 50 largest Indian companies by today's market value, ranked live from the Nifty 200." },
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

// Candidates for the US ranking: about 115 of the largest companies headquartered in the US, one share
// class each (GOOGL, BRK-B), with their sector. Yahoo has no free "largest companies" list, so the top 50
// are ranked live from these; anything that grows into the top 50 from outside needs adding here.
// US-listed companies domiciled abroad (Linde, Accenture, Medtronic, Eaton, Chubb) are left out. Checked 23 Oct 2026.
const US_AS_OF = "23 Oct 2026";
const US_CANDIDATES: [string, string][] = [
  ...["AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CRM", "ADBE", "AMD", "CSCO", "IBM", "INTU", "QCOM", "TXN", "NOW", "AMAT", "MU", "LRCX", "KLAC", "ADI", "PANW", "CRWD", "PLTR", "ANET", "APP", "SNPS", "CDNS", "INTC", "DELL", "APH"].map((x): [string, string] => [x, "Technology"]),
  ...["GOOGL", "META", "NFLX", "TMUS", "T", "VZ", "DIS", "CMCSA"].map((x): [string, string] => [x, "Communication Services"]),
  ...["AMZN", "TSLA", "HD", "MCD", "LOW", "TJX", "BKNG", "SBUX", "NKE", "UBER"].map((x): [string, string] => [x, "Consumer Cyclical"]),
  ...["WMT", "COST", "PG", "KO", "PEP", "PM", "MO", "MDLZ", "CL"].map((x): [string, string] => [x, "Consumer Defensive"]),
  ...["BRK-B", "JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "C", "AXP", "SCHW", "BLK", "SPGI", "PGR", "COF", "BX", "KKR", "ICE", "CME", "MMC", "HOOD"].map((x): [string, string] => [x, "Financial Services"]),
  ...["LLY", "UNH", "JNJ", "ABBV", "MRK", "TMO", "ABT", "ISRG", "AMGN", "PFE", "DHR", "GILD", "BSX", "VRTX", "SYK", "BMY", "CVS", "ELV", "REGN"].map((x): [string, string] => [x, "Healthcare"]),
  ...["GE", "GEV", "CAT", "RTX", "HON", "UNP", "BA", "DE", "LMT", "UPS", "ADP", "WM", "PH", "GD", "NOC"].map((x): [string, string] => [x, "Industrials"]),
  ...["XOM", "CVX", "COP"].map((x): [string, string] => [x, "Energy"]),
  ...["NEE", "SO", "DUK", "CEG"].map((x): [string, string] => [x, "Utilities"]),
  ...["PLD", "AMT", "EQIX", "WELL"].map((x): [string, string] => [x, "Real Estate"]),
  ["SHW", "Basic Materials"],
];

/** Symbols with their sector, from a compact "SECTOR: A B C" table. */
const bySector = (suffix: string, table: Record<string, string>): [string, string][] =>
  Object.entries(table).flatMap(([sector, syms]) => syms.split(" ").map((x): [string, string] => [x + suffix, sector]));

// The FTSE 100's companies (investment trusts left out), checked 23 Oct 2026. Ranking the index by
// market value gives the UK's 50 largest listed companies.
const UK_CANDIDATES = bySector(".L", {
  Healthcare: "AZN GSK HLN SN HIK CTEC",
  Energy: "SHEL BP",
  "Financial Services": "HSBA LSEG BARC LLOY NWG PRU STAN III LGEN AV ADM BEZ STJ SDR MNG HSX ICG",
  "Consumer Defensive": "ULVR BATS DGE TSCO IMB RKT ABF SBRY",
  "Basic Materials": "RIO GLEN AAL ANTO FRES CRDA MNDI EDV",
  Industrials: "REL RR BA EXPN BNZL SMIN ITRK RTO SPX WEIR IMI DCC MRO BAB DPLM IAG EZJ HWDN",
  "Consumer Cyclical": "CPG ENT IHG WTB NXT KGF MKS JD PSN BKG TW BTRW GAW BME",
  Utilities: "NG SSE CNA UU SVT",
  "Communication Services": "VOD BT-A PSON INF WPP AUTO RMV AAF",
  Technology: "SGE HLMA",
  "Real Estate": "LAND BLND SGRO UTG LMP",
});

// About 90 of the largest companies on the Tokyo Stock Exchange (roughly TOPIX Core30 and Large70),
// checked 23 Oct 2026; Toyota Industries, taken private in 2026, is left out.
const JAPAN_CANDIDATES = bySector(".T", {
  "Consumer Cyclical": "7203 9983 7267 6902 7269 7201 7270 5108 4661 7832 5802",
  "Financial Services": "8306 8316 8411 8766 7182 8591 8604 8725 8630 8309 8308",
  Technology: "6758 6861 8035 6702 6857 6981 6723 6752 6762 6146 7751 4307 6971 6920 4062",
  "Communication Services": "9984 9432 9433 9434 7974 4689 9766 9697",
  Industrials: "6501 8058 8001 8031 8053 8002 8015 6098 6367 7011 6503 6954 6273 6301 9022 9020 9101 9104 7012 7013 6326 6178",
  "Basic Materials": "4063 5401",
  Healthcare: "4502 4568 4519 4543 4578 4503 7741 7733 4901",
  "Consumer Defensive": "2914 3382 4452 2802 2502 2503 4911",
  "Real Estate": "8801 8802 1925",
});

// The German companies in the DAX plus the larger MDAX names, checked 23 Oct 2026. Airbus and Qiagen,
// Dutch companies listed in Frankfurt, are left out; Porsche SE's market value covers both share classes.
const GERMANY_CANDIDATES = bySector(".DE", {
  Technology: "SAP IFX NEM AIXA",
  Industrials: "SIE ENR RHM DHL MTX DTG KBX BNR G1A LHA HOT HAG R3NK KGX FRA TKA RAA HLAG 8TRA",
  "Financial Services": "ALV MUV2 DB1 DBK CBK HNR1 TLX DWS",
  "Communication Services": "DTE EVD G24",
  "Consumer Cyclical": "MBG BMW VOW3 P911 PAH3 ADS CON ZAL PUM DHER BOSS TUI1",
  Healthcare: "MRK BAYN SHL FRE FME SRT3",
  "Basic Materials": "BAS SY1 HEI EVK 1COV NDA",
  "Consumer Defensive": "HEN3 BEI",
  Utilities: "EOAN RWE EBK",
  "Real Estate": "VNA DWNI LEG",
});

// About 80 of the largest companies in Shanghai (.SS), Shenzhen (.SZ) and Hong Kong (.HK), checked
// 23 Oct 2026, one listing each. For companies listed in both places the mainland A share is used: its
// market value on Yahoo covers the whole company, while the Hong Kong figure prices every share at the
// cheaper H-share price.
const CHINA_CANDIDATES: [string, string][] = Object.entries({
  "Financial Services": "601398.SS 601939.SS 601288.SS 601988.SS 601318.SS 600036.SS 601628.SS 601658.SS 601328.SS 600030.SS 601166.SS 601998.SS 600000.SS 601818.SS 300059.SZ 601601.SS 601211.SS 1299.HK 0388.HK 601319.SS 000001.SZ 601688.SS",
  Energy: "601857.SS 600938.SS 600028.SS 601088.SS 601225.SS",
  "Communication Services": "0700.HK 600941.SS 601728.SS 600050.SS 9999.HK 9888.HK 1024.HK",
  "Consumer Defensive": "600519.SS 000858.SZ 600887.SS 9633.HK 0291.HK 002714.SZ 603288.SS",
  "Consumer Cyclical": "9988.HK 3690.HK 9618.HK 002594.SZ 601888.SS 600104.SS 000333.SZ 000651.SZ 600690.SS 2020.HK 9961.HK 2015.HK 9868.HK 601127.SS 9992.HK 0175.HK",
  Technology: "1810.HK 601138.SS 688981.SS 002475.SZ 300308.SZ 300502.SZ 688256.SS 000063.SZ 002371.SZ 688041.SS 002415.SZ 688795.SS",
  Industrials: "300750.SZ 600031.SS 601390.SS 601668.SS 601919.SS 601766.SS 601816.SS 600150.SS 002352.SZ",
  "Basic Materials": "601899.SS 600309.SS 600019.SS 600585.SS",
  Utilities: "600900.SS 601985.SS 003816.SZ 600011.SS",
  Healthcare: "600276.SS 300760.SZ 2269.HK 1093.HK 6160.HK 603259.SS",
}).flatMap(([sector, syms]) => syms.split(" ").map((x): [string, string] => [x, sector]));

const DEFS: Def[] = [
  ...NSE,
  {
    id: "top50us", name: "US 50 most valuable", family: "United States", size: 50, ranked: "us",
    description: `The 50 largest US companies by today's market value, ranked live from about ${US_CANDIDATES.length} of the biggest (list checked ${US_AS_OF}).`,
  },
  {
    id: "top50uk", name: "UK 50 most valuable", family: "United Kingdom", size: 50, ranked: "uk",
    description: "The 50 largest UK-listed companies by today's market value, ranked live from the FTSE 100 (list checked 23 Oct 2026).",
  },
  {
    id: "top50de", name: "Germany's 50 most valuable", family: "Germany", size: 50, ranked: "germany",
    description: `The 50 largest German companies by today's market value, ranked live from about ${GERMANY_CANDIDATES.length} DAX and MDAX names (list checked 23 Oct 2026).`,
  },
  {
    id: "top50cn", name: "China's 50 most valuable", family: "China", size: 50, ranked: "china",
    description: `The 50 largest Chinese companies by today's market value, ranked live from about ${CHINA_CANDIDATES.length} of the biggest in Shanghai, Shenzhen and Hong Kong (list checked 23 Oct 2026).`,
  },
  {
    id: "top50jp", name: "Japan's 50 most valuable", family: "Japan", size: 50, ranked: "japan",
    description: `The 50 largest Japanese companies by today's market value, ranked live from about ${JAPAN_CANDIDATES.length} of the biggest on the Tokyo Stock Exchange (list checked 23 Oct 2026).`,
  },
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

/** An NSE index's constituents from NSE's own file, cached for a day. Throws DataError. */
function indexMembers(csv: string, name: string): Promise<UniverseMember[]> {
  const url = indexCsvUrl(csv);
  return cached("index:" + csv, DAY, async () => {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/csv,*/*" }, cache: "no-store", signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!res?.ok) throw new DataError(`NSE's ${name} file did not load${res ? ` (status ${res.status})` : ""}`, "upstream");
    const members = parseIndexCsv(await res.text());
    if (members.length < 5) throw new DataError(`NSE's ${name} file looks incomplete`, "upstream");
    return members;
  });
}

export interface RankedCompany { rank: number; symbol: string; name: string; industry: string; price: number; marketCap: number; changePct: number | null; currency: string }
export type { TopMarket };

const CANDIDATES: Record<Exclude<TopMarket, "india">, [string, string][]> = { us: US_CANDIDATES, uk: UK_CANDIDATES, japan: JAPAN_CANDIDATES, germany: GERMANY_CANDIDATES, china: CHINA_CANDIDATES };
const SOURCE: Record<TopMarket, string> = {
  india: "Nifty 200 constituents (NSE) ranked by market value from Yahoo Finance quotes (delayed)",
  us: `About ${US_CANDIDATES.length} of the largest US companies (list checked ${US_AS_OF}) ranked by market value from Yahoo Finance quotes (delayed)`,
  uk: "FTSE 100 companies (list checked 23 Oct 2026) ranked by market value from Yahoo Finance quotes (delayed)",
  japan: `About ${JAPAN_CANDIDATES.length} of the largest Tokyo-listed companies (list checked 23 Oct 2026) ranked by market value from Yahoo Finance quotes (delayed)`,
  germany: `About ${GERMANY_CANDIDATES.length} German DAX and MDAX companies (list checked 23 Oct 2026) ranked by market value from Yahoo Finance quotes (delayed)`,
  china: `About ${CHINA_CANDIDATES.length} of the largest companies in Shanghai, Shenzhen and Hong Kong (list checked 23 Oct 2026) ranked by market value in yuan from Yahoo Finance quotes (delayed)`,
};

/**
 * A market's most valuable listed companies, ranked by today's market value (price × shares), refreshed
 * every 15 minutes from batches of Yahoo quotes. India's candidates are the Nifty 200, which holds every
 * large company except very recent listings; the others are the lists above. Market values are put into
 * the market's own currency first: a few London shares are quoted in dollars.
 */
export function getTopCompanies(market: TopMarket, n = 50): Promise<{ companies: RankedCompany[]; asOf: string; source: string }> {
  return cached(`top-${market}`, 15 * MIN, async () => {
    const members: UniverseMember[] = market === "india"
      ? await indexMembers("nifty200", "Nifty 200")
      : CANDIDATES[market].map(([symbol, group]) => ({ symbol, name: symbol, group }));
    const quotes = await quotesFor(members.map((m) => m.symbol));
    // too many gaps would rank the wrong companies: fail (and so skip the cache) rather than show that;
    // a hand-made list may hold a few stale names, so it is allowed a little more slack than NSE's file
    if (quotes.length < members.length * (market === "india" ? 0.95 : 0.9)) throw new DataError(`Market values loaded for only ${quotes.length} of ${members.length} companies`, "upstream");
    const base = TOP_MARKETS[market].currency;
    const rates = new Map<string, number>([[base, 1]]);
    for (const c of new Set(quotes.map((q) => q.currency))) if (!rates.has(c)) rates.set(c, await fxSpot(c, base).catch(() => NaN));
    const industry = new Map(members.map((m) => [m.symbol, m.group ?? ""]));
    const companies = quotes
      .map((q) => ({ q, value: q.marketCap * (rates.get(q.currency) ?? NaN) }))
      .filter((x) => Number.isFinite(x.value))
      .sort((a, b) => b.value - a.value)
      .slice(0, 50)
      .map(({ q, value }, i) => ({ rank: i + 1, symbol: q.symbol, name: q.name, industry: industry.get(q.symbol) ?? "", price: q.price, marketCap: value, changePct: q.changePct, currency: q.currency }));
    return { companies, asOf: new Date().toISOString(), source: SOURCE[market] };
  }).then((r) => ({ ...r, companies: r.companies.slice(0, n) }));
}

/** A universe with its members; NSE files are cached for a day. Throws DataError. */
export function getUniverse(id: string): Promise<Universe> {
  const d = BY_ID.get(id);
  if (!d) return Promise.reject(new DataError(`No list called "${id}"`, "not_found"));
  if (d.members) {
    return Promise.resolve({ id, name: d.name, description: d.description, source: `S&P Dow Jones Indices announcements; list checked ${DOW_AS_OF}`, members: d.members });
  }
  if (d.ranked) {
    return getTopCompanies(d.ranked, 50).then((t) => ({ id, name: d.name, description: d.description, source: t.source, members: t.companies.map((c) => ({ symbol: c.symbol, name: c.name, ...(c.industry ? { group: c.industry } : {}) })) }));
  }
  return indexMembers(d.csv!, d.name).then((members) => ({
    id, name: d.name, description: d.description, source: `NSE index constituents (${indexCsvUrl(d.csv!)}), refreshed daily`, members: members.slice(0, 150),
  }));
}
