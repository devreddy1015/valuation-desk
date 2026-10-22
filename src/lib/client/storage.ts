"use client";
import { useCallback, useEffect, useState } from "react";

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeJSON(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** localStorage-backed state that renders the fallback on the server and first paint, then loads. */
export function useStored<T>(key: string, fallback: T): [T, (v: T | ((p: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(fallback);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from storage after mount
    setValue(readJSON(key, fallback));
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback((v: T | ((p: T) => T)) => {
    setValue((prev) => {
      const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
      writeJSON(key, next);
      return next;
    });
  }, [key]);
  return [value, set, loaded];
}

export interface WatchItem { symbol: string; name: string; currency: string; price: number; pt: number | null; upside: number | null; rating: string; viewed: string }
export const WATCH_KEY = "vd:watchlist:v1";
export const SETTINGS_KEY = "vd:settings:v1";
export interface Settings { calls: boolean }
export const DEFAULT_SETTINGS: Settings = { calls: false };
