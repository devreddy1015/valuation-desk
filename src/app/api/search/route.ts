import { searchSymbols } from "@/lib/server/yahoo";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ hits: [] });
  try {
    const hits = await searchSymbols(q);
    return Response.json({ hits }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch {
    return Response.json({ hits: [], error: "Search is unavailable right now" }, { status: 502 });
  }
}
