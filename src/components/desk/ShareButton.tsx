"use client";
import { useState } from "react";
import { ShareError, shareUrl, type SharedState } from "@/lib/client/share";
import "@/styles/share.css";

/**
 * Shares a link that reopens this exact valuation. On phones it opens the system share sheet
 * (WhatsApp, email…); elsewhere it copies the link, or shows it selected when copying is blocked.
 */
export default function ShareButton({ getState, summary }: { getState: () => SharedState; summary: string }) {
  const [msg, setMsg] = useState("");
  const [manual, setManual] = useState<string | null>(null);
  const done = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };
  const go = async () => {
    let url: string;
    try { url = await shareUrl(window.location.origin, getState()); }
    catch (e) { done(e instanceof ShareError ? e.message : "This valuation could not be packed into a link."); return; }
    const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    if (coarse && typeof navigator.share === "function") {
      try { await navigator.share({ title: document.title, text: summary, url }); done("Shared."); return; }
      catch (e) { if ((e as Error).name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); setManual(null); done("Link copied. Anyone who opens it sees your inputs; their own saved work is untouched."); }
    catch { setManual(url); done("Copying is blocked here: the link is selected below, copy it with your keyboard."); }
  };
  return (
    <>
      <button type="button" className="btn" onClick={go}>Share link</button>
      <span className="sr-only" role="status">{msg}</span>
      {msg && <span className="share-msg" aria-hidden="true">{msg}</span>}
      {manual && <input className="share-manual" readOnly value={manual} aria-label="Link to this valuation" onFocus={(e) => e.currentTarget.select()} ref={(el) => el?.select()} />}
    </>
  );
}
