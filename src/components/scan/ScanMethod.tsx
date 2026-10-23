import Link from "next/link";

const ITEMS: [string, string][] = [
  ["Default inputs", "Each stock is valued the way the desk first opens it: revenue growth from analyst estimates (or the company's own history) fading to long-run growth, today's margin, a cost of capital built from the government bond yield, the stock's beta and the country's equity risk premium, base case."],
  ["DCF value", "A five-year free-cash-flow forecast plus a terminal value, discounted at the WACC, less debt, leases and minority interests, per share. Lenders, insurers and investment holding companies get no DCF: their debt is raw material, not financing, so the method does not describe them. Fee businesses such as payment networks, exchanges and fund managers do get one."],
  ["Peer value", "Peers are the other stocks in the same list: the same industry when at least three there have usable multiples, otherwise the same sector, otherwise the whole list. Financial firms are compared only with similar ones (lenders with lenders, insurers with insurers) and get no peer value when the list has fewer than three. The value is the average of the median EV/EBITDA and median P/E prices (P/E and P/B for financial firms), using the same limits as the desk to drop extreme multiples."],
  ["Value estimate and gap", "Half DCF, half peers when both exist, otherwise whichever exists. The gap is value estimate ÷ price − 1: +20% means the model puts the value a fifth above today's price. A value more than three times, or under a third of, the price is marked \"check first\": odd data or default inputs that don't fit the company are the usual cause, so it gets no call and is left out of the summary."],
  ["Return vs WACC", "The yearly return you would earn at today's price if the base-case forecast came true (the discount rate at which the DCF equals the price), next to the WACC the model asks for. Above the WACC means the price looks cheap on these assumptions."],
  ["Price implies vs history", "The steady revenue growth for five years that today's price needs (a reverse DCF), next to the company's average reported growth. A price that implies far less growth than the record sets a low bar."],
  ["Health", "The business-health grade from the desk's health check (A best, E worst), with its red flags. A dash means the grade could not be computed."],
  ["Freshness", "Prices are delayed and each stock's result is kept for 15 minutes, so a second scan soon after is quick. Market data comes from Yahoo Finance and can be wrong or missing."],
  ["Next step", "The scanner only shortlists. Open any stock for peers found across the market, your own forecast, scenarios and every check behind the number. Educational, not investment advice."],
];

/** The plain-English method box under the scanner. */
export default function ScanMethod() {
  return (
    <details className="card section scan-method">
      <summary><h2>How the scanner values each stock</h2></summary>
      <dl>
        {ITEMS.map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <p className="note">The full method, step by step, is on the <Link href="/method" className="accent">method page</Link>.</p>
    </details>
  );
}
