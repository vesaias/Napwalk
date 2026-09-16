import { describe, expect, it } from "vitest";
import { shadeAt, SPEED_M_PER_MIN } from "../router/astar";
import { parseGraph, toXY } from "../router/graph";
import { routeLine } from "../router/draw";
import { packGraph, type ToyEdge } from "../router/packGraph";
import { DEFAULT_SETTINGS, type Settings } from "./settings";
import { FASTEST, presetFor } from "./preference";
import { snapToEdge } from "../router/graph";
import { abLeg, planAB, planLoops, planLoopsVia } from "./plan";

// Diamond A(0) → B(1) → D(3): 2 × 150 m, fully shaded, silent.
//         A(0) → C(2) → D(3): 2 × 100 m, sunny, loud (noiseQ 255).
// Geometry matches the lengths so the A* heuristic stays honest:
// C is 100 m east of A, D 200 m east, B 112 m north of C.
const LAT0 = 50.1109;
const LNG0 = 8.6821;
const DLNG_100M = 0.0014; // 100 m of longitude at 50.11° N
const NODES: [number, number][] = [
  [LAT0, LNG0], // 0 A
  [LAT0 + 0.001011, LNG0 + DLNG_100M], // 1 B
  [LAT0, LNG0 + DLNG_100M], // 2 C
  [LAT0, LNG0 + 2 * DLNG_100M], // 3 D
];
const FULL = new Array(48).fill(255);
const NONE = new Array(48).fill(0);

function diamond(opts: { cobbledShade?: boolean; cobbledAll?: boolean } = {}): ToyEdge[] {
  const shadeQ = opts.cobbledShade || opts.cobbledAll ? 200 : 0;
  const sunQ = opts.cobbledAll ? 200 : 0;
  const shaded = (u: number, v: number): ToyEdge => ({ u, v, lenDm: 1500, shade: FULL, surfaceQ: shadeQ });
  const sunny = (u: number, v: number): ToyEdge => ({ u, v, lenDm: 1000, shade: NONE, noiseQ: 255, surfaceQ: sunQ });
  return [shaded(0, 1), shaded(1, 0), shaded(1, 3), shaded(3, 1), sunny(0, 2), sunny(2, 0), sunny(2, 3), sunny(3, 2)];
}
// eids after packGraph's (u, v) sort:
// 0: 0→1  1: 0→2  2: 1→0  3: 1→3  4: 2→0  5: 2→3  6: 3→1  7: 3→2
const SHADED = [0, 3];
const SUNNY = new Set([1, 5]);

// The same diamond with the shaded way pulled in: B sits 60 m north of C,
// so the shaded leg is 233 m where the sunny one is 200 m — one minute
// apart once both are rounded.
const NEAR_NODES: [number, number][] = [
  [LAT0, LNG0], // 0 A
  [LAT0 + 0.000543, LNG0 + DLNG_100M], // 1 B, 60 m north of C
  [LAT0, LNG0 + DLNG_100M], // 2 C
  [LAT0, LNG0 + 2 * DLNG_100M], // 3 D
];
function nearDiamond(): ToyEdge[] {
  const shaded = (u: number, v: number): ToyEdge => ({ u, v, lenDm: 1166, shade: FULL, surfaceQ: 0 });
  const sunny = (u: number, v: number): ToyEdge => ({ u, v, lenDm: 1000, shade: NONE, noiseQ: 255, surfaceQ: 0 });
  return [shaded(0, 1), shaded(1, 0), shaded(1, 3), shaded(3, 1), sunny(0, 2), sunny(2, 0), sunny(2, 3), sunny(3, 2)];
}

// Two ways from A to D, tuned against the cost model (astar.ts PRESETS) so
// that the three presets disagree in the one way this test needs: a SHORT
// street that is half shaded and fully loud (rate 3.29 balanced, 3.65 max
// shade, 4.0 max quiet) and a LONG one, fully shaded and silent (rate 1).
// At 100 m against 345 m, balanced takes the short way and BOTH the shade
// and the quiet preset answer with the long one.
const DLNG_50M = DLNG_100M / 2;
const TWIN_NODES: [number, number][] = [
  [LAT0, LNG0], // 0 A
  [LAT0 + 0.001493, LNG0 + DLNG_50M], // 1 B, 165 m north of C
  [LAT0, LNG0 + DLNG_50M], // 2 C, 50 m east
  [LAT0, LNG0 + 2 * DLNG_50M], // 3 D, 100 m east
];
const HALF = new Array(48).fill(120); // 47 % shaded
function twinPaths(): ToyEdge[] {
  const long = (u: number, v: number): ToyEdge => ({ u, v, lenDm: 1725, shade: FULL, surfaceQ: 0 });
  const short = (u: number, v: number): ToyEdge => ({ u, v, lenDm: 500, shade: HALF, noiseQ: 255, surfaceQ: 0 });
  return [long(0, 1), long(1, 0), long(1, 3), long(3, 1), short(0, 2), short(2, 0), short(2, 3), short(3, 2)];
}
// the pin sits ON D: both ways end there, so the choice is between the two
// ways and not between two ends of the destination edge
const TWIN_DEST: [number, number] = [LNG0 + 2 * DLNG_50M, LAT0];

