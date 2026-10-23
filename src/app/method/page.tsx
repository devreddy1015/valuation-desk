import type { Metadata } from "next";

export const metadata: Metadata = { title: "Method", description: "How the Valuation Desk turns market data into a DCF, a peer value and ranges." };

const STEPS: [string, string][] = [
  ["Data", "Prices, shares, five years of annual statements, analyst revenue estimates and related stocks come from Yahoo Finance. When statements are in another currency than the share price (Infosys reports in US dollars, trades in rupees), each year is converted at that year's average exchange rate and the balance sheet at today's rate."],
  ["Forecast", "Five years of revenue growth, EBIT margin, tax, depreciation, capex and working capital, in bear, base and bull versions. The starter base case uses consensus revenue growth where it is consistent with history, fades to long-run growth by year five, and keeps the latest margin. Capex above depreciation fades to 1.15 times depreciation. Every driver is a placeholder for your own view."],
  ["Discount rate", "Cost of equity = risk-free rate + beta × equity risk premium. The risk-free rate is the 10-year government bond yield of the trading currency (sourced for India, live for the US, flagged as an estimate elsewhere), less the country default spread where the bond is not default-free. Beta is computed from two years of weekly returns against the country's main index. The equity risk premium comes from Aswath Damodaran's country table."],
  ["DCF", "Free cash flow to the firm, discounted from today to each fiscal year end, plus a Gordon-growth terminal value. Enterprise value, plus cash, minus borrowings, leases, minority interests and dividends already paid since the balance sheet, divided by shares outstanding."],
  ["Peers", "Related stocks from Yahoo, kept when they are in the same industry, with EV/EBITDA, P/E, EV/Sales and P/B rebuilt with all amounts in one currency. The peer value is the average of the median EV/EBITDA and median P/E prices (P/E and P/B for financial firms: lenders, insurers and investment holding companies, judged on their statements rather than Yahoo's label, so payment networks, exchanges and fund managers stay on the DCF)."],
  ["Result", "The value estimate blends the DCF and peer values with your weight, rounded to a sensible step. With calls switched on, upside above or below your thresholds becomes BUY or SELL; in between is HOLD."],
  ["Ranges", "A reverse DCF solves for the growth or margin that today's price implies. A sensitivity grid moves WACC and terminal growth by up to 1 point each. A Monte Carlo runs 2,000 futures with random shifts to growth, margin, WACC and terminal growth, and reports the share of runs above the price."],
  ["Expected return", "The discount rate at which your forecast is worth exactly today's price (an internal rate of return on the whole business), set against the WACC. Earnings power value capitalises last year's operating profit after tax with no growth at all, which splits the price into what today's business supports and what pays for growth."],
  ["Business health", "Three published screens on the annual accounts: Piotroski's F-score (2000), nine pass-or-fail tests of profitability, debt, liquidity and efficiency; Altman's Z'' (1995) for non-manufacturers and emerging markets, a distress score; and Beneish's M-score (1999), eight ratios that flagged companies later found to have manipulated earnings. Plus cash conversion, ROCE, ROE, interest cover, net debt to EBITDA, receivable days and dilution (bonus issues and splits are recognised). A 0 to 100 score blends them into a grade from A to E. Banks and insurers get lender ratios instead."],
  ["Its own past", "Monthly P/E and P/B from split-adjusted prices and each year's reported earnings and book value (used from two months after the year end), with the median and the middle 80% of months. Yahoo carries four to five years of statements, so this covers a few years, not a full cycle."],
  ["Scanner", "Each stock in an index is valued on the desk's default inputs without peers; then the other stocks in the same list act as peers (same industry when three or more exist, else the same sector, else the whole list), leaving the stock itself out of its own median. Values more than three times or less than a third of the price are marked for checking and left out of the summary."],
  ["Portfolio X-ray", "Your holdings, valued one by one like the scanner, converted to one currency at today's rates and averaged by value: the model gap, the expected return, the growth prices imply against what the companies delivered, health, and concentration (the effective number of holdings is one over the sum of squared weights). Holdings stay in your browser."],
  ["Sharing", "A share link carries your inputs in the part of the address after #, which browsers never send to a server; the person opening it sees your assumptions on today's prices. The Excel model rebuilds the valuation with live formulas, checked against this engine cell by cell."],
  ["Limits", "Yahoo data is unofficial and delayed, and can be wrong; edit any number in the Company data table. A free-cash-flow DCF does not suit banks, insurers or companies with large finance arms. Default inputs fit some companies badly (commodity producers, turnarounds, young companies), so treat scanner rankings as a list of things to look at, not answers. Nothing here is investment advice."],
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
