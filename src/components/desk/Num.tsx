"use client";
import { useEffect, useState } from "react";

/** A numeric input that lets people type freely ("-", "7.") and only commits valid numbers. */
export default function Num({ value, onChange, step = 0.1, label, id, flag = false, className = "in", min, max }: { value: number; onChange: (v: number) => void; step?: number | "any"; label?: string; id?: string; flag?: boolean; className?: string; min?: number; max?: number }) {
  const [text, setText] = useState(String(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the field in sync when the value changes elsewhere
    setText((t) => (parseFloat(t) === value ? t : Number.isFinite(value) ? String(Math.round(value * 1e6) / 1e6) : ""));
  }, [value]);
  return (
    <input
      id={id}
      className={`${className}${flag ? " flag" : ""}`}
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={bad || undefined}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const v = parseFloat(t.replace(/,/g, ""));
        const ok = /^\s*-?[\d,]*\.?\d*\s*$/.test(t) && Number.isFinite(v) && (min === undefined || v >= min) && (max === undefined || v <= max);
        setBad(!ok);
        if (ok) onChange(v);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const s = step === "any" ? 0.1 : step;
        const v = Math.round((value + (e.key === "ArrowUp" ? s : -s)) * 1e6) / 1e6;
        if ((min === undefined || v >= min) && (max === undefined || v <= max)) { onChange(v); setText(String(v)); setBad(false); }
      }}
    />
  );
}
