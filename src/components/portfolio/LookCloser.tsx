"use client";
import Link from "next/link";
import { LIMITS, type ObservationKind, type Xray } from "@/lib/portfolio";
import { pct } from "@/lib/format";

const KIND: Record<ObservationKind, { label: string; cls: string }> = {
  position: { label: "Size", cls: "pf-warn" },
  sector: { label: "Sector", cls: "pf-warn" },
  health: { label: "Health", cls: "bad" },
  expectations: { label: "Expectations", cls: "bad" },
  cost: { label: "Check data", cls: "skip" },
  check: { label: "Check data", cls: "skip" },
};

/** Observations worth a second look, each with its numbers and a link to the stock. Not advice. */
export default function LookCloser({ x }: { x: Xray }) {
  const obs = x.observations;
  return (
    <section className="card section" aria-labelledby="pf-lc-h">
      <div className="section-head">
        <h2 id="pf-lc-h">Look closer</h2>
        <p>Observations from the numbers, not advice. Each is a question worth asking: a single holding above {pct(LIMITS.position, 0)}, a sector above {pct(LIMITS.sector, 0)}, a health grade of D or E, or a price that needs growth more than {LIMITS.expectations} points above the company&apos;s record.</p>
      </div>
      {obs.length ? (
        <ul className="pf-obs">
          {obs.map((o) => (
            <li key={o.key}>
              <span className={`badge ${KIND[o.kind].cls}`}>{KIND[o.kind].label}</span>
              <div>
                <h3>{o.title}</h3>
                <p>{o.detail}</p>
                {o.symbol && <Link href={`/stock/${encodeURIComponent(o.symbol)}`}>Open {o.symbol} on the desk to test the assumptions</Link>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{x.valued ? "Nothing stands out on these checks for the holdings valued so far." : "Observations appear once your holdings are valued."}</p>
      )}
    </section>
  );
}
