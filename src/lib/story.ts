// The valuation as a few plain-English sentences, each tied to a number: what the price implies,
// how the user's case compares, what the business earns at today's price, how much of the price
// pays for growth, and how wide the range of outcomes is. Banks and insurers get peers and ROE.
import { FORECAST_YEARS, type MonteCarlo, type Valuation } from "./model";
import type { HealthReport } from "./quality";
import { lastRoe, type Returns } from "./returns";
import type { StockData, UserInputs } from "./types";
import { money, mult, pct } from "./format";

export type Tone = "good" | "bad" | "neutral";
export interface StoryPoint { key: string; text: string; tone: Tone }
export interface Story {
  headline: string;
  accent: string; // the phrase in the headline to highlight (a substring of it)
  tone: Tone;
  points: StoryPoint[];
}
export interface StoryInput {
  data: StockData;
  inp: UserInputs;
  R: Valuation;
  MC?: MonteCarlo | null;
  ret?: Returns | null;
  health?: HealthReport | null;
  calls: boolean;
}

/**
 * Thresholds behind the words. Tones are read from the side of someone paying today's price:
 * "good" = the numbers lean in the price's favour, "bad" = the price asks a lot of the future.
 * - growthPts / growthRel: implied growth is "roughly in line" with history when the gap is within
 *   max(2 percentage points, 20% of the historical rate); otherwise "slower" or "more".
 * - value: the DCF is "close to" the price within ±10%.
 * - spread: an expected return within ±0.5 points of the WACC is "about the same".
 * - growthLow / growthHigh: up to 25% of the price paying for growth reads well; 60% or more asks a lot.
 * - mcGood / mcBad: 60% or more of simulated values above the price reads well; 40% or less asks a lot.
 * - peers: a bank's P/E or P/B within ±15% of the peer median is "in line".
 * - roe: return on equity within ±1 point of the cost of equity is "about the same".
 */
export const STORY_RULES = { growthPts: 0.02, growthRel: 0.2, value: 0.1, spread: 0.005, growthLow: 0.25, growthHigh: 0.6, mcGood: 0.6, mcBad: 0.4, peers: 0.15, roe: 0.01 };

const fin = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const UNIT: Record<string, string> = { INR: "rupee", USD: "dollar", GBP: "pound", EUR: "euro", JPY: "yen", AUD: "dollar", CAD: "dollar", SGD: "dollar", HKD: "dollar", CHF: "franc" };

/** Revenue growth a year over the reported history: compound from the first to the last positive year. */
export function historicalGrowth(data: StockData): { rate: number; from: string; to: string } | null {
  const h = data.history.filter((y) => fin(y.revenue) && y.revenue > 0);
  if (h.length < 2) return null;
  const a = h[0], b = h[h.length - 1];
  const years = Math.max(1, Math.round((Date.parse(b.end) - Date.parse(a.end)) / (365.25 * 864e5)));
  const rate = Math.pow(b.revenue / a.revenue, 1 / years) - 1;
  return fin(rate) ? { rate, from: a.label, to: b.label } : null;
}

/** "slower" / "more" / "in line": implied growth (fraction) against historical growth (fraction). */
export function growthVerdict(implied: number, hist: number): "slower" | "more" | "in line" {
  const gap = implied - hist, thr = Math.max(STORY_RULES.growthPts, STORY_RULES.growthRel * Math.abs(hist));
  return gap < -thr ? "slower" : gap > thr ? "more" : "in line";
}

const band = (x: number, lo: number, hi: number): Tone => (x >= hi ? "good" : x <= lo ? "bad" : "neutral");

function callSentence(R: Valuation, inp: UserInputs, cur: string): string {
  if (!R.ok || R.rating === "–") return "";
  const w = Math.round(R.w * 100);
  const how = !R.dcfOk || w === 0 ? "peers only" : w === 100 ? "DCF only" : `${w}% DCF and ${100 - w}% peers`;
  return ` The model's call is ${R.rating}: a value estimate of ${money(R.pt, cur)} (${how}) is ${pct(R.upside, 1, true)} against today's price, with the lines you set at ${pct(inp.buy / 100, 0, true)} and ${pct(inp.sell / 100, 0, true)}.`;
}

