// Live probe: universes and scan rows. npx tsx --conditions=react-server scripts/scan-probe.mts [symbols...]
import { getUniverse, listUniverses } from "../src/lib/server/universe.ts";
import { getScanRow } from "../src/lib/server/scanRow.ts";
import type { ScanRow } from "../src/lib/scanTypes.ts";

const f = (x: number | null, d = 2) => (x === null ? "null" : x.toFixed(d));
const p = (x: number | null) => (x === null ? "null" : (x * 100).toFixed(1) + "%");

console.log(`${listUniverses().length} universes:`, listUniverses().map((u) => `${u.id}(${u.size ?? "?"})`).join(" "));
for (const id of ["nifty50", "dow30"]) {
  const u = await getUniverse(id);
  const groups = new Set(u.members.map((m) => m.group).filter(Boolean));
  console.log(`\n${u.name}: ${u.members.length} members, ${groups.size} groups; source: ${u.source}`);
  console.log("  first 5:", u.members.slice(0, 5).map((m) => `${m.symbol} ${m.name}${m.group ? ` [${m.group}]` : ""}`).join(" | "));
  const bad = u.members.filter((m) => !/^[A-Z0-9^.\-=&]{1,24}$/.test(m.symbol));
  console.log("  invalid symbols:", bad.length ? bad.map((m) => m.symbol).join(",") : "none");
}

const symbols = process.argv.slice(2).length ? process.argv.slice(2) : ["INFY.NS", "HDFCBANK.NS", "RELIANCE.NS", "TCS.NS", "AAPL", "BP.L"];
const rows: ScanRow[] = [];
const queue = [...symbols];
await Promise.all(Array.from({ length: 3 }, async () => {
  for (let s = queue.shift(); s; s = queue.shift()) {
    const t = Date.now();
    try { rows.push(await getScanRow(s)); console.log(`  ok ${s} in ${Date.now() - t} ms`); }
    catch (e) { console.log(`  FAIL ${s}: ${(e as Error).message} [${(e as { code?: string }).code ?? "?"}]`); }
  }
}));
for (const r of rows) {
  console.log(`\n${r.symbol} ${r.name} | ${r.exchange} ${r.country} | ${r.sector} / ${r.industry} | ${r.currency} | financial=${r.financial}`);
  console.log(`  price ${f(r.price)} mcap ${(r.marketCap / 1e9).toFixed(1)}bn shares ${(r.shares / 1e6).toFixed(1)}mn | DCF ${f(r.dcfValue)} (${r.dcfValue ? p(r.dcfValue / r.price - 1) : "–"}) WACC ${p(r.wacc)}`);
  console.log(`  implied g ${f(r.impliedGrowth, 1)}% vs hist ${f(r.histGrowth, 1)}% | IRR ${p(r.expectedReturn)} growthShare ${p(r.growthShare)} FCF yield ${p(r.fcfYield)}`);
  console.log(`  P/E ${f(r.pe, 1)} EV/EBITDA ${f(r.evEbitda, 1)} P/B ${f(r.pb, 1)} | EPS ${f(r.eps)} EBITDA ${(r.ebitda / 1e9).toFixed(2)}bn netCash ${(r.netCash / 1e9).toFixed(2)}bn BVPS ${f(r.bookValuePerShare)}`);
  console.log(`  health ${r.health.grade} ${r.health.score ?? "–"} flags=${r.health.flags.length} | warnings: ${r.warnings.length}${r.warnings.length ? " — " + r.warnings.map((w) => w.slice(0, 70)).join(" / ") : ""}`);
  const bad = Object.entries(r).filter(([, v]) => typeof v === "number" && !Number.isFinite(v)).map(([k]) => k);
  if (bad.length) console.log("  NON-FINITE:", bad.join(","));
}
