import { afterEach, describe, expect, it, vi } from "vitest";
import { SHARE_MAX_CHARS, ShareError, decodeShare, encodeShare, parseExportPayload, parseSharedState, readSharedFromHash, shareUrl, type SharedState } from "./client/share";

const rep5 = (v: number) => [v, v, v, v, v];
const drivers = (g: number) => ({ growth: [g, 7, 7, 6.5, 6], margin: rep5(21), tax: rep5(25.2), da: rep5(2.9), capex: rep5(1.6), wc: rep5(20) });
const state = (): SharedState => ({
  v: 1,
  symbol: "INFY.NS",
  inputs: {
    scenario: "bull",
    assume: { bear: drivers(6), base: drivers(9.5), bull: drivers(12.25) },
    rate: { rf: 7.437, spread: 1.75, beta: 0.81, erp: 6.92, kd: 8.9, g: 5 },
    dcfWeight: 60, buy: 15, sell: -10,
    probs: { bear: 20, base: 50, bull: 30 }, usePW: true,
    mc: { g: 2, m: 1.5, w: 1, t: 0.5, seed: 3 },
    peers: { "TCS.NS": true, "WIPRO.NS": false, "M&M.NS": true },
  },
  overrides: { "h:4:revenue": 1.7865e12, "b:cash": 4.3e11, "s:shares": 4.0529e9, "t:ebitda": 4.39e11 },
  extraPeers: [{ symbol: "ACN", name: "Accenture plc", industry: "Information Technology Services", currency: "INR", marketCap: 1.6e13, evEbitda: 14.2, pe: 22.9, evSales: 2.6, pb: null, margin: 0.155, growth: 0.04 }],
});

/** Builds a code from arbitrary JSON, the way an attacker would. */
const rawCode = (obj: unknown) => "j." + Buffer.from(JSON.stringify(obj)).toString("base64url");

afterEach(() => { vi.unstubAllGlobals(); });

