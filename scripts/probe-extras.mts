import { getStockData } from "../src/lib/server/yahoo.ts";
for (const s of process.argv.slice(2)) {
  const d = await getStockData(s);
  const y = d.history.at(-1)!;
  const missing = Object.entries(y).filter(([, v]) => v === null || v === undefined).map(([k]) => k);
  console.log(s, d.history.map((h) => h.label).join(","), "missing in last year:", missing.join(" ") || "none", "| EPS", y.dilutedEPS?.toFixed(2), "shares", y.dilutedShares);
}
