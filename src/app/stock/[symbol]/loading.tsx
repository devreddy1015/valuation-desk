export default function Loading() {
  return (
    <div className="wrap" style={{ paddingBlock: "48px" }}>
      <section className="card empty" aria-busy="true" aria-live="polite">
        <div className="ticker-dots" aria-hidden="true"><i className="on" /><i className="on" /><i /><i /><i /></div>
        <h1 style={{ fontSize: 22 }}>Loading prices, five years of statements and peers…</h1>
        <p className="muted">The first visit to a stock takes a few seconds; repeat visits are cached.</p>
      </section>
    </div>
  );
}
