# Valuation Desk

Value any listed company: DCF, peer comparison, reverse DCF, scenarios, sensitivity and Monte Carlo, with live prices and five years of statements. Every NSE-listed company in India can be browsed at `/india`; any stock Yahoo Finance lists can be opened at `/stock/<SYMBOL>` (for example `INFY.NS`, `500325.BO`, `AAPL`, `BP.L`, `7203.T`).

Educational model, not investment advice.

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # valuation-engine regression tests
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
- `src/lib/server/`: data adapters (Yahoo, NSE list, Damodaran table) with an in-memory cache
- `src/components/desk/`: the valuation desk interface and charts
- `src/app/`: pages (`/`, `/india`, `/stock/[symbol]`, `/method`) and API routes (`/api/search`, `/api/peer`)
