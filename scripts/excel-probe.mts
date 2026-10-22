// Build workbooks for live stocks and dump every formula cell's cached (engine) result, so an
// independent Excel engine can recompute the formulas and compare. Usage: excel-probe.mts OUTDIR SYM...
import { writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { getPeers, getStockData } from "../src/lib/server/yahoo.ts";
import { compute, defaultInputs } from "../src/lib/model.ts";
import { buildWorkbook } from "../src/lib/excel.ts";

const [out, ...syms] = process.argv.slice(2);
for (const s of syms) {
  const data = await getStockData(s);
  const peers = await getPeers(data.symbol, data.industry, data.sector).catch(() => []);
  const inp = defaultInputs(data, peers);
  const now = Date.now();
  const R = compute(inp, data, peers, now);
  const buf = await buildWorkbook(data, inp, peers, R, now, { calls: true });
  const file = `${out}/${s}.xlsx`;
  writeFileSync(file, buf);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const cells: Record<string, unknown> = {};
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => {
    const v = c.value as { formula?: string; result?: unknown } | null;
    if (v && typeof v === "object" && "formula" in v) cells[`${ws.name}!${c.address}`] = { f: v.formula, r: v.result };
  })));
  const engine = { bear: R.scen.bear.vps, base: R.scen.base.vps, bull: R.scen.bull.vps, wacc: R.wacc, comps: R.compsValue, pt: R.pt, dcfUsed: R.dcfUsed, sens00: R.sens[0][0], sens44: R.sens[4][4], scenario: inp.scenario };
  writeFileSync(`${out}/${s}.json`, JSON.stringify({ cells, engine }));
  console.log(s, "formula cells:", Object.keys(cells).length, "engine:", JSON.stringify(engine));
}
