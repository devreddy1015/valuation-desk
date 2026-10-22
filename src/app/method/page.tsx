import type { Metadata } from "next";

export const metadata: Metadata = { title: "Method", description: "How the Valuation Desk turns market data into a DCF, a peer value and ranges." };

const STEPS: [string, string][] = [
  ["Data", "Prices, shares, five years of annual statements, analyst revenue estimates and related stocks come from Yahoo Finance. When statements are in another currency than the share price (Infosys reports in US dollars, trades in rupees), each year is converted at that year's average exchange rate and the balance sheet at today's rate."],
  ["Forecast", "Five years of revenue growth, EBIT margin, tax, depreciation, capex and working capital, in bear, base and bull versions. The starter base case uses consensus revenue growth where it is consistent with history, fades to long-run growth by year five, and keeps the latest margin. Capex above depreciation fades to 1.15 times depreciation. Every driver is a placeholder for your own view."],
  ["Discount rate", "Cost of equity = risk-free rate + beta × equity risk premium. The risk-free rate is the 10-year government bond yield of the trading currency (sourced for India, live for the US, flagged as an estimate elsewhere), less the country default spread where the bond is not default-free. Beta is computed from two years of weekly returns against the country's main index. The equity risk premium comes from Aswath Damodaran's country table."],
  ["DCF", "Free cash flow to the firm, discounted from today to each fiscal year end, plus a Gordon-growth terminal value. Enterprise value, plus cash, minus borrowings, leases, minority interests and dividends already paid since the balance sheet, divided by shares outstanding."],
  ["Peers", "Related stocks from Yahoo, kept when they are in the same industry, with EV/EBITDA, P/E, EV/Sales and P/B rebuilt with all amounts in one currency. The peer value is the average of the median EV/EBITDA and median P/E prices (P/E and P/B for banks and insurers)."],
  ["Result", "The value estimate blends the DCF and peer values with your weight, rounded to a sensible step. With calls switched on, upside above or below your thresholds becomes BUY or SELL; in between is HOLD."],
  ["Ranges", "A reverse DCF solves for the growth or margin that today's price implies. A sensitivity grid moves WACC and terminal growth by up to 1 point each. A Monte Carlo runs 2,000 futures with random shifts to growth, margin, WACC and terminal growth, and reports the share of runs above the price."],
  ["Limits", "Yahoo data is unofficial and delayed, and can be wrong; edit any number in the Company data table. A free-cash-flow DCF does not suit banks, insurers or companies with large finance arms. Nothing here is investment advice."],
];

export default function Method() {
  return (
    <div className="wrap" style={{ display: "flex", flexDirection: "column", gap: 20, paddingBlock: "28px 48px", maxWidth: 980 }}>
      <p className="label">Method</p>
      <h1 style={{ fontSize: "clamp(28px, 4vw, 44px)", letterSpacing: "-0.03em", fontWeight: 600 }}>How a number becomes a value.<span className="accent"> Every step is visible.</span></h1>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {STEPS.map(([k, d], i) => (
          <li key={k} className="card section" style={{ flexDirection: "row", gap: 18 }}>
            <span className="mono accent" style={{ fontSize: 13, minWidth: 28 }}>{String(i + 1).padStart(2, "0")}</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><h2 style={{ fontSize: 17 }}>{k}</h2><p style={{ color: "var(--ink-2)", maxWidth: "75ch" }}>{d}</p></div>
          </li>
        ))}
      </ol>
    </div>
  );
}
