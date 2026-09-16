import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "geojson";
import { boundsOf, NO_FC } from "./mapData";

const fc = (lines: number[][][]): FeatureCollection => ({
  type: "FeatureCollection",
  features: lines.map((coordinates) => ({
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates },
  })),
});

describe("boundsOf", () => {
  it("is null for an empty collection", () => {
    expect(boundsOf(NO_FC)).toBeNull();
  });
  it("boxes every line, not just the first", () => {
    const b = boundsOf(fc([[[8.68, 50.11], [8.69, 50.12]], [[8.67, 50.13], [8.70, 50.10]]]));
    expect(b).toEqual([[8.67, 50.10], [8.70, 50.13]]);
  });
  it("boxes a one-point line as a degenerate box, not as nothing", () => {
    // A plan whose whole route is one node (start == destination, or a
    // loop the planner collapsed) still has to give the map SOMETHING to
    // fit, or the walk vanishes off screen. West == east, south == north.
    const b = boundsOf(fc([[[8.68, 50.11]]]));
    expect(b).toEqual([[8.68, 50.11], [8.68, 50.11]]);
  });

  it("skips a line with no coordinates but keeps the collection's other lines", () => {
    const b = boundsOf(fc([[], [[8.68, 50.11], [8.69, 50.12]]]));
    expect(b).toEqual([[8.68, 50.11], [8.69, 50.12]]);
    // and a collection of nothing but empty lines has no box at all
    expect(boundsOf(fc([[], []]))).toBeNull();
  });

  it("ignores a MultiLineString — LineString is the only geometry it reads", () => {
    // routeLinesOf only ever emits LineString, so this is the contract, not
    // an oversight: anything else handed to boundsOf is silently invisible.
    const multi: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "MultiLineString", coordinates: [[[8.68, 50.11], [8.69, 50.12]]] },
        },
      ],
    };
    expect(boundsOf(multi)).toBeNull();
  });

  it("ignores non-line features", () => {
    const one: FeatureCollection = {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } }],
    };
    expect(boundsOf(one)).toBeNull();
  });
});
