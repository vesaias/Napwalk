// Plaza-crossing scan (2026-08-28). Guardrail for the open-space milestone:
// it must be impossible to make plaza routing worse without this number
// moving.
//
// The pair list comes from the pipeline (scratchpad/plaza_pairs.py): pairs of
// graph nodes on a fused walk surface whose STRAIGHT segment stays inside the
// walkable area (polygon minus the obstacles 01c punches out). A pedestrian
// can walk that segment, so `routed / straight` is a fair measure of how well
// the router crosses the square. 1.0 = perfect, higher = detour.
//
// env: PAIRS=<tsv> T (start minute) P (preset) OUT (json) [ART] [BUDGET]
//      BUDGET = max allowed mean excess ratio; the test fails above it.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { it, expect } from "vitest";
import { PRESETS, route } from "./astar";
import { nearestNode, parseGraph, toXY, type Graph } from "./graph";

const ART = process.env.ART || new URL("../../public/graph.bin.gz", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

it("plaza scan", { timeout: 600_000 }, () => {
  if (!process.env.PAIRS) return;
  const buf = gunzipSync(readFileSync(ART));
  const g: Graph = parseGraph(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const T = Number(process.env.T ?? 660);
  const preset = PRESETS[(process.env.P ?? "balanced") as keyof typeof PRESETS];

  const rows = readFileSync(process.env.PAIRS, "utf8").split("\n").slice(1)
    .filter((l) => l.trim())
    .map((l) => {
      const [alng, alat, blng, blat, st, ar] = l.split(String.fromCharCode(9)).map(Number);
      return { a: nearestNode(g, alng, alat), b: nearestNode(g, blng, blat),
               alng, alat, blng, blat, straight: st, area: ar };
    });

  // guard the snap: the node we route from must actually be where the
  // pipeline measured, and the artifact distance must agree with the metres
  // it measured in EPSG:25832
  let checked = 0, bad = 0;
  for (const r of rows) {
    if (r.a < 0 || r.b < 0) { bad++; continue; }
    const [ax, ay] = toXY(g.lng[r.a], g.lat[r.a]);
    const [bx, by] = toXY(g.lng[r.b], g.lat[r.b]);
    const [qax, qay] = toXY(r.alng, r.alat);
    const [qbx, qby] = toXY(r.blng, r.blat);
    const snapErr = Math.max(Math.hypot(ax - qax, ay - qay), Math.hypot(bx - qbx, by - qby));
    const d = Math.hypot(bx - ax, by - ay);
    if (snapErr > 2 || Math.abs(d - r.straight) > Math.max(3, 0.05 * r.straight)) bad++;
    checked++;
  }
  expect(bad / Math.max(1, checked)).toBeLessThan(0.02); // snap + mapping sane

  const out: any[] = [];
  let routed = 0, failed = 0;
  for (const r of rows) {
    if (r.a < 0 || r.b < 0) continue;
    const w = route(g, r.a, r.b, T, preset);
    if (!w) { failed++; continue; }
    routed++;
    out.push({ a: r.a, b: r.b, area: r.area, straight: r.straight,
               walked: Math.round(w.meters), cost: Math.round(w.cost),
               ratio: +(w.meters / r.straight).toFixed(3),
               at: [+g.lng[r.a].toFixed(5), +g.lat[r.a].toFixed(5)] });
  }
  expect(routed).toBeGreaterThan(0.9 * rows.length); // never score an empty run
  const rs = out.map((o) => o.ratio).sort((p, q) => p - q);
  const pct = (f: number) => rs.length ? rs[Math.min(rs.length - 1, Math.floor(f * rs.length))] : 0;
  const mean = rs.reduce((s, v) => s + v, 0) / Math.max(1, rs.length);
  // excess metres actually walked beyond the straight crossing
  const excess = out.reduce((s, o) => s + (o.walked - o.straight), 0);
  // Metres are the wrong lens on their own: adding edges can only lower the
  // COST of the optimal route, but the cheaper route may be longer (shadier,
  // quieter, smoother). Total cost is what says whether the mesh helped.
  const totalCost = out.reduce((s, o) => s + o.cost, 0);
  const report = {
    pairs: rows.length, routed, failed,
    meanRatio: +mean.toFixed(3), medianRatio: pct(0.5), p90Ratio: pct(0.9), p99Ratio: pct(0.99),
    over1_3: out.filter((o) => o.ratio > 1.3).length,
    over2_0: out.filter((o) => o.ratio > 2.0).length,
    excessM: Math.round(excess), totalCost: Math.round(totalCost),
    worst: [...out].sort((p, q) => q.ratio - p.ratio).slice(0, 25),
    all: out,
  };
  writeFileSync(process.env.OUT ?? "../data/work/frankfurt/osm/_scan_plaza.json", JSON.stringify(report, null, 1));
  if (process.env.BUDGET) expect(report.meanRatio).toBeLessThanOrEqual(Number(process.env.BUDGET));
});
