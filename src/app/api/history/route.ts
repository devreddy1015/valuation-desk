import { getPriceHistory } from "@/lib/server/history";
import { DataError } from "@/lib/server/yahoo";

/** GET /api/history?symbol=INFY.NS -> { symbol, currency, points: [{ date, close }], splits: [{ date, ratio }] } */
export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9^.\-=&]{1,24}$/.test(symbol)) return Response.json({ error: "Not a valid ticker" }, { status: 400 });
  try {
    const history = await getPriceHistory(symbol);
    return Response.json(history, { headers: { "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=86400" } });
  } catch (e) {
    if (e instanceof DataError && e.code !== "upstream") return Response.json({ error: e.message }, { status: 404 });
    return Response.json({ error: "Price history is unavailable right now. Try again in a minute." }, { status: 502 });
  }
}
