import Link from "next/link";
import { Suspense } from "react";
import TopCompanies from "@/components/TopCompanies";
import { TOP_MARKETS, TOP_ORDER, type TopMarket } from "@/lib/topMarkets";

/** The full "50 most valuable companies" page for one market, with links to the other markets. */
export default function TopPage({ market }: { market: TopMarket }) {
  const info = TOP_MARKETS[market];
  return (
    <div className="wrap" style={{ display: "flex", flexDirection: "column", gap: 20, paddingBlock: "28px 48px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p className="label">{info.country} · by market value</p>
        <h1 style={{ fontSize: "clamp(28px, 4vw, 44px)", letterSpacing: "-0.03em", fontWeight: 600 }}>{info.possessive} 50 most valuable companies.<span className="accent"> Open any to value it.</span></h1>
        <p className="muted" style={{ maxWidth: "70ch" }}>Ranked live by what the market pays for the whole company. Size is not value: the scanner checks which of them look cheap or dear against their own cash flows and peers.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Link className="btn primary" href={`/scan?u=${info.scanId}`}>Scan all 50</Link>
          {market === "india" && <Link className="btn" href="/india">Browse every NSE stock</Link>}
        </div>
        <nav aria-label="Other markets" className="top-markets">
          {TOP_ORDER.map((m) => (m === market
            ? <span key={m} aria-current="page">{TOP_MARKETS[m].country}</span>
            : <Link key={m} href={TOP_MARKETS[m].path}>{TOP_MARKETS[m].country}</Link>))}
        </nav>
      </div>
      <section className="card section" aria-labelledby="top-h">
        <div className="section-head"><h2 id="top-h">Largest first</h2><p>{info.unitNote}</p></div>
        <Suspense fallback={<p className="muted" aria-busy="true">Loading today&apos;s market values…</p>}><TopCompanies market={market} /></Suspense>
      </section>
    </div>
  );
}
