import "server-only";

// A small in-memory cache with TTL and in-flight de-duplication. On Vercel's Fluid compute an
// instance serves many requests, so this saves repeat calls to Yahoo between page views.
const store = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>();
const MAX = 2000;

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < hit.ttl) return hit.value as Promise<T>;
  const value = fn().catch((e) => {
    store.delete(key); // never cache a failure
    throw e;
  });
  if (store.size >= MAX) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { at: now, ttl: ttlMs, value });
  return value;
}

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
