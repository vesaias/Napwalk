// Wander's pure arithmetic (UI redesign Task 13, 2026-09-05).
//
// Three small questions the loops screen and the duration sheet ask, none of
// which needs React, the DOM or the network:
//   - "be back by 15:30" is how many minutes of walking?
//   - which point of a loop should be reverse-geocoded to name it?
//   - what does that name read as on the card?
// The lookups themselves (and their cache) live in useWander.ts, and the link
// Share hands over in share.ts (Task 15 — the desktop panel writes the same
// one for an A→B walk).
import type { LngLat } from "../components/MapView";
import type { Candidate } from "../plan/plan";
import type { Graph } from "../router/graph";
import { MAX_DURATION_MIN, MIN_DURATION_MIN } from "../urlState";
import { distanceM } from "./geo";
import { DAY_START_MIN, STEP_MIN } from "./time";

/** The four lengths the duration sheet offers as tiles (mockups/phone-dur.html). */
export const DURATION_TILES = [30, 45, 60, 90] as const;

/** "Be back by 15:30" as a loop length. Snapped to the five-minute grid the
 *  clock, the planner and the URL all move on, and bounded: an hour that has
 *  already passed is not a walk, and the far end of the slider is a whole
 *  evening the loop planner would grind on and nobody would walk. */
export function durationFromBackBy(backMin: number, departMin: number): number {
  const raw = Math.round((backMin - departMin) / STEP_MIN) * STEP_MIN;
  return Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, raw));
}

/** The other end of the same number: the hour a loop of `min` minutes gets
 *  home, leaving at `departMin`.
 *
 *  It exists so the duration sheet and the loops card cannot drift apart.
 *  The card prints `back ${startMin + minutes}` (screens/wander/Wander.tsx);
 *  the sheet used to print `now + pick`, so with a departure pinned to 17:00
 *  at 07:55 the card said "back 17:45" and the sheet "be back by 08:40", and
 *  picking 18:00 in it planned a 240-minute loop (final review I1). Both
 *  count from the DEPARTURE now, and this is the arithmetic they share. */
export function backByFor(departMin: number, min: number): number {
  return Math.max(DAY_START_MIN, departMin + min);
}

/** A stable key for a candidate, cheap enough to compute every render: the
 *  edges it walks, in the order it walks them. Two plans of the same walk
 *  (the planner hands its one-slot cache back unchanged) share a key, so the
 *  name looked up for it is looked up once. FNV-1a over the edge ids. */
export function candKey(eids: number[]): string {
  let h = 2166136261;
  for (const e of eids) {
    h ^= e;
    h = Math.imul(h, 16777619);
  }
  return `${eids.length}:${(h >>> 0).toString(36)}`;
}

/** The point of a loop furthest from where it started — the one place on it
 *  that is not "here", and therefore the one worth naming. Null for a walk
 *  with no nodes. */
export function farthestNode(g: Graph, nodes: number[], from: LngLat): LngLat | null {
  let best: LngLat | null = null;
  let bestD = -1;
  for (const n of nodes) {
    const p: LngLat = [g.lng[n], g.lat[n]];
    const d = distanceM(from, p);
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Where to ask what a loop is called.
 *
 *  A lap walk is named by the place it goes round, and that is not its
 *  farthest point: the approach to a park is walked twice and its circuit
 *  once per lap, so the most-repeated node is inside the park while the
 *  farthest one is often on the street that leads to it (the first run of
 *  this screen named a four-lap park walk "Oberlindau 18"). Among equally
 *  repeated nodes the farthest wins — deeper into the park, further from
 *  the rim. Every other loop, and a single lap that repeats nothing, is
 *  named by its farthest point, the one part of it that is not "here". */
export function namePoint(
  g: Graph,
  c: Pick<Candidate, "walkKind" | "nodes">,
  from: LngLat
): LngLat | null {
  if (c.walkKind === "laps") {
    const seen = new Map<number, number>();
    for (const n of c.nodes) seen.set(n, (seen.get(n) ?? 0) + 1);
    let best = -1;
    let bestCount = 2; // a node walked once is not the circuit
    let bestD = -1;
    for (const [n, count] of seen) {
      if (count < bestCount) continue;
      const d = distanceM(from, [g.lng[n], g.lat[n]]);
      if (count > bestCount || d > bestD) {
        best = n;
        bestCount = count;
        bestD = d;
      }
    }
    if (best >= 0) return [g.lng[best], g.lat[best]];
  }
  return farthestNode(g, c.nodes, from);
}

/** Photon writes "Berger Straße 12 · Nordend" (plan/geocode.ts); the two
 *  halves answer two different questions and the middle dot is the seam. */
export function splitLabel(label: string): { name: string; district: string | null } {
  const i = label.indexOf(" · ");
  if (i < 0) return { name: label, district: null };
  return { name: label.slice(0, i), district: label.slice(i + 3) };
}

export type LoopName =
  | { k: "parkLaps"; park: string; n: number }
  | { k: "district"; text: string }
  | null;

/** The line under a loop card's badge. Laps of a park say which park and how
 *  many times round; every other loop says the part of town it walks, which
 *  is the district half of the same label. Null until the lookup lands — a
 *  card with no name line is better than one that guesses. */
export function loopName(c: Pick<Candidate, "walkKind" | "laps">, label: string | null): LoopName {
  if (!label) return null;
  const { name, district } = splitLabel(label);
  if (c.walkKind === "laps" && c.laps !== undefined && c.laps > 0) {
    return { k: "parkLaps", park: name, n: c.laps };
  }
  return { k: "district", text: district ?? name };
}
