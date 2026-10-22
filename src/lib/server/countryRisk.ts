import "server-only";
import { cached, DAY } from "./cache";
import { DAMODARAN_OVERRIDES, MATURE_ERP } from "../markets";

export interface CountryRisk { country: string; rating: string; defaultSpread: number; crp: number; erp: number; taxRate: number }

const URL = "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ctryprem.html";

const strip = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const pct = (s: string) => {
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
};

/** Parses Damodaran's country risk premium table (country, rating, default spread, CRP, ERP, tax rate, ...). */
export function parseCountryTable(html: string): Map<string, CountryRisk> {
  const out = new Map<string, CountryRisk>();
  const rows = html.split(/<tr[\s>]/i).slice(1);
  for (const row of rows) {
    const cells = row.split(/<td[\s>]/i).slice(1).map((c) => strip("<x " + c));
    if (cells.length < 6) continue;
    const [country, rating, ds, crp, erp, tax] = cells;
    if (!country || !/^[A-Za-z][A-Za-z .,'()&-]+$/.test(country) || !/%/.test(erp)) continue;
    const v = { country, rating, defaultSpread: pct(ds), crp: pct(crp), erp: pct(erp), taxRate: pct(tax) };
    if (Number.isFinite(v.erp) && v.erp > 0 && v.erp < 40) out.set(country.toLowerCase(), v);
  }
  return out;
}

export function getCountryTable(): Promise<Map<string, CountryRisk>> {
  return cached("damodaran:ctryprem", 7 * DAY, async () => {
    const res = await fetch(URL, { headers: { "User-Agent": "Mozilla/5.0 (valuation-desk)" }, cache: "no-store" });
    if (!res.ok) throw new Error(`Damodaran table returned ${res.status}`);
    const buf = await res.arrayBuffer();
    const html = new TextDecoder("latin1").decode(buf);
    const t = parseCountryTable(html);
    if (t.size < 50) throw new Error("Damodaran table could not be parsed");
    return t;
  });
}

const ALIASES: Record<string, string> = { "united states": "united states", usa: "united states", "south korea": "korea", "hong kong": "hong kong", "czech republic": "czech republic" };

export async function erpFor(country: string): Promise<{ value: number; defaultSpread: number; note: string; estimated: boolean }> {
  const o = DAMODARAN_OVERRIDES[country];
  if (o) return { value: o.erp, defaultSpread: o.defaultSpread, note: o.note, estimated: false };
  try {
    const t = await getCountryTable();
    const k = country.toLowerCase();
    const hit = t.get(ALIASES[k] ?? k) ?? [...t.values()].find((v) => v.country.toLowerCase().startsWith(k));
    if (hit) return { value: hit.erp, defaultSpread: hit.defaultSpread, note: `Damodaran country risk table (January 2026), ${hit.country}, rating ${hit.rating}`, estimated: false };
  } catch {
    /* fall through to the mature-market default */
  }
  return { value: MATURE_ERP.value, defaultSpread: 0, note: `${MATURE_ERP.note}; ${country || "this country"} was not found in the country table`, estimated: true };
}
