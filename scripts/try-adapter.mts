import { getStockData, getPeers } from "../src/lib/server/yahoo.ts";
import { compute, defaultInputs } from "../src/lib/model.ts";
const syms = process.argv.slice(2);
for (const s of syms) {
  try {
    const d = await getStockData(s);
    const peers = await getPeers(d.symbol, d.industry, d.sector);
    const inp = defaultInputs(d, peers);
    const R = compute(inp, d, peers, Date.now());
    const L = d.history[d.history.length - 1];
    const U = d.currency === "INR" ? 1e7 : 1e6;
    console.log(JSON.stringify({
      sym: d.symbol, name: d.name, cur: d.currency, fin: d.financialCurrency, price: d.price, shares: d.shares, mcap: d.marketCap, capCheck: (d.price * d.shares / d.marketCap).toFixed(3),
      country: d.country, industry: d.industry, financial: d.financial,
      years: d.history.map(y => y.label), revLast: Math.round(L.revenue / U), ebitLast: Math.round(L.ebit / U), margin: (L.ebit / L.revenue).toFixed(3),
      bridge: Object.fromEntries(Object.entries(d.bridge).map(([k, v]) => [k, typeof v === "number" ? Math.round(v / U) : String(v).slice(0, 80)])),
      ttm: { rev: Math.round(d.ttm.revenue / U), ebitda: Math.round(d.ttm.ebitda / U), ni: Math.round(d.ttm.netIncome / U), eps: d.ttm.eps.toFixed(2) },
      est: d.estimates, beta: d.beta, yBeta: d.yahooBeta, rf: d.riskFree, erp: d.erp,
      peers: peers.map(p => `${p.symbol}:${p.evEbitda?.toFixed(1)}/${p.pe?.toFixed(1)}`),
      out: { dcf: R.live.vps.toFixed(1), comps: R.compsValue.toFixed(1), pt: R.pt, up: (R.upside * 100).toFixed(1), wacc: (R.wacc * 100).toFixed(2), impG: R.impliedGrowth.toFixed(2), tv: R.live.tvShare.toFixed(2) },
      warn: d.warnings, fx: d.fxNote?.slice(0, 120),
    }));
  } catch (e) { console.log(s, "ERROR", (e as Error).message); }
}
