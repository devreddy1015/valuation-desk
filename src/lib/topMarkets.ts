// The markets with a "50 most valuable companies" list: display settings shared by the pages, the
// table and the scanner. The candidate lists and the ranking itself live in server/universe.ts.

export type TopMarket = "india" | "us" | "uk" | "japan" | "germany" | "china";

export interface TopMarketInfo {
  market: TopMarket;
  country: string; // "India"
  possessive: string; // "India's"
  path: string; // page with the full list
  scanId: string; // scanner list id
  currency: string; // market values are shown in this currency
  sectorLabel: string; // heading of the sector column
  unitNote: string; // how market values are written
  candidatesNote: string; // what the ranking is drawn from and what it can miss
}

export const TOP_MARKETS: Record<TopMarket, TopMarketInfo> = {
  india: {
    market: "india", country: "India", possessive: "India's", path: "/india/top", scanId: "top50", currency: "INR", sectorLabel: "Industry",
    unitNote: "Market value in lakh crore rupees (1 lakh crore = ₹1,00,000 crore).",
    candidatesNote: "The candidates are the Nifty 200, so a company listed in the last few months may be missing until NSE adds it.",
  },
  us: {
    market: "us", country: "United States", possessive: "The US's", path: "/us/top", scanId: "top50us", currency: "USD", sectorLabel: "Sector",
    unitNote: "Market value in US dollars: T is trillion, B billion.",
    candidatesNote: "The candidates are about 115 of the largest US-headquartered companies, so a fast riser from outside that list, or a US-listed company based abroad, is not shown.",
  },
  uk: {
    market: "uk", country: "United Kingdom", possessive: "The UK's", path: "/uk/top", scanId: "top50uk", currency: "GBP", sectorLabel: "Sector",
    unitNote: "Market value in pounds: B is billion. Prices on the London Stock Exchange are quoted in pence; they are shown here in pounds.",
    candidatesNote: "The candidates are the FTSE 100 companies (investment trusts left out), so a company that joins the index after the list was checked is missing.",
  },
  japan: {
    market: "japan", country: "Japan", possessive: "Japan's", path: "/japan/top", scanId: "top50jp", currency: "JPY", sectorLabel: "Sector",
    unitNote: "Market value in yen: T is trillion (¥1,000 billion), B billion.",
    candidatesNote: "The candidates are about 90 of the largest companies on the Tokyo Stock Exchange, so a fast riser from outside that list is not shown.",
  },
  germany: {
    market: "germany", country: "Germany", possessive: "Germany's", path: "/germany/top", scanId: "top50de", currency: "EUR", sectorLabel: "Sector",
    unitNote: "Market value in euros: B is billion.",
    candidatesNote: "The candidates are the German companies in the DAX and the larger MDAX names; companies based abroad but listed in Frankfurt (Airbus, Qiagen) are left out, as is any fast riser from outside the list.",
  },
  china: {
    market: "china", country: "China", possessive: "China's", path: "/china/top", scanId: "top50cn", currency: "CNY", sectorLabel: "Sector",
    unitNote: "Market value in Chinese yuan (CN¥): T is trillion, B billion. Hong Kong-listed values are converted from Hong Kong dollars at today's rate.",
    candidatesNote: "The candidates are about 80 of the largest companies in Shanghai, Shenzhen and Hong Kong, one listing each: the mainland (A) share for companies listed in both places, whose market value covers the whole company. Chinese companies listed only in the US (PDD) and any fast riser from outside the list are not shown.",
  },
};
export const TOP_ORDER: TopMarket[] = ["india", "us", "uk", "japan", "germany", "china"];