const A: [number, number] = [LNG0, LAT0];
// the pin sits 5 m west of D on the C–D edge, so the two snap ends are
// not tied (a pin exactly on D ties route-to-B + edge against route-to-D)
const NEAR_D: [number, number] = [LNG0 + 2 * DLNG_100M - 0.00007, LAT0];
const NOON = 12 * 60;
const S: Settings = { ...DEFAULT_SETTINGS };

describe("planAB", () => {
  it("shade: recommends the shaded way, offers the sunny way as faster", () => {
    const g = parseGraph(packGraph(NODES, diamond()));
    const r = planAB(g, A, NEAR_D, NOON, "shade", S)!;
    expect(r).not.toBeNull();
    expect(r.pref).toBe("shade");
    expect(r.startMin).toBe(NOON);
    expect(r.recommended.kind).toBe("recommended");
    expect(r.recommended.eids).toEqual(SHADED);
    expect(r.recommended.nodes).toEqual([0, 1, 3]);
    // 300 m routed + the 5 m of the C–D edge back to the pin
    expect(r.recommended.meters).toBeCloseTo(305, 0);
    expect(r.recommended.stats.minutes).toBe(Math.round(305 / SPEED_M_PER_MIN)); // 5
    expect(r.recommended.stats.km).toBe(0.3);
    expect(r.recommended.stats.shadePct).toBe(100);
    expect(r.recommended.stats.quietPct).toBe(100);
    expect(r.recommended.sunMin).toBe(0);
    expect(r.recommended.deltaMin).toBe(0);
    expect(r.alternatives.map((c) => c.kind)).toEqual(["faster"]);
    const fast = r.alternatives[0];
    expect(fast.kind).toBe("faster");
    expect(fast.deltaMin).toBeLessThan(0);
    expect(fast.eids.length).toBeGreaterThan(0);
    for (const e of fast.eids) expect(SUNNY.has(e)).toBe(true);
    expect(fast.sunMin).toBeGreaterThan(0);
    expect(fast.stats.shadePct).toBe(0);
    // FASTEST ends at C (100 + 95 m) rather than D (200 + 5 m)
    expect(fast.nodes).toEqual([0, 2]);
    expect(fast.meters).toBeCloseTo(195, 0);
    expect(fast.stats.minutes).toBe(Math.round(195 / SPEED_M_PER_MIN)); // 3
    expect(fast.deltaMin).toBe(3 - 5);
  });

  it("each candidate carries its own tail to the destination pin", () => {
    const g = parseGraph(packGraph(NODES, diamond()));
    const r = planAB(g, A, NEAR_D, NOON, "shade", S)!;
    const rec = r.recommended.tail!;
    const fast = r.alternatives[0].tail!;
    expect(r.tail).toEqual(rec);
    expect(fast).not.toEqual(rec);
    // both end at the snap point; the recommended tail starts at D (5 m
    // away), the faster one at C (95 m away)
    const m = (p: [number, number], q: [number, number]) => {
      const [ax, ay] = toXY(p[0], p[1]);
      const [bx, by] = toXY(q[0], q[1]);
      return Math.hypot(ax - bx, ay - by);
    };
    expect(m(rec[rec.length - 1], NEAR_D)).toBeLessThan(1);
    expect(m(fast[fast.length - 1], NEAR_D)).toBeLessThan(1);
    expect(m(rec[0], NEAR_D)).toBeCloseTo(5, -1);
    expect(m(fast[0], NEAR_D)).toBeCloseTo(95, -1);
  });

  it("quiet: the shaded way is also the quiet one", () => {
    const g = parseGraph(packGraph(NODES, diamond()));
    const r = planAB(g, A, NEAR_D, NOON, "quiet", S)!;
    expect(r.recommended.eids).toEqual(SHADED);
    expect(r.alternatives.map((c) => c.kind)).toEqual(["faster"]);
  });

  it("balanced: the shade and quiet legs duplicate the recommendation and are dropped", () => {
    const g = parseGraph(packGraph(NODES, diamond()));
    const r = planAB(g, A, NEAR_D, NOON, "balanced", S)!;
    expect(r.recommended.eids).toEqual(SHADED);
    expect(r.alternatives.map((c) => c.kind)).toEqual(["faster"]);
    expect(r.alternatives.length).toBeLessThanOrEqual(2);
  });

  it("avoidCobbles walls off the cobbled shaded way", () => {
    const g = parseGraph(packGraph(NODES, diamond({ cobbledShade: true })));
    const r = planAB(g, A, NEAR_D, NOON, "shade", { ...S, avoidCobbles: true })!;
    expect(r).not.toBeNull();
    for (const e of r.recommended.eids) expect(SUNNY.has(e)).toBe(true);
    expect(r.recommended.stats.cobbleM).toBe(0);
    // every leg is forced onto the same way → nothing left to offer
    expect(r.alternatives).toEqual([]);
  });

  it("returns null when the destination is unreachable", () => {
    const far: [number, number][] = [
      [LAT0, LNG0],
      [LAT0, LNG0 + DLNG_100M],
      [LAT0 + 0.02, LNG0], // 2 km north, own component
      [LAT0 + 0.02, LNG0 + DLNG_100M],
    ];
    const g = parseGraph(packGraph(far, [
      { u: 0, v: 1, lenDm: 1000 }, { u: 1, v: 0, lenDm: 1000 },
      { u: 2, v: 3, lenDm: 1000 }, { u: 3, v: 2, lenDm: 1000 },
    ]));
    expect(planAB(g, A, [LNG0 + DLNG_100M, LAT0 + 0.02], NOON, "shade", S)).toBeNull();
  });

  it("head/tail come from the snaps; a far pin gets a connector", () => {
    const g = parseGraph(packGraph(NODES, diamond()));
    const onGraph = planAB(g, A, NEAR_D, NOON, "shade", S)!;
    expect(onGraph.connectors).toEqual([]);
    expect(onGraph.head.length).toBeGreaterThan(0);
    expect(onGraph.tail.length).toBeGreaterThan(0);
    // the tail ends at the destination pin's snap point (on the C–D edge)
    const tailEnd = onGraph.tail[onGraph.tail.length - 1];
    expect(tailEnd[0]).toBeCloseTo(NEAR_D[0], 5);
    expect(tailEnd[1]).toBeCloseTo(NEAR_D[1], 5);
    // start 30 m south of A: a connector from the pin to the snap point
    const off: [number, number] = [LNG0, LAT0 - 0.00027];
    const r = planAB(g, off, NEAR_D, NOON, "shade", S)!;
    expect(r.connectors.length).toBe(1);
    expect(r.connectors[0][0]).toEqual(off);
  });
});

