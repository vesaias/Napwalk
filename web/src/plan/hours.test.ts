import { describe, expect, it } from "vitest";
import { parseGraph } from "../router/graph";
import { packGraph, type ToyEdge } from "../router/packGraph";
import type { BorderGeom } from "../shade/ShadeLayer";
import { leaveWindow } from "../ui/time";
import {
  bestHour,
  daylightHours,
  distanceToBorder,
  insideBorder,
  shadeAround,
  shadeByHour,
  sunMinutes,
} from "./hours";

/** The window the fixed 10–19 strip used to be, kept here as a shape for the
 *  `bestHour` cases to talk about (CR-03 A3 made the real one the day's). */
const SHADE_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

// Same diamond as plan.test.ts: A→B→D shaded 300 m, A→C→D sunny 200 m.
const LAT0 = 50.1109;
const LNG0 = 8.6821;
const DLNG_100M = 0.0014;
const NODES: [number, number][] = [
  [LAT0, LNG0],
  [LAT0 + 0.001011, LNG0 + DLNG_100M],
  [LAT0, LNG0 + DLNG_100M],
  [LAT0, LNG0 + 2 * DLNG_100M],
];
const FULL = new Array(48).fill(255);
const NONE = new Array(48).fill(0);
const shaded = (u: number, v: number): ToyEdge => ({ u, v, lenDm: 1500, shade: FULL });
const sunny = (u: number, v: number): ToyEdge => ({ u, v, lenDm: 1000, shade: NONE, noiseQ: 255 });
const EDGES = [shaded(0, 1), shaded(1, 0), shaded(1, 3), shaded(3, 1), sunny(0, 2), sunny(2, 0), sunny(2, 3), sunny(3, 2)];
// 0: 0→1  1: 0→2  2: 1→0  3: 1→3  4: 2→0  5: 2→3  6: 3→1  7: 3→2
const SHADED = [0, 3];
const SUNNY = [1, 5];
const NOON = 12 * 60;

describe("sunMinutes", () => {
  it("counts the minutes walked on edges with shade < 0.5 at arrival", () => {
    const g = parseGraph(packGraph(NODES, EDGES));
    expect(sunMinutes(g, SUNNY, NOON)).toBe(3); // 200 m / 66.7 m/min
    expect(sunMinutes(g, SHADED, NOON)).toBe(0);
    expect(sunMinutes(g, [], NOON)).toBe(0);
  });

  it("uses the arrival time per edge, not the start time", () => {
    // second edge shaded from bucket 24 (14:00), bare at bucket 23 (13:45):
    // the interpolated shade crosses 0.5 at 13:52:30 (832.5). Leaving at
    // 832 the START time reads 0.47 (sunny) but the walker arrives at
    // 833.5 where it reads 0.57 (shaded) — a start-time bug counts 3.
    const late = NONE.map((_, i) => (i >= 24 ? 255 : 0));
    const g = parseGraph(packGraph(NODES, [...EDGES.slice(0, 6), { u: 2, v: 3, lenDm: 1000, shade: late }, sunny(3, 2)]));
    expect(sunMinutes(g, SUNNY, 832)).toBe(2);
    expect(sunMinutes(g, SUNNY, 10 * 60)).toBe(3);
  });
});

