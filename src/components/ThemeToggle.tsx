"use client";
import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";
const KEY = "vd:theme";

export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => {
    let m: Mode = "system";
    try { m = (localStorage.getItem(KEY) as Mode) || "system"; } catch { /* storage blocked */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the stored choice after mount
    setMode(m);
  }, []);
  const apply = (m: Mode) => {
    setMode(m);
    try { localStorage.setItem(KEY, m); } catch { /* storage blocked */ }
    if (m === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", m);
  };
  return (
    <div className="seg" role="radiogroup" aria-label="Colour theme">
      {(["light", "system", "dark"] as Mode[]).map((m) => (
        <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => apply(m)} title={`${m[0].toUpperCase()}${m.slice(1)} theme`}>
          {m === "light" ? "Light" : m === "dark" ? "Dark" : "Auto"}
        </button>
      ))}
    </div>
  );
}

/** Runs before paint so the stored theme never flashes. */
export const themeInitScript = `try{var m=localStorage.getItem('${KEY}');if(m==='light'||m==='dark')document.documentElement.setAttribute('data-theme',m)}catch(e){}`;