// 25 × 25 street grid, 100 m spacing, as in router/loops.test.ts — the PSP
// loop planner needs a ring of nodes around the start, which the diamond
// cannot give it. `cobbledRows` cobbles every horizontal edge in those rows.
const GRID_N = 25;
const GRID_LAT = 100 / 110_574;
const GRID_LNG = 100 / (111_320 * Math.cos((50.11 * Math.PI) / 180));
/** Bands of the grid that are park-green, fully shaded (and, because a walk
 *  worth choosing has to cost something, 40 % longer) or loud. Everything
 *  omitted leaves the row exactly as it was before these existed. */
type GridBands = {
  greenRows?: (r: number) => boolean;
  shadeRows?: (r: number) => boolean;
  loudRows?: (r: number) => boolean;
};
function gridGraph(cobbledRows: (r: number) => boolean = () => false, o: GridBands = {}) {
  const nodes: [number, number][] = [];
  for (let r = 0; r < GRID_N; r++) {
    for (let c = 0; c < GRID_N; c++) {
      nodes.push([LAT0 + (r - GRID_N / 2) * GRID_LAT, LNG0 + (c - GRID_N / 2) * GRID_LNG]);
    }
  }
  const edges: ToyEdge[] = [];
  const id = (r: number, c: number) => r * GRID_N + c;
  for (let r = 0; r < GRID_N; r++) {
    for (let c = 0; c < GRID_N; c++) {
      const q = cobbledRows(r) ? 200 : 0;
      const lenDm = o.shadeRows?.(r) ? 1400 : 1000;
      const band = {
        greenQ: o.greenRows?.(r) ? 255 : 0,
        shade: o.shadeRows?.(r) ? FULL : undefined,
        noiseQ: o.loudRows?.(r) ? 255 : 0,
      };
      if (c + 1 < GRID_N) {
        edges.push({ u: id(r, c), v: id(r, c + 1), lenDm, surfaceQ: q, ...band });
        edges.push({ u: id(r, c + 1), v: id(r, c), lenDm, surfaceQ: q, ...band });
      }
      if (r + 1 < GRID_N) {
        edges.push({ u: id(r, c), v: id(r + 1, c), lenDm, ...band });
        edges.push({ u: id(r + 1, c), v: id(r, c), lenDm, ...band });
      }
    }
  }
  return parseGraph(packGraph(nodes, edges));
}
const GRID_CENTER = Math.floor((GRID_N * GRID_N) / 2);
const GRID_START: [number, number] = [LNG0 - 0.5 * GRID_LNG, LAT0 - 0.5 * GRID_LAT]; // node 312 (row 12, col 12) exactly

