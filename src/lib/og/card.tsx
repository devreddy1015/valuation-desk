// Shared pieces for the link-preview images (WhatsApp, LinkedIn, X). Satori needs inline styles
// and display:flex on every element with more than one child.
import type { ReactNode } from "react";

export const OG_SIZE = { width: 1200, height: 630 };
export const C = { bg: "#07080b", card: "#0f1217", line: "#2a313d", ink: "#f1f4f9", ink2: "#b3bbc8", muted: "#8a93a3", accent: "#5b84ff", good: "#35c97a", bad: "#ff7b7b" };

/** Amount with an ISO code instead of a symbol: the image font has no ₹ or ¥ glyph. */
export function ogMoney(v: number, cur: string): string {
  if (!Number.isFinite(v)) return "–";
  const d = Math.abs(v) >= 100 ? 0 : 2;
  return `${cur} ${v.toLocaleString(cur === "INR" ? "en-IN" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.ink, padding: "56px 64px", fontFamily: "sans-serif",
      backgroundImage: `linear-gradient(${C.card} 1px, transparent 1px), linear-gradient(90deg, ${C.card} 1px, transparent 1px)`, backgroundSize: "56px 56px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 28, fontWeight: 600 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: C.accent }} />
        Valuation Desk
      </div>
      {children}
      <div style={{ display: "flex", marginTop: "auto", fontSize: 22, color: C.muted }}>Educational model, not investment advice · live data from Yahoo Finance, delayed</div>
    </div>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "good" | "bad" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 8, border: `1px solid ${C.line}`, borderRadius: 18, padding: "22px 26px", background: C.card }}>
      <div style={{ display: "flex", fontSize: 20, letterSpacing: 2, textTransform: "uppercase", color: C.muted }}>{label}</div>
      <div style={{ display: "flex", fontSize: 50, fontWeight: 700, color: tone === "good" ? C.good : tone === "bad" ? C.bad : C.ink }}>{value}</div>
      {note ? <div style={{ display: "flex", fontSize: 22, color: C.ink2 }}>{note}</div> : null}
    </div>
  );
}
