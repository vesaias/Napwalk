import { describe, expect, it } from "vitest";
import { loops } from "./loops";
import { PRESETS } from "./astar";
import { parseGraph } from "./graph";
import { packGraph, type ToyEdge } from "./packGraph";
import { boundedDijkstra, sharing } from "./psp";

// 25x25 street grid, ~100 m spacing, bidirectional edges.
const N = 25;
const SPACING_LAT = 100 / 110_574;
const SPACING_LNG = 100 / (111_320 * Math.cos((50.11 * Math.PI) / 180));

function gridGraph() {
  const nodes: [number, number][] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      nodes.push([50.1109 + (r - N / 2) * SPACING_LAT,
                  8.6821 + (c - N / 2) * SPACING_LNG]);
    }
  }
  const edges: ToyEdge[] = [];
  const id = (r: number, c: number) => r * N + c;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (c + 1 < N) {
        edges.push({ u: id(r, c), v: id(r, c + 1), lenDm: 1000 });
        edges.push({ u: id(r, c + 1), v: id(r, c), lenDm: 1000 });
      }
      if (r + 1 < N) {
        edges.push({ u: id(r, c), v: id(r + 1, c), lenDm: 1000 });
        edges.push({ u: id(r + 1, c), v: id(r, c), lenDm: 1000 });
      }
    }
  }
  return parseGraph(packGraph(nodes, edges));
}

const CENTER = Math.floor((N * N) / 2);

describe("boundedDijkstra", () => {
  it("settles a ring of nodes at the requested walking length", () => {
    const g = gridGraph();
    const d = boundedDijkstra(g, CENTER, 600, PRESETS.maxQuiet, 500);
    const atRing = d.settled.filter((n) => d.len[n] >= 400 && d.len[n] <= 500);
    expect(atRing.length).toBeGreaterThan(8);
    // nothing expanded far beyond the bound
    expect(Math.max(...d.settled.map((n) => d.len[n]))).toBeLessThan(700);
  });
});

describe("loops (PSP)", () => {
  it("returns 3 round loops near the target length with little sharing", () => {
    const g = gridGraph();
    // 30 min at 4 km/h = 2000 m; grid is 2.4 km wide so feasible
    const res = loops(g, CENTER, 30, 600, PRESETS.maxQuiet);
    expect(res.length).toBe(3);
    for (const l of res) {
      expect(l.nodes[0]).toBe(CENTER);
      expect(l.nodes[l.nodes.length - 1]).toBe(CENTER);
      expect(Math.abs(l.meters - 2000)).toBeLessThanOrEqual(0.35 * 2000);
      expect(sharing(g, l)).toBeLessThan(0.15);
    }
  });

  it("alternatives are genuinely different loops", () => {
    const g = gridGraph();
    const res = loops(g, CENTER, 30, 600, PRESETS.maxQuiet);
    for (let i = 0; i < res.length; i++) {
      for (let j = i + 1; j < res.length; j++) {
        const a = new Set(res[i].eids);
        const shared = res[j].eids.filter((e) => a.has(e)).length;
        expect(shared / Math.min(res[i].eids.length, res[j].eids.length)).toBeLessThan(0.5);
      }
    }
  });

  it("is round: convex-hull area is a decent fraction of a circle's", () => {
    const g = gridGraph();
    const res = loops(g, CENTER, 30, 600, PRESETS.maxQuiet);
    for (const l of res) {
      const pts = l.nodes.map((n) => [g.x[n], g.y[n]] as [number, number]);
      const area = hullArea(pts);
      const circleArea = (l.meters * l.meters) / (4 * Math.PI);
      expect(area / circleArea).toBeGreaterThan(0.35);
    }
  });
});

function hullArea(pts: [number, number][]): number {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let a = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

describe("quiet loop fallback (no circuits)", () => {
  it("returns valid non-repeating loops near the target on a plain grid", () => {
    const g = gridGraph();
    const res = loops(g, CENTER, 30, 600, PRESETS.balanced);
    expect(res.length).toBe(3);
    for (const l of res) {
      expect(l.nodes[0]).toBe(CENTER);
      expect(l.nodes[l.nodes.length - 1]).toBe(CENTER);
      expect(Math.abs(l.meters - 2000)).toBeLessThanOrEqual(0.35 * 2000);
      expect(sharing(g, l)).toBeLessThan(0.15);
      // consecutive edges chain
      for (let i = 1; i < l.eids.length; i++) expect(g.edgeSource[l.eids[i]]).toBe(g.edgeTarget[l.eids[i - 1]]);
    }
  });
});
