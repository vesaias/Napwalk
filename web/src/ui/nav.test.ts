import { describe, expect, it } from "vitest";
import { parseGraph } from "../router/graph";
import { packGraph, type ToyEdge } from "../router/packGraph";
import {
  AHEAD_MIN,
  BACKTRACK_M,
  ON_NODE_M,
  OFF_ROUTE_M,
  OFF_ROUTE_MS,
  bearingDeg,
  nearestNodeIdx,
  offRoute,
  onPath,
  polylineOffM,
  shadeAhead,
  type OffSample,
} from "./nav";

// A straight 1 km chain east of a Frankfurt corner: eleven nodes, ten
// 100 m edges. The first five are fully shaded, the last five bare.
const LAT0 = 50.1109;
const LNG0 = 8.6821;
const DLNG_100M = 0.0014;
const NODES: [number, number][] = Array.from({ length: 11 }, (_, i) => [LAT0, LNG0 + i * DLNG_100M]);

const FULL = new Array(48).fill(255);
const NONE = new Array(48).fill(0);
// shaded only from bucket 24 (14:00); bare at bucket 23 (13:45)
const LATE = NONE.map((_, i) => (i >= 24 ? 255 : 0));

const link = (i: number, shade: number[]): ToyEdge => ({ u: i, v: i + 1, lenDm: 1000, shade });
// forward edges only, so packGraph's (u, v) sort makes eid i the edge i → i+1
const EDGES = Array.from({ length: 10 }, (_, i) => link(i, i < 5 ? FULL : NONE));

const NOON = 12 * 60;
const SPEED = 4000 / 60; // m per minute, the walking speed the router uses
const BUDGET_M = AHEAD_MIN * SPEED;

function graph(edges: ToyEdge[] = EDGES) {
  return parseGraph(packGraph(NODES, edges));
}

/** The whole chain as a candidate: ten edges, eleven nodes. */
const CAND = {
  eids: Array.from({ length: 10 }, (_, i) => i),
  nodes: Array.from({ length: 11 }, (_, i) => i),
};

const at = (i: number): [number, number] => [LNG0 + i * DLNG_100M, LAT0];

// A closed loop for B18: a 300 m block walked round, whose LAST leg comes
// back to the start past a node 18 m short of it. The walk begins at a fix
// 13 m along that last leg — on the first node of the loop and on its
// second-to-last at the same time, and nearer to the second-to-last.
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((LAT0 * Math.PI) / 180));
const RING_NODES: [number, number][] = [
  [LAT0, LNG0],                             // 0  A, where the loop starts and ends
  [LAT0, LNG0 + 300 * M_LNG],               // 1  B
  [LAT0 + 300 * M_LAT, LNG0 + 300 * M_LNG], // 2  C
  [LAT0 + 300 * M_LAT, LNG0],               // 3  D
  [LAT0 + 18 * M_LAT, LNG0],                // 4  E, 18 m short of A
];
const RING_EDGES: ToyEdge[] = [
  { u: 0, v: 1, lenDm: 3000, shade: FULL },
  { u: 1, v: 2, lenDm: 3000, shade: FULL },
  { u: 2, v: 3, lenDm: 3000, shade: FULL },
  { u: 3, v: 4, lenDm: 2820, shade: FULL },
  { u: 4, v: 0, lenDm: 180, shade: FULL },
];
/** The loop as a candidate: five edges, six nodes, the first the last. */
const RING = { eids: [0, 1, 2, 3, 4], nodes: [0, 1, 2, 3, 4, 0] };
/** ...and the fix the walker presses Start on: 13 m up the closing leg. */
const RING_START: [number, number] = [LNG0, LAT0 + 13 * M_LAT];

