"use client";
import { useRef, useState } from "react";
import { big, bigUnit, money } from "@/lib/format";

type TipRow = [string, string, string?];
interface TipState { x: number; y: number; w: number; title: string; rows: TipRow[] }

/** One tooltip per chart: marks call bind() to show it on hover and on keyboard focus. */
function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const place = (cx: number, cy: number, title: string, rows: TipRow[]) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: cx - box.left, y: cy - box.top, w: box.width, title, rows });
  };
  const bind = (title: string, rows: TipRow[]) => ({
    tabIndex: 0,
    role: "img" as const,
    "aria-label": `${title}: ${rows.map((r) => `${r[0]} ${r[1]}`).join(", ")}`,
    onPointerMove: (e: React.PointerEvent) => place(e.clientX, e.clientY, title, rows),
    onPointerLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent<Element>) => { const b = e.currentTarget.getBoundingClientRect(); place(b.left + b.width / 2, b.top, title, rows); },
    onBlur: () => setTip(null),
  });
  const node = tip ? (
    <div className="tip" style={{ left: Math.max(0, Math.min(tip.x + 14, tip.w - 230)), top: Math.max(0, tip.y - 70) }} aria-hidden="true">
      <div className="t">{tip.title}</div>
      {tip.rows.map((r) => (
        <div className="r" key={r[0]}><span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>{r[2] && <i className="key-line" style={{ background: r[2] }} />}{r[0]}</span><b>{r[1]}</b></div>
      ))}
    </div>
  ) : null;
  return { ref, bind, node, setTip, place };
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo)) return [lo];
  const span = hi - lo, raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export interface RangeRow { label: string; sub: string; lo: number; hi: number; mid?: number; midLabel?: string; neutral?: boolean }

export function FootballField({ rows, price, target, currency, targetLabel }: { rows: RangeRow[]; price: number; target: number | null; currency: string; targetLabel: string }) {
  const { ref, bind, node } = useTip();
  const valid = rows.filter((r) => Number.isFinite(r.lo) && Number.isFinite(r.hi));
  const vals = valid.flatMap((r) => [r.lo, r.hi]).concat([price], target !== null && Number.isFinite(target) ? [target] : []).filter(Number.isFinite);
  const W = 760, left = 200, right = 30, top = 48, rowH = 46, H = top + rowH * rows.length + 36;
  const lo = Math.min(...vals) * 0.94, hi = Math.max(...vals) * 1.04;
  const X = (v: number) => left + ((v - lo) / (hi - lo)) * (W - left - right);
  const ticks = niceTicks(lo, hi, 6).filter((v) => v >= lo && v <= hi);
  const pX = X(price), tX = target !== null && Number.isFinite(target) ? X(target) : null;
  const tRight = tX === null || tX >= pX;
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Valuation ranges per share">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={X(v)} x2={X(v)} y1={top - 6} y2={top + rowH * rows.length} stroke="var(--grid)" />
            <text x={X(v)} y={top + rowH * rows.length + 20} textAnchor="middle" fontSize="12" fill="var(--muted)">{money(v, currency, 0)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cy = top + rowH * i + rowH / 2;
          const ok = Number.isFinite(r.lo) && Number.isFinite(r.hi);
          return (
            <g key={r.label}>
              <text x="0" y={cy - 3} fontSize="13.5" fontWeight="600" fill="var(--ink)">{r.label}</text>
              <text x="0" y={cy + 13} fontSize="11.5" fill="var(--muted)">{r.sub}</text>
              {ok ? (
                <g {...bind(`${r.label} · ${r.sub}`, [["Low", money(r.lo, currency)], ...(r.mid !== undefined && Number.isFinite(r.mid) ? [[r.midLabel ?? "Mid", money(r.mid, currency)] as TipRow] : []), ["High", money(r.hi, currency)]])}>
                  <rect x={left} y={cy - rowH / 2} width={W - left - right} height={rowH} fill="transparent" />
                  <rect className="mark" x={X(r.lo)} y={cy - 8} width={Math.max(3, X(r.hi) - X(r.lo))} height="16" rx="4" fill={r.neutral ? "var(--neutral-mark)" : "var(--s1)"} />
                  {r.mid !== undefined && Number.isFinite(r.mid) && <circle cx={X(r.mid)} cy={cy} r="5" fill="var(--card)" stroke="var(--ink)" strokeWidth="2" />}
                </g>
              ) : <text x={left} y={cy + 4} fontSize="12.5" fill="var(--muted)">Not available with the current inputs</text>}
            </g>
          );
        })}
        <line x1={pX} x2={pX} y1={top - 10} y2={top + rowH * rows.length} stroke="var(--ink-2)" strokeWidth="1.5" />
        <text x={tRight ? pX - 6 : pX + 6} y={top - 18} textAnchor={tRight ? "end" : "start"} fontSize="12.5" fill="var(--ink-2)">Price {money(price, currency)}</text>
        {tX !== null && (
          <>
            <line x1={tX} x2={tX} y1={top - 10} y2={top + rowH * rows.length} stroke="var(--accent)" strokeWidth="2" />
            <text x={tRight ? tX + 6 : tX - 6} y={top - 18} textAnchor={tRight ? "start" : "end"} fontSize="12.5" fontWeight="700" fill="var(--accent)">{targetLabel} {money(target, currency)}</text>
          </>
        )}
      </svg>
      {node}
    </div>
  );
}