describe("planLoops", () => {
  it("labels the loop planner's results, recommended first, deltas against it", () => {
    const g = gridGraph();
    const r = planLoops(g, GRID_START, 30, NOON, "quiet", S)!;
    expect(r).not.toBeNull();
    expect(r.pref).toBe("quiet");
    expect(r.startMin).toBe(NOON);
    expect(r.recommended.kind).toBe("recommended");
    expect(r.recommended.deltaMin).toBe(0);
    expect(r.recommended.nodes[0]).toBe(GRID_CENTER);
    expect(r.recommended.nodes[r.recommended.nodes.length - 1]).toBe(GRID_CENTER);
    expect(r.recommended.stats.minutes).toBeGreaterThan(0);
    // loops() returns 3 on this grid, but a uniform grid gives most of them
    // nothing to offer: SPEC §1.1 keeps only what clears a threshold. The
    // floor matters as much as the cap — a cap alone passes with no
    // alternatives at all, i.e. with the loop deleted (review F6).
    expect(r.alternatives.length).toBeGreaterThanOrEqual(1);
    expect(r.alternatives.length).toBeLessThanOrEqual(2);
    for (const c of r.alternatives) {
      // no circuits on a toy graph → never a park loop
      expect(c.kind).not.toBe("parkLoop");
      expect(c.walkKind).toBeUndefined();
      expect(c.laps).toBeUndefined();
      expect(c.parkShare).toBeUndefined();
      expect(c.deltaMin).toBe(c.stats.minutes - r.recommended.stats.minutes);
      expect(c.eids.length).toBeGreaterThan(0);
      if (c.kind === "faster") expect(c.deltaMin).toBeLessThanOrEqual(-2);
      if (c.kind === "shadier") {
        expect(c.stats.shadePct).toBeGreaterThanOrEqual(r.recommended.stats.shadePct + 10);
      }
      if (c.kind === "quieter") {
        expect(c.stats.quietPct).toBeGreaterThanOrEqual(r.recommended.stats.quietPct + 10);
      }
    }
    // a loop starts and ends at the start snap: head is the snap tail, tail its reverse
    expect(r.tail).toEqual([...r.head].reverse());
    expect(r.connectors).toEqual([]);
  });

  it("avoidCobbles keeps only cobble-free loops", () => {
    // every horizontal edge cobbled: no loop can avoid them → null
    expect(planLoops(gridGraph(() => true), GRID_START, 30, NOON, "quiet", { ...S, avoidCobbles: true })).toBeNull();
    // ...and without the setting the same graph still plans
    const r = planLoops(gridGraph(() => true), GRID_START, 30, NOON, "quiet", S)!;
    expect(r.recommended.stats.cobbleM).toBeGreaterThan(0);
    // only the rows south of the start cobbled: whatever survives is clean
    const north = planLoops(gridGraph((row) => row < 12), GRID_START, 30, NOON, "quiet", { ...S, avoidCobbles: true })!;
    expect(north).not.toBeNull();
    expect(north.recommended.stats.cobbleM).toBe(0);
    for (const c of north.alternatives) expect(c.stats.cobbleM).toBe(0);
  });
});