export function storyFor({ data, inp, R, MC, ret, health, calls }: StoryInput): Story {
  const cur = data.currency, price = inp.price, sc = inp.scenario, name = data.name || data.symbol;
  const points: StoryPoint[] = [];
  const call = calls ? callSentence(R, inp, cur) : "";
  let head: Omit<Story, "points"> = { headline: "Not enough data for a plain-English verdict", accent: "Not enough data", tone: "neutral" };

  if (!data.financial) {
    const hg = historicalGrowth(data);
    const ig = fin(R.impliedGrowth) ? R.impliedGrowth / 100 : null;
    const years = `${R.fyLabels[0]}–${R.fyLabels[FORECAST_YEARS - 1]}`;
    const dcfOk = R.live.valid && fin(R.live.vps);

    // 1. what the price implies against what the company has delivered
    if (dcfOk && ig !== null) {
      const v = hg ? growthVerdict(ig, hg.rate) : null;
      const past = hg ? ` ${name} grew revenue by ${pct(hg.rate)} a year between ${hg.from} and ${hg.to}, so the price asks for ${v === "slower" ? "less than" : v === "more" ? "more than" : "about what"} it has delivered.` : "";
      points.push({ key: "implied", tone: v === "slower" ? "good" : v === "more" ? "bad" : "neutral", text: `At today's price of ${money(price, cur)}, the market is pricing in revenue growth of about ${pct(ig)} a year for ${years}, holding the rest of your ${sc} case.${past}` });
      head = v === "slower" ? { headline: "Priced for slower growth than it has delivered", accent: "slower growth", tone: "good" }
        : v === "more" ? { headline: "Priced for more growth than it has delivered", accent: "more growth", tone: "bad" }
        : v === "in line" ? { headline: "Priced roughly in line with its history", accent: "roughly in line", tone: "neutral" }
        : { headline: `Priced for about ${pct(ig)} revenue growth a year`, accent: pct(ig), tone: "neutral" };
    } else if (dcfOk) {
      points.push({ key: "implied", tone: "neutral", text: `No constant revenue growth between −60% and +100% a year makes your ${sc} case match today's price of ${money(price, cur)}, so check the margins and the cash and debt in the bridge.` });
      head = { headline: "No growth rate in the model's range matches the price", accent: "No growth rate", tone: "neutral" };
    } else {
      head = { headline: "The DCF can't value it with these inputs", accent: "can't value it", tone: "neutral" };
    }

    // 2. the user's own case
    if (dcfOk) {
      const up = R.live.vps / price - 1;
      const cmp = ig === null || !fin(R.liveAvgGrowth) ? "" : R.liveAvgGrowth / 100 > ig + 0.0005 ? ", more than the price implies," : R.liveAvgGrowth / 100 < ig - 0.0005 ? ", less than the price implies," : ", about what the price implies,";
      const where = Math.abs(up) < 0.005 ? "in line with today's price" : `${pct(Math.abs(up), 0)} ${up > 0 ? "above" : "below"} today's price`;
      const assumes = fin(R.liveAvgGrowth) ? ` assumes ${pct(R.liveAvgGrowth / 100)} revenue growth a year on average${cmp} and` : "";
      points.push({ key: "case", tone: band(up, -STORY_RULES.value, STORY_RULES.value), text: `Your ${sc} case${assumes} values the shares at ${money(R.live.vps, cur)}, ${where}.${call}` });
    } else {
      points.push({ key: "case", tone: "neutral", text: `Your ${sc} case doesn't give a usable DCF value: the WACC must stay above terminal growth and the value must come out positive.${call}` });
    }

    // 3. expected return against the required return
    if (ret?.irr != null && fin(ret.spread)) {
      const s = ret.spread, close = Math.abs(s) <= STORY_RULES.spread;
      points.push({ key: "return", tone: close ? "neutral" : s > 0 ? "good" : "bad", text: `If your ${sc} case comes true, the whole business would return about ${pct(ret.irr)} a year at today's price, ${close ? "about the same as" : `${(Math.abs(s) * 100).toFixed(1)} percentage points ${s > 0 ? "more" : "less"} than`} the ${pct(ret.wacc)} a year the model requires (the WACC).` });
    } else if (ret?.irrStatus === "below-range") {
      points.push({ key: "return", tone: "bad", text: `Even a required return just above terminal growth would not make your ${sc} case worth today's price, so the price asks for more than this forecast.` });
    } else if (ret?.irrStatus === "above-range") {
      points.push({ key: "return", tone: "neutral", text: `At today's price your ${sc} case would return more than ${pct(ret.irrRange?.[1] ?? 0.6, 0)} a year; a result that high usually means the forecast or the data needs a second look.` });
    }

    // 4. how much of the price pays for growth
    const last = data.history[data.history.length - 1];
    if (ret && fin(ret.epv) && fin(ret.growthShare)) {
      const fy = ret.epvParts?.fy ?? last?.label ?? "last year";
      if (ret.epv >= price) points.push({ key: "growth", tone: "good", text: `Today's profits alone cover the price: ${fy} operating profit after tax, held flat for ever, is worth ${money(ret.epv, cur)} a share against ${money(price, cur)}.` });
      else if (ret.epv <= 0) points.push({ key: "growth", tone: "bad", text: `${fy} operating profit after tax, held flat for ever, doesn't cover the debt and other claims, so the whole price rests on growth or a recovery.` });
      else {
        const g = ret.growthShare;
        points.push({ key: "growth", tone: g <= STORY_RULES.growthLow ? "good" : g >= STORY_RULES.growthHigh ? "bad" : "neutral", text: `About ${pct(g, 0)} of today's price pays for future growth. The other ${pct(1 - g, 0)}, ${money(ret.epv, cur)} a share, is what ${fy} operating profit after tax is worth if it never grows.` });
      }
    } else if (ret && last && !(last.ebit > 0)) {
      points.push({ key: "growth", tone: "bad", text: `${last.label} ended with no operating profit, so the whole price rests on a recovery or growth.` });
    }

    // 5. the spread of simulated outcomes
    if (dcfOk && MC && MC.n > 0 && fin(MC.p10) && fin(MC.p90) && fin(MC.probAbove)) {
      points.push({ key: "range", tone: band(MC.probAbove, STORY_RULES.mcBad, STORY_RULES.mcGood), text: `Across ${MC.n.toLocaleString("en-US")} simulated futures around your ${sc} case, the middle 80% of values runs from ${money(MC.p10, cur)} to ${money(MC.p90, cur)} a share, and ${pct(MC.probAbove, 0)} of them are worth more than today's price.` });
    }
  } else {
    // Banks and insurers: multiples against peers, and what the equity earns against what it costs.
    const n = R.peers.filter((p) => p.included).length;
    const rel = (k: "pe" | "pb") => (fin(R.subject[k]) && fin(R.stats[k].med) && R.stats[k].med > 0 ? R.subject[k] / R.stats[k].med - 1 : NaN);
    const peerPoint = (k: "pe" | "pb", what: string, unit: string) => {
      const d = rel(k);
      if (!fin(R.subject[k])) return { key: k, tone: "bad" as Tone, text: `${what} is zero or negative, so a ${unit} can't be calculated.` };
      if (!fin(d)) return { key: k, tone: "neutral" as Tone, text: `${name} trades at ${mult(R.subject[k])} ${what.toLowerCase()}; there is no peer median to compare with.` };
      const inLine = Math.abs(d) <= STORY_RULES.peers;
      return { key: k, tone: (inLine ? "neutral" : d < 0 ? "good" : "bad") as Tone, text: `At ${mult(R.subject[k])} ${what.toLowerCase()}, ${name} trades ${inLine ? "roughly in line with" : `${pct(Math.abs(d), 0)} ${d < 0 ? "below" : "above"}`} the median of ${n} peer${n === 1 ? "" : "s"} (${mult(R.stats[k].med)}).` };
    };
    const pe = peerPoint("pe", "Trailing earnings", "P/E"), pb = peerPoint("pb", "Book value", "P/B");
    pe.text += call;
    points.push(pe, pb);
    const dPe = rel("pe"), dPb = rel("pb"), d = fin(dPe) ? dPe : dPb, on = fin(dPe) ? "on earnings" : "on book value";
    const { roe, fy } = ret?.roe !== undefined ? { roe: ret.roe, fy: ret.roeYear ?? null } : lastRoe(data.history);
    if (fin(d)) {
      head = d < -STORY_RULES.peers ? { headline: `Valued below its peers ${on}`, accent: "below its peers", tone: "good" }
        : d > STORY_RULES.peers ? { headline: `Valued above its peers ${on}`, accent: "above its peers", tone: "bad" }
        : { headline: `Valued roughly in line with its peers ${on}`, accent: "roughly in line", tone: "neutral" };
    } else if (fin(roe) && fin(R.ke)) {
      head = roe >= R.ke ? { headline: "Earns more than its cost of equity", accent: "more", tone: "good" } : { headline: "Earns less than its cost of equity", accent: "less", tone: "bad" };
    }
    if (fin(roe) && fin(R.ke)) {
      const fair = R.ke > R.g && roe > R.g ? (roe - R.g) / (R.ke - R.g) : NaN;
      const rule = fin(fair) ? ` A simple rule, fair P/B = (ROE − g) ÷ (cost of equity − g), gives about ${mult(fair)}${fin(R.subject.pb) ? ` against ${mult(R.subject.pb)} today` : ""}, if that return lasts.` : "";
      const gap = roe - R.ke;
      points.push({ key: "roe", tone: Math.abs(gap) <= STORY_RULES.roe ? "neutral" : gap > 0 ? "good" : "bad", text: `Return on equity was ${pct(roe)} in ${fy ?? "the last reported year"}, ${Math.abs(gap) <= STORY_RULES.roe ? "about the same as" : gap > 0 ? "above" : "below"} the ${pct(R.ke)} a year shareholders require (the cost of equity).${rule}` });
    }
    const ey = ret?.earningsYield ?? (price > 0 && fin(data.ttm.eps) ? data.ttm.eps / price : null), bond = ret?.bondYield ?? inp.rate.rf / 100;
    if (fin(ey) && fin(bond)) {
      const per = `per ${UNIT[cur] ?? "unit of currency"} of price`;
      points.push({ key: "yield", tone: ey >= bond ? "good" : "neutral", text: `Earnings yield is ${pct(ey)} (trailing earnings ÷ price) against ${pct(bond)} on a 10-year government bond: ${ey >= bond ? `more profit ${per} than the bond pays, though profits are less certain than interest` : `less profit ${per} than the bond pays, so the price counts on earnings growing`}.` });
    }
  }

  // 6. business health, when the health check ran
  if (health && health.grade !== "–" && health.summary) {
    const tone: Tone = health.grade === "A" || health.grade === "B" ? "good" : health.grade === "D" || health.grade === "E" ? "bad" : "neutral";
    points.push({ key: "health", tone, text: `Business health grade ${health.grade}${fin(health.score) ? ` (${Math.round(health.score)} out of 100)` : ""}: ${health.summary.replace(/\s+$/, "")}${/[.!?]$/.test(health.summary.trim()) ? "" : "."}` });
  }

  return { ...head, points: points.slice(0, 6) };
}
