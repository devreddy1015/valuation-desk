// Display formatting. Big amounts use the unit readers expect: Indian rupees in crore,
// yen/won/rupiah in billions, everything else in millions.

const BILLION_CURRENCIES = new Set(["JPY", "KRW", "IDR", "VND", "IRR", "HUF", "CLP", "COP"]);

export function bigUnit(currency: string): { div: number; label: string } {
  if (currency === "INR") return { div: 1e7, label: "₹ crore" };
  if (BILLION_CURRENCIES.has(currency)) return { div: 1e9, label: `${currency} bn` };
  return { div: 1e6, label: `${currency} mn` };
}

const fmtCache = new Map<string, Intl.NumberFormat>();
function nf(key: string, make: () => Intl.NumberFormat) {
  let f = fmtCache.get(key);
  if (!f) { f = make(); fmtCache.set(key, f); }
  return f;
}
const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Price per share with its currency symbol. */
export function money(v: number | null | undefined, currency: string, digits?: number): string {
  if (!ok(v)) return "–";
  const d = digits ?? (Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 10 ? 2 : 2);
  try {
    return nf(`m:${currency}:${d}`, () => new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, minimumFractionDigits: d, maximumFractionDigits: d })).format(v);
  } catch {
    return `${currency} ${v.toFixed(d)}`;
  }
}

/** Per-share value for grids, axes and tables: whole units at 100 and above. */
export function money0(v: number | null | undefined, currency: string): string {
  return money(v, currency, ok(v) && Math.abs(v) >= 100 ? 0 : 2);
}

/** A large amount (revenue, cash) in the currency's reading unit, without the unit label. */
export function big(v: number | null | undefined, currency: string): string {
  if (!ok(v)) return "–";
  const u = bigUnit(currency);
  const x = v / u.div;
  const d = Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2;
  return nf(`b:${currency}:${d}`, () => new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d })).format(x);
}

export function pct(f: number | null | undefined, dp = 1, sign = false): string {
  if (!ok(f)) return "–";
  return (sign && f > 0 ? "+" : "") + (f * 100).toFixed(dp) + "%";
}
export function mult(m: number | null | undefined): string {
  return ok(m) ? m.toFixed(1) + "x" : "–";
}
export function num(v: number | null | undefined, dp = 2): string {
  return ok(v) ? v.toFixed(dp) : "–";
}
export function dateLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
export const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A rupee market value in lakh crore, the unit Indian markets quote company size in: "₹16.10 lakh cr". */
export function lakhCrore(v: number | null | undefined): string {
  return ok(v) ? `₹${(v / 1e12).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lakh cr` : "–";
}

const CUR_SIGN: Record<string, string> = { USD: "$", GBP: "£", JPY: "¥", EUR: "€" };
/** A company's market value the way its market quotes it: lakh crore rupees in India, trillions or billions elsewhere. */
export function marketValue(v: number | null | undefined, currency: string): string {
  if (!ok(v)) return "–";
  if (currency === "INR") return lakhCrore(v);
  const sym = CUR_SIGN[currency] ?? `${currency} `;
  if (v >= 1e12) return `${sym}${(v / 1e12).toFixed(2)}T`;
  return `${sym}${(v / 1e9).toFixed(v >= 1e11 ? 0 : 1)}B`;
}