describe("planLoopsVia (W3)", () => {
  // Four blocks east and three north of the start — far enough that the two
  // legs are real walks and the retrace price has somewhere else to go.
  const GRID_VIA: [number, number] = [
    LNG0 + 3.5 * GRID_LNG,
    LAT0 + 2.5 * GRID_LAT,
  ];

  /** Metres from a point to the nearest place on a drawn polyline — how the
   *  test asks "does the walk actually reach the place?". */
  function offLineM(line: [number, number][], p: [number, number]): number {
    const [px, py] = toXY(p[0], p[1]);
    let best = Infinity;
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = toXY(line[i - 1][0], line[i - 1][1]);
      const [bx, by] = toXY(line[i][0], line[i][1]);
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
    }
    return best;
  }

  it("walks there and back: both legs, home again, and the stats sum", () => {
    const g = gridGraph();
    const r = planLoopsVia(g, GRID_START, GRID_VIA, NOON, "quiet", S)!;
    expect(r).not.toBeNull();
    expect(r.pref).toBe("quiet");
    expect(r.startMin).toBe(NOON);
    expect(r.recommended.kind).toBe("recommended");
    expect(r.recommended.deltaMin).toBe(0);

    const c = r.recommended;
    // it is a loop: it starts and ends where the walker is standing
    expect(c.nodes[0]).toBe(GRID_CENTER);
    expect(c.nodes[c.nodes.length - 1]).toBe(GRID_CENTER);
    // and it goes through the place — the via's own snapped node is on it
    const snapV = snapToEdge(g, GRID_VIA[0], GRID_VIA[1]);
    const viaNode = snapV.node;
    expect(c.nodes).toContain(viaNode);
    // both legs are there: the via is neither the first nor the last node
    const at = c.nodes.indexOf(viaNode);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(c.nodes.length - 1);

    // Fix round 1, finding 2: the walk REACHES the place, not the junction
    // nearest to it. The via's own edge is walked end to end, so the pin's
    // snapped point lies ON the line the map draws — and the crossing's
    // metres are inside the numbers on the card, not lost between the legs.
    expect(c.eids.includes(snapV.eid) || c.eids.includes(g.revEdge[snapV.eid])).toBe(true);
    const line = routeLine(g, c.eids, NOON, r.head, c.tail ?? r.tail);
    expect(offLineM(line, snapV.point)).toBeLessThan(1);
    expect(offLineM(line, GRID_VIA)).toBeLessThan(60); // half a block: the pin is mid-block

    // the stitched candidate's numbers are the two legs' numbers added up:
    // every edge it walks is counted once, at 100 m a block on this grid
    expect(c.meters).toBeCloseTo(c.eids.length * 100, 6);
    expect(c.stats.minutes).toBe(Math.round(c.meters / SPEED_M_PER_MIN));
    expect(c.stats.km).toBe(Math.round(c.meters / 100) / 10);
    // the way home is not the way out: the retrace price bought new streets
    const out = new Set(c.eids.slice(0, at));
    expect(c.eids.slice(at).some((e) => !out.has(e) && !out.has(g.revEdge[e]))).toBe(true);

    // a loop starts and ends at the start snap, as planLoops' does
    expect(r.tail).toEqual([...r.head].reverse());
    for (const alt of r.alternatives) {
      expect(alt.deltaMin).toBe(alt.stats.minutes - c.stats.minutes);
      expect(alt.nodes[0]).toBe(GRID_CENTER);
      expect(alt.nodes[alt.nodes.length - 1]).toBe(GRID_CENTER);
      expect(alt.nodes).toContain(viaNode);
      expect(alt.kind).not.toBe("recommended");
    }
    expect(r.alternatives.length).toBeLessThanOrEqual(2);
    // A UNIFORM grid has nothing to offer as a second card: every combo
    // walks the same streets, and the mirror check below is why the reversed
    // one is not shipped as a "different" walk. The fixture two tests down
    // gives the alternatives path something to bite on (review finding 6).
    expect(r.alternatives.length).toBe(0);
  });

  it("does not ship a walk and its mirror as two cards (finding 5)", () => {
    const g = gridGraph();
    const r = planLoopsVia(g, GRID_START, GRID_VIA, NOON, "shade", S)!;
    // Reverse edges have their own ids, so the same loop walked backwards
    // shares NO edge id with the forward one: compared raw, the mirror of
    // the recommendation looked like a second walk and only `altTag` kept it
    // off the sheet. Canonicalised, the sets are identical.
    const canon = (eids: number[]) =>
      new Set(eids.map((e) => (g.revEdge[e] >= 0 && g.revEdge[e] < e ? g.revEdge[e] : e)));
    const rec = canon(r.recommended.eids);
    for (const alt of r.alternatives) {
      const a = canon(alt.eids);
      const inter = [...a].filter((e) => rec.has(e)).length;
      const union = a.size + rec.size - inter;
      expect(inter / union, "an alternative is a different walk, not a mirror").toBeLessThan(0.85);
    }
  });

  it("offers a second card when the streets actually differ (finding 6)", () => {
    // Rows 13–16 are fully shaded but 40 % longer, rows 11–12 are loud: a
    // quiet-first walk takes the long shaded way north and the fastest leg
    // does not, so the two combos are genuinely different streets — on the
    // SAME crossing of the via edge, which is the only one searched since
    // final review I3 (the band was two rows while each combo picked its own
    // crossing; two rows apart the three combos now differ by less than
    // SPEC §1.1 asks a card to buy, and none was offered).
    const g = gridGraph(() => false, {
      shadeRows: (row) => row >= 13 && row <= 16,
      loudRows: (row) => row >= 11 && row <= 12,
    });
    const r = planLoopsVia(g, GRID_START, GRID_VIA, NOON, "quiet", S)!;
    expect(r).not.toBeNull();
    expect(r.alternatives.length).toBeGreaterThanOrEqual(1);
    expect(r.alternatives.length).toBeLessThanOrEqual(2);
    const kinds = r.alternatives.map((c) => c.kind);
    expect(new Set(kinds).size, "no two cards wear the same tag").toBe(kinds.length);
    for (const alt of r.alternatives) {
      expect(alt.kind).not.toBe("recommended");
      expect(alt.deltaMin).toBe(alt.stats.minutes - r.recommended.stats.minutes);
      // SPEC §1.1's thresholds, the same ones every other card obeys
      if (alt.kind === "faster") expect(alt.deltaMin).toBeLessThanOrEqual(-2);
      if (alt.kind === "shadier") {
        expect(alt.stats.shadePct).toBeGreaterThanOrEqual(r.recommended.stats.shadePct + 10);
      }
      if (alt.kind === "quieter") {
        expect(alt.stats.quietPct).toBeGreaterThanOrEqual(r.recommended.stats.quietPct + 10);
      }
    }
  });

  it("measures its own park share, so Park loop is reachable on W3 (finding 3)", () => {
    // A stitched leg is built by route(), which knows nothing about parks;
    // plan.ts measures the share from the same per-edge test the composer
    // uses. Without it SPEC §1.1's tag — written for exactly this case —
    // could never appear on a loop via a place.
    const plain = planLoopsVia(gridGraph(), GRID_START, GRID_VIA, NOON, "shade", S)!;
    expect(plain.recommended.parkShare).toBe(0);
    expect([plain.recommended, ...plain.alternatives].map((c) => c.kind)).not.toContain("parkLoop");

    // the same grid with a green corridor through the via
    const green = planLoopsVia(
      gridGraph(() => false, { greenRows: (row) => row >= 12 && row <= 14 }),
      GRID_START,
      GRID_VIA,
      NOON,
      "shade",
      S
    )!;
    // SPEC §1.1's threshold: half the length inside a park
    expect(green.recommended.parkShare!).toBeGreaterThanOrEqual(0.5);
    expect(green.alternatives.length).toBeGreaterThanOrEqual(1);
    expect(green.alternatives.map((c) => c.kind)).toContain("parkLoop");
  });

  it("has nothing to plan when the place is where you already are", () => {
    expect(planLoopsVia(gridGraph(), GRID_START, GRID_START, NOON, "shade", S)).toBeNull();
  });

  it("obeys the cobble wall on both legs", () => {
    // every horizontal edge cobbled: no way across the grid without them
    expect(
      planLoopsVia(gridGraph(() => true), GRID_START, GRID_VIA, NOON, "quiet", {
        ...S,
        avoidCobbles: true,
      })
    ).toBeNull();
    const r = planLoopsVia(gridGraph(() => true), GRID_START, GRID_VIA, NOON, "quiet", S)!;
    expect(r.recommended.stats.cobbleM).toBeGreaterThan(0);
  });
});