export function RevenueChart({ years, actual, series, live, currency }: { years: string[]; actual: number[]; series: Record<"bear" | "base" | "bull", number[]>; live: string; currency: string }) {
  const { ref, node, place, setTip } = useTip();
  const svgRef = useRef<SVGSVGElement>(null);
  const [idx, setIdx] = useState<number | null>(null);
  const nA = actual.length, all = [...actual, ...series.bear, ...series.base, ...series.bull].filter(Number.isFinite);
  const W = 760, H = 310, left = 70, right = 120, top = 30, bottom = 32;
  const ticks = niceTicks(Math.min(...all) * 0.95, Math.max(...all) * 1.02, 5);
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const n = years.length;
  const X = (i: number) => left + (i * (W - left - right)) / (n - 1);
  const Y = (v: number) => top + ((hi - v) / (hi - lo)) * (H - top - bottom);
  const color = { bear: "var(--s2)", base: "var(--s1)", bull: "var(--s3)" } as const;
  const path = (vals: number[], i0: number) => vals.map((v, j) => `${j ? "L" : "M"}${X(i0 + j).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const u = bigUnit(currency);
  const ends = (["bear", "base", "bull"] as const).map((k) => ({ k, v: series[k][series[k].length - 1], y: Y(series[k][series[k].length - 1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 30) ends[i].y = ends[i - 1].y + 30;
  const showAt = (i: number) => {
    const k = Math.max(0, Math.min(n - 1, i));
    setIdx(k);
    const rows: TipRow[] = [];
    if (k < nA) rows.push(["Actual", big(actual[k], currency), "var(--neutral-mark)"]);
    if (k >= nA - 1) (["bull", "base", "bear"] as const).forEach((s) => rows.push([s[0].toUpperCase() + s.slice(1), big(k === nA - 1 ? actual[nA - 1] : series[s][k - nA], currency), color[s]]));
    const b = svgRef.current?.getBoundingClientRect();
    if (b) place(b.left + (X(k) / W) * b.width, b.top + 40, `Revenue ${years[k]} (${u.label})`, rows);
  };
  return (
    <div className="chart" ref={ref}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue history and three scenario paths">
        <text x="0" y="12" fontSize="11.5" fill="var(--muted)">{u.label}</text>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={left} x2={W - right} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" />
            <text x={left - 8} y={Y(v) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{big(v, currency)}</text>
          </g>
        ))}
        <line x1={X(nA - 1)} x2={X(nA - 1)} y1={top} y2={H - bottom} stroke="var(--line-2)" />
        <text x={X(nA - 1) + 6} y={top + 12} fontSize="11.5" fill="var(--muted)">forecast →</text>
        {years.map((y, i) => <text key={y} x={X(i)} y={H - 10} textAnchor="middle" fontSize="11.5" fill="var(--muted)">{y}</text>)}
        <path d={path(actual, 0)} fill="none" stroke="var(--neutral-mark)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {(["bear", "base", "bull"] as const).map((k) => <path key={k} d={path([actual[nA - 1], ...series[k]], nA - 1)} fill="none" stroke={color[k]} strokeWidth={k === live ? 2.6 : 2} strokeLinejoin="round" strokeLinecap="round" />)}
        {ends.map((e) => (
          <g key={e.k}>
            <circle cx={X(n - 1)} cy={Y(e.v)} r="4.5" fill={color[e.k]} stroke="var(--card)" strokeWidth="2" />
            <text x={X(n - 1) + 12} y={e.y - 2} fontSize="12.5" fontWeight="600" fill="var(--ink-2)">{e.k[0].toUpperCase() + e.k.slice(1)}</text>
            <text x={X(n - 1) + 12} y={e.y + 13} fontSize="12" fill="var(--muted)">{big(e.v, currency)}</text>
          </g>
        ))}
        {idx !== null && <line x1={X(idx)} x2={X(idx)} y1={top} y2={H - bottom} stroke="var(--ink-2)" />}
        <rect x={left} y={top} width={W - left - right} height={H - top - bottom} fill="transparent" tabIndex={0} aria-label="Revenue by year; use the left and right arrow keys"
          onPointerMove={(e) => { const b = svgRef.current!.getBoundingClientRect(); const x = ((e.clientX - b.left) / b.width) * W; showAt(Math.round(((x - left) / (W - left - right)) * (n - 1))); }}
          onPointerLeave={() => { setIdx(null); setTip(null); }}
          onFocus={() => showAt(idx ?? n - 1)} onBlur={() => { setIdx(null); setTip(null); }}
          onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); showAt((idx ?? n - 1) - 1); } if (e.key === "ArrowRight") { e.preventDefault(); showAt((idx ?? 0) + 1); } }} />
      </svg>
      {node}
    </div>
  );
}

export function FcfChart({ years, fcf, pv, df, currency }: { years: string[]; fcf: number[]; pv: number[]; df: number[]; currency: string }) {
  const { ref, bind, node } = useTip();
  const W = 760, H = 270, left = 70, right = 16, top = 34, bottom = 30;
  const maxV = Math.max(...fcf, ...pv, 1), minV = Math.min(0, ...fcf, ...pv);
  const ticks = niceTicks(minV, maxV * 1.1, 4);
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const Y = (v: number) => top + ((hi - v) / (hi - lo)) * (H - top - bottom);
  const band = (W - left - right) / years.length, bw = 22, gap = 2;
  const bar = (x: number, v: number, fill: string) => {
    const y0 = Y(0), y1 = Y(v), h = Math.abs(y0 - y1), r = Math.min(4, h);
    const d = v >= 0
      ? `M${x} ${y0} V${y1 + r} Q${x} ${y1} ${x + r} ${y1} H${x + bw - r} Q${x + bw} ${y1} ${x + bw} ${y1 + r} V${y0} Z`
      : `M${x} ${y0} V${y1 - r} Q${x} ${y1} ${x + r} ${y1} H${x + bw - r} Q${x + bw} ${y1} ${x + bw} ${y1 - r} V${y0} Z`;
    return <path className="mark" d={d} fill={fill} />;
  };
  const u = bigUnit(currency);
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Free cash flow and present value by forecast year">
        <text x="0" y="12" fontSize="11.5" fill="var(--muted)">{u.label}</text>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={left} x2={W - right} y1={Y(v)} y2={Y(v)} stroke={v === 0 ? "var(--line-2)" : "var(--grid)"} />
            <text x={left - 8} y={Y(v) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{big(v, currency)}</text>
          </g>
        ))}
        {years.map((y, i) => {
          const cx = left + band * i + band / 2;
          return (
            <g key={y}>
              <g {...bind(y, [["Free cash flow", big(fcf[i], currency), "var(--s1)"], ["Present value", big(pv[i], currency), "var(--s1-soft)"], ["Discount factor", df[i].toFixed(3)]])}>
                <rect x={cx - band / 2 + 4} y={top} width={band - 8} height={H - top - bottom} fill="transparent" />
                {bar(cx - bw - gap / 2, fcf[i], "var(--s1)")}
                {bar(cx + gap / 2, pv[i], "var(--s1-soft)")}
                <text x={cx - bw / 2 - gap / 2} y={Y(Math.max(fcf[i], 0)) - 6} textAnchor="middle" fontSize="12" fill="var(--ink-2)">{big(fcf[i], currency)}</text>
              </g>
              <text x={cx} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--muted)">{y}</text>
            </g>
          );
        })}
      </svg>
      {node}
    </div>
  );
}

export function Histogram({ vals, price, target, currency, targetLabel }: { vals: number[]; price: number; target: number | null; currency: string; targetLabel: string }) {
  const { ref, bind, node } = useTip();
  if (!vals.length) return <p className="muted">No simulated outcomes with the current inputs.</p>;
  const lo0 = vals[Math.floor(vals.length * 0.01)], hi0 = vals[Math.ceil(vals.length * 0.99) - 1];
  const bins = 32, w = (hi0 - lo0) / bins || 1;
  const counts = Array(bins).fill(0);
  vals.forEach((v) => { const b = Math.min(bins - 1, Math.max(0, Math.floor((v - lo0) / w))); counts[b]++; });
  const maxC = Math.max(...counts);
  const W = 760, H = 240, left = 16, right = 16, top = 30, bottom = 34;
  const X = (v: number) => left + ((v - lo0) / (hi0 - lo0)) * (W - left - right);
  const bw = (W - left - right) / bins;
  const Y = (c: number) => top + (1 - c / maxC) * (H - top - bottom);
  const ticks = niceTicks(lo0, hi0, 6).filter((v) => v >= lo0 && v <= hi0);
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Distribution of simulated values per share">
        <line x1={left} x2={W - right} y1={H - bottom} y2={H - bottom} stroke="var(--line-2)" />
        {ticks.map((v) => <text key={v} x={X(v)} y={H - 12} textAnchor="middle" fontSize="12" fill="var(--muted)">{money(v, currency, 0)}</text>)}
        {counts.map((c, i) => {
          const a = lo0 + i * w, b = a + w;
          return (
            <g key={i} {...bind(`${i === 0 ? "≤ " : ""}${money(a, currency, 0)} to ${i === bins - 1 ? "≥ " : ""}${money(b, currency, 0)}`, [["Runs", String(c)], ["Share", ((c / vals.length) * 100).toFixed(1) + "%"]])}>
              <rect x={left + i * bw} y={top} width={bw} height={H - top - bottom} fill="transparent" />
              {c > 0 && <rect className="mark" x={left + i * bw + 1} y={Y(c)} width={Math.max(1, bw - 2)} height={H - bottom - Y(c)} rx="2" fill={b <= price ? "var(--s1-soft)" : "var(--s1)"} />}
            </g>
          );
        })}
        {price >= lo0 && price <= hi0 && <><line x1={X(price)} x2={X(price)} y1={top - 6} y2={H - bottom} stroke="var(--ink-2)" strokeWidth="1.5" /><text x={X(price) - 6} y={top - 12} textAnchor="end" fontSize="12.5" fill="var(--ink-2)">Price {money(price, currency)}</text></>}
        {target !== null && Number.isFinite(target) && target >= lo0 && target <= hi0 && <><line x1={X(target)} x2={X(target)} y1={top - 6} y2={H - bottom} stroke="var(--accent)" strokeWidth="2" /><text x={X(target) + 6} y={top - 12} fontSize="12.5" fontWeight="700" fill="var(--accent)">{targetLabel} {money(target, currency)}</text></>}
      </svg>
      {node}
      <div className="legend"><span><i className="key-box" style={{ background: "var(--s1-soft)" }} />Runs below today&apos;s price</span><span><i className="key-box" style={{ background: "var(--s1)" }} />Runs above it</span></div>
    </div>
  );
}
