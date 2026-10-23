"use client";
import "@/styles/share.css";

/** Shown while the desk displays a valuation opened from someone's share link. */
export default function SharedBanner({ edits, peers, onKeep, onDiscard }: { edits: number; peers: number; onKeep: () => void; onDiscard: () => void }) {
  const changed = [
    edits ? `edited ${edits} company figure${edits === 1 ? "" : "s"} (marked in the Company data table)` : "",
    peers ? `added ${peers} peer${peers === 1 ? "" : "s"}, whose figures were fetched again from Yahoo` : "",
  ].filter(Boolean);
  return (
    <div className="shared-banner no-print" role="region" aria-label="Shared valuation">
      <p><b>You&apos;re viewing a shared valuation.</b> These are the sender&apos;s assumptions on today&apos;s live prices{changed.length ? `; the sender also ${changed.join(" and ")}` : ""}. Your own saved inputs for this stock are untouched.</p>
      <div className="shared-actions">
        <button type="button" className="btn small primary" onClick={onKeep}>Keep it as mine</button>
        <button type="button" className="btn small" onClick={onDiscard}>Back to my own</button>
      </div>
    </div>
  );
}
