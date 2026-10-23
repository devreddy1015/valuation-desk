import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import SearchBox from "@/components/SearchBox";
import TopCompanies from "@/components/TopCompanies";
import Watchlist from "@/components/Watchlist";
import { getNseListings } from "@/lib/server/nse";

const QUICK = [
  ["INFY.NS", "Infosys"], ["TCS.NS", "TCS"], ["RELIANCE.NS", "Reliance"], ["HDFCBANK.NS", "HDFC Bank"], ["BHARTIARTL.NS", "Bharti Airtel"], ["JIOFIN.NS", "Jio Financial"],
  ["AAPL", "Apple"], ["MSFT", "Microsoft"], ["7203.T", "Toyota"], ["SAP.DE", "SAP"], ["0700.HK", "Tencent"],
];

const MARKETS: { country: string; suffix: string; example: [string, string] }[] = [
  { country: "United States", suffix: "no suffix", example: ["NVDA", "Nvidia"] },
  { country: "United Kingdom", suffix: ".L", example: ["SHEL.L", "Shell"] },
  { country: "Japan", suffix: ".T", example: ["6758.T", "Sony"] },
  { country: "Germany", suffix: ".DE", example: ["SIE.DE", "Siemens"] },
  { country: "France", suffix: ".PA", example: ["MC.PA", "LVMH"] },
  { country: "Hong Kong", suffix: ".HK", example: ["9988.HK", "Alibaba"] },
  { country: "Canada", suffix: ".TO", example: ["SHOP.TO", "Shopify"] },
  { country: "Australia", suffix: ".AX", example: ["BHP.AX", "BHP"] },
  { country: "South Korea", suffix: ".KS", example: ["005930.KS", "Samsung"] },
  { country: "Taiwan", suffix: ".TW", example: ["2330.TW", "TSMC"] },
  { country: "Brazil", suffix: ".SA", example: ["PETR4.SA", "Petrobras"] },
  { country: "India, BSE", suffix: ".BO", example: ["500325.BO", "Reliance on BSE"] },
];

const TOOLS: { href: string; label: string; title: string; body: string; cta: string }[] = [
  { href: "/scan", label: "Find", title: "Opportunity scanner", body: "Value a whole index in about a minute: Nifty 50, Next 50, midcaps, sector indices or the Dow. Rank by value gap, expected return, health, or how little growth the price assumes.", cta: "Scan the Nifty 50" },
  { href: "/portfolio", label: "Check", title: "Portfolio X-ray", body: "Paste or upload your holdings (a Zerodha holdings CSV works as is) and see what the whole portfolio is priced for, how healthy it is, and where it is concentrated.", cta: "X-ray my portfolio" },
  { href: "/india", label: "Value", title: "Valuation desk", body: "Open any stock for the full model: your own forecast, peers, scenarios, a health check, a plain-English summary, and an Excel model with live formulas.", cta: "Browse every NSE stock" },
];

const FEATURES = [
  ["Plain English", "Every result explained in sentences a client understands: what growth the price assumes, what you would earn if your forecast comes true, and how much of the price pays for growth."],
  ["Business health", "Piotroski F-score, Altman Z'' and the Beneish M-score earnings-manipulation screen, plus cash conversion, ROCE, debt cover and dilution, each with the number behind it."],
  ["DCF and scenarios", "Five-year free cash flow forecast with bear, base and bull cases, a WACC you build step by step, a reverse DCF and the bridge from enterprise value to a share price."],
  ["Peers and history", "Peers found automatically and editable, plus the stock's own P/E and P/B band over the years: is it cheap against its past, not just its rivals?"],
  ["Uncertainty", "Two thousand simulated futures, a WACC by growth sensitivity grid and a football field of every range, so nobody mistakes one number for the truth."],
  ["Share and export", "A link that opens your exact valuation, a preview card for WhatsApp and LinkedIn, a printable report, CSV, and a working Excel model."],
];

async function NseCount() {
  await connection(); // the NSE list is fetched at request time and cached for a day
  const count = await getNseListings().then((l) => l.length).catch(() => null);
  return <>{count ? count.toLocaleString("en-IN") : "listed"}</>;
}