describe("share codes", () => {
  it("round-trips through deflate-raw", async () => {
    const code = await encodeShare(state());
    expect(code.startsWith("z.")).toBe(true);
    expect(code).toMatch(/^z\.[A-Za-z0-9_-]+$/);
    expect(await decodeShare(code)).toEqual(state());
  });

  it("falls back to plain base64url JSON without CompressionStream, and still decodes", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    const code = await encodeShare(state());
    expect(code.startsWith("j.")).toBe(true);
    vi.unstubAllGlobals();
    expect(await decodeShare(code)).toEqual(state());
  });

  it("keeps an optional price and drops unknown keys from old saved objects before encoding", async () => {
    const s = state();
    s.inputs.price = 1180.5;
    (s.extraPeers[0] as unknown as Record<string, unknown>).sector = "Technology";
    const back = await decodeShare(await encodeShare(s));
    expect(back?.inputs.price).toBe(1180.5);
    expect(Object.keys(back!.extraPeers[0])).not.toContain("sector");
  });

  it("refuses to encode a state with a missing or non-finite input", async () => {
    const s = state();
    s.inputs.assume.base.margin[2] = NaN;
    await expect(encodeShare(s)).rejects.toBeInstanceOf(ShareError);
    await expect(encodeShare({ ...state(), inputs: {} as SharedState["inputs"] })).rejects.toBeInstanceOf(ShareError);
  });

  it("rejects tampered codes without throwing", async () => {
    const code = await encodeShare(state());
    // deflate-raw carries no checksum, so a flipped character may still inflate to a valid state:
    // the promise is only that the result is null or passes the same strict validation
    for (let i = 2; i < code.length; i += 7) {
      const flipped = code.slice(0, i) + (code[i] === "A" ? "B" : "A") + code.slice(i + 1);
      const r = await decodeShare(flipped);
      expect(r === null || parseSharedState(r) !== null).toBe(true);
    }
    for (const bad of [code.slice(0, -6), "z." + code.slice(2).split("").reverse().join(""), "x." + code.slice(2), "z.", "z.!!!", "", "j.e30", "j.bnVsbA", 42, null, undefined, {}])
      expect(await decodeShare(bad)).toBeNull();
  });

  it("validates the shape strictly", async () => {
    const ok = state();
    const mutate = (f: (s: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const s = JSON.parse(JSON.stringify(ok));
      f(s);
      return rawCode(s);
    };
    expect(await decodeShare(rawCode(ok))).toEqual(ok);
    const cases = [
      mutate((s) => { s.v = 2; }),
      mutate((s) => { s.symbol = "infy ns"; }),
      mutate((s) => { s.symbol = "<script>"; }),
      mutate((s) => { s.inputs.assume.base.growth.pop(); }),
      mutate((s) => { s.inputs.assume.bear.wc.push(1); }),
      mutate((s) => { s.inputs.assume.bull.tax[0] = "25"; }),
      mutate((s) => { s.inputs.assume.bull.tax[0] = null; }),
      mutate((s) => { delete s.inputs.assume.bull; }),
      mutate((s) => { s.inputs.assume.extreme = s.inputs.assume.bull; }),
      mutate((s) => { s.inputs.scenario = "moon"; }),
      mutate((s) => { s.inputs.rate.g = 1e9; }),
      mutate((s) => { delete s.inputs.rate.kd; }),
      mutate((s) => { s.inputs.usePW = "yes"; }),
      mutate((s) => { s.inputs.peers["TCS.NS"] = 1; }),
      mutate((s) => { s.inputs.peers["bad ticker"] = true; }),
      mutate((s) => { s.inputs.price = -5; }),
      mutate((s) => { s.inputs.extra = 1; }),
      mutate((s) => { s.overrides["x:1"] = 5; }),
      mutate((s) => { s.overrides["h:0:label"] = 5; }),
      mutate((s) => { s.overrides["b:date"] = 5; }),
      mutate((s) => { s.extraPeers[0].pe = "22"; }),
      mutate((s) => { s.extraPeers[0].symbol = "acn"; }),
      mutate((s) => { delete s.extraPeers[0].name; }),
      mutate((s) => { s.extraPeers = {}; }),
      mutate((s) => { s.note = "hi"; }),
    ];
    for (const c of cases) expect(await decodeShare(c)).toBeNull();
    // JSON numbers too large for a double parse to Infinity: still rejected as not finite
    expect(await decodeShare("j." + Buffer.from(JSON.stringify(ok).replace('"beta":0.81', '"beta":1e999')).toString("base64url"))).toBeNull();
    // a __proto__ key is just an unknown key
    expect(await decodeShare("j." + Buffer.from(JSON.stringify(ok).replace('"v":1,', '"v":1,"__proto__":{"polluted":true},')).toString("base64url"))).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("enforces the size limits, including a small code that inflates to a huge JSON", async () => {
    const big = rawCode({ ...state(), extraPeers: Array.from({ length: 30 }, (_, i) => ({ ...state().extraPeers[0], symbol: `P${i}`, name: "x".repeat(200), industry: "y".repeat(200) })) });
    expect(big.length).toBeGreaterThan(SHARE_MAX_CHARS);
    expect(await decodeShare(big)).toBeNull();
    // 2 MB of spaces deflates to about 2 KB: the decoder must stop at its JSON limit
    const bomb = new TextEncoder().encode(JSON.stringify(state()).replace("{", "{" + " ".repeat(2_000_000)));
    const z = new Uint8Array(await new Response(new Blob([bomb]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    const code = "z." + Buffer.from(z).toString("base64url");
    expect(code.length).toBeLessThan(SHARE_MAX_CHARS);
    expect(await decodeShare(code)).toBeNull();
    // and the encoder refuses to build a link that the decoder would refuse
    const noise = (n: number) => Array.from({ length: n }, () => String.fromCharCode(0x4e00 + Math.floor(Math.random() * 20000))).join("");
    const many = state();
    for (let i = 0; i < 29; i++) many.extraPeers.push({ ...many.extraPeers[0], symbol: `Q${i}`, name: noise(200), industry: noise(200) });
    await expect(encodeShare(many)).rejects.toBeInstanceOf(ShareError);
  });

  it("builds a hash link that never reaches the server", async () => {
    const s = { ...state(), symbol: "M&M.NS" };
    s.inputs.peers = {};
    const url = await shareUrl("https://valuation-desk.example/", s);
    expect(url.startsWith("https://valuation-desk.example/stock/M%26M.NS#v=z.")).toBe(true);
    const u = new URL(url);
    expect(u.pathname).toBe("/stock/M%26M.NS");
    expect((await decodeShare(new URLSearchParams(u.hash.slice(1)).get("v")))?.symbol).toBe("M&M.NS");
  });

  it("reads the hash only for the stock on screen", async () => {
    const url = new URL(await shareUrl("https://x.test", state()));
    vi.stubGlobal("window", { location: { hash: url.hash } });
    expect((await readSharedFromHash("INFY.NS"))?.inputs.scenario).toBe("bull");
    expect(await readSharedFromHash("infy.ns")).not.toBeNull();
    expect(await readSharedFromHash("TCS.NS")).toBeNull();
    vi.stubGlobal("window", { location: { hash: "#v=z.garbage" } });
    expect(await readSharedFromHash("INFY.NS")).toBeNull();
    vi.stubGlobal("window", { location: { hash: "" } });
    expect(await readSharedFromHash("INFY.NS")).toBeNull();
  });
});

describe("export payload", () => {
  const body = () => { const s = state(); return { symbol: " infy.ns ", inputs: { ...s.inputs, price: 1163.25 }, overrides: s.overrides, extraPeers: s.extraPeers }; };
  it("accepts the Desk payload and normalises the symbol", () => {
    const p = parseExportPayload({ ...body(), calls: true, now: 1_792_000_000_000 });
    expect(p?.symbol).toBe("INFY.NS");
    expect(p?.inputs.price).toBe(1163.25);
    expect(p?.calls).toBe(true);
    expect(parseSharedState({ v: 1, ...body(), symbol: "INFY.NS" })).not.toBeNull();
  });
  it("rejects bad payloads", () => {
    expect(parseExportPayload({ ...body(), symbol: "../../etc" })).toBeNull();
    expect(parseExportPayload({ ...body(), calls: "yes" })).toBeNull();
    expect(parseExportPayload({ ...body(), now: "today" })).toBeNull();
    expect(parseExportPayload({ ...body(), admin: true })).toBeNull();
    expect(parseExportPayload({ ...body(), inputs: { ...body().inputs, price: Number.NaN } })).toBeNull();
    expect(parseExportPayload(null)).toBeNull();
  });
});
