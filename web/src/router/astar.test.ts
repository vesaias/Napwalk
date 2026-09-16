import { describe, expect, it } from "vitest";
import { PRESETS, edgeCost, minRate, noiseCurve, route, shadeAt } from "./astar";
import { parseGraph } from "./graph";
import { packGraph, type ToyEdge } from "./packGraph";

// Diamond: 0 -> 1 -> 3 (long, shady) vs 0 -> 2 -> 3 (short, sunny).
// ~500 m per long edge, ~300 m per short edge.
const NODES: [number, number][] = [
  [50.1109, 8.6821], // 0 start
  [50.114, 8.68], // 1 shady detour
  [50.112, 8.684], // 2 direct
  [50.1145, 8.6845], // 3 goal
];
const FULL = new Array(48).fill(255);
const NONE = new Array(48).fill(0);

function diamond(shadyLong: number[], sunnyShort: number[]): ToyEdge[] {
  return [
    { u: 0, v: 1, lenDm: 5000, shade: shadyLong },
    { u: 1, v: 3, lenDm: 5000, shade: shadyLong },
    { u: 0, v: 2, lenDm: 3000, shade: sunnyShort },
    { u: 2, v: 3, lenDm: 3000, shade: sunnyShort },
  ];
}

describe("route", () => {
  it("prefers short path when shade does not matter (maxQuiet)", () => {
    const g = parseGraph(packGraph(NODES, diamond(FULL, NONE)));
    const r = route(g, 0, 3, 600, PRESETS.maxQuiet)!;
    expect(r.nodes).toEqual([0, 2, 3]);
    expect(r.meters).toBeCloseTo(600);
  });

  it("takes the shady detour on maxShade", () => {
    const g = parseGraph(packGraph(NODES, diamond(FULL, NONE)));
    const r = route(g, 0, 3, 600, PRESETS.maxShade)!;
    // 1000m·(1+0) = 1000 vs 600m·(1+3.5) = 2700 -> detour wins
    expect(r.nodes).toEqual([0, 1, 3]);
  });

  it("uses arrival time, not start time, for shade lookup", () => {
    // long edges shady ONLY in the afternoon (bucket >= 24, i.e. 14:00+).
    const afternoonShade = NONE.map((_, i) => (i >= 24 ? 255 : 0));
    const g = parseGraph(packGraph(NODES, diamond(afternoonShade, NONE)));
    const morning = route(g, 0, 3, 8 * 60, PRESETS.maxShade)!;
    const afternoon = route(g, 0, 3, 15 * 60, PRESETS.maxShade)!;
    expect(morning.nodes).toEqual([0, 2, 3]); // detour not yet shady
    expect(afternoon.nodes).toEqual([0, 1, 3]);
  });

  it("cost never below straight-line meters (admissible heuristic)", () => {
    const g = parseGraph(packGraph(NODES, diamond(FULL, FULL)));
    const r = route(g, 0, 3, 600, PRESETS.balanced)!;
    expect(r.cost).toBeGreaterThanOrEqual(r.meters);
  });

  it("extraCost hook penalizes chosen edges", () => {
    const g = parseGraph(packGraph(NODES, diamond(NONE, NONE)));
    const first = route(g, 0, 3, 600, PRESETS.maxQuiet)!;
    const used = new Set(first.eids);
    const second = route(g, 0, 3, 600, PRESETS.maxQuiet,
      (eid) => (used.has(eid) ? 5 : 0))!;
    expect(second.nodes).toEqual([0, 1, 3]);
  });

  it("returns null when unreachable", () => {
    const g = parseGraph(packGraph(NODES, [{ u: 0, v: 1, lenDm: 100 }]));
    expect(route(g, 0, 3, 600, PRESETS.balanced)).toBeNull();
  });
});

describe("green preference", () => {
  it("prefers the green path of two equal-length options", () => {
    const g = parseGraph(packGraph(NODES, [
      { u: 0, v: 1, lenDm: 5000, greenQ: 255 },
      { u: 1, v: 3, lenDm: 5000, greenQ: 255 },
      { u: 0, v: 2, lenDm: 5000, greenQ: 0 },
      { u: 2, v: 3, lenDm: 5000, greenQ: 0 },
    ]));
    const r = route(g, 0, 3, 600, PRESETS.balanced)!;
    expect(r.nodes).toEqual([0, 1, 3]);
  });

  it("does not detour absurdly for green (bounded by weight)", () => {
    // green detour is 3x the length: 3000·(1+0) vs 1000·(1+0.6) -> direct wins
    const g = parseGraph(packGraph(NODES, [
      { u: 0, v: 1, lenDm: 15000, greenQ: 255 },
      { u: 1, v: 3, lenDm: 15000, greenQ: 255 },
      { u: 0, v: 2, lenDm: 5000, greenQ: 0 },
      { u: 2, v: 3, lenDm: 5000, greenQ: 0 },
    ]));
    const r = route(g, 0, 3, 600, PRESETS.balanced)!;
    expect(r.nodes).toEqual([0, 2, 3]);
  });
});

