import { describe, expect, it } from "vitest";
import { parseGraph } from "../router/graph";
import { packGraph, type ToyEdge } from "../router/packGraph";
import {
  backByFor,
  candKey,
  DURATION_TILES,
  durationFromBackBy,
  farthestNode,
  loopName,
  namePoint,
  splitLabel,
} from "./wander";

// The same 1 km chain nav.test.ts walks: eleven nodes, 100 m apart, east of
// a Frankfurt corner.
const LAT0 = 50.1109;
const LNG0 = 8.6821;
const DLNG_100M = 0.0014;
const NODES: [number, number][] = Array.from({ length: 11 }, (_, i) => [LAT0, LNG0 + i * DLNG_100M]);
const EDGES: ToyEdge[] = Array.from({ length: 10 }, (_, i) => ({ u: i, v: i + 1, lenDm: 1000 }));
const G = parseGraph(packGraph(NODES, EDGES));
const at = (i: number): [number, number] => [LNG0 + i * DLNG_100M, LAT0];

describe("durationFromBackBy", () => {
  it("is the gap between now and the hour picked", () => {
    expect(durationFromBackBy(15 * 60 + 30, 14 * 60)).toBe(90);
    expect(durationFromBackBy(14 * 60 + 45, 14 * 60)).toBe(45);
  });

  it("snaps to the five-minute grid the clock and the URL both use", () => {
    expect(durationFromBackBy(14 * 60 + 47, 14 * 60)).toBe(45);
    expect(durationFromBackBy(14 * 60 + 48, 14 * 60)).toBe(50);
  });

  it("never asks for a loop shorter than a quarter of an hour", () => {
    // "be back by" an hour that has already passed is not a walk
    expect(durationFromBackBy(13 * 60, 14 * 60)).toBe(15);
    expect(durationFromBackBy(14 * 60 + 5, 14 * 60)).toBe(15);
  });

  it("caps the longest loop, so the whole rest of the day is not planned", () => {
    // 08:00 with the slider at its far end is 15 h 55, which the loop
    // planner would grind on for minutes and nobody would walk
    expect(durationFromBackBy(23 * 60 + 55, 8 * 60)).toBe(180);
  });

  it("leaves every tile the sheet offers untouched", () => {
    for (const min of DURATION_TILES) {
      expect(durationFromBackBy(14 * 60 + min, 14 * 60)).toBe(min);
    }
  });
});

describe("candKey", () => {
  it("is the same for the same walk and different for another", () => {
    expect(candKey([4, 9, 12])).toBe(candKey([4, 9, 12]));
    expect(candKey([4, 9, 12])).not.toBe(candKey([4, 9, 13]));
    // order is part of the walk: the same edges walked the other way round
    expect(candKey([4, 9, 12])).not.toBe(candKey([12, 9, 4]));
    expect(candKey([])).toBe(candKey([]));
  });
});

describe("splitLabel", () => {
  it("splits Photon's 'street · district' into its two halves", () => {
    expect(splitLabel("Rotlintstraße 42 · Nordend")).toEqual({
      name: "Rotlintstraße 42",
      district: "Nordend",
    });
  });

  it("keeps a label with no district whole", () => {
    expect(splitLabel("Günthersburgpark")).toEqual({ name: "Günthersburgpark", district: null });
  });
});

describe("loopName", () => {
  it("names the park and the laps for a lap walk", () => {
    expect(loopName({ walkKind: "laps", laps: 2 }, "Günthersburgpark · Nordend")).toEqual({
      k: "parkLaps",
      park: "Günthersburgpark",
      n: 2,
    });
  });

  it("names the district for every other loop", () => {
    expect(loopName({ walkKind: "quiet" }, "Rotlintstraße 42 · Nordend")).toEqual({
      k: "district",
      text: "Nordend",
    });
    // no district in the label: the place itself is the best there is
    expect(loopName({}, "Günthersburgpark")).toEqual({ k: "district", text: "Günthersburgpark" });
  });

  it("has no name line before the lookup lands", () => {
    expect(loopName({ walkKind: "laps", laps: 2 }, null)).toBeNull();
    expect(loopName({}, "")).toBeNull();
  });

  it("falls back to the district when a lap walk lost its lap count", () => {
    expect(loopName({ walkKind: "laps" }, "Günthersburgpark · Nordend")).toEqual({
      k: "district",
      text: "Nordend",
    });
  });
});

describe("farthestNode", () => {
  it("is the node of the loop furthest from where it started", () => {
    const nodes = [0, 1, 2, 3, 4, 3, 2, 1, 0]; // there and back
    const p = farthestNode(G, nodes, at(0));
    expect(p).not.toBeNull();
    expect(p?.[0]).toBeCloseTo(at(4)[0], 6);
  });

  it("measures from the origin, not from the first node", () => {
    const p = farthestNode(G, [3, 4, 5, 6], at(6));
    expect(p?.[0]).toBeCloseTo(at(3)[0], 6);
  });

  it("has nothing to say about an empty walk", () => {
    expect(farthestNode(G, [], at(0))).toBeNull();
  });
});

describe("namePoint", () => {
  // out to node 8, four laps of the 8→9→10 stub, and home again
  const LAPS = {
    walkKind: "laps",
    nodes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 8, 9, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  };

  it("names a lap walk by the circuit it goes round, not by its far end", () => {
    // node 10 is the farthest, but node 9 is the one walked four times —
    // and a park's rim street is what the farthest node usually is
    expect(namePoint(G, LAPS, at(0))?.[0]).toBeCloseTo(at(9)[0], 6);
  });

  it("falls back to the farthest point for every other loop", () => {
    expect(namePoint(G, { nodes: LAPS.nodes }, at(0))?.[0]).toBeCloseTo(at(10)[0], 6);
    expect(namePoint(G, { walkKind: "quiet", nodes: [0, 1, 2] }, at(0))?.[0]).toBeCloseTo(at(2)[0], 6);
  });

  it("falls back for a lap walk that repeats nothing", () => {
    expect(namePoint(G, { walkKind: "laps", nodes: [0, 1, 2] }, at(0))?.[0]).toBeCloseTo(at(2)[0], 6);
    expect(namePoint(G, { walkKind: "laps", nodes: [] }, at(0))).toBeNull();
  });
});

describe("backByFor — the other end of durationFromBackBy (final review I1)", () => {
  // The duration sheet's "Or be back by 17:45" and the loops card's
  // "3.0 km · back 17:45" are the same sentence about the same walk. They
  // disagreed because one counted from the DEPARTURE and the other from the
  // wall clock, so with `Leave 17:00` set at 07:55 the card said 17:45 and
  // the sheet 08:40 — and picking 18:00 in that sheet planned 240 minutes.
  it("agrees with the card for the same departure and the same length", () => {
    const departMin = 17 * 60;
    for (const min of [30, 45, 60, 90]) {
      expect(backByFor(departMin, min)).toBe(departMin + min);
    }
    expect(backByFor(17 * 60, 45)).toBe(17 * 60 + 45);
  });

  it("round-trips through durationFromBackBy, from the departure", () => {
    const departMin = 17 * 60;
    for (const min of [30, 45, 60, 90]) {
      expect(durationFromBackBy(backByFor(departMin, min), departMin)).toBe(min);
    }
    // and the reader's own pick comes back as the length they picked
    expect(durationFromBackBy(18 * 60, 17 * 60)).toBe(60);
  });

  it("never names an hour before the day starts", () => {
    expect(backByFor(0, 0)).toBe(0);
  });
});