describe("nearestNodeIdx", () => {
  it("finds the node the fix stands on", () => {
    const g = graph();
    expect(nearestNodeIdx(g, CAND.nodes, at(0))).toBe(0);
    expect(nearestNodeIdx(g, CAND.nodes, at(6))).toBe(6);
    expect(nearestNodeIdx(g, CAND.nodes, at(10))).toBe(10);
  });

  it("rounds to the nearer of two neighbours", () => {
    const g = graph();
    // 40 m past node 3, so node 3 (40 m) beats node 4 (60 m)
    expect(nearestNodeIdx(g, CAND.nodes, [LNG0 + 3.4 * DLNG_100M, LAT0])).toBe(3);
    expect(nearestNodeIdx(g, CAND.nodes, [LNG0 + 3.6 * DLNG_100M, LAT0])).toBe(4);
  });

  it("prefers the part of the walk still ahead (Task 13: self-crossing loops)", () => {
    const g = graph();
    // A there-and-back walk over the first five nodes: node 2 appears twice,
    // at index 2 on the way out and index 6 on the way home.
    const there = [0, 1, 2, 3, 4, 3, 2, 1, 0];
    expect(nearestNodeIdx(g, there, at(2))).toBe(2); // no progress yet
    expect(nearestNodeIdx(g, there, at(2), 5)).toBe(6); // walking home
    // and it never goes backwards over a node it has already passed
    expect(nearestNodeIdx(g, there, at(3), 4)).toBe(5);
  });

  it("puts a loop's walker on its FIRST node, not the one it ends on (B18)", () => {
    const g = parseGraph(packGraph(RING_NODES, RING_EDGES));
    // node 4 is 5 m from the fix and node 0 is 13 m: the closest node is
    // the second-to-last of the walk, which would read it as 18 m from over
    expect(nearestNodeIdx(g, RING.nodes, RING_START)).toBe(0);
    // both are inside ON_NODE_M, which is what lets index break the tie
    expect(ON_NODE_M).toBeGreaterThan(13);
    // ...and the ratchet still wins once the walker really is on the way
    // home: from node 3 on, node 4 is the answer
    expect(nearestNodeIdx(g, RING.nodes, RING_START, 3)).toBe(4);
  });

  it("lets a walker who is nowhere near the rest of the walk start over", () => {
    const g = graph();
    const there = [0, 1, 2, 3, 4, 3, 2, 1, 0];
    // standing on node 0 with the walk "seven nodes in": the nearest node
    // ahead is 8 (0 m away), which is the right answer and not a backtrack
    expect(nearestNodeIdx(g, there, at(0), 7)).toBe(8);
    // but on the chain, which never returns, a fix back at the start is
    // 600 m from everything ahead — further than BACKTRACK_M, so the
    // whole route is searched again
    expect(BACKTRACK_M).toBeLessThan(600);
    expect(nearestNodeIdx(g, CAND.nodes, at(0), 6)).toBe(0);
    // within BACKTRACK_M the forward answer wins, wobbling fix or not
    expect(nearestNodeIdx(g, CAND.nodes, [LNG0 + 5.7 * DLNG_100M, LAT0], 6)).toBe(6);
  });
});