describe("shadeByHour", () => {
  it("returns one shade percentage per hour, 10:00–19:00 by default", () => {
    const g = parseGraph(packGraph(NODES, EDGES));
    const s = shadeByHour(g, SHADED, SHADE_HOURS);
    expect(s).toHaveLength(10);
    expect(s.every((v) => v === 100)).toBe(true);
    expect(shadeByHour(g, SUNNY, SHADE_HOURS).every((v) => v === 0)).toBe(true);
  });

  it("takes an explicit hour list", () => {
    const g = parseGraph(packGraph(NODES, EDGES));
    expect(shadeByHour(g, SHADED, [9, 12])).toEqual([100, 100]);
  });

  // The toy artifact's buckets run 08:00 → 19:45, and `daylightHours` gives
  // the first and last bars to the hours SUNRISE and SUNSET fall in — hours
  // whose early (or late) minutes are night. Priced at the bare hour, the
  // 05:00 bar of a June day was measured twenty minutes before sunrise,
  // where `shadeAt` reports full shade because the sun is down; the bar
  // stands for 05:20 onwards and is priced there (2026-09-09 ruling).
  it("prices the first and last bars inside the daylight they cover", () => {
    // SUNNY's two edges carry no shade in any bucket, so a fabricated
    // "fully shaded" reading is unmistakable
    const g = parseGraph(packGraph(NODES, EDGES));
    const JUNE = { sunriseMin: 5 * 60 + 20, sunsetMin: 21 * 60 + 35 };
    // no day: the bare hour, before sunrise, reads as fully shaded — the
    // fabricated 100 % this rule exists to stop
    expect(shadeByHour(g, SUNNY, [5])).toEqual([100]);
    // with the day: 05:20 is daylight the artifact cannot price, so it is
    // clamped to the first bucket, which for this toy edge is bare sun
    expect(shadeByHour(g, SUNNY, [5], JUNE)).toEqual([0]);
    // …the same at the other end, and untouched in between
    expect(shadeByHour(g, SUNNY, [21], JUNE)).toEqual([0]);
    expect(shadeByHour(g, SUNNY, [12], JUNE)).toEqual([0]);
    // and a minute that really is night still reads as fully shaded: the
    // whole 05:00 hour is dark in December, so the bar is clamped to
    // sunrise, which is inside the window and priced normally
    const DEC = { sunriseMin: 8 * 60 + 22, sunsetMin: 16 * 60 + 26 };
    expect(shadeByHour(g, SUNNY, [5], DEC)).toEqual([0]); // clamped up to 08:22
  });
});

describe("shadeAround", () => {
  it("averages shade over edges whose source lies within 150 m", () => {
    const g = parseGraph(packGraph(NODES, EDGES));
    // 40 m west of A: sources A (40 m) and C (140 m) count, B (180 m) and
    // D (240 m) do not → edges 0,1 (A) and 4,5 (C): one shaded of four
    expect(shadeAround(g, LNG0 - 0.00056, LAT0, NOON)).toBe(25);
  });

  it("is 0 with no edge nearby", () => {
    const g = parseGraph(packGraph(NODES, EDGES));
    expect(shadeAround(g, LNG0 + 0.05, LAT0 + 0.05, NOON)).toBe(0);
  });
});

const SQUARE: BorderGeom = {
  type: "Polygon",
  coordinates: [[[8.68, 50.11], [8.69, 50.11], [8.69, 50.12], [8.68, 50.12], [8.68, 50.11]]],
};
const WITH_HOLE: BorderGeom = {
  type: "Polygon",
  coordinates: [
    SQUARE.coordinates[0],
    [[8.684, 50.114], [8.686, 50.114], [8.686, 50.116], [8.684, 50.116], [8.684, 50.114]],
  ],
};
const MULTI: BorderGeom = {
  type: "MultiPolygon",
  coordinates: [SQUARE.coordinates, [[[8.70, 50.11], [8.71, 50.11], [8.71, 50.12], [8.70, 50.12], [8.70, 50.11]]]],
};

describe("insideBorder", () => {
  it("is true inside the ring and false outside", () => {
    expect(insideBorder(SQUARE, 8.685, 50.115)).toBe(true);
    expect(insideBorder(SQUARE, 8.695, 50.115)).toBe(false);
    expect(insideBorder(SQUARE, 8.685, 50.125)).toBe(false);
  });

  it("treats a second ring as a hole (even-odd)", () => {
    expect(insideBorder(WITH_HOLE, 8.685, 50.115)).toBe(false);
    expect(insideBorder(WITH_HOLE, 8.681, 50.111)).toBe(true);
  });

  it("checks every polygon of a MultiPolygon", () => {
    expect(insideBorder(MULTI, 8.705, 50.115)).toBe(true);
    expect(insideBorder(MULTI, 8.695, 50.115)).toBe(false);
  });
});

