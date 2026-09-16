// Citywide "never on the road" scan (2026-08-27). Routes N random A→B
// pairs, replays them through the exact display code and reports:
//   R1 penalised-carriageway: the ROUTER walks a street edge that has a
//      mapped sidewalk (bit0+bit1, not a crossing) for > 15 m — a topology/
//      pipeline defect (one-sided sidewalk, missing crossing, fork split…)
//   R2 on-centreline: the DRAWN line runs within 1.5 m of a street
//      centreline for > 10 m outside junction/crossing zones — a display
//      defect (ramp, released offset, side flip…)
//
// R2 is attributed to the edge the walker is ON at the violation, not to
// whichever street happened to be nearest when the run started (2026-08-27:
// the old code latched runEid at the first sample and never updated it, so
// long runs were blamed on edges the route never walks). The walked edge
// also decides whether the run is a display DEFECT at all:
//   offset-collapsed  street drawn at OFFSET_M but sitting on a centreline
//                     -> the real bug; this is what perKm counts
//   footway           walker is on a mapped footway drawn on its own true
//                     geometry — faithful drawing, OSM just runs it there
//   kerb-hug          bit7 street, drawn at 1 m BY DESIGN (DECISIONS
//                     2026-08-20) — below R2's 1.5 m threshold by
//                     construction, so it can never not fire
//   crossing          crossing piece, drawn centred by design
// The three non-defect causes are still reported in byCause so nothing is
// hidden, but they are excluded from perKm.
// env: N (pairs, default 300) SEED T (start minute) P (preset) ART (artifact)
//      OUT (json report) BUDGET (max violations; test fails above it)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { it, expect } from "vitest";
import { PRESETS, route } from "./astar";
import { routeLine } from "./draw";
import { edgeLatLngs, parseGraph, type Graph } from "./graph";

