import type { Metadata } from "next";
import Portfolio from "@/components/portfolio/Portfolio";
import "@/styles/portfolio.css";

export const metadata: Metadata = {
  title: "Portfolio X-ray",
  description: "Import your holdings (a Zerodha CSV works as is) and see what the whole portfolio is priced for, how healthy the businesses are, and where it is concentrated. Educational, not investment advice.",
};

export default function PortfolioPage() {
  return (
    <div className="wrap pf">
      <header className="pf-head">
        <p className="label">Portfolio X-ray · check</p>
        <h1>Everything you own, through one model.<span className="accent"> What is it priced for?</span></h1>
        <p className="lede">Each holding is valued with a DCF on default inputs and checked for business health; then the portfolio is read as a whole: the return it would earn if the forecasts come true, the growth the prices assume, and how concentrated it is.</p>
      </header>
      <Portfolio />
    </div>
  );
}
