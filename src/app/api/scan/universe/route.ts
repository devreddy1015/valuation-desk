import { getUniverse, isUniverseId, listUniverses } from "@/lib/server/universe";
import { DataError } from "@/lib/server/yahoo";

const DAY_AT_CDN = { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400" };

/** GET /api/scan/universe -> { universes }; ?id=nifty50 -> { universe } with its members. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim().toLowerCase() ?? "";
  if (!id) return Response.json({ universes: listUniverses() }, { headers: DAY_AT_CDN });
  if (!isUniverseId(id)) return Response.json({ error: `No list called "${id.slice(0, 40)}"`, code: "not_found" }, { status: 404 });
  try {
    return Response.json({ universe: await getUniverse(id) }, { headers: DAY_AT_CDN });
  } catch (e) {
    return Response.json({ error: e instanceof DataError ? e.message : "The list is unavailable right now", code: "upstream" }, { status: 502 });
  }
}
