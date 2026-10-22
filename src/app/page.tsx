import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import SearchBox from "@/components/SearchBox";
import Watchlist from "@/components/Watchlist";
import { getNseListings } from "@/lib/server/nse";

const QUICK = [
  ["INFY.NS", "Infosys"], ["TCS.NS", "TCS"], ["RELIANCE.NS", "Reliance"], ["HDFCBANK.NS", "HDFC Bank"], ["BHARTIARTL.NS", "Bharti Airtel"],
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

const FEATURES = [
  ["DCF", "Five-year free cash flow forecast with bear, base and bull cases, a WACC you build step by step, and the bridge from enterprise value to a share price."],
  ["Comps", "Peers from the same industry, found automatically and editable, with median EV/EBITDA and P/E turned into a value per share."],
  ["Reverse DCF", "The revenue growth and margin that today's price already assumes, set against your own forecast."],
  ["Monte Carlo", "Two thousand simulated futures and the chance the stock is worth more than its price."],
  ["Sensitivity", "A WACC against terminal growth grid that shows how much your answer depends on two inputs nobody knows."],
  ["Client report", "A one-page summary to copy, print or save as PDF, plus a CSV of every input and output."],
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
          <h1 id="hero-h">Value any listed company.<span className="accent">From Infosys to Toyota, in minutes.</span></h1>
          <p className="lede">Live prices and five years of statements, turned into a DCF, a peer comparison, scenarios and a client-ready summary. Every input is yours to change; every number shows where it came from.</p>
          <div className="hero-search"><SearchBox /></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {QUICK.map(([s, n]) => <Link key={s} className="chip" href={`/stock/${encodeURIComponent(s)}`}>{n} <span className="muted">{s}</span></Link>)}
          </div>
        </div>
      </section>

      <div className="wrap" style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 48 }}>
        <Watchlist />

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
          <div className="section-head"><h2 id="ft-h">What the desk does for each stock</h2></div>
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
