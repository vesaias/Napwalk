import { describe, expect, it } from "vitest";
import type { BorderGeom } from "../shade/ShadeLayer";
import { outsideInfo } from "./outside";

/** A degree of longitude is ~71 km at 50°N, a degree of latitude ~111 km —
 *  so this 0.01° box around Frankfurt is roughly 700 m by 1.1 km. */
const SQUARE: BorderGeom = {
  type: "Polygon",
  coordinates: [
    [
      [8.68, 50.11],
      [8.69, 50.11],
      [8.69, 50.12],
      [8.68, 50.12],
      [8.68, 50.11],
    ],
  ],
};

const EMPTY: BorderGeom = { type: "Polygon", coordinates: [] };

describe("outsideInfo", () => {
  it("is null with nothing to compare", () => {
    expect(outsideInfo(null, [8.685, 50.115])).toBeNull();
    expect(outsideInfo(SQUARE, null)).toBeNull();
    expect(outsideInfo(null, null)).toBeNull();
  });

  it("is null for a fix inside the border", () => {
    expect(outsideInfo(SQUARE, [8.685, 50.115])).toBeNull();
  });

  it("measures a fix outside it, in metres and in catalog kilometres", () => {
    // one hundredth of a degree of latitude north of the top edge: ~1.1 km
    const out = outsideInfo(SQUARE, [8.685, 50.13]);
    if (!out) throw new Error("expected a fix outside the border");
    expect(out.m).toBeGreaterThan(1000);
    expect(out.m).toBeLessThan(1300);
    expect(out.km).toMatch(/^1\.[12]$/);
  });

  it("rounds to one decimal, the way city.outside is written", () => {
    // just past the south-east corner: metres away, and the sheet says 0.0
    const out = outsideInfo(SQUARE, [8.6901, 50.1099]);
    if (!out) throw new Error("expected a fix outside the border");
    expect(out.km).toBe("0.0");
  });

  it("is null for a geometry with no vertices to measure to", () => {
    expect(outsideInfo(EMPTY, [8.685, 50.115])).toBeNull();
  });

  it("treats a fix standing in a hole as outside the data", () => {
    // The pipeline exports the shade border with holes where it has nothing
    // (a lake, a gap in the DSM). Even-odd ray casting makes the hole
    // outside, and the banner is right to appear there.
    const withHole: BorderGeom = {
      type: "Polygon",
      coordinates: [
        SQUARE.coordinates[0],
        [
          [8.684, 50.114],
          [8.686, 50.114],
          [8.686, 50.116],
          [8.684, 50.116],
          [8.684, 50.114],
        ],
      ],
    };
    const out = outsideInfo(withHole, [8.685, 50.115]);
    if (!out) throw new Error("a fix in a hole is outside the data");
    // the nearest vertex is a corner of the hole, ~130 m away
    expect(out.m).toBeGreaterThan(80);
    expect(out.m).toBeLessThan(200);
    expect(out.km).toBe("0.1");
    // and the same geometry without the hole says nothing
    expect(outsideInfo(SQUARE, [8.685, 50.115])).toBeNull();
  });

  it("reads every polygon of a MultiPolygon", () => {
    const multi: BorderGeom = {
      type: "MultiPolygon",
      coordinates: [
        SQUARE.coordinates as number[][][],
        [
          [
            [8.70, 50.11],
            [8.71, 50.11],
            [8.71, 50.12],
            [8.70, 50.12],
            [8.70, 50.11],
          ],
        ],
      ],
    };
    expect(outsideInfo(multi, [8.705, 50.115])).toBeNull();
    expect(outsideInfo(multi, [8.695, 50.115])).not.toBeNull();
  });
});
