// Run the business health check on live Yahoo data (or a file saved by health-dump.mts) and print it.
// Usage: npx tsx --conditions=react-server scripts/health-probe.mts [--from saved.json] [--full] SYM1 SYM2 ...
import { readFileSync } from "node:fs";
import { healthCheck } from "../src/lib/quality.ts";
import type { StockData } from "../src/lib/types.ts";

const args = process.argv.slice(2);
const fromAt = args.indexOf("--from");
const from = fromAt >= 0 ? args.splice(fromAt, 2)[1] : null;
const full = args.includes("--full");
const symbols = args.filter((a) => !a.startsWith("--"));
if (symbols.length > 8) throw new Error("at most 8 symbols per probe");

async function load(): Promise<Record<string, StockData | { error: string }>> {
  if (from) {
    const all = JSON.parse(readFileSync(from, "utf8"));
    return symbols.length ? Object.fromEntries(symbols.map((s) => [s, all[s] ?? { error: "not in file" }])) : all;
  }
  const { getStockData } = await import("../src/lib/server/yahoo.ts");
  const out: Record<string, StockData | { error: string }> = {};
  for (let i = 0; i < symbols.length; i += 3) {
    await Promise.all(symbols.slice(i, i + 3).map(async (s) => { try { out[s] = await getStockData(s); } catch (e) { out[s] = { error: (e as Error).message }; } }));
  }
  return out;
}

for (const [sym, d] of Object.entries(await load())) {
  if ("error" in d) { console.log(`\n== ${sym}: ERROR ${d.error}`); continue; }
  const r = healthCheck(d);
  console.log(`\n== ${sym} ${d.name} | ${d.history.map((y) => y.label).join(" ")}${d.financial ? " | financial" : ""}`);
  console.log(`grade ${r.grade}  score ${r.score}  | Piotroski ${r.piotroski ? `${r.piotroski.score}/${r.piotroski.max}` : "–"}  | Z'' ${r.altman ? `${r.altman.z.toFixed(2)} ${r.altman.zone}` : "–"}  | M ${r.beneish ? `${r.beneish.m.toFixed(2)}${r.beneish.flag ? " FLAG" : ""}` : "–"}`);
  console.log("summary:", r.summary);
  if (full && r.piotroski) r.piotroski.tests.forEach((t) => console.log(`  [${t.pass === null ? "n/a " : t.pass ? "PASS" : "FAIL"}] ${t.label}: ${t.value}`));
  if (full && r.beneish) console.log("  beneish parts:", r.beneish.parts.map((p) => `${p.key}=${p.value?.toFixed(3)}${p.neutral ? "*" : ""}`).join(" "));
  if (full && r.altman?.history) console.log("  Z'' history:", r.altman.history.map((x) => `${x.label} ${x.z.toFixed(2)}`).join(", "), "| F history:", r.piotroski?.history?.map((x) => `${x.label} ${x.score}/${x.max}`).join(", "));
  console.log("  metrics:", r.metrics.map((m) => `${m.key}=${m.display ?? (m.value === null ? "–" : m.value.toFixed(3))}(${m.verdict})`).join("  "));
  r.flags.forEach((f) => console.log("  FLAG  ", f));
  r.strengths.forEach((f) => console.log("  GOOD  ", f));
  if (full) r.notes.forEach((f) => console.log("  note  ", f));
}
