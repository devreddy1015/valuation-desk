import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import TopCompanies from "@/components/TopCompanies";

export const metadata: Metadata = {
  title: "The US's 50 most valuable companies",
  description: "The 50 largest US companies by today's market value, ranked live, each one click from a full valuation. Educational, not investment advice.",
};

export default function TopUsPage() {
  return (
    <div className="wrap" style={{ display: "flex", flexDirection: "column", gap: 20, paddingBlock: "28px 48px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p className="label">United States · by market value</p>
        <h1 style={{ fontSize: "clamp(28px, 4vw, 44px)", letterSpacing: "-0.03em", fontWeight: 600 }}>The US&apos;s 50 most valuable companies.<span className="accent"> Open any to value it.</span></h1>
        <p className="muted" style={{ maxWidth: "70ch" }}>Ranked live by what the market pays for the whole company. Size is not value: the scanner checks which of them look cheap or dear against their own cash flows and peers.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Link className="btn primary" href="/scan?u=top50us">Scan all 50</Link>
          <Link className="btn" href="/india/top">India&apos;s 50 most valuable</Link>
        </div>
      </div>
      <section className="card section" aria-labelledby="top-h">
        <div className="section-head"><h2 id="top-h">Largest first</h2><p>Market value in US dollars: T is trillion, B billion.</p></div>
        <Suspense fallback={<p className="muted" aria-busy="true">Loading today&apos;s market values…</p>}><TopCompanies market="us" /></Suspense>
      </section>
    </div>
  );
}
