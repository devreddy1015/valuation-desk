"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useStored, WATCH_KEY, type WatchItem, SETTINGS_KEY, DEFAULT_SETTINGS, type Settings } from "@/lib/client/storage";
import { dateLabel, money, pct } from "@/lib/format";

type SortKey = "name" | "upside" | "viewed";

/** The stocks this browser has valued, with the last price target seen for each. */
export default function Watchlist() {
  const [items, setItems, loaded] = useStored<WatchItem[]>(WATCH_KEY, []);
  const [settings] = useStored<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "viewed", dir: -1 });
  const rows = useMemo(() => {
    const r = [...items];
    r.sort((a, b) => {
      const va = sort.key === "name" ? a.name : sort.key === "upside" ? a.upside ?? -Infinity : a.viewed;
      const vb = sort.key === "name" ? b.name : sort.key === "upside" ? b.upside ?? -Infinity : b.viewed;
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
    return r;
  }, [items, sort]);
  if (!loaded) return null;
  if (!items.length) {
    return (
      <section className="card section" aria-labelledby="wl-h">
        <div className="section-head"><h2 id="wl-h">Your desk</h2></div>
        <p className="muted">Stocks you value appear here with their last price target, so you can compare them side by side. Search for a company above to start.</p>
      </section>
    );
  }
  const head = (key: SortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={key === "name" ? "left" : undefined}>
      <button type="button" className="sortbtn" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 }))}>
        {label}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
  return (
    <section className="card section" aria-labelledby="wl-h">
      <div className="section-head">
        <h2 id="wl-h">Your desk</h2>
        <p>The last result you saw for each stock, using your own inputs. Open a stock to refresh it with live prices.</p>
      </div>
      <div className="scroll">
        <table className="data">
          <thead><tr>{head("name", "Company")}<th>Price</th><th>{settings.calls ? "Target" : "Value"}</th>{head("upside", "Upside")}{settings.calls && <th>Call</th>}{head("viewed", "Last viewed")}<th><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.symbol}>
                <td><Link href={`/stock/${encodeURIComponent(w.symbol)}`} className="linkbtn">{w.name}</Link> <span className="muted mono small">{w.symbol}</span></td>
                <td>{money(w.price, w.currency)}</td>
                <td>{w.pt !== null ? money(w.pt, w.currency) : "–"}</td>
                <td>{pct(w.upside, 1, true)}</td>
                {settings.calls && <td>{w.rating}</td>}
                <td>{dateLabel(w.viewed)}</td>
                <td><button type="button" className="btn small ghost" onClick={() => setItems((p) => p.filter((x) => x.symbol !== w.symbol))} aria-label={`Remove ${w.name} from your desk`}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
