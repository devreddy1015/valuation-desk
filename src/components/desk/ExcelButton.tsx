"use client";
import { useState } from "react";
import type { ExportPayload } from "@/lib/client/share";

/** Downloads the current valuation as an Excel model with live formulas, built on the server. */
export default function ExcelButton({ getPayload, symbol }: { getPayload: () => ExportPayload; symbol: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const go = async () => {
    if (busy) return;
    setBusy(true); setMsg("Building the Excel model…");
    try {
      const res = await fetch("/api/excel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(getPayload()) });
      if (!res.ok) {
        const j = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(j?.error || `the server answered ${res.status}`);
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `${symbol}-valuation-desk.xlsx`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      setMsg(`Downloaded ${name}.`);
    } catch (e) {
      setMsg(`Could not build the Excel model: ${(e as Error).message}.`);
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(""), 6000);
    }
  };
  return (
    <>
      {/* aria-disabled rather than disabled, so keyboard focus stays on the button while it works */}
      <button type="button" className="btn" onClick={go} aria-disabled={busy} aria-describedby="xl-status">{busy ? "Building Excel…" : "Excel model"}</button>
      <span id="xl-status" className="sr-only" role="status">{msg}</span>
      {msg && !busy && <span className="share-msg" aria-hidden="true">{msg}</span>}
    </>
  );
}
