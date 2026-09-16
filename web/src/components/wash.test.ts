import { describe, expect, it } from "vitest";
import { WORLD_RING, ringArea, washFeature } from "./wash";
import type { BorderGeom } from "../shade/ShadeLayer";

// counter-clockwise unit square, and the same square the other way round
const CCW = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const CW = [...CCW].reverse();

const holesOf = (g: BorderGeom | null) => {
  const f = washFeature(g);
  const rings = (f?.geometry as GeoJSON.Polygon | undefined)?.coordinates ?? [];
  return rings.slice(1);
};

describe("ringArea", () => {
  it("signs a ring by its winding", () => {
    expect(ringArea(CCW)).toBeGreaterThan(0);
    expect(ringArea(CW)).toBeLessThan(0);
    expect(ringArea(WORLD_RING)).toBeGreaterThan(0);
  });
});

describe("washFeature", () => {
  it("winds a counter-clockwise border against the world ring", () => {
    const holes = holesOf({ type: "Polygon", coordinates: [CCW] });
    expect(holes).toHaveLength(1);
    expect(Math.sign(ringArea(holes[0]))).toBe(-Math.sign(ringArea(WORLD_RING)));
  });

  it("leaves an already opposite (clockwise) border alone", () => {
    const holes = holesOf({ type: "Polygon", coordinates: [CW] });
    expect(holes).toHaveLength(1);
    expect(Math.sign(ringArea(holes[0]))).toBe(-Math.sign(ringArea(WORLD_RING)));
    expect(holes[0]).toEqual(CW); // no needless reversal
  });

  it("cuts every polygon of a multipolygon, whatever its winding", () => {
    const shift = (r: number[][], dx: number) => r.map(([x, y]) => [x + dx, y]);
    const holes = holesOf({
      type: "MultiPolygon",
      coordinates: [[CCW], [shift(CW, 10)], [shift(CCW, 20)]],
    });
    expect(holes).toHaveLength(3);
    for (const h of holes) {
      expect(Math.sign(ringArea(h))).toBe(-Math.sign(ringArea(WORLD_RING)));
    }
  });

  it("starts from the world and keeps the border's points", () => {
    const f = washFeature({ type: "Polygon", coordinates: [CCW] })!;
    const rings = (f.geometry as GeoJSON.Polygon).coordinates;
    expect(rings[0]).toEqual(WORLD_RING);
    expect(rings[1]).toHaveLength(CCW.length);
  });

  it("is nothing without a border", () => {
    expect(washFeature(null)).toBeNull();
    expect(washFeature({ type: "MultiPolygon", coordinates: [] })).toBeNull();
    expect(washFeature({ type: "Polygon", coordinates: [[[0, 0], [1, 1]]] })).toBeNull();
  });
});
