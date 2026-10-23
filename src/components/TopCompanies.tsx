import Link from "next/link";
import { connection } from "next/server";
import { dateLabel, marketValue, money, pct } from "@/lib/format";
import { getTopCompanies } from "@/lib/server/universe";
import { TOP_MARKETS, type TopMarket } from "@/lib/topMarkets";

/**
 * A market's most valuable companies as a table, ranked live by market value. A server component that
 * reads request-time data, so it must sit inside <Suspense>. `compact` drops the industry, share and
 * price columns so two tables fit side by side.
 */
export default async function TopCompanies({ market = "india", n = 50, compact = false }: { market?: TopMarket; n?: number; compact?: boolean }) {
  await connection(); // quotes are fetched at request time and cached for 15 minutes
  const top = await getTopCompanies(market, n).catch(() => null);
  if (!top) return <p className="muted">Market values are unavailable right now. Try again in a minute.</p>;
  const info = TOP_MARKETS[market];
  const total = top.companies.reduce((s, c) => s + c.marketCap, 0);
  const local = (symbol: string) => symbol.replace(/\.(NS|L|T)$/, "");
  return (
    <>
      <div className="scroll">
        <table className="data top-table">
          <caption className="sr-only">{info.possessive} {top.companies.length} most valuable listed companies, largest first</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col" className="left">Company</th>
              {!compact && <th scope="col" className="left">{info.sectorLabel}</th>}
              <th scope="col">Market value</th>
              {!compact && <th scope="col" title="Share of the combined market value of these companies">Share</th>}
              {!compact && <th scope="col">Price</th>}
              <th scope="col">Today</th>
            </tr>
          </thead>
          <tbody>
            {top.companies.map((c) => (
              <tr key={c.symbol}>
                <td className="mono">{c.rank}</td>
                <td className="left"><Link className="top-name" href={`/stock/${encodeURIComponent(c.symbol)}`}>{c.name}</Link> <span className="muted mono small">{local(c.symbol)}</span></td>
                {!compact && <td className="left muted">{c.industry || "–"}</td>}
                <td>{marketValue(c.marketCap, info.currency)}</td>
                {!compact && <td>{pct(c.marketCap / total, 1)}</td>}
                {!compact && <td>{money(c.price, c.currency)}</td>}
                <td className={c.changePct === null ? "muted" : c.changePct >= 0 ? "top-up" : "top-down"}>{c.changePct === null ? "–" : `${c.changePct > 0 ? "+" : c.changePct < 0 ? "−" : ""}${Math.abs(c.changePct).toFixed(2)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!compact && <p className="note">Ranked by market value (share price × shares) at delayed prices from Yahoo Finance, refreshed every 15 minutes; checked {dateLabel(top.asOf)}. {info.candidatesNote}</p>}
    </>
  );
}
