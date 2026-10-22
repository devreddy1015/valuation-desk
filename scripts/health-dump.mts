// Fetch live StockData for a few symbols and save it as JSON, so the health check can be
// re-run offline while tuning (scripts/health-probe.mts --from <file>).
// Usage: npx tsx --conditions=react-server scripts/health-dump.mts <out.json> SYM1 SYM2 ...
import { writeFileSync } from "node:fs";
import { getStockData } from "../src/lib/server/yahoo.ts";
import type { StockData } from "../src/lib/types.ts";

const [out, ...symbols] = process.argv.slice(2);
if (!out || !symbols.length || symbols.length > 8) throw new Error("usage: health-dump.mts <out.json> <1-8 symbols>");
const res: Record<string, StockData | { error: string }> = {};
for (let i = 0; i < symbols.length; i += 3) {
  await Promise.all(symbols.slice(i, i + 3).map(async (s) => {
    try { res[s] = await getStockData(s); } catch (e) { res[s] = { error: (e as Error).message }; }
  }));
}
writeFileSync(out, JSON.stringify(res, null, 1));
console.log("saved", Object.keys(res).join(", "), "to", out);
