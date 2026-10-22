import type { Metadata } from "next";
import ScanMethod from "@/components/scan/ScanMethod";
import Scanner from "@/components/scan/Scanner";
import { listUniverses } from "@/lib/server/universe";
import "@/styles/scan.css";

export const metadata: Metadata = {
  title: "Opportunity scanner",
  description: "Value every stock in the Nifty 50, Next 50, midcap and sector indices or the Dow, then rank them by value gap, expected return, health and the growth the price implies. Educational, not investment advice.",
};

export default function ScanPage() {
  return (
    <div className="wrap scan-page">
      <header className="scan-head">
        <p className="label">Opportunity scanner · find</p>
        <h1>Rank a whole index.<span className="accent"> Find what to value next.</span></h1>
        <p className="lede">
          The scanner values every stock in a list with a DCF and with peers from the same list, then ranks them: the biggest gap between value and price,
          the best return if the forecast comes true, the prices that assume the least growth, and the healthiest businesses.
        </p>
      </header>
      <Scanner universes={listUniverses()} />
      <ScanMethod />
    </div>
  );
}
