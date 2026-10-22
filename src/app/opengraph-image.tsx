import { ImageResponse } from "next/og";
import { C, Frame, OG_SIZE } from "@/lib/og/card";

export const alt = "Valuation Desk: find, check and value any listed company";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <Frame>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 70, gap: 10 }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, letterSpacing: -2 }}>Find it, check it, value it.</div>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, letterSpacing: -2, color: C.accent }}>Any listed company.</div>
          <div style={{ display: "flex", fontSize: 30, color: C.ink2, marginTop: 24, maxWidth: 980 }}>Opportunity scanner for the Nifty indices, portfolio X-ray, business health check, DCF with peers, and an Excel model with live formulas.</div>
        </div>
      </Frame>
    ),
    size,
  );
}