describe("shadeAt", () => {
  it("lerps between buckets and clamps the day edges", () => {
    const shade = new Array(48).fill(0);
    shade[0] = 255; // 08:00
    shade[1] = 0; //   08:15
    const g = parseGraph(packGraph(NODES, [{ u: 0, v: 1, lenDm: 100, shade }]));
    expect(shadeAt(g, 0, 480)).toBeCloseTo(1);
    expect(shadeAt(g, 0, 487.5)).toBeCloseTo(0.5);
    expect(shadeAt(g, 0, 400)).toBeCloseTo(1); // clamped before 08:00
  });
});

describe("ORS-shaped weighting", () => {
  it("a shaded park path costs less than its own length (green discount)", () => {
    const g = parseGraph(packGraph(NODES, [
      { u: 0, v: 1, lenDm: 1000, greenQ: 255, shade: FULL },
      { u: 0, v: 2, lenDm: 1000, greenQ: 0, shade: FULL },
    ]));
    const park = edgeCost(g, 0, 600, PRESETS.balanced, 0);
    const street = edgeCost(g, 1, 600, PRESETS.balanced, 0);
    expect(park).toBeLessThan(100); // 100 m edge, rate 1 - 0.6 = 0.4
    expect(park).toBeCloseTo(40);
    expect(street).toBeCloseTo(100);
  });

  it("noise curve: quiet free, loud quadratic", () => {
    expect(noiseCurve(0)).toBe(0);
    expect(noiseCurve(4 / 8)).toBe(0);
    expect(noiseCurve(1)).toBeCloseTo(1);
    const mid = noiseCurve(6 / 8);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.5); // convex: halfway up the loud range is < 0.5
  });

  it("route uses the shadier sidewalk (max of L/R)", () => {
    const g = parseGraph(packGraph(NODES, [
      { u: 0, v: 1, lenDm: 1000, shadeL: new Array(48).fill(255), shadeR: new Array(48).fill(0) },
      { u: 0, v: 2, lenDm: 1000, shadeL: new Array(48).fill(0), shadeR: new Array(48).fill(0) },
    ]));
    expect(shadeAt(g, 0, 600)).toBeCloseTo(1);
    expect(shadeAt(g, 1, 600)).toBeCloseTo(0);
    expect(edgeCost(g, 0, 600, PRESETS.maxShade, 0)).toBeLessThan(edgeCost(g, 1, 600, PRESETS.maxShade, 0));
  });

  it("heuristic stays admissible with the green discount", () => {
    // all-green graph: cost rate is (1 - wGreen); path cost must be >= h(start)
    const g = parseGraph(packGraph(NODES, diamond(FULL, FULL).map((e) => ({ ...e, greenQ: 255 }))));
    const r = route(g, 0, 3, 600, PRESETS.balanced)!;
    const straight = Math.hypot(g.x[3] - g.x[0], g.y[3] - g.y[0]);
    expect(r.cost).toBeGreaterThanOrEqual(minRate(PRESETS.balanced) * straight - 1e-6);
  });
});

