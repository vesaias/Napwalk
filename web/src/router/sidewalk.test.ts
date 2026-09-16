import { describe, expect, it } from "vitest";
import { sidewalkRuns } from "./sidewalk";
import { parseGraph } from "./graph";
import { packGraph } from "./packGraph";

const NODES: [number, number][] = [
  [50.1109, 8.6821], [50.1113, 8.6821], [50.1115, 8.6821], [50.1119, 8.6821], [50.1123, 8.6821],
];
const L = new Array(48).fill(200);
const R = new Array(48).fill(50);

describe("sidewalkRuns", () => {
  it("absorbs a short opposite-side stretch, keeps park paths centred", () => {
    const g = parseGraph(packGraph(NODES, [
      { u: 0, v: 1, lenDm: 1000, shadeL: L, shadeR: R, street: true },  // left shadier
      { u: 1, v: 2, lenDm: 200, shadeL: R, shadeR: L, street: true },   // right shadier, 20 m
      { u: 2, v: 3, lenDm: 1000, shadeL: L, shadeR: R, street: true },  // left
      { u: 3, v: 4, lenDm: 800, shadeL: L, shadeR: R, street: false },  // park path
    ]));
    const runs = sidewalkRuns(g, [0, 1, 2, 3], 600);
    expect(runs.map((r) => [r.side, r.eids.length])).toEqual([[-1, 3], [0, 1]]);
  });
  it("one side per continuous street stretch: the side with more metres wins", () => {
    const g = parseGraph(packGraph(NODES, [
      { u: 0, v: 1, lenDm: 1000, shadeL: L, shadeR: R, street: true },
      { u: 1, v: 2, lenDm: 1500, shadeL: R, shadeR: L, street: true },
    ]));
    expect(sidewalkRuns(g, [0, 1], 600).map((r) => r.side)).toEqual([1]);
  });
});

import { offsetLine } from "./sidewalk";
describe("offsetLine", () => {
  it("shifts a north-bound line to the east for side +1 (right of travel)", () => {
    // ends taper to zero; the middle vertex carries the full offset
    const line: [number, number][] = [[8.68, 50.11], [8.68, 50.111], [8.68, 50.112]];
    const off = offsetLine(line, 1);
    expect(Math.abs(off[0][0] - 8.68)).toBeLessThan(1e-9);
    expect(off[1][0]).toBeGreaterThan(8.68);
    const dm = (off[1][0] - 8.68) * 111320 * Math.cos((50.11 * Math.PI) / 180);
    expect(Math.abs(dm - 3)).toBeLessThan(0.05);
  });
  it("clamps the mitre at a hairpin", () => {
    const line: [number, number][] = [[8.68, 50.11], [8.681, 50.11], [8.68, 50.1100001]];
    const off = offsetLine(line, -1);
    // every output vertex stays within 2 × offset of the input polyline
    const toXY = (p: [number, number]) => [p[0] * 71350, p[1] * 110540];
    const L = line.map(toXY);
    for (const q of off.map(toXY)) {
      let best = Infinity;
      for (let i = 1; i < L.length; i++) {
        const [ax, ay] = L[i - 1], [bx, by] = L[i];
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / L2));
        best = Math.min(best, Math.hypot(q[0] - ax - t * dx, q[1] - ay - t * dy));
      }
      expect(best).toBeLessThan(12.1);
    }
  });
});

describe("offsetLine near a short end segment", () => {
  it("never steps back along the run (Bertramswiese triangle, 2026-08-17)", () => {
    const raw: [number, number][] = [[8.675004, 50.136341], [8.674965, 50.1367], [8.675012, 50.136717]];
    const off = offsetLine(raw, 1);
    // projection of each vertex on the run's overall direction must be non-decreasing
    const dx = raw[2][0] - raw[0][0], dy = raw[2][1] - raw[0][1];
    let last = -Infinity;
    for (const p of off) {
      const t = (p[0] - raw[0][0]) * dx + (p[1] - raw[0][1]) * dy;
      expect(t).toBeGreaterThanOrEqual(last - 1e-12);
      last = t;
    }
  });
});
