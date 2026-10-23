import type { Metadata } from "next";
import TopPage from "@/components/TopPage";
import { TOP_MARKETS } from "@/lib/topMarkets";

export const metadata: Metadata = {
  title: `${TOP_MARKETS.germany.possessive} 50 most valuable companies`,
  description: "The 50 largest listed companies in Germany by today's market value, ranked live, each one click from a full valuation. Educational, not investment advice.",
};

export default function Page() {
  return <TopPage market="germany" />;
}