export default function Home() {
  return (
    <>
      <section className="hero" aria-labelledby="hero-h">
        <div className="wrap">
          <div className="ticker-dots" aria-hidden="true"><i className="on" /><i className="on" /><i className="on" /><i /><i /><i /></div>
          <p className="label">Equity research · any listed company</p>
          <h1 id="hero-h">Find it, check it, value it.<span className="accent">Any listed company, from Infosys to Toyota.</span></h1>
          <p className="lede">Find opportunities across an index, check the health of a business, and value it with live prices and five years of statements. Every input is yours to change; every number shows where it came from.</p>
          <div className="hero-search"><SearchBox /></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <Link className="btn primary" href="/scan">Scan the Nifty 50</Link>
            <Link className="btn" href="/portfolio">X-ray my portfolio</Link>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {QUICK.map(([s, n]) => <Link key={s} className="chip" href={`/stock/${encodeURIComponent(s)}`}>{n} <span className="muted">{s}</span></Link>)}
          </div>
        </div>
      </section>

      <div className="wrap" style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 48 }}>
        <section aria-labelledby="tl-h" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="section-head"><h2 id="tl-h">Three ways in</h2><p>Start from a whole market, from what you already own, or from one company.</p></div>
          <div className="grid-3">
            {TOOLS.map((t) => (
              <Link key={t.href} href={t.href} className="card tile tool">
                <span className="label">{t.label}</span>
                <h3>{t.title}</h3>
                <p>{t.body}</p>
                <span className="accent small mono">{t.cta} →</span>
              </Link>
            ))}
          </div>
        </section>

        <Watchlist />

        <section className="card section" aria-labelledby="top10-h">
          <div className="section-head">
            <h2 id="top10-h">The most valuable companies</h2>
            <p>The ten largest in India and in the US by today&apos;s market value. Open any to value it, or scan all 50 to find which look cheap.</p>
          </div>
          <div className="two">
            <div className="top-col">
              <h3 className="label">India · <Link className="accent" href="/india/top">all 50</Link> · <Link className="accent" href="/scan?u=top50">scan</Link></h3>
              <Suspense fallback={<p className="muted" aria-busy="true">Loading today&apos;s market values…</p>}><TopCompanies market="india" n={10} compact /></Suspense>
            </div>
            <div className="top-col">
              <h3 className="label">United States · <Link className="accent" href="/us/top">all 50</Link> · <Link className="accent" href="/scan?u=top50us">scan</Link></h3>
              <Suspense fallback={<p className="muted" aria-busy="true">Loading today&apos;s market values…</p>}><TopCompanies market="us" n={10} compact /></Suspense>
            </div>
          </div>
          <p className="note">Ranked by market value (share price × shares) at delayed prices from Yahoo Finance, refreshed every 15 minutes.</p>
        </section>

        <section aria-labelledby="mk-h" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="section-head"><h2 id="mk-h">Every market</h2><p>Search covers the exchanges Yahoo Finance lists. For India you can also browse every company on the NSE.</p></div>
          <div className="grid-4">
            <Link href="/india" className="card tile" style={{ borderColor: "var(--accent)" }}>
              <span className="label">India · NSE</span>
              <h3>All <Suspense fallback="listed"><NseCount /></Suspense> NSE stocks</h3>
              <p>Browse the full list from the exchange&apos;s own file, A to Z, and open any of them.</p>
            </Link>
            {MARKETS.map((m) => (
              <Link key={m.country} href={`/stock/${encodeURIComponent(m.example[0])}`} className="card tile">
                <span className="label">{m.country} · {m.suffix}</span>
                <h3>{m.example[1]}</h3>
                <p className="mono small">{m.example[0]}</p>
              </Link>
            ))}
          </div>
        </section>

        <section aria-labelledby="ft-h" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="section-head"><h2 id="ft-h">What you get for each stock</h2></div>
          <div className="grid-3">
            {FEATURES.map(([k, d]) => (
              <div key={k} className="card quote-card">
                <span className="label">{k}</span>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
