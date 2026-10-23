import { money0 as money, pct } from "@/lib/format";
import type { AnalystView } from "@/lib/types";
import "@/styles/outlook.css";

const fin = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
/** Yahoo's average rating runs from 1 (strong buy) to 5 (strong sell). */
function ratingWord(m: number): string {
  return m <= 1.5 ? "Strong buy" : m <= 2.5 ? "Buy" : m <= 3.5 ? "Hold" : m <= 4.5 ? "Sell" : "Strong sell";
}
const KINDS = [
  { key: "strongBuy", label: "Strong buy", cls: "ol-sb" }, { key: "buy", label: "Buy", cls: "ol-b" }, { key: "hold", label: "Hold", cls: "ol-h" },
  { key: "sell", label: "Sell", cls: "ol-s" }, { key: "strongSell", label: "Strong sell", cls: "ol-ss" },
] as const;

/** A horizontal scale with markers: the shared drawing for the analyst range and the risk band. */
export function Scale({ lo, hi, bands = [], marks, currency, label }: {
  lo: number; hi: number; currency: string; label: string;
  bands?: { from: number; to: number; cls: string }[];
  marks: { at: number; text: string; cls: string }[];
}) {
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`;
  return (
    <div className="ol-scale" role="img" aria-label={label}>
      <div className="ol-track">
        {bands.map((b) => <span key={b.cls + b.from} className={`ol-band ${b.cls}`} style={{ left: at(b.from), width: `calc(${at(b.to)} - ${at(b.from)})` }} />)}
        {marks.map((m) => <span key={m.text} className={`ol-mark ${m.cls}`} style={{ left: at(m.at) }} title={`${m.text}: ${money(m.at, currency)}`} />)}
      </div>
      <div className="ol-legend" aria-hidden="true">
        {marks.map((m) => <span key={m.text}><i className={`ol-dot ${m.cls}`} />{m.text} {money(m.at, currency)}</span>)}
      </div>
    </div>
  );
}

/** What the analysts covering a stock expect: their targets and ratings, set against the model. */
export default function AnalystPanel({ a, price, currency, value, valueLabel }: {
  a: AnalystView | null | undefined; price: number; currency: string; value: number | null; valueLabel: string;
}) {
  const head = (
    <div className="section-head">
      <h2 id="an-h">What analysts expect</h2>
      <p>Price targets and ratings from the brokers&apos; analysts who cover the stock, as Yahoo collects them. Their opinion, not this app&apos;s; set against the model so you can see where you differ.</p>
    </div>
  );
  if (!a || (!fin(a.mean) && !a.ratings.length)) {
    return (
      <section className="card section" aria-labelledby="an-h">
        {head}
        <p className="muted">No analyst coverage on Yahoo for this company. Smaller companies are often not covered at all, which makes your own analysis matter more.</p>
      </section>
    );
  }
  const now = a.ratings.find((r) => r.period === "0m") ?? a.ratings[0];
  const before = a.ratings.find((r) => r.period === "-3m");
  const count = (r: typeof now) => (r ? r.strongBuy + r.buy + r.hold + r.sell + r.strongSell : 0);
  const buys = (r: typeof now) => (r ? r.strongBuy + r.buy : 0), sells = (r: typeof now) => (r ? r.sell + r.strongSell : 0);
  const total = count(now);
  const targets = fin(a.mean) && fin(a.low) && fin(a.high);
  const lo = Math.min(...[a.low, price, value].filter(fin)) * 0.95, hi = Math.max(...[a.high, price, value].filter(fin)) * 1.05;
  const diff = fin(value) && fin(a.mean) ? value / a.mean - 1 : null;
  return (
    <section className="card section" aria-labelledby="an-h">
      {head}
      {targets && (
        <>
          <p className="ol-lead">
            {a.n ? `${a.n} analysts' ` : "Analysts' "}average 12-month target is <b>{money(a.mean, currency)}</b>, {pct(a.mean! / price - 1, 1, true)} against today&apos;s {money(price, currency)}
            {fin(a.median) ? ` (median ${money(a.median, currency)})` : ""}. The range runs from {money(a.low, currency)} to {money(a.high, currency)}.
          </p>
          <Scale lo={lo} hi={hi} currency={currency} label={`Analyst targets from ${money(a.low, currency)} to ${money(a.high, currency)}, average ${money(a.mean, currency)}, against a price of ${money(price, currency)}`}
            bands={[{ from: a.low!, to: a.high!, cls: "ol-band-an" }]}
            marks={[
              { at: price, text: "Price", cls: "ol-m-price" },
              { at: a.mean!, text: "Analysts' average", cls: "ol-m-an" },
              ...(fin(value) ? [{ at: value, text: valueLabel.charAt(0).toUpperCase() + valueLabel.slice(1), cls: "ol-m-value" }] : []),
            ]} />
        </>
      )}
      {now && total > 0 && (
        <div className="ol-ratings">
          <p className="small">
            <b>Ratings this month:</b> {buys(now)} buy, {now.hold} hold, {sells(now)} sell
            {fin(a.recommendationMean) ? `; the average works out to "${ratingWord(a.recommendationMean)}" (${a.recommendationMean.toFixed(1)} on a 1 to 5 scale, 1 = strong buy)` : ""}.
            {before && count(before) > 0 ? ` Three months ago: ${buys(before)} buy, ${before.hold} hold, ${sells(before)} sell.` : ""}
          </p>
          <div className="ol-stack" aria-hidden="true">
            {KINDS.map((k) => now[k.key] > 0 && <span key={k.key} className={k.cls} style={{ flexGrow: now[k.key] }}>{now[k.key]}</span>)}
          </div>
          <div className="ol-legend" aria-hidden="true">{KINDS.map((k) => <span key={k.key}><i className={`ol-dot ${k.cls}`} />{k.label} {now[k.key]}</span>)}</div>
        </div>
      )}
      {diff !== null && (
        <p className="small">Your {valueLabel} of {money(value, currency)} is {Math.abs(diff) < 0.02 ? "close to" : `${pct(Math.abs(diff), 0)} ${diff > 0 ? "above" : "below"}`} the analysts&apos; average{Math.abs(diff) >= 0.15 ? ": a big gap is worth explaining, it usually comes down to growth or margin assumptions." : "."}</p>
      )}
      <p className="note">Targets are usually for 12 months ahead and tend to run optimistic; brokers that cover a company often do business with it. Counts and targets come from different updates, so they may not match exactly.</p>
    </section>
  );
}
