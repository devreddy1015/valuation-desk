import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import IndiaList from "@/components/IndiaList";
import SearchBox from "@/components/SearchBox";
import { getNseListings } from "@/lib/server/nse";

export const metadata: Metadata = { title: "All NSE stocks", description: "Every company listed on the National Stock Exchange of India, ready to value." };

async function Listings() {
  await connection(); // NSE list refreshed daily: fetched at request time
  const listings = await getNseListings().catch(() => null);
  return listings ? <IndiaList listings={listings} /> : (
    <section className="card empty">
      <h2>The NSE list is unavailable right now</h2>
      <p className="muted">NSE&apos;s file could not be loaded. You can still search for any company by name or ticker.</p>
      <div style={{ width: "min(560px, 100%)" }}><SearchBox /></div>
    </section>
  );
}

export default function IndiaPage() {
  return (
    <div className="wrap" style={{ display: "flex", flexDirection: "column", gap: 20, paddingBlock: "28px 48px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p className="label">India · National Stock Exchange</p>
        <h1 style={{ fontSize: "clamp(28px, 4vw, 44px)", letterSpacing: "-0.03em", fontWeight: 600 }}>Every NSE-listed company.<span className="accent"> Pick one to value.</span></h1>
        <p className="muted" style={{ maxWidth: "70ch" }}>From NSE&apos;s own equity list, refreshed daily. BSE-only companies are reachable through search with the .BO suffix. Looking for the giants? See <Link className="accent" href="/india/top">India&apos;s 50 most valuable companies</Link>.</p>
      </div>
      <Suspense fallback={<section className="card empty" aria-busy="true"><p className="muted">Loading the NSE list…</p></section>}><Listings /></Suspense>
    </div>
  );
}
