import { fxSpot } from "@/lib/server/yahoo";

/** GET /api/fx?from=USD&to=INR -> { from, to, rate } where rate is units of `to` per unit of `from`. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from")?.trim().toUpperCase() ?? "", to = sp.get("to")?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return Response.json({ error: "Use three-letter currency codes" }, { status: 400 });
  if (from === to) return Response.json({ from, to, rate: 1 });
  try {
    const rate = await fxSpot(from, to);
    return Response.json({ from, to, rate }, { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400" } });
  } catch {
    return Response.json({ error: `No exchange rate for ${from}/${to}` }, { status: 502 });
  }
}