describe("after sunset", () => {
  it("offers no shadier walk, A→B or loop", () => {
    const g = gridGraph();
    const ab = planAB(g, A, NEAR_D, 22 * 60, "balanced", S, true)!;
    expect(ab).not.toBeNull();
    expect(ab.alternatives.map((c) => c.kind)).not.toContain("shadier");
    const loop = planLoops(g, GRID_START, 30, 22 * 60, "quiet", S, true)!;
    expect(loop).not.toBeNull();
    expect(loop.alternatives.map((c) => c.kind)).not.toContain("shadier");
  });
});

describe("alternative badges tell the truth", () => {
  // SPEC §1.1's thresholds, asserted on the plan rather than on cardCopy:
  // −2 min, +10 points of shade, +10 points of quiet, and never twice the
  // same tag. (The 5-point margin of 2026-09-06 was replaced by these.)
  it("only tags a walk that clears the spec's threshold on that axis", () => {
    const g = gridGraph();
    for (const pref of ["shade", "quiet", "balanced"] as const) {
      const r = planAB(g, A, NEAR_D, NOON, pref, S);
      if (!r) continue;
      const seen = new Set<string>();
      for (const c of r.alternatives) {
        if (c.kind === "quieter") expect(c.stats.quietPct).toBeGreaterThanOrEqual(r.recommended.stats.quietPct + 10);
        if (c.kind === "shadier") expect(c.stats.shadePct).toBeGreaterThanOrEqual(r.recommended.stats.shadePct + 10);
        if (c.kind === "faster") expect(c.deltaMin).toBeLessThanOrEqual(-2);
        expect(seen.has(c.kind)).toBe(false);
        seen.add(c.kind);
      }
    }
  });

  it("keeps a walk that is two minutes faster — the threshold itself", () => {
    const g = parseGraph(packGraph(NODES, diamond()));
    const r = planAB(g, A, NEAR_D, NOON, "shade", S)!;
    expect(r.alternatives[0].kind).toBe("faster");
    expect(r.alternatives[0].deltaMin).toBe(-2);
  });

  it("drops the card a single minute would have bought", () => {
    // Same diamond with the shaded way pulled in (B only 60 m north of C):
    // 238 m against the sunny way's 195 m — 4 minutes against 3. One minute
    // is under SPEC §1.1's two, the sunny leg is neither shadier nor
    // quieter, so it earns no tag and no card.
    const g = parseGraph(packGraph(NEAR_NODES, nearDiamond()));
    const r = planAB(g, A, NEAR_D, NOON, "shade", S)!;
    expect(r.recommended.stats.minutes).toBe(4);
    expect(r.recommended.stats.shadePct).toBe(100);
    const fast = abLeg(g, 0, snapToEdge(g, NEAR_D[0], NEAR_D[1]), NOON, { ...FASTEST, access: S.access }, undefined)!;
    expect(Math.round((fast.meters + fast.alongM) / SPEED_M_PER_MIN)).toBe(3);
    expect(r.alternatives).toEqual([]);
  });

  it("ships one walk once, however many presets ask for it", () => {
    // A short sunny street and one long shaded one: balanced takes the
    // short way, and BOTH the quiet and the shade preset answer with the
    // same long way. The tag set alone does not catch that — the second
    // copy is simply offered the other tag (review F5).
    const g = parseGraph(packGraph(TWIN_NODES, twinPaths()));
    const snapD = snapToEdge(g, TWIN_DEST[0], TWIN_DEST[1]);
    const quiet = abLeg(g, 0, snapD, NOON, presetFor("quiet", S), undefined)!;
    const shade = abLeg(g, 0, snapD, NOON, presetFor("shade", S), undefined)!;
    expect(quiet.eids).toEqual(shade.eids); // the fixture is doing its job
    const r = planAB(g, A, TWIN_DEST, NOON, "balanced", S)!;
    expect(r.recommended.eids).not.toEqual(quiet.eids);
    expect(r.alternatives.length).toBe(1);
    expect(r.alternatives[0].eids).toEqual(quiet.eids);
  });
});

