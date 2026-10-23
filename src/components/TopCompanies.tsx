import Link from "next/link";
import { connection } from "next/server";
import { dateLabel, lakhCrore, money, pct } from "@/lib/format";
import { getTopIndia } from "@/lib/server/universe";

/**
 * India's most valuable companies as a table, ranked live by market value. A server component that
 * reads request-time data, so it must sit inside <Suspense>.
 */
export default async function TopCompanies({ n = 50, compact = false }: { n?: number; compact?: boolean }) {
  await connection(); // quotes are fetched at request time and cached for 15 minutes
  const top = await getTopIndia(n).catch(() => null);
  if (!top) return <p className="muted">Market values are unavailable right now. Try again in a minute, or browse every NSE stock instead.</p>;
  const total = top.companies.reduce((s, c) => s + c.marketCap, 0);
  return (
    <>
      <div className="scroll">
        <table className="data top-table">
          <caption className="sr-only">India&apos;s {top.companies.length} most valuable listed companies, largest first</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col" className="left">Company</th>
              {!compact && <th scope="col" className="left">Industry</th>}
              <th scope="col">Market value</th>
              {!compact && <th scope="col" title="Share of the combined market value of these companies">Share</th>}
              <th scope="col">Price</th>
              <th scope="col">Today</th>
            </tr>
          </thead>
          <tbody>
            {top.companies.map((c) => (
              <tr key={c.symbol}>
                <td className="mono">{c.rank}</td>
                <td className="left"><Link className="top-name" href={`/stock/${encodeURIComponent(c.symbol)}`}>{c.name}</Link> <span className="muted mono small">{c.symbol.replace(/\.NS$/, "")}</span></td>
                {!compact && <td className="left muted">{c.industry || "–"}</td>}
                <td>{lakhCrore(c.marketCap)}</td>
                {!compact && <td>{pct(c.marketCap / total, 1)}</td>}
                <td>{money(c.price, "INR")}</td>
                <td className={c.changePct === null ? "muted" : c.changePct >= 0 ? "top-up" : "top-down"}>{c.changePct === null ? "–" : `${c.changePct > 0 ? "+" : c.changePct < 0 ? "−" : ""}${Math.abs(c.changePct).toFixed(2)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">Ranked by market value (share price × shares) at delayed prices from Yahoo Finance, refreshed every 15 minutes; checked {dateLabel(top.asOf)}. The candidates are the Nifty 200, so a company listed in the last few months may be missing until NSE adds it.</p>
    </>
  );
}
