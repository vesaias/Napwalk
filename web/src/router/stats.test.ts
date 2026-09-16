import { describe, expect, it } from "vitest";
import { routeStats } from "./stats";
import { parseGraph } from "./graph";
import { packGraph } from "./packGraph";

const NODES: [number, number][] = [
  [50.1109, 8.6821],
  [50.1145, 8.6821],
  [50.1181, 8.6821],
];

describe("routeStats", () => {
  it("computes length-weighted card numbers", () => {
    const g = parseGraph(packGraph(NODES, [
      // 400 m fully shaded quiet asphalt
      { u: 0, v: 1, lenDm: 4000, shade: new Array(48).fill(255), noiseQ: 0, surfaceQ: 13 },
      // 100 m sunny loud cobbles (noise class E ~ 8/8)
      { u: 1, v: 2, lenDm: 1000, shade: new Array(48).fill(0), noiseQ: 255, surfaceQ: 242 },
    ]));
    const s = routeStats(g, [0, 1], 600);
    expect(s.km).toBe(0.5);
    expect(s.minutes).toBe(Math.round(500 / (4000 / 60)));
    expect(s.shadePct).toBe(80); // 400/500 shaded
    expect(s.cobbleM).toBe(100);
    expect(s.quietPct).toBe(80); // 400 m below 55 dB of 500
  });

  it("shade respects arrival time along the route", () => {
    const lateShade = new Array(48).fill(0);
    for (let i = 24; i < 48; i++) lateShade[i] = 255; // shady from 14:00
    const g = parseGraph(packGraph(NODES, [
      { u: 0, v: 1, lenDm: 4000, shade: lateShade },
      { u: 1, v: 2, lenDm: 4000, shade: lateShade },
    ]));
    // same route, three start times: morning fully sunny, 13:30 partial
    // (second edge reached closer to 14:00), 15:00 fully shady
    expect(routeStats(g, [0, 1], 8 * 60).shadePct).toBe(0);
    // start 13:44: first edge still sunny (bucket 23=0), second edge is
    // reached ~13:50, inside the 13:45->14:00 lerp window -> partial
    const mid = routeStats(g, [0, 1], 13 * 60 + 44).shadePct;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
    expect(routeStats(g, [0, 1], 15 * 60).shadePct).toBe(100);
    // the later leg is shadier than the first — arrival time matters
    const firstLegOnly = routeStats(g, [0], 13 * 60 + 44).shadePct;
    expect(mid).toBeGreaterThan(firstLegOnly);
  });
});
