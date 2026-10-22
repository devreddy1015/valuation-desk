"use client";
import "@/styles/share.css";

/** Shown while the desk displays a valuation opened from someone's share link. */
export default function SharedBanner({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  return (
    <div className="shared-banner no-print" role="region" aria-label="Shared valuation">
      <p><b>You&apos;re viewing a shared valuation.</b> These are the sender&apos;s inputs on today&apos;s live prices. Your own saved inputs for this stock are untouched.</p>
      <div className="shared-actions">
        <button type="button" className="btn small primary" onClick={onKeep}>Keep it as mine</button>
        <button type="button" className="btn small" onClick={onDiscard}>Back to my own</button>
      </div>
    </div>
  );
}
