import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import SearchBox from "@/components/SearchBox";
import ThemeToggle, { themeInitScript } from "@/components/ThemeToggle";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Valuation Desk: value any listed company", template: "%s · Valuation Desk" },
  description: "DCF, peer comparison, reverse DCF and Monte Carlo for any listed company, starting with every NSE stock in India. Educational, not investment advice.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <header className="topbar">
          <div className="wrap">
            <Link href="/" className="brand"><span className="dot" aria-hidden="true" />Valuation Desk</Link>
            <nav className="nav" aria-label="Main">
              <Link href="/">Home</Link>
              <Link href="/india">All Indian stocks</Link>
              <Link href="/method">Method</Link>
            </nav>
            <span className="spacer" />
            <div className="top-search"><SearchBox compact placeholder="Search a company or ticker" /></div>
            <ThemeToggle />
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="foot">
          <div className="wrap">
            <p><b>Educational model, not investment advice.</b> Market data comes from Yahoo Finance through the open-source yahoo-finance2 library: it is unofficial, delayed, can be wrong or missing, and is not licensed for commercial use. Check every number against the company&apos;s filings before relying on it.</p>
            <p className="muted">Country risk premiums: Aswath Damodaran (NYU Stern). The list of Indian stocks: National Stock Exchange of India. Your inputs stay in your browser.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
