// POST a decoded share link to /api/excel and save the workbook plus each formula cell's cached result.
import { writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { decodeShare } from "../src/lib/client/share.ts";
const [code, out] = process.argv.slice(2);
const s = (await decodeShare(code))!;
const res = await fetch("http://localhost:3123/api/excel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: s.symbol, inputs: s.inputs, overrides: s.overrides, extraPeers: s.extraPeers, calls: false }) });
console.log("status", res.status, res.headers.get("content-disposition"));
const buf = Buffer.from(await res.arrayBuffer());
writeFileSync(`${out}.xlsx`, buf);
const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
const cells: Record<string, unknown> = {};
wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => { const v = c.value as { formula?: string; result?: unknown } | null; if (v && typeof v === "object" && "formula" in v) cells[`${ws.name}!${c.address}`] = { f: v.formula, r: v.result }; })));
const sel = wb.getWorksheet("Inputs")!.getCell("C23").value, vps = (wb.getWorksheet("DCF")!.getCell("C51").value as { result: number }).result;
console.log("selector", sel, "DCF value per share", vps, "summary value", (wb.getWorksheet("Summary")!.getCell("C13").value as { result: number }).result);
writeFileSync(`${out}.json`, JSON.stringify({ cells, engine: { bear: NaN } }));