// Minutes the artifact cannot price (2026-09-09 ruling; found in the S1/S2
// fix round).
//
// The shade buckets cover the EXPORT day's daylight, not the selected day's.
// Frankfurt's artifact was exported in late August and runs 06:30–20:30;
// in June the sun is up from 05:25. `lerpShade` returned 1 — fully shaded —
// for every minute outside the window, which is right after dark and wrong
// at dawn: the leave-at strip drew a fabricated 100 % bar at each end of a
// June day and `bestHour` recommended it ("Best: 05:00 · 100 % shade").
//
// The rule now: sun DOWN → 1, as before; sun UP but unpriced → the nearest
// edge bucket. The toy graph's window is 08:00 → 19:45 (48 buckets of 15
// from 08:00), which stands in for the real one.
describe("shadeAt outside the artifact's bucket window", () => {
  const WINDOW_START = 8 * 60;
  const WINDOW_END = 8 * 60 + 15 * 47; // 19:45
  /** A long summer day either side of the export day's window. */
  const JUNE = { sunriseMin: 5 * 60 + 25, sunsetMin: 21 * 60 + 35 };

  /** Bucket 0 reads 25/255, the last reads 200/255, the middle 128 — three
   *  values that cannot be confused with each other or with 1. */
  const ramp = new Array(48).fill(128);
  ramp[0] = 25;
  ramp[47] = 200;
  const g = parseGraph(packGraph(NODES, [{ u: 0, v: 1, lenDm: 5000, shade: ramp }]));

  it("prices a minute before sunrise as fully shaded, as it always has", () => {
    expect(shadeAt(g, 0, JUNE.sunriseMin - 30, JUNE)).toBe(1);
    expect(shadeAt(g, 0, 0, JUNE)).toBe(1);
  });

  it("prices dawn — sun up, before the first bucket — like the first bucket", () => {
    // 06:00 on 21 June is broad daylight and 30 minutes before the export
    // day's earliest sun: the honest client-side answer is the earliest
    // morning the artifact knows about.
    expect(shadeAt(g, 0, 6 * 60, JUNE)).toBeCloseTo(25 / 255, 6);
    expect(shadeAt(g, 0, WINDOW_START - 1, JUNE)).toBeCloseTo(25 / 255, 6);
    // …and the boundary itself is the bucket, clamped or not
    expect(shadeAt(g, 0, WINDOW_START, JUNE)).toBeCloseTo(25 / 255, 6);
  });

  it("leaves every minute inside the window exactly as it was", () => {
    for (const m of [WINDOW_START, 10 * 60, 14 * 60, WINDOW_END]) {
      expect(shadeAt(g, 0, m, JUNE), `${m}`).toBe(shadeAt(g, 0, m));
    }
    expect(shadeAt(g, 0, 14 * 60, JUNE)).toBeCloseTo(128 / 255, 6);
  });

  it("prices dusk — sun up, after the last bucket — like the last bucket", () => {
    expect(shadeAt(g, 0, WINDOW_END + 1, JUNE)).toBeCloseTo(200 / 255, 6);
    expect(shadeAt(g, 0, 21 * 60, JUNE)).toBeCloseTo(200 / 255, 6);
  });

  it("prices a minute after sunset as fully shaded", () => {
    expect(shadeAt(g, 0, JUNE.sunsetMin + 1, JUNE)).toBe(1);
    expect(shadeAt(g, 0, 23 * 60, JUNE)).toBe(1);
  });

  it("is the shipped behaviour with no day given at all", () => {
    // every caller that has no sun to hand keeps the 2026-08-28 rule
    expect(shadeAt(g, 0, 6 * 60)).toBe(1);
    expect(shadeAt(g, 0, 21 * 60)).toBe(1);
    expect(shadeAt(g, 0, 14 * 60)).toBeCloseTo(128 / 255, 6);
  });

  it("still says 'shaded' outside the window on a short winter day", () => {
    // December in Frankfurt: the daylight is NARROWER than the window, so
    // every minute the clamp could fire on is a minute after dark and the
    // 2026-08-28 rule stands unchanged.
    const DEC = { sunriseMin: 8 * 60 + 22, sunsetMin: 16 * 60 + 26 };
    expect(shadeAt(g, 0, 7 * 60, DEC)).toBe(1); // before the window AND before sunrise
    expect(shadeAt(g, 0, 20 * 60, DEC)).toBe(1); // after the window AND after sunset
    expect(shadeAt(g, 0, 12 * 60, DEC)).toBeCloseTo(128 / 255, 6);
    // …and a minute the artifact DOES price is left to the artifact, sun up
    // or not: 18:00 in December is dark, but the export day has a bucket for
    // it and that bucket is the only measurement there is. Unchanged by this
    // rule, which only ever speaks for minutes outside the window.
    expect(shadeAt(g, 0, 18 * 60, DEC)).toBe(shadeAt(g, 0, 18 * 60));
  });

  it("reaches the router's cost, so a dawn walk is priced rather than flattened", () => {
    // With every edge reading 1 the shade term is a constant and the router
    // is choosing on the other axes alone. Same minute, same preset: the
    // cost moves once the day is known.
    const p = { ...PRESETS.maxShade, day: JUNE };
    const flat = edgeCost(g, 0, 6 * 60, PRESETS.maxShade, 0);
    const priced = edgeCost(g, 0, 6 * 60, p, 0);
    expect(priced).toBeGreaterThan(flat);
    // …and inside the window the two agree exactly
    expect(edgeCost(g, 0, 14 * 60, p, 0)).toBe(edgeCost(g, 0, 14 * 60, PRESETS.maxShade, 0));
  });
});
