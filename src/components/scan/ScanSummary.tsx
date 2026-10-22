"use client";
import { pct } from "@/lib/format";
import type { ScanSummary as Summary } from "@/lib/scanMath";

/** Four headline numbers for the stocks currently shown. */
export default function ScanSummary({ s }: { s: Summary }) {
  return (
    <div className="minis" role="group" aria-label="Summary of the stocks shown">
      <div className="mini">
        <span className="k">Median value gap</span>
        <span className="v">{pct(s.medianGap, 1, true)}</span>
        <span className="n">{s.valued ? `Middle of ${s.valued} valued stocks${s.extreme ? `; ${s.extreme} far from the price left out` : ""}` : "No stock valued yet"}</span>
      </div>
      <div className="mini">
        <span className="k">Gap above +15%</span>
        <span className="v">{s.above15}</span>
        <span className="n">of {s.valued} valued: model value well above price</span>
      </div>
      <div className="mini">
        <span className="k">Health A or B</span>
        <span className="v">{s.graded ? s.healthAB : "–"}</span>
        <span className="n">{s.graded ? `of ${s.graded} with a health grade` : "Health grades not available"}</span>
      </div>
      <div className="mini">
        <span className="k">Median expected return</span>
        <span className="v">{pct(s.medianReturn)}</span>
        <span className="n">{s.withReturn ? `a year, vs a median WACC of ${pct(s.medianWacc)}` : "Not available for these stocks"}</span>
      </div>
    </div>
  );
}