// --- rule 4 on the way home (final review, missing test 1) -----------------
//
// CLAUDE.md rule 4: every edge cost lookup uses the ARRIVAL time at that
// edge. On a loop via a place the return leg leaves at `atVia` — the
// departure plus the outbound metres plus the crossing — and `plan.test.ts`
// asserted only that the loop closed and the numbers summed, never the
// minute. A home leg priced at `startMin` would take a street that is shaded
// when you set off and bare by the time you walk it, which is the whole bug
// the rule exists to prevent.
//
// The fixture makes the two answers opposite. One long corridor east to the
// place; two equally long ways back, north and south. The north pair is
// shaded EARLY (buckets 0–5, i.e. up to 08:45) and bare after; the south
// pair is bare early and shaded from 09:00 on. Leaving at 09:00, the walker
// reaches the place 31 minutes later — so north is the shaded way at the
// departure and south is the shaded way when the return actually starts.
describe("planLoopsVia prices the way home at atVia, not at startMin", () => {
  const DLAT_100M = 100 / 110574;
  const HOME_NODE = 0;
  const FAR = 1; // 2000 m east: where the outbound leg ends
  const PAST = 2; // 100 m further east: the far end of the via's own edge
  const NORTH = 3;
  const SOUTH = 4;
  const T0 = 9 * 60; // bucket 4 exactly

  // buckets are 15 min from 08:00 (packGraph): 0–5 is 08:00–09:15,
  // 6 onwards is 09:30 and later
  const EARLY = Array.from({ length: 48 }, (_, b) => (b <= 5 ? 255 : 0));
  const LATE = Array.from({ length: 48 }, (_, b) => (b >= 6 ? 255 : 0));

  const SHIFT_NODES: [number, number][] = [
    [LAT0, LNG0], // 0 home
    [LAT0, LNG0 + 20 * DLNG_100M], // 1 far
    [LAT0, LNG0 + 21 * DLNG_100M], // 2 past
    [LAT0 + 10 * DLAT_100M, LNG0 + 10.5 * DLNG_100M], // 3 north
    [LAT0 - 10 * DLAT_100M, LNG0 + 10.5 * DLNG_100M], // 4 south
  ];

  /** Metres between two [lat, lng] nodes, in the graph's own frame — so the
   *  lengths and the geometry cannot drift apart and unseat the heuristic. */
  function segM(a: [number, number], b: [number, number]): number {
    const [ax, ay] = toXY(a[1], a[0]);
    const [bx, by] = toXY(b[1], b[0]);
    return Math.hypot(ax - bx, ay - by);
  }

  function shiftGraph() {
    const edges: ToyEdge[] = [];
    const pair = (u: number, v: number, shade?: number[]) => {
      const lenDm = Math.round(segM(SHIFT_NODES[u], SHIFT_NODES[v]) * 10);
      edges.push({ u, v, lenDm, shade });
      edges.push({ u: v, v: u, lenDm, shade });
    };
    pair(HOME_NODE, FAR); // the corridor out: never shaded, always shortest
    pair(FAR, PAST); // the via's own edge
    pair(HOME_NODE, NORTH, EARLY);
    pair(NORTH, PAST, EARLY);
    pair(HOME_NODE, SOUTH, LATE);
    pair(SOUTH, PAST, LATE);
    return parseGraph(packGraph(SHIFT_NODES, edges));
  }

  /** The edge id of u→v on this toy graph. */
  function eidOf(g: ReturnType<typeof shiftGraph>, u: number, v: number): number {
    for (let e = 0; e < g.nEdges; e++) if (g.edgeSource[e] === u && g.edgeTarget[e] === v) return e;
    throw new Error(`no edge ${u}->${v}`);
  }

  const START: [number, number] = [LNG0, LAT0];
  const VIA: [number, number] = [LNG0 + 20.5 * DLNG_100M, LAT0]; // mid the via edge

  it("takes the street that is shaded when the walk home actually starts", () => {
    const g = shiftGraph();
    const outM = segM(SHIFT_NODES[HOME_NODE], SHIFT_NODES[FAR]) + segM(SHIFT_NODES[FAR], SHIFT_NODES[PAST]);
    const atVia = T0 + outM / SPEED_M_PER_MIN;
    expect(atVia - T0).toBeGreaterThan(15); // a real bucket apart

    // the fixture's whole point: the two ways home swap shade in between
    const north = eidOf(g, PAST, NORTH);
    const south = eidOf(g, PAST, SOUTH);
    expect(shadeAt(g, north, T0)).toBeGreaterThan(0.9);
    expect(shadeAt(g, north, atVia)).toBeLessThan(0.1);
    expect(shadeAt(g, south, T0)).toBeLessThan(0.1);
    expect(shadeAt(g, south, atVia)).toBeGreaterThan(0.9);

    // pref "quiet" so viaCombos' FIRST pair — the one the recommendation is
    // built from — walks home under the SHADE preset (out: main, back: other)
    const r = planLoopsVia(g, START, VIA, T0, "quiet", S)!;
    expect(r).not.toBeNull();
    const c = r.recommended;
    expect(c.nodes[0]).toBe(HOME_NODE);
    expect(c.nodes[c.nodes.length - 1]).toBe(HOME_NODE);
    expect(c.nodes).toContain(PAST);
    // ...and home the south way, which is shaded at atVia. Priced at
    // startMin the router would have taken the north pair — it is the
    // shaded one then, and both are the same length.
    expect(c.nodes, "the way home is the street shaded at atVia").toContain(SOUTH);
    expect(c.nodes, "not the one that was shaded at the departure").not.toContain(NORTH);
  });

  it("takes the north way when the walk really does happen early", () => {
    // The control: leave early enough that atVia is still inside the north
    // pair's own window, and the same planner picks the other street. Without
    // this the test above would pass on a planner that always went south.
    const g = shiftGraph();
    const early = 8 * 60;
    const r = planLoopsVia(g, START, VIA, early, "quiet", S)!;
    expect(r.recommended.nodes).toContain(NORTH);
    expect(r.recommended.nodes).not.toContain(SOUTH);
  });
});
