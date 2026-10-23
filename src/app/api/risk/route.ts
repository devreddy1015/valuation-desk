import { BENCHMARK_BY_COUNTRY, FALLBACK_BENCHMARK } from "@/lib/markets";
import { getWeeklyHistory } from "@/lib/server/history";
import { DataError } from "@/lib/server/yahoo";

const BENCHMARKS = new Set([...Object.values(BENCHMARK_BY_COUNTRY).map((b) => b.symbol), FALLBACK_BENCHMARK.symbol]);

/** GET /api/risk?symbol=INFY.NS&bench=^NSEI -> five years of weekly adjusted closes for the stock and its index. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const symbol = sp.get("symbol")?.trim().toUpperCase() ?? "", bench = sp.get("bench")?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9^.\-=&]{1,24}$/.test(symbol)) return Response.json({ error: "Not a valid ticker" }, { status: 400 });
  try {
    const [stock, index] = await Promise.all([
      getWeeklyHistory(symbol),
      BENCHMARKS.has(bench) ? getWeeklyHistory(bench).catch(() => null) : Promise.resolve(null),
    ]);
    return Response.json({ stock, bench: index }, { headers: { "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=86400" } });
  } catch (e) {
    const status = e instanceof DataError ? (e.code === "not_found" ? 404 : 502) : 502;
    return Response.json({ error: e instanceof Error ? e.message : "Price history is unavailable right now" }, { status });
  }
}
