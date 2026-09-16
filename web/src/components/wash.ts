// The coverage wash: the world with the city cut out of it.
//
// Kept apart from MapView (which cannot be imported under vitest — it pulls
// in maplibre and a ?worker&url import) because the winding rule below is
// the kind of thing that must be tested, not eyeballed: maplibre decides
// which ring of a fill is a hole by the SIGN of its area, not by even-odd.
// A ring wound the same way as the outer ring becomes another filled
// island, so the wash paints the whole viewport instead of cutting the city
// out. Six of the eight shipped borders are wound the opposite way from
// Frankfurt's, which is how this was missed the first time (2026-09-05).
import type { Feature } from "geojson";
import type { BorderGeom } from "../shade/ShadeLayer";

/** The outer ring of the wash: the whole web-mercator world. */
export const WORLD_RING: number[][] = [
  [-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85],
];

/** Twice the signed shoelace area of a ring; positive = counter-clockwise.
 *  Only the sign is used, and the ring may be closed or not. */
export function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** The world polygon with each border ring as a hole, every hole wound
 *  opposite to the world ring. Null when there is no border to cut out. */
export function washFeature(g: BorderGeom | null): Feature | null {
  if (!g) return null;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const world = ringArea(WORLD_RING);
  const holes: number[][][] = [];
  for (const p of polys) {
    const ring = p[0];
    if (!ring || ring.length < 4) continue; // not a ring; nothing to cut
    const a = ringArea(ring);
    // same sign as the world ring = maplibre would fill it, not cut it
    holes.push(a * world > 0 ? [...ring].reverse() : ring);
  }
  if (!holes.length) return null;
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [WORLD_RING, ...holes] },
  };
}
