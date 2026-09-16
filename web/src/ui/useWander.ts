// The lookups the Wander tab needs (UI redesign Task 13, 2026-09-05).
//
// A loop has no destination to name it by, so both lines the screen writes
// about a walk come from the same place: Photon's reverse geocode of a
// point. The origin's label is the header's subline; the label of a
// candidate's farthest node is the card's name line.
//
// Reverse geocodes are cached across plans in a module-level Map, because
// the planner is asked the same question often — a preference change, a
// clock tick, a duration flipped back — and the answer for a walk that has
// already been named must not cost another round trip. Bounded, oldest
// first, so a long session cannot grow it without limit.
import { useEffect, useReducer, useRef } from "react";
import type { LngLat } from "../components/MapView";
import { pointKey as ptKey } from "./geo";
import { reverseGeocode } from "../plan/geocode";

/** Labels already looked up. Only real answers are kept: a lookup that came
 *  back with nothing (Photon has no name there, or the request failed — it
 *  reports both the same way) is left out, so the next plan gets to ask
 *  again. Nothing retries on its own; the effect below only runs when the
 *  set of points being asked about changes. */
const CACHE = new Map<string, string>();
/** Keys with a request in flight, so two candidates that want the same
 *  point (or a re-render) do not each start one. */
const PENDING = new Set<string>();
const CACHE_MAX = 50;

function remember(key: string, label: string): void {
  if (CACHE.size >= CACHE_MAX) {
    const oldest = CACHE.keys().next().value;
    if (oldest !== undefined) CACHE.delete(oldest);
  }
  CACHE.set(key, label);
}

/** Read, and mark as used. A Map iterates in insertion order, so deleting a
 *  key and putting it back makes `remember`'s "oldest first" mean LEAST
 *  RECENTLY USED — without which the origin's own label, which every render
 *  reads and which is on screen the whole time, was evicted after fifty
 *  lookups. */
function recall(key: string): string | null {
  const hit = CACHE.get(key);
  if (hit === undefined) return null;
  CACHE.delete(key);
  CACHE.set(key, hit);
  return hit;
}

export type LabelTarget = {
  /** What the answer is remembered under. */
  key: string;
  /** Where to ask about; null means "not yet known", and is skipped. */
  at: LngLat | null;
};

/** Reverse-geocode every target that has not been looked up yet, and hand
 *  back a reader for what is known so far. Returns null for a key whose
 *  answer has not landed (or was nothing) — every caller has a line it can
 *  write without one. */
export function useLabels(targets: LabelTarget[]): (key: string) => string | null {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  // the effect fires on the SET of points being asked about; the targets
  // themselves come from a ref, so a re-render with the same set is free
  const dep = targets.map((t) => (t.at ? t.key : "")).join("|");
  const ref = useRef(targets);
  ref.current = targets;

  // No AbortController, deliberately. The cache is keyed by the QUESTION,
  // not by the screen that asked it, so an answer that arrives after the
  // plan changed is still the right answer for its key — and aborting on
  // cleanup lost lookups outright: the abort resolves after the next effect
  // run has already skipped the key as "pending", and nothing ever asked
  // again (a tapped origin stayed "Dropped pin" for the rest of the
  // session). Each key is asked at most once at a time either way.
  useEffect(() => {
    for (const { key, at } of ref.current) {
      if (!at || CACHE.has(key) || PENDING.has(key)) continue;
      PENDING.add(key);
      reverseGeocode(at[0], at[1])
        .then((label) => {
          if (label === null) return; // nothing to show, and nothing to keep
          remember(key, label);
          bump();
        })
        // reverseGeocode swallows its own errors today, so this is belt and
        // braces — but a key stuck in PENDING is never asked about again,
        // and that invariant should not rest on another module's contract
        .finally(() => PENDING.delete(key));
    }
    // `dep` is the identity of the whole target list; ref.current is read
    // inside, so a changed list can never leave a stale closure behind
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);

  return recall;
}

/** A point's cache key. `@` keeps a coordinate key from ever colliding with
 *  one of the loop keys in the same LRU (wander.ts, candKey); the rounding
 *  itself is geo.ts's, shared with the planner's cache (M6). */
export function pointKey(p: LngLat): string {
  return `@${ptKey(p)}`;
}