describe("insideBorder on the boundary itself", () => {
  // Even-odd ray casting has no "on the line" answer: the half-open rule
  // `yi > lat !== yj > lat` puts the SOUTH and WEST edges of a ring inside
  // and the NORTH and EAST edges outside, and a vertex follows the two
  // edges that meet there. This is not a bug to fix — two adjacent city
  // polygons must not both claim a shared border point — but it IS the
  // contract, so it is written down rather than discovered.
  it("counts the south-west corner in and the other three out", () => {
    expect(insideBorder(SQUARE, 8.68, 50.11)).toBe(true); // SW
    expect(insideBorder(SQUARE, 8.69, 50.11)).toBe(false); // SE
    expect(insideBorder(SQUARE, 8.69, 50.12)).toBe(false); // NE
    expect(insideBorder(SQUARE, 8.68, 50.12)).toBe(false); // NW
  });

  it("counts the south and west edges in, the north and east out", () => {
    expect(insideBorder(SQUARE, 8.685, 50.11)).toBe(true); // south edge
    expect(insideBorder(SQUARE, 8.68, 50.115)).toBe(true); // west edge
    expect(insideBorder(SQUARE, 8.685, 50.12)).toBe(false); // north edge
    expect(insideBorder(SQUARE, 8.69, 50.115)).toBe(false); // east edge
  });

  it("is stable a metre either side of an edge", () => {
    // ~1 m is 9e-6° of latitude: the answer must not flicker there
    expect(insideBorder(SQUARE, 8.685, 50.110009)).toBe(true);
    expect(insideBorder(SQUARE, 8.685, 50.109991)).toBe(false);
  });
});

describe("distanceToBorder", () => {
  it("is ~0 at a vertex", () => {
    expect(distanceToBorder(SQUARE, 8.69, 50.12)).toBeCloseTo(0, 3);
  });

  it("is the haversine distance to the nearest vertex", () => {
    // 0.01° of latitude north of the top-right vertex ≈ 1112 m
    const d = distanceToBorder(SQUARE, 8.69, 50.13);
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1125);
    // nearest vertex of the second polygon of a MultiPolygon
    expect(distanceToBorder(MULTI, 8.71, 50.13)).toBeCloseTo(d, 0);
  });

  it("measures a point INSIDE the border to the nearest vertex, not to 0", () => {
    // The contract is deliberately "distance to the nearest ring vertex",
    // not "distance to the polygon": for a point inside, that is a positive
    // number, not zero and not negative. outsideInfo is the only caller and
    // it asks insideBorder FIRST, so the figure is never shown for a fix
    // inside — but anything else reaching for this must know it.
    const centre = distanceToBorder(SQUARE, 8.685, 50.115);
    expect(centre).toBeGreaterThan(0);
    // the box is ~715 m by ~1112 m, so its centre is ~660 m from a corner
    expect(centre).toBeGreaterThan(600);
    expect(centre).toBeLessThan(700);
    // and a point just inside a corner is as small as it gets
    expect(distanceToBorder(SQUARE, 8.68001, 50.11001)).toBeLessThan(5);
  });

  it("counts a hole's vertices too — the nearest ring wins, inner or outer", () => {
    // the hole runs 8.684–8.686 × 50.114–50.116, inside the SQUARE
    expect(distanceToBorder(WITH_HOLE, 8.685, 50.115)).toBeLessThan(
      distanceToBorder(SQUARE, 8.685, 50.115),
    );
    expect(distanceToBorder(WITH_HOLE, 8.684, 50.114)).toBeCloseTo(0, 3);
  });

  it("is Infinity for a geometry with no vertices at all", () => {
    expect(distanceToBorder({ type: "Polygon", coordinates: [] }, 8.685, 50.115)).toBe(Infinity);
    expect(distanceToBorder({ type: "MultiPolygon", coordinates: [] }, 8.685, 50.115)).toBe(
      Infinity,
    );
  });
});

