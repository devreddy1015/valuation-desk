import { compute, defaultInputs } from "@/lib/model";
import { buildWorkbook } from "@/lib/excel";
import { applyOverrides } from "@/lib/overrides";
import { parseExportPayload } from "@/lib/client/share";
import { DataError, getPeers, getStockData } from "@/lib/server/yahoo";
import type { UserInputs } from "@/lib/types";

const MAX_BODY = 200 * 1024;

/** POST /api/excel {symbol, inputs, overrides, extraPeers, calls?, now?} -> the valuation as an .xlsx with live formulas. */
export async function POST(req: Request) {
  const text = await req.text().catch(() => "");
  if (!text || text.length > MAX_BODY) return Response.json({ error: "The request is empty or too large" }, { status: 400 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return Response.json({ error: "The request is not valid JSON" }, { status: 400 }); }
  const p = parseExportPayload(body);
  if (!p) return Response.json({ error: "The valuation inputs are not valid" }, { status: 400 });
  try {
    const raw = await getStockData(p.symbol);
    const data = applyOverrides(raw, p.overrides);
    const auto = await getPeers(raw.symbol, raw.industry, raw.sector).catch(() => []);
    const peers = [...auto, ...p.extraPeers.filter((x) => !auto.some((a) => a.symbol === x.symbol))];
    const inputs: UserInputs = { ...defaultInputs(raw, auto), ...p.inputs, price: p.inputs.price ?? raw.price };
    // the valuation date on screen, within a day of now, so year fractions match what the user saw
    const now = Date.now(), valDate = p.now !== undefined && Math.abs(p.now - now) < 864e5 ? p.now : now;
    const R = compute(inputs, data, peers, valDate);
    const origin = new URL(req.url).origin;
    const buf = await buildWorkbook(data, inputs, peers, R, valDate, { calls: p.calls, link: `${origin}/stock/${encodeURIComponent(raw.symbol)}` });
    const file = `${raw.symbol.replace(/[^A-Z0-9.\-]/gi, "_")}-valuation-desk.xlsx`;
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${file}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof DataError) return Response.json({ error: e.message }, { status: e.code === "not_found" ? 404 : e.code === "unsupported" ? 422 : 502 });
    return Response.json({ error: "The workbook could not be built right now" }, { status: 502 });
  }
}
