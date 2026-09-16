// Distance on the ground, for the shell (UI redesign Task 12, 2026-09-05).
//
// One haversine, used for three questions the shell asks: how far away is
// that search result, how far is the walker from the destination (the 30 m
// that ends a walk), and which node of the route is the walker standing on.
// It lived in time.ts as `crowM` until Task 12 needed it during navigation.
import type { LngLat } from "../components/MapView";

const EARTH_R = 6_371_000;

/** How many decimal places a point keeps before it becomes a cache key:
 *  four is ~11 m, so a fix drifting on the spot is the same corner. */
const KEY_DP = 4;

/** A point as a string, rounded, for the two caches that key on one: the
 *  planner's question (usePlanner) and the reverse-geocode LRU (useWander).
 *  They used to round to the same four places in two places (M6). */
export function pointKey(p: LngLat): string {
  return `${p[0].toFixed(KEY_DP)},${p[1].toFixed(KEY_DP)}`;
}

/** Great-circle metres between two lng/lat points. Good to a metre at
 *  city scale, which is all any caller here needs. */
export function distanceM(a: LngLat, b: LngLat): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

/** A walk is over when the walker is this close to the destination pin —
 *  about the width of a street crossing, which is as precise as a phone's
 *  fix gets under trees (SPEC §3, "arrival"). */
export const ARRIVED_M = 30;

/** ...and a loop has only really left the place it started once it is this
 *  far from it. Wander's walks begin ON their own destination, so arrival
 *  cannot be distance alone: something has to have happened in between.
 *  120 m is two or three houses — far enough that no fix wobbling at the
 *  front door can pass for a walk, close enough to trip on the first
 *  corner. */
export const LEFT_M = 120;
