import { getPeerRow } from "@/lib/server/yahoo";

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9^.\-=&]{1,24}$/.test(symbol)) return Response.json({ error: "Not a valid ticker" }, { status: 400 });
  const row = await getPeerRow(symbol);
  if (!row) return Response.json({ error: `No data for ${symbol}` }, { status: 404 });
  const peer: Partial<typeof row> = { ...row };
  delete peer.sector;
  return Response.json({ peer }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
