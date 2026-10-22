import { getScanRow } from "@/lib/server/scanRow";
import { DataError } from "@/lib/server/yahoo";

const STATUS = { not_found: 404, unsupported: 422, upstream: 502 } as const;

/** GET /api/scan/row?symbol=INFY.NS -> { row: ScanRow }, or { error, code } on failure. */
export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9^.\-=&]{1,24}$/.test(symbol)) return Response.json({ error: "Not a valid ticker", code: "invalid" }, { status: 400 });
  try {
    const row = await getScanRow(symbol);
    return Response.json({ row }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch (e) {
    if (e instanceof DataError) return Response.json({ error: e.message, code: e.code }, { status: STATUS[e.code] });
    return Response.json({ error: "Market data is unavailable right now", code: "upstream" }, { status: 502 });
  }
}
