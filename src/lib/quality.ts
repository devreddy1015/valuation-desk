// Business health check: how good and how trustworthy the reported numbers look.
// STUB: the contract below is fixed; the implementation is being written.
import type { HealthGrade } from "./scanTypes";
import type { StockData } from "./types";

export interface HealthTest {
  key: string;
  label: string; // plain English, e.g. "Cash from operations beat profit"
  pass: boolean | null; // null = could not be computed
  value: string; // the numbers behind the test, formatted
  why: string; // one sentence on why it matters
}

export interface HealthMetric {
  key: string;
  label: string;
  value: number | null;
  format: "pct" | "x" | "days" | "num";
  good: boolean | null;
  note: string;
}

export interface HealthReport {
  score: number | null; // 0-100
  grade: HealthGrade;
  summary: string; // one plain-English sentence
  piotroski: { score: number; max: number; tests: HealthTest[] } | null;
  altman: { z: number; zone: "safe" | "grey" | "distress"; note: string } | null;
  beneish: { m: number; flag: boolean; note: string; parts: { key: string; label: string; value: number | null }[] } | null;
  metrics: HealthMetric[];
  flags: string[]; // plain-language red flags
  strengths: string[];
  notes: string[]; // what could not be computed and why
}

export function healthCheck(data: StockData): HealthReport {
  void data;
  return { score: null, grade: "–", summary: "", piotroski: null, altman: null, beneish: null, metrics: [], flags: [], strengths: [], notes: [] };
}
