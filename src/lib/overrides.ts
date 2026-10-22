import type { StockData } from "./types";

/** User edits to company data, keyed "h:<yearIndex>:<field>", "b:<bridgeField>", "t:<ttmField>" or "s:shares". */
export type Overrides = Record<string, number>;

export function applyOverrides(d: StockData, ov: Overrides): StockData {
  if (!Object.keys(ov).length) return d;
  const c: StockData = { ...d, history: d.history.map((y) => ({ ...y })), bridge: { ...d.bridge }, ttm: { ...d.ttm } };
  for (const [k, v] of Object.entries(ov)) {
    const [kind, a, b] = k.split(":");
    if (kind === "h" && c.history[+a]) (c.history[+a] as unknown as Record<string, number>)[b] = v;
    else if (kind === "b") (c.bridge as unknown as Record<string, number>)[a] = v;
    else if (kind === "t") (c.ttm as unknown as Record<string, number>)[a] = v;
    else if (kind === "s") c.shares = v;
  }
  if (ov["t:netIncome"] !== undefined || ov["s:shares"] !== undefined) c.ttm.eps = c.ttm.netIncome / c.shares;
  return c;
}
