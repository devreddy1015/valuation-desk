// Spot-check the review fixes on live data: shares, EBIT repair, implied growth, financial flag.
import { getStockData, getPeers } from "../src/lib/server/yahoo.ts";
import { compute, defaultInputs } from "../src/lib/model.ts";
for (const s of process.argv.slice(2)) {
  try {
    const d = await getStockData(s);
    const peers = await getPeers(d.symbol, d.industry, d.sector).catch((e) => { console.log("  peers failed:", (e as Error).message); return []; });
    const inp = defaultInputs(d, peers);
    const R = compute(inp, d, peers, Date.now());
    const L = d.history.at(-1)!;
    console.log(`${s} | ${d.industry} | financial ${d.financial} | shares ${(d.shares / 1e6).toFixed(0)}mn cap/(p*sh) ${(d.marketCap / (d.price * d.shares)).toFixed(3)} | EPS ${d.ttm.eps.toFixed(2)} P/E ${(d.price / d.ttm.eps).toFixed(1)} BVPS ${d.bookValuePerShare?.toFixed(2)} | margin ${(L.ebit / L.revenue * 100).toFixed(1)}% wc ${inp.assume.base.wc[0]}% | DCF ${R.live.vps.toFixed(1)} vs ${d.price.toFixed(1)} | impG ${R.impliedGrowth.toFixed(2)} (case ${R.liveAvgGrowth.toFixed(1)}) | value ${R.pt} | peers ${peers.length}`);
    console.log("   returned:", d.bridge.returnedNote.slice(0, 200));
    d.warnings.filter((w) => /share count|operating profit|Lenders/.test(w)).forEach((w) => console.log("   warn:", w.slice(0, 220)));
  } catch (e) { console.log(s, "ERROR", (e as Error).message); }
}
