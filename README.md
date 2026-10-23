# Valuation Desk

Find, check and value any listed company, with live prices and five years of statements:

- `/scan`: the opportunity scanner. Values every stock in a Nifty index (50, Next 50, Midcap, Smallcap, sector and theme indices) or the Dow 30, with peers taken from the same list, and ranks them by value gap, expected return, the growth the price implies against history, and business health.
- `/portfolio`: the portfolio X-ray. Import holdings (Zerodha Kite/Console CSV, any CSV, or pasted lines) and read the whole portfolio through the model: value gap, expected return, expectations gap, health, concentration and mix.
- `/stock/<SYMBOL>`: the valuation desk for one company (for example `INFY.NS`, `500325.BO`, `AAPL`, `BP.L`, `7203.T`): DCF with bear/base/bull, peers, reverse DCF, Monte Carlo, sensitivity, a plain-English story, expected return and earnings power value, a business health check (Piotroski, Altman Z'', Beneish M), the P/E and P/B band against its own past, share links, a client summary, CSV, print, and an Excel model with live formulas.
- `/india`: every NSE-listed company, A to Z.

Educational model, not investment advice.

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # engine, health check, returns, story, bands, scanner, portfolio and share-link tests
npm run build && npm start
```

## Deploy to Vercel

```bash
npx vercel login
npx vercel deploy --prod
```

No environment variables or API keys are needed.

## Data and its limits

- Prices, statements, estimates and related stocks: Yahoo Finance via the open-source `yahoo-finance2` library. It is unofficial, delayed and not licensed for commercial use; Yahoo can rate-limit or change it without notice. For a commercial service, replace `src/lib/server/yahoo.ts` with a licensed provider.
- Every NSE equity: the National Stock Exchange's own daily `EQUITY_L.csv`.
- Country equity risk premiums: Aswath Damodaran's country risk table (India uses his July 2026 update).
- Risk-free rates: India is a sourced value (21 Oct 2026); US uses the live 10-year Treasury yield; other currencies are flagged as estimates for the user to replace.
- Users' inputs and data edits are stored only in their own browser (localStorage).

## Where things are

- `src/lib/model.ts`: the valuation engine (pure functions), tested in `src/lib/model.test.ts`
- `src/lib/quality.ts` (health check), `returns.ts` (IRR, EPV), `story.ts` (plain English), `bands.ts` (P/E and P/B history), `scanMath.ts` (scanner peers and ranking), `portfolio.ts` (import parsers and X-ray), `excel.ts` (workbook builder): pure and unit-tested
- `src/lib/client/share.ts`: share-link encoding and strict validation (also used by `/api/excel`)
- `src/lib/server/`: data adapters (Yahoo, NSE list and index constituents, Damodaran table, price history) with an in-memory cache
- `src/components/`: the desk, scanner and portfolio interfaces and charts
- `src/app/`: pages and API routes (`/api/search`, `/api/peer`, `/api/scan/row`, `/api/scan/universe`, `/api/history`, `/api/fx`, `POST /api/excel`), plus link-preview images
