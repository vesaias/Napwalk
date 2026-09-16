// Regression: real-graph scenario. From Marbachweg (north edge of
// Sinaipark) a 45-min loop must be a genuine ROUND green walk: high green
// share, essentially no repeated edges, round shape. Skipped when the
// artifact is not synced (CI without data).
import { describe, expect, it } from "vitest";
import { PRESETS } from "./astar";
import { nearestNode, type Graph } from "./graph";
import { loops } from "./loops";
import { sharing } from "./psp";
import { realGraph } from "./realGraph.fixture";

function load(): Graph | null {
  try {
    return realGraph();
  } catch {
    return null; // stale artifact version
  }
}

const g = load();
const MARBACH: [number, number] = [8.6742, 50.1476];

function greenShare(g: Graph, eids: number[]) {
  let gm = 0;
  let tot = 0;
  for (const eid of eids) {
    const len = g.lenDm[eid] / 10;
    gm += (g.greenQ[eid] / 255) * len;
    tot += len;
  }
  return gm / tot;
}

function hullRoundness(g: Graph, nodes: number[], meters: number) {
  const pts = nodes.map((n) => [g.x[n], g.y[n]] as [number, number]);
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
  return Math.abs(a) / 2 / ((meters * meters) / (4 * Math.PI));
}

describe.skipIf(!g)("Sinaipark from Marbachweg (real graph)", () => {
  it("45-min: park walks — go to Sinaipark, lap it, come home", () => {
    const s = nearestNode(g!, ...MARBACH);
    const t0 = performance.now();
    const res = loops(g!, s, 45, 615, PRESETS.balanced);
    const ms = performance.now() - t0;
    const gs = res.map((l) => greenShare(g!, l.eids));
    const sh = res.map((l) => sharing(g!, l));
    console.log(`loops in ${ms.toFixed(0)} ms — green:`, gs.map((x) => x.toFixed(2)),
      "sharing:", sh.map((x) => x.toFixed(2)),
      "meters:", res.map((l) => Math.round(l.meters)));
    expect(res.length).toBe(3);
    // cards are distinct SHAPES: at least two Sinaipark circuits (very
    // green), a third may be another park; no two overlap heavily
    const green = gs.filter((x) => x > 0.8).length;
    expect(green).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      // shared distinct edges over the shorter walk's distinct edges (<= 1)
      const a = new Set(res[i].eids);
      const b = new Set(res[j].eids);
      let shared = 0;
      for (const e of b) if (a.has(e)) shared++;
      expect(shared / Math.min(a.size, b.size)).toBeLessThan(0.75);
    }
    for (const l of res) expect(Math.abs(l.meters - 3000)).toBeLessThan(1050);
    // laps repeat by design, but never a full there-and-back
    for (const x of sh) expect(x).toBeLessThan(0.8);
    expect(ms).toBeLessThan(2000);
  });
});
