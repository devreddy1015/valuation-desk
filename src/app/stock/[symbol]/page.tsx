import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import Loading from "./loading";
import Desk from "@/components/desk/Desk";
import SearchBox from "@/components/SearchBox";
import { DataError, getPeers, getStockData } from "@/lib/server/yahoo";

type Props = { params: Promise<{ symbol: string }> };

const TICKER = /^[A-Z0-9^.\-=&]{1,24}$/;
/** The path segment as a symbol, or "" when it can't be one (a stray "%" makes decodeURIComponent throw). */
function symbolFrom(raw: string): string {
  try { return decodeURIComponent(raw).trim().toUpperCase(); } catch { return ""; }
}

// The title only ever repeats what Yahoo returned, never the address: otherwise any text typed into a
// /stock/... link would show up as the page title and the link preview under the site's name.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const symbol = symbolFrom((await params).symbol);
  const d = TICKER.test(symbol) ? await getStockData(symbol).catch(() => null) : null;
  if (!d) return { title: "Stock not found", robots: { index: false } };
  return { title: `${d.name} (${d.symbol})`, description: `Value ${d.name} with a DCF, peers, a business health check and a plain-English summary. Educational model, not investment advice.` };
}

type Loaded = { ok: true; data: Awaited<ReturnType<typeof getStockData>>; peers: Awaited<ReturnType<typeof getPeers>>; now: number } | { ok: false; title: string; body: string };

async function load(symbol: string): Promise<Loaded> {
  if (!TICKER.test(symbol)) return { ok: false, title: "That is not a ticker", body: "That address doesn't contain a stock symbol. Search by company name instead." };
  try {
    const data = await getStockData(symbol);
    const peers = await getPeers(data.symbol, data.industry, data.sector).catch(() => []);
    return { ok: true, data, peers, now: Date.now() };
  } catch (e) {
    if (e instanceof DataError) {
      const title = e.code === "not_found" ? `No data for ${symbol}` : e.code === "unsupported" ? `${symbol} can't be valued here` : "Market data is unavailable";
      return { ok: false, title, body: e.message + (e.code === "not_found" ? ". Indian stocks need .NS (NSE) or .BO (BSE) after the symbol, for example INFY.NS." : ".") };
    }
    return { ok: false, title: "Market data is unavailable right now", body: "Yahoo Finance did not answer. This happens when it limits requests; try again in a minute." };
  }
}

async function StockContent({ params }: Props) {
  const { symbol: raw } = await params;
  await connection();
  const r = await load(symbolFrom(raw));
  if (!r.ok) return <Problem title={r.title} body={r.body} />;
  return <Desk data={r.data} peers={r.peers} now={r.now} />;
}

export default function StockPage({ params }: Props) {
  return <Suspense fallback={<Loading />}><StockContent params={params} /></Suspense>;
}

function Problem({ title, body }: { title: string; body: string }) {
  return (
    <div className="wrap" style={{ paddingBlock: "48px" }}>
      <section className="card empty">
        <p className="label">Valuation desk</p>
        <h1 style={{ fontSize: 28, letterSpacing: "-0.02em" }}>{title}</h1>
        <p className="muted" style={{ maxWidth: "60ch" }}>{body}</p>
        <div style={{ width: "min(560px, 100%)" }}><SearchBox /></div>
        <Link className="btn" href="/india">Browse every NSE stock</Link>
      </section>
    </div>
  );
}