// CR-03 A3 / backlog B7: the strip covers the daylight day, not a fixed
// 10–19 that left a 07:00 departure with no bar and no badge.
describe("daylightHours", () => {
  it("is every hour the daylight window touches, sunrise's to sunset's", () => {
    // Frankfurt, late June: 05:15 → 21:38
    expect(daylightHours(5 * 60 + 15, 21 * 60 + 38)).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
    ]);
    // ...and late December: 08:22 → 16:26
    expect(daylightHours(8 * 60 + 22, 16 * 60 + 26)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it("counts an hour that lands exactly on sunrise or sunset", () => {
    expect(daylightHours(6 * 60, 20 * 60)[0]).toBe(6);
    expect(daylightHours(6 * 60, 20 * 60).at(-1)).toBe(20);
  });

  it("has June over the dense threshold and December under it", () => {
    expect(daylightHours(5 * 60 + 15, 21 * 60 + 38).length).toBeGreaterThanOrEqual(14);
    expect(daylightHours(8 * 60 + 22, 16 * 60 + 26).length).toBeLessThan(14);
  });

  it("is empty on a day with no daylight in it", () => {
    // sunriseMinutes/sunsetMinutes fold onto the same minute in a polar winter
    expect(daylightHours(1439, 1439)).toEqual([]);
    expect(daylightHours(12 * 60, 11 * 60)).toEqual([]);
  });

  // S2 review, finding 3: the sheet's two halves have to agree, and until
  // the first end was floored they did not. Frankfurt in June ran the
  // slider from 05:25 and the bars from 06:00, so 35 minutes of the track
  // stood on no bar: `currentBar = -1`, no percentage read out, and the
  // label row lost the current hour (measured on the parent).
  it("has a bar under every minute the leave-at window offers", () => {
    // sunrise/sunset pairs across the year and across the eight cities'
    // latitudes, including the two that land on a whole hour
    const days: [number, number][] = [
      [5 * 60 + 15, 21 * 60 + 38], // Frankfurt, June
      [5 * 60 + 20, 21 * 60 + 35],
      [8 * 60 + 22, 16 * 60 + 26], // Frankfurt, December
      [7 * 60 + 25, 16 * 60 + 25], // New York, December
      [5 * 60 + 55, 20 * 60 + 30], // San Francisco, June
      [6 * 60, 20 * 60], // exactly on the hour, both ends
      [6 * 60 + 59, 7 * 60 + 1], // a minute either side of one hour mark
    ];
    for (const [sunrise, sunset] of days) {
      const hours = daylightHours(sunrise, sunset);
      const win = leaveWindow(sunrise, sunset, 12 * 60);
      for (const m of [win.min, win.max]) {
        expect(hours, `${sunrise}-${sunset} @ ${m}`).toContain(Math.floor(m / 60));
      }
    }
  });
});

describe("bestHour", () => {
  const flat = SHADE_HOURS.map(() => 40);

  it("is null for a profile that was never measured", () => {
    expect(bestHour([], SHADE_HOURS)).toBeNull();
    expect(bestHour([1, 2, 3], SHADE_HOURS)).toBeNull(); // shorter than the window
    expect(bestHour([...flat, 99], SHADE_HOURS)).toBeNull(); // and longer
    expect(bestHour([], [])).toBeNull(); // ...and a window with no hours in it
  });

  it("names the shadiest hour, its index and what it reads", () => {
    const pct = [...flat];
    pct[4] = 68; // 14:00
    expect(bestHour(pct, SHADE_HOURS)).toEqual({ idx: 4, hour: 14, pct: 68 });
  });

  it("reads the hour off the window it was given, not off a fixed one", () => {
    const june = daylightHours(5 * 60 + 15, 21 * 60 + 38);
    const pct = june.map(() => 40);
    pct[1] = 90; // the second bar is 06:00 in June (the first is sunrise's)
    expect(bestHour(pct, june)).toEqual({ idx: 1, hour: 6, pct: 90 });
  });

  it("finds a best at either end of the day", () => {
    const first = [...flat];
    first[0] = 90;
    expect(bestHour(first, SHADE_HOURS)?.hour).toBe(SHADE_HOURS[0]);
    const last = [...flat];
    last[SHADE_HOURS.length - 1] = 90;
    expect(bestHour(last, SHADE_HOURS)?.hour).toBe(SHADE_HOURS[SHADE_HOURS.length - 1]);
  });

  it("gives a tie to the earlier hour — the walk you can take sooner", () => {
    const pct = [...flat];
    pct[2] = 70;
    pct[7] = 70;
    expect(bestHour(pct, SHADE_HOURS)?.hour).toBe(SHADE_HOURS[2]);
    // and an all-flat day still answers, rather than pretending it has none
    expect(bestHour(flat, SHADE_HOURS)).toEqual({ idx: 0, hour: SHADE_HOURS[0], pct: 40 });
  });
});