describe("shadeAhead", () => {
  it("keeps only the edges past the walker", () => {
    const a = shadeAhead(graph(), CAND, at(6), NOON)!;
    expect(a.fromIdx).toBe(6);
    expect(a.remainingEids).toEqual([6, 7, 8, 9]);
    expect(a.remainingM).toBeCloseTo(400, 3);
    expect(a.remainingMin).toBe(6); // 400 m / 66.7 m per min
    expect(a.sunMin).toBe(6); // all four are bare
  });

  it("covers exactly the next ten minutes, merging equal neighbours", () => {
    const a = shadeAhead(graph(), CAND, at(0), NOON)!;
    // five shaded edges (500 m), then bare ones until the 666.7 m budget
    expect(a.segments.map((s) => s.shade)).toEqual([true, false]);
    expect(a.segments[0].m).toBeCloseTo(500, 3);
    expect(a.segments[1].m).toBeCloseTo(BUDGET_M - 500, 3);
  });

  it("reports the whole remaining walk, not just the strip", () => {
    const a = shadeAhead(graph(), CAND, at(0), NOON)!;
    expect(a.remainingM).toBeCloseTo(1000, 3);
    expect(a.remainingMin).toBe(15);
    // 500 bare metres at 4 km/h is 7.5 min — 7.499999… in binary, so it
    // rounds down. sunMinutes has always done this; the strip is the
    // number people read, and it is metres, not minutes.
    expect(a.sunMin).toBe(7);
  });

  it("calls a bare stretch not mostly shaded", () => {
    const a = shadeAhead(graph(), CAND, at(5), NOON)!;
    expect(a.segments).toEqual([{ shade: false, m: 500 }]);
  });

  it("reads each edge's shade at the ARRIVAL time, not the start time", () => {
    // Edge 5 turns shaded between 13:45 and 14:00, crossing 0.5 at 13:52:30.
    // Leaving node 0 at 13:52 the walker reaches it at 13:59:30 — shaded,
    // so the strip's first block runs 600 m. A start-time lookup would read
    // 0.47 there and stop the block at 500 m.
    const g = graph(EDGES.map((e, i) => (i === 5 ? link(5, LATE) : e)));
    const a = shadeAhead(g, CAND, at(0), 832)!;
    expect(a.segments[0].m).toBeCloseTo(600, 3);
    expect(a.segments.map((s) => s.shade)).toEqual([true, false]);
  });

  it("counts only what is left of a walk that comes back on itself", () => {
    // there and back over the first four edges: the walker is at node 2 on
    // the way home (index 6), not at index 2 where they were ten minutes ago
    const LOOP = { eids: [0, 1, 2, 3, 3, 2, 1, 0], nodes: [0, 1, 2, 3, 4, 3, 2, 1, 0] };
    const a = shadeAhead(graph(), LOOP, at(2), NOON, 5)!;
    expect(a.fromIdx).toBe(6);
    expect(a.remainingEids).toEqual([1, 0]);
    expect(a.remainingM).toBeCloseTo(200, 3);
    // without the progress it would snap to index 2 and claim 600 m to go
    expect(shadeAhead(graph(), LOOP, at(2), NOON).remainingM).toBeCloseTo(600, 3);
  });

  it("prices a loop's whole first tick, not its last 18 m (B18)", () => {
    const g = parseGraph(packGraph(RING_NODES, RING_EDGES));
    const a = shadeAhead(g, RING, RING_START, NOON)!;
    expect(a.fromIdx).toBe(0);
    expect(a.remainingEids).toEqual([0, 1, 2, 3, 4]);
    expect(a.remainingM).toBeCloseTo(1200, 3);
    expect(a.remainingMin).toBe(18);
    // and the walker who really is 18 m from home still reads 18 m
    expect(shadeAhead(g, RING, RING_START, NOON, 3)!.remainingM).toBeCloseTo(18, 3);
  });

  it("has nothing to say at the end of the walk", () => {
    const a = shadeAhead(graph(), CAND, at(10), NOON)!;
    expect(a.remainingEids).toEqual([]);
    expect(a.segments).toEqual([]);
    expect(a.remainingMin).toBe(0);
    expect(a.sunMin).toBe(0);
  });

  it("survives a candidate with no edges", () => {
    const a = shadeAhead(graph(), { eids: [], nodes: [] }, at(0), NOON)!;
    expect(a).toMatchObject({ fromIdx: 0, remainingEids: [], segments: [], remainingMin: 0 });
  });
});

