import { ImageResponse } from "next/og";
import { connection } from "next/server";
import { C, Frame, OG_SIZE, Stat, ogMoney } from "@/lib/og/card";
import { compute, defaultInputs } from "@/lib/model";
import { healthCheck } from "@/lib/quality";
import { isExtreme } from "@/lib/scanMath";
import { getPeers, getStockData } from "@/lib/server/yahoo";

export const alt = "Valuation summary: price, value on default inputs and business health";
export const size = OG_SIZE;
export const contentType = "image/png";

type Card = { name: string; symbol: string; meta: string; cur: string; price: number; value: number; upside: number; extreme: boolean; grade: string; score: number | null };

async function load(symbol: string): Promise<Card | null> {
  const work = (async () => {
    const data = await getStockData(symbol);
    const peers = await getPeers(data.symbol, data.industry, data.sector).catch(() => []);
    const R = compute(defaultInputs(data, peers), data, peers, Date.now());
    const h = healthCheck(data);
    return {
      name: data.name, symbol: data.symbol, meta: [data.exchange, data.industry || data.sector].filter(Boolean).join(" · "), cur: data.currency,
      price: data.price, value: R.ok ? R.pt : NaN, upside: R.ok ? R.upside : NaN, extreme: R.ok && isExtreme(R.pt, data.price), grade: h.grade, score: h.score,
    };
  })().catch(() => null);
  // Link previews give up after a few seconds: past 6 s, send the generic card instead.
  return Promise.race([work, new Promise<null>((r) => setTimeout(() => r(null), 6000))]);
}

// The card shows the desk's default-input valuation: a share link's own inputs live in the #hash,
// which never reaches the server, so the label says "default inputs" rather than claiming to be the sender's.
export default async function Image({ params }: { params: Promise<{ symbol: string }> }) {
  await connection();
  const symbol = (await params).symbol.trim().toUpperCase(); // already decoded by the router
  const d = /^[A-Z0-9^.\-=&]{1,24}$/.test(symbol) ? await load(symbol) : null;
  const pctText = (f: number) => `${f > 0 ? "+" : f < 0 ? "−" : ""}${Math.abs(f * 100).toFixed(1)}%`;
  return new ImageResponse(
    (
      <Frame>
        {d ? (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 44, gap: 14 }}>
            <div style={{ display: "flex", fontSize: 22, letterSpacing: 2, textTransform: "uppercase", color: C.muted }}>{d.meta || "Listed company"}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 20, fontSize: 60, fontWeight: 700, letterSpacing: -1.5 }}>
              <span style={{ display: "flex", maxWidth: 820, overflow: "hidden" }}>{d.name.length > 34 ? d.name.slice(0, 33) + "…" : d.name}</span>
              <span style={{ display: "flex", color: C.accent, fontSize: 40 }}>{d.symbol}</span>
            </div>
            <div style={{ display: "flex", gap: 20, marginTop: 26 }}>
              <Stat label="Price" value={ogMoney(d.price, d.cur)} note="delayed quote" />
              {d.extreme
                ? <Stat label="Default-input value" value="Check data" note="far from the price" />
                : <Stat label="Default-input value" value={ogMoney(d.value, d.cur)} note={Number.isFinite(d.upside) ? `${pctText(d.upside)} vs price, before your own inputs` : "not available"} tone={Number.isFinite(d.upside) ? (d.upside >= 0 ? "good" : "bad") : undefined} />}
              <Stat label="Business health" value={d.grade === "–" ? "–" : `Grade ${d.grade}`} note={d.score !== null ? `${d.score} out of 100` : "not graded"} tone={d.grade === "A" || d.grade === "B" ? "good" : d.grade === "D" || d.grade === "E" ? "bad" : undefined} />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 80, gap: 12 }}>
            <div style={{ display: "flex", fontSize: 70, fontWeight: 700 }}>Value any listed company</div>
            <div style={{ display: "flex", fontSize: 34, color: C.ink2 }}>DCF, peers, business health and the growth the price implies.</div>
          </div>
        )}
      </Frame>
    ),
    // a real card can sit at the CDN for an hour; the generic fallback only briefly, so the next unfurl retries
    { ...size, headers: { "Cache-Control": d ? "public, s-maxage=3600, stale-while-revalidate=86400" : "public, s-maxage=60" } },
  );
}