// ART overrides the artifact under test, so a change can be A/B'd against
// the previous graph.bin.gz without swapping files (2026-08-27).
const ART = process.env.ART || new URL("../../public/graph.bin.gz", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const NEAR_M = 1.5, RUN_M = 10, WALK_M = 15, XZONE_M = 12;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

it("on-road scan", { timeout: 600_000 }, () => {
  if (!existsSync(ART) || !process.env.N) return;
  const buf = gunzipSync(readFileSync(ART));
  const g: Graph = parseGraph(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const N = Number(process.env.N), T = Number(process.env.T ?? 660);
  const preset = PRESETS[(process.env.P ?? "balanced") as keyof typeof PRESETS];
  const rand = rng(Number(process.env.SEED ?? 1));
  const lat0 = 50.11, mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180), mLat = 110_540;
  const toM = (p: [number, number]): [number, number] => [p[0] * mLng, p[1] * mLat];

  // grid of street centreline segments (bit0, not crossing, not centred/carfree)
  // and of crossing-edge segments (junction zones)
  const CELL = 20;
  const streets = new Map<string, [number, number, number, number, number][]>();
  const xings: [number, number, number, number][] = [];
  const xgrid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
  const addSeg = (m: Map<string, any[]>, item: any, ax: number, ay: number, bx: number, by: number) => {
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        const k = `${cx},${cy}`; if (!m.has(k)) m.set(k, []); m.get(k)!.push(item);
      }
  };
  for (let e = 0; e < g.nEdges; e++) {
    const f = g.flags[e];
    const pts = (edgeLatLngs(g, e) as [number, number][]).map(toM);
    if ((f & 4) !== 0) {
      for (let i = 0; i + 1 < pts.length; i++) { const id = xings.length; xings.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]]); addSeg(xgrid, id, ...xings[id]); }
    } else if ((f & 1) !== 0 && (f & 128) === 0) {
      for (let i = 0; i + 1 < pts.length; i++) addSeg(streets, [pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], e], pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    }
  }
  const dSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  const nearStreet = (x: number, y: number): number => {
    let best = -1, bd = NEAR_M;
    for (let cx = -1; cx <= 1; cx++) for (let cy = -1; cy <= 1; cy++) {
      const k = `${Math.floor(x / CELL) + cx},${Math.floor(y / CELL) + cy}`;
      for (const s of streets.get(k) ?? []) { const d = dSeg(x, y, s[0], s[1], s[2], s[3]); if (d < bd) { bd = d; best = s[4]; } }
    }
    return best;
  };
  const inXzone = (x: number, y: number): boolean => {
    for (let cx = -1; cx <= 1; cx++) for (let cy = -1; cy <= 1; cy++) {
      const k = `${Math.floor(x / CELL) + cx},${Math.floor(y / CELL) + cy}`;
      for (const id of xgrid.get(k) ?? []) { const s = xings[id]; if (dSeg(x, y, s[0], s[1], s[2], s[3]) < XZONE_M) return true; }
    }
    return false;
  };

  const viol: any[] = [];
  let routed = 0, meters = 0;
  for (let n = 0; n < N; n++) {
    const a = Math.floor(rand() * g.nNodes);
    const b = Math.floor(rand() * g.nNodes);
    const d = Math.hypot((g.lng[a] - g.lng[b]) * mLng, (g.lat[a] - g.lat[b]) * mLat);
    if (d < 300 || d > 2500) { n--; continue; }
    const r = route(g, a, b, T, preset);
    if (!r) continue;
    routed++; meters += r.meters;
    const url = `?m=ab&t=${T}&p=${process.env.P ?? "balanced"}&s=${g.lng[a].toFixed(5)},${g.lat[a].toFixed(5)}&e=${g.lng[b].toFixed(5)},${g.lat[b].toFixed(5)}`;
    // R1
    for (const e of r.eids) {
      const f = g.flags[e];
      if ((f & 135) === 3 && g.lenDm[e] / 10 > WALK_M) {
        const p = edgeLatLngs(g, e)[0];
        viol.push({ kind: "penalised-carriageway", eid: e, len: g.lenDm[e] / 10, at: [p[0], p[1]], url });
      }
    }
    // R2
    const line = routeLine(g, r.eids, T) as [number, number][];
    // segments of the edges this route actually walks, for attribution
    const walk: [number, number, number, number, number][] = [];
    for (const we of r.eids) {
      const wp = (edgeLatLngs(g, we) as [number, number][]).map(toM);
      for (let z = 0; z + 1 < wp.length; z++) walk.push([wp[z][0], wp[z][1], wp[z + 1][0], wp[z + 1][1], we]);
    }
    const walkedAt = (q: [number, number]): number => {
      const [qx, qy] = toM(q);
      let bi = -1, bd = Infinity;
      for (const w of walk) { const d = dSeg(qx, qy, w[0], w[1], w[2], w[3]); if (d < bd) { bd = d; bi = w[4]; } }
      return bi;
    };
    let run = 0, runPts: [number, number][] = [], runEid = -1;
    for (let i = 0; i < line.length; i++) {
      const [x, y] = toM(line[i]);
      const e = nearStreet(x, y);
      const on = e >= 0 && !inXzone(x, y);
      if (on) {
        if (!runPts.length) runEid = e;
        runPts.push(line[i]);
        if (i > 0) { const [px, py] = toM(line[i - 1]); run += Math.hypot(x - px, y - py); }
      }
      if ((!on || i === line.length - 1) && runPts.length) {
        if (run > RUN_M) {
          const mid = runPts[runPts.length >> 1];
          const we = walkedAt(mid);
          const wf = we >= 0 ? g.flags[we] : 0;
          const cause = we < 0 ? "unattributed"
            : (wf & 4) !== 0 ? "crossing"
            : (wf & 1) === 0 ? "footway"
            : (wf & 128) !== 0 ? "kerb-hug"
            : "offset-collapsed";
          viol.push({ kind: "on-centreline", cause, eid: we, nearEid: runEid,
                      flags: wf, nearFlags: g.flags[runEid], len: Math.round(run),
                      at: runPts[0], url });
        }
        run = 0; runPts = [];
      }
    }
  }
  const DEFECT = (v: any) => v.kind !== "on-centreline" || v.cause === "offset-collapsed";
  const byKind: Record<string, number> = {};
  const byCause: Record<string, number> = {};
  for (const v of viol) {
    if (DEFECT(v)) byKind[v.kind] = (byKind[v.kind] ?? 0) + 1;
    if (v.cause) byCause[v.cause] = (byCause[v.cause] ?? 0) + 1;
  }
  const defects = viol.filter(DEFECT).length;
  const km = meters / 1000;
  const report = { routed, km: Math.round(km), perKm: +(defects / km).toFixed(3),
                   defects, allViolations: viol.length, perKmAll: +(viol.length / km).toFixed(3),
                   byKind, byCause, viol };
  writeFileSync(process.env.OUT ?? "../data/work/frankfurt/osm/_scan_onroad.json", JSON.stringify(report, null, 1));
  if (process.env.BUDGET) expect(defects).toBeLessThanOrEqual(Number(process.env.BUDGET));
});