describe("bearingDeg", () => {
  it("names the four directions", () => {
    const here: [number, number] = [LNG0, LAT0];
    expect(bearingDeg(here, [LNG0, LAT0 + 0.01])).toBeCloseTo(0, 1); // north
    expect(bearingDeg(here, [LNG0 + 0.01, LAT0])).toBeCloseTo(90, 1); // east
    expect(bearingDeg(here, [LNG0, LAT0 - 0.01])).toBeCloseTo(180, 1); // south
    expect(bearingDeg(here, [LNG0 - 0.01, LAT0])).toBeCloseTo(270, 1); // west
  });

  it("stays inside one turn of the compass", () => {
    for (const d of [-0.01, 0, 0.01]) {
      const b = bearingDeg([LNG0, LAT0], [LNG0 - 0.01, LAT0 + d]);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
  });
});

describe("onPath", () => {
  // The chain runs due east, so every point on it bears 90°.
  it("measures the line, not its nodes", () => {
    const g = graph();
    // dead centre of the 100 m edge between nodes 3 and 4: 50 m from either
    // node, and 0 m from the line the walker is standing on
    const mid: [number, number] = [LNG0 + 3.5 * DLNG_100M, LAT0];
    expect(nearestNodeIdx(g, CAND.nodes, mid)).toBe(3);
    const p = onPath(g, CAND.nodes, mid);
    expect(p!.offM).toBeLessThan(0.5); // the graph's packed degrees, not maths
    expect(p!.bearing).toBeCloseTo(90, 0);
  });

  it("reports how far off the line a fix has strayed", () => {
    const g = graph();
    // 0.00045° of latitude is ~50 m north of the chain
    const p = onPath(g, CAND.nodes, [LNG0 + 3.5 * DLNG_100M, LAT0 + 0.00045]);
    expect(p!.offM).toBeGreaterThan(45);
    expect(p!.offM).toBeLessThan(55);
    expect(p!.at[1]).toBeCloseTo(LAT0, 5); // the foot of the perpendicular
  });

  it("looks past the node it is standing on for the heading", () => {
    // an L: east for one edge, then north
    const nodes: [number, number][] = [
      [LAT0, LNG0],
      [LAT0, LNG0 + DLNG_100M],
      [LAT0 + 0.0009, LNG0 + DLNG_100M],
    ];
    const g = parseGraph(
      packGraph(nodes, [
        { u: 0, v: 1, lenDm: 1000, shade: FULL },
        { u: 1, v: 2, lenDm: 1000, shade: FULL },
      ])
    );
    // standing on the corner: the bearing that matters is the one after it
    const p = onPath(g, [0, 1, 2], [LNG0 + DLNG_100M, LAT0]);
    expect(p!.bearing).toBeCloseTo(0, 0);
  });

  it("counts the drawn connector as route (fix round 1, B-1)", () => {
    const g = graph();
    // 100 m north of the chain: off the route's nodes by 100 m...
    const away: [number, number] = [LNG0 + 3.5 * DLNG_100M, LAT0 + 0.0009];
    expect(onPath(g, CAND.nodes, away)!.offM).toBeGreaterThan(90);
    // ...but a plan computed from there draws a dashed connector from the
    // walker's own feet to the edge it snapped to, and that IS the line they
    // see. Measured against it, they are standing on the walk.
    const connector: [number, number][] = [away, [LNG0 + 3.5 * DLNG_100M, LAT0]];
    expect(onPath(g, CAND.nodes, away, 0, [connector])!.offM).toBeLessThan(1);
    // the heading is still the route's, never the connector's
    expect(onPath(g, CAND.nodes, away, 0, [connector])!.bearing).toBeCloseTo(90, 0);
  });

  it("has no line to be off when the route is a single node", () => {
    expect(onPath(graph(), [3], at(3))).toBeNull();
    expect(onPath(graph(), [], at(3))).toBeNull();
  });
});

describe("offRoute", () => {
  /** `n` readings `m` metres from the line, one a second, starting at t=0. */
  const run = (m: number, seconds: number): OffSample[] =>
    Array.from({ length: seconds + 1 }, (_, i) => ({ t: i * 1000, m }));

  it("says nothing about a walker still on the line", () => {
    expect(offRoute([])).toBe(false);
    expect(offRoute(run(0, 60))).toBe(false);
    // 39 m is inside the 40 m tolerance, for ever
    expect(offRoute(run(39, 600))).toBe(false);
  });

  it("waits the full ten seconds", () => {
    expect(offRoute(run(41, 9))).toBe(false);
    expect(offRoute(run(41, 10))).toBe(true);
  });

  it("starts the clock again the moment the walker is back on it", () => {
    const wobble: OffSample[] = [
      ...run(41, 9),
      { t: 9_500, m: 10 }, // one fix back on the line
      { t: 10_000, m: 41 },
      { t: 19_000, m: 41 }, // only 9 s since it left again
    ];
    expect(offRoute(wobble)).toBe(false);
    expect(offRoute([...wobble, { t: 20_000, m: 41 }])).toBe(true);
  });

  it("reads the run that is still open, not an older one", () => {
    const old: OffSample[] = [...run(41, 30), { t: 31_000, m: 0 }, { t: 32_000, m: 41 }];
    expect(offRoute(old)).toBe(false);
  });

  it("holds the tolerance and the window the spec names", () => {
    expect(OFF_ROUTE_M).toBe(40);
    expect(OFF_ROUTE_MS).toBe(10_000);
  });
});

describe("polylineOffM", () => {
  const A: [number, number] = [LNG0, LAT0];
  const B: [number, number] = [LNG0 + DLNG_100M, LAT0];

  it("measures the segment, not its ends", () => {
    // the midpoint is 50 m from either end and 0 m from the line
    expect(polylineOffM([A, B], [LNG0 + 0.5 * DLNG_100M, LAT0])).toBeLessThan(0.5);
  });

  it("clamps to the ends of a finite segment", () => {
    // 100 m past B along the same bearing: the nearest point on the segment
    // is B itself, not the infinite line through it
    const past: [number, number] = [LNG0 + 2 * DLNG_100M, LAT0];
    expect(polylineOffM([A, B], past)).toBeCloseTo(100, -1);
  });

  it("takes the nearest of many segments", () => {
    const bend: [number, number] = [LNG0 + DLNG_100M, LAT0 + 0.0009];
    expect(polylineOffM([A, B, bend], [LNG0 + DLNG_100M, LAT0 + 0.00045])).toBeLessThan(1);
  });

  it("has nothing to say about an empty or one-point line", () => {
    expect(polylineOffM([], A)).toBe(Infinity);
    expect(polylineOffM([A], B)).toBeCloseTo(100, -1);
  });
});
