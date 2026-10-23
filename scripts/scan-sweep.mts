// Score a whole universe through the running server, the way the scanner page does, and list outliers.
// Usage: npx tsx scripts/scan-sweep.mts http://localhost:3123 nifty50 dow30
import { scoreRows, summarize } from "../src/lib/scanMath.ts";
import type { ScanRow, Universe } from "../src/lib/scanTypes.ts";
const [base, ...ids] = process.argv.slice(2);
for (const id of ids) {
  const u = ((await (await fetch(`${base}/api/scan/universe?id=${id}`)).json()) as { universe: Universe }).universe;
  const rows: ScanRow[] = [], fails: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < u.members.length) {
      const m = u.members[next++];
      const r = await fetch(`${base}/api/scan/row?symbol=${encodeURIComponent(m.symbol)}`);
      const j = (await r.json()) as { row?: ScanRow; error?: string };
      if (j.row) rows.push(j.row); else fails.push(`${m.symbol}: ${r.status} ${j.error}`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const scored = scoreRows(rows, (s) => u.members.find((m) => m.symbol === s)?.group);
  const s = summarize(scored);
  console.log(`\n== ${u.name}: ${rows.length}/${u.members.length} valued, ${fails.length} failed | median gap ${(s.medianGap! * 100).toFixed(1)}% | extreme ${s.extreme} | median return ${(s.medianReturn! * 100).toFixed(1)}% vs WACC ${(s.medianWacc! * 100).toFixed(1)}%`);
  fails.forEach((f) => console.log("  FAIL", f));
  const fmt = (r: (typeof scored)[number]) => `${r.symbol.padEnd(14)} ${r.financial ? "FIN" : "   "} gap ${r.valueGap === null ? "  n/a" : ((r.valueGap * 100).toFixed(0) + "%").padStart(6)} ${r.method.padEnd(9)} ${r.peers.basis}/${r.peers.n} impG ${r.impliedGrowth?.toFixed(1) ?? "–"} hist ${r.histGrowth?.toFixed(1) ?? "–"} grade ${r.health.grade}${r.extreme ? "  CHECK" : ""}`;
  const sorted = [...scored].sort((a, b) => (b.valueGap ?? -9) - (a.valueGap ?? -9));
  console.log("  top:"); sorted.slice(0, 6).forEach((r) => console.log("   ", fmt(r)));
  console.log("  bottom:"); sorted.filter((r) => r.valueGap !== null).slice(-5).forEach((r) => console.log("   ", fmt(r)));
  console.log("  financial:"); scored.filter((r) => r.financial).forEach((r) => console.log("   ", fmt(r)));
}
