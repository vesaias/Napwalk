// Which sidewalk to draw a route on, edge by edge — smoothed so the line
// does not hop across the street for a few metres of shade (2026-08-17).
import { SPEED_M_PER_MIN } from "./astar";
import { edgeLatLngs, walkSide, type Graph } from "./graph";


export type SidewalkRun = {
  side: -1 | 0 | 1;
  eids: number[];
  meters: number;
  /** ramp origin/end override (lng,lat) when a short kerb/crossing piece was
   *  trimmed from the neighbouring sidewalk run — the walker never leaves
   *  the sidewalk to touch the street node (2026-08-17) */
  startPt?: [number, number];
  endPt?: [number, number];
  /** metres to cut from this (side 0) run's start/end for display: a path
   *  meeting a street at the centreline node — the walker steps onto the
   *  sidewalk before the node, not through it (Grüneburgweg hook) */
  trimStartM?: number;
  trimEndM?: number;
};

const CONNECTOR_M = 10;

/** Trim short crossing/kerb pieces (flags bit2, <= CONNECTOR_M in total) at
 *  the junction of a sidewalk run and an offset street run, so the street
 *  run ramps straight from the sidewalk's end instead of via the node. */
export function trimConnectors(g: Graph, runs: SidewalkRun[]): SidewalkRun[] {
  const isX = (e: number) => (g.flags[e] & 4) !== 0;
  const len = (e: number) => g.lenDm[e] / 10;
  const src = (e: number): [number, number] => [g.lng[g.edgeSource[e]], g.lat[g.edgeSource[e]]];
  const tgt = (e: number): [number, number] => [g.lng[g.edgeTarget[e]], g.lat[g.edgeTarget[e]]];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r.side === 0) continue;
    const prev = runs[i - 1];
    if (prev && prev.side === 0) {
      let m = 0, k = prev.eids.length;
      while (k > 0 && isX(prev.eids[k - 1]) && m + len(prev.eids[k - 1]) <= CONNECTOR_M) { m += len(prev.eids[k - 1]); k--; }
      if (k < prev.eids.length && k > 0) {
        r.startPt = tgt(prev.eids[k - 1]);
        prev.eids = prev.eids.slice(0, k);
        prev.meters -= m;
      } else if (prev.meters > 3 * OFFSET_M) {
        prev.trimEndM = OFFSET_M; // path -> street: cut back to the sidewalk line
        const pc = cutEnds(runCoords(g, prev.eids), prev.trimStartM ?? 0, OFFSET_M);
        r.startPt = pc[pc.length - 1];
      }
    }
    const next = runs[i + 1];
    if (next && next.side === 0) {
      let m = 0, k = 0;
      while (k < next.eids.length && isX(next.eids[k]) && m + len(next.eids[k]) <= CONNECTOR_M) { m += len(next.eids[k]); k++; }
      if (k > 0 && k < next.eids.length) {
        r.endPt = src(next.eids[k]);
        next.eids = next.eids.slice(k);
        next.meters -= m;
      } else if (next.meters > 3 * OFFSET_M) {
        next.trimStartM = OFFSET_M;
        const nc = cutEnds(runCoords(g, next.eids), OFFSET_M, 0);
        r.endPt = nc[0];
      }
    }
  }
  return runs.filter((r) => r.eids.length > 0);
}

export function sidewalkRuns(g: Graph, eids: number[], startMin: number): SidewalkRun[] {
  // raw side per edge at its arrival time
  const runs: SidewalkRun[] = [];
  let meters = 0;
  const raw: (0 | 1 | -1)[] = [];
  for (const eid of eids) {
    // a crossing piece is not a sidewalk (no offset, whatever its class)
    raw.push((g.flags[eid] & 4) !== 0 ? 0 : walkSide(g, eid, startMin + meters / SPEED_M_PER_MIN));
    meters += g.lenDm[eid] / 10;
  }
  // a STREET piece flagged crossing (bit0+bit2: the road's own carriageway
  // through a side-street junction) sandwiched between two street edges
  // drawn on the same side, and collinear with both, is the sidewalk
  // continuing across the junction mouth — keep the offset instead of
  // dropping to the centreline (Bruchstraße/Textorstraße 2026-08-27).
  // Mapped footway crossings (bit0 clear) keep their own geometry.
  const COLL = Math.cos((30 * Math.PI) / 180);
  const streetX = (e: number) => (g.flags[e] & 5) === 5;
  const streetSide = (k: number): 0 | 1 | -1 => (k >= 0 && k < eids.length && (g.flags[eids[k]] & 5) === 1 ? raw[k] : 0);
  for (let i = 0; i < eids.length; i++) {
    if (!streetX(eids[i])) continue;
    let j = i;
    while (j < eids.length && streetX(eids[j])) j++;
    // side from whichever street neighbour exists (a route may start or
    // end on the junction); both present and disagreeing -> centred
    const sa = streetSide(i - 1), sb = streetSide(j);
    const side = sa !== 0 && sb !== 0 ? (sa === sb ? sa : 0) : sa || sb;
    if (side === 0) { i = j; continue; }
    let ok = true;
    const from = sa !== 0 ? i - 1 : i, to = sb !== 0 ? j : j - 1;
    for (let k = from; k < to && ok; k++) {
      const e1 = eids[k], e2 = eids[k + 1];
      ok = g.exDx[e1] * g.enDx[e2] + g.exDy[e1] * g.enDy[e2] >= COLL;
    }
    if (ok) for (let k = i; k < j; k++) raw[k] = side;
    i = j;
  }
  meters = 0;
  for (let idx = 0; idx < eids.length; idx++) {
    const eid = eids[idx];
    const side = raw[idx] as 0 | 1 | -1;
    const len = g.lenDm[eid] / 10;
    meters += len;
    const last = runs[runs.length - 1];
    if (last && last.side === side) {
      last.eids.push(eid);
      last.meters += len;
    } else runs.push({ side, eids: [eid], meters: len });
  }
  // one side per continuous street stretch (wish 2026-08-17: "no
  // sidestepping on the street"): consecutive street runs are merged and
  // take the side with more metres; park stretches (side 0) separate them
  const out: SidewalkRun[] = [];
  let i = 0;
  while (i < runs.length) {
    if (runs[i].side === 0) { out.push(runs[i]); i++; continue; }
    let j = i, left = 0, right = 0;
    const eids: number[] = [];
    let meters = 0;
    while (j < runs.length && runs[j].side !== 0) {
      if (runs[j].side < 0) left += runs[j].meters; else right += runs[j].meters;
      eids.push(...runs[j].eids);
      meters += runs[j].meters;
      j++;
    }
    // a street stretch shorter than the offset ramp itself is a crossing
    // hop or a kerb piece: drawn centred
    out.push({ side: meters < 2 * TAPER_M ? 0 : left > right ? -1 : 1, eids, meters });
    i = j;
  }
  // re-merge neighbours that ended up on the same side (0 next to 0)
  const merged: SidewalkRun[] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && last.side === r.side) { last.eids.push(...r.eids); last.meters += r.meters; }
    else merged.push({ ...r, eids: [...r.eids] });
  }
  runs.length = 0;
  runs.push(...merged);
  return runs;
}

const segLen = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** point at arc length `d` along a polyline (metres space) */
function pointAt(xy: [number, number][], d: number): [number, number] {
  let acc = 0;
  for (let i = 1; i < xy.length; i++) {
    const L = segLen(xy[i - 1], xy[i]);
    if (acc + L >= d) {
      const t = L > 0 ? (d - acc) / L : 0;
      return [xy[i - 1][0] + t * (xy[i][0] - xy[i - 1][0]), xy[i - 1][1] + t * (xy[i][1] - xy[i - 1][1])];
    }
    acc += L;
  }
  return xy[xy.length - 1];
}

/** Offset a lng/lat polyline by `side * OFFSET_M` metres (side -1 = left of
 *  travel, +1 = right, 0 = unchanged). Segment offset + mitred joins with a
 *  clamp; the first/last TAPER_M are replaced by a straight RAMP from the
 *  raw node into the offset line — always connected, never a perpendicular
 *  step or a backtrack (2026-08-17). Runs shorter than 2·TAPER_M are not
 *  offset. */
export const OFFSET_M = 3; // drawn offset; 6 (the measured median sidewalk distance) read as too far, halved 2026-08-19
const TAPER_M = 12; // ramp length from a node onto the offset line (a gentle diagonal, not a wedge)

export function offsetLine(
  coords: [number, number][],
  side: -1 | 0 | 1,
  startPt?: [number, number],
  endPt?: [number, number],
  ramps: { start: boolean; end: boolean } = { start: true, end: true }
): [number, number][] {
  if (side === 0 || coords.length < 2) return coords;
  const lat0 = coords[0][1];
  const mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const mLat = 110_540;
  const xy = coords.map(([lng, lat]) => [lng * mLng, lat * mLat] as [number, number]);
  const s0: [number, number] = startPt ? [startPt[0] * mLng, startPt[1] * mLat] : xy[0];
  const e0: [number, number] = endPt ? [endPt[0] * mLng, endPt[1] * mLat] : xy[xy.length - 1];
  let total = 0;
  for (let i = 1; i < xy.length; i++) total += segLen(xy[i - 1], xy[i]);
  if (total < 2 * TAPER_M) return coords;
  // unit right-normal per segment (right of travel in an x-east/y-north frame)
  const nrm: [number, number][] = [];
  for (let i = 0; i < xy.length - 1; i++) {
    let dx = xy[i + 1][0] - xy[i][0];
    let dy = xy[i + 1][1] - xy[i][1];
    if (Math.hypot(dx, dy) < 1e-9) {
      const j = i + 2 < xy.length ? [i + 1, i + 2] : [Math.max(0, i - 1), i];
      dx = xy[j[1]][0] - xy[j[0]][0];
      dy = xy[j[1]][1] - xy[j[0]][1];
    }
    const L = Math.hypot(dx, dy) || 1;
    nrm.push([dy / L, -dx / L]);
  }
  const d = side * OFFSET_M;
  const off: [number, number][] = [];
  for (let i = 0; i < xy.length; i++) {
    let nx: number, ny: number;
    if (i === 0) [nx, ny] = nrm[0];
    else if (i === xy.length - 1) [nx, ny] = nrm[nrm.length - 1];
    else {
      const [ax, ay] = nrm[i - 1];
      const [bx, by] = nrm[i];
      let mx = ax + bx, my = ay + by;
      const mL = Math.hypot(mx, my);
      if (mL < 1e-6) { mx = ax; my = ay; } else { mx /= mL; my /= mL; }
      const cosHalf = mx * ax + my * ay;
      const scale = Math.min(2, 1 / Math.max(0.5, cosHalf));
      nx = mx * scale; ny = my * scale;
    }
    off.push([xy[i][0] + nx * d, xy[i][1] + ny * d]);
  }
  // ramp: raw start -> offset point at TAPER_M ... offset point at total-TAPER_M -> raw end;
  // at a route's free start/end (ramps.start/end false) the line simply stays offset
  const A = pointAt(off, TAPER_M);
  const B = pointAt(off, total - TAPER_M);
  const mid: [number, number][] = [];
  let acc = 0;
  for (let i = 1; i < off.length - 1; i++) {
    acc += segLen(off[i - 1], off[i]);
    if ((ramps.start ? acc > TAPER_M : true) && (ramps.end ? acc < total - TAPER_M : true)) mid.push(off[i]);
  }
  const head: [number, number][] = ramps.start ? [s0, A] : [off[0]];
  const foot: [number, number][] = ramps.end ? [B, e0] : [off[off.length - 1]];
  const out = [...head, ...mid, ...foot];
  return out.map(([x, y]) => [x / mLng, y / mLat]);
}

/** Douglas-Peucker in metres, for DISPLAY only: the set-backs where a
 *  sidewalk meets a crossing draw as fussy little steps (2026-08-17). */
export function simplifyLine(coords: [number, number][], tolM = 5, anchors: [number, number][] = []): [number, number][] {
  if (coords.length < 3) return coords;
  const lat0 = coords[0][1];
  const mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const mLat = 110_540;
  const xy = coords.map(([lng, lat]) => [lng * mLng, lat * mLat] as [number, number]);
  const keep = new Uint8Array(xy.length);
  keep[0] = keep[xy.length - 1] = 1;
  // anchors (crossing entries/exits) are kept and split the DP intervals
  const fixed = [0, xy.length - 1];
  for (const [alng, alat] of anchors) {
    const ax = alng * mLng, ay = alat * mLat;
    let best = -1, bd = 0.5;
    for (let i = 1; i < xy.length - 1; i++) {
      const d = Math.hypot(xy[i][0] - ax, xy[i][1] - ay);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0 && !keep[best]) { keep[best] = 1; fixed.push(best); }
  }
  fixed.sort((a, b) => a - b);
  const stack: [number, number][] = [];
  for (let k = 1; k < fixed.length; k++) if (fixed[k] > fixed[k - 1] + 1) stack.push([fixed[k - 1], fixed[k]]);
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, wd = tolM;
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      let d: number;
      if (L2 === 0) d = Math.hypot(px - ax, py - ay);
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return coords.filter((_, i) => keep[i]);
}

/** Round corners for DISPLAY: cut each interior vertex at up to R_M (never
 *  more than a quarter of the adjoining segments), two passes — a 90°
 *  turn becomes a soft arc, straights stay straight (2026-08-17). */
export function roundCorners(coords: [number, number][], rM = 4, passes = 2): [number, number][] {
  if (coords.length < 3) return coords;
  const lat0 = coords[0][1];
  const mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const mLat = 110_540;
  let pts = coords.map(([lng, lat]) => [lng * mLng, lat * mLat] as [number, number]);
  for (let pass = 0; pass < passes; pass++) {
    const out: [number, number][] = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i], a = pts[i - 1], b = pts[i + 1];
      const la = Math.hypot(p[0] - a[0], p[1] - a[1]);
      const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
      const r = Math.min(rM / (pass + 1), la * 0.25, lb * 0.25);
      if (r < 0.2) { out.push(p); continue; }
      out.push([p[0] + ((a[0] - p[0]) * r) / la, p[1] + ((a[1] - p[1]) * r) / la]);
      out.push([p[0] + ((b[0] - p[0]) * r) / lb, p[1] + ((b[1] - p[1]) * r) / lb]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts.map(([x, y]) => [x / mLng, y / mLat]);
}

/** Remove kerb spurs for DISPLAY: an interior vertex reached by a short
 *  hop (< maxHopM) followed by a sharp turn back (> minTurnDeg) is OSM
 *  crossing/kerb geometry, not a place anyone walks to (2026-08-17). */
export function removeSpurs(coords: [number, number][], maxHopM = 8, minTurnDeg = 100,
  protect?: boolean[]): [number, number][] {
  if (coords.length < 3) return coords;
  const lat0 = coords[0][1];
  const mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const mLat = 110_540;
  let pts = coords.map(([lng, lat], i) => ({ x: lng * mLng, y: lat * mLat, i }));
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    const out: typeof pts = [pts[0]];
    for (let k = 1; k < pts.length - 1; k++) {
      const a = out[out.length - 1], p = pts[k], b = pts[k + 1];
      // a vertex on real crossing infrastructure is a semantic corner (walk
      // to the crossing head, cross) — never spur-cut it, however sharp
      // the turn (Roßmarkt pin tail 2026-08-21)
      if (protect?.[p.i]) { out.push(p); continue; }
      const la = Math.hypot(p.x - a.x, p.y - a.y);
      const lb = Math.hypot(b.x - p.x, b.y - p.y);
      const dot = ((p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)) / (la * lb || 1);
      const turn = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
      // a genuine spur RETURNS — net displacement below the longer leg
      const net = Math.hypot(b.x - a.x, b.y - a.y);
      if ((la < maxHopM || lb < maxHopM) && turn > minTurnDeg && net < Math.max(la, lb)) { changed = true; continue; }
      out.push(p);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
    if (!changed) break;
  }
  return pts.map(({ x, y }) => [x / mLng, y / mLat]);
}

/** Geometry of a run for DISPLAY. A crossing chain — consecutive crossing
 *  pieces plus kerb stubs (<= KERB_M) between/around them — is drawn as one
 *  straight stroke from its entry to its exit when it zigzags (a staggered
 *  island crossing is walked E-N-W-N-W-N in OSM, nobody wants to see that,
 *  2026-08-17); a chain that already runs smoothly (an L over a two-part
 *  junction crossing, Eschersheimer/Bremer 2026-08-18) keeps its mapped
 *  shape. Entry and exit of every chain are pushed to `anchors` so
 *  simplifyLine keeps them: the corner where the sidewalk turns onto the
 *  zebra is what makes a crossing readable. */
const KERB_M = 8;
const ZIGZAG_DEG = 60;
export function runCoords(g: Graph, eids: number[], anchors?: [number, number][]): [number, number][] {
  const isX = (e: number) => (g.flags[e] & 4) !== 0;
  const len = (e: number) => g.lenDm[e] / 10;
  const out: [number, number][] = [];
  const push = (pts: [number, number][]) => {
    if (out.length === 0) out.push(...pts);
    else out.push(...pts.slice(1));
  };
  let i = 0;
  while (i < eids.length) {
    if (!isX(eids[i]) && !(len(eids[i]) <= KERB_M && i + 1 < eids.length && isX(eids[i + 1]))) {
      push(edgeLatLngs(g, eids[i]) as [number, number][]);
      i++;
      continue;
    }
    // chain: crossings and the kerb stubs between / right before / right
    // after them
    let j = i + 1;
    while (j < eids.length) {
      if (isX(eids[j])) { j++; continue; }
      if (len(eids[j]) > KERB_M) break;
      j++; // a stub: absorbed; it ends the chain unless a crossing follows
      if (!(j < eids.length && isX(eids[j]))) break;
    }
    const pts: [number, number][] = [];
    for (let k = i; k < j; k++) {
      const e = edgeLatLngs(g, eids[k]) as [number, number][];
      if (pts.length === 0) pts.push(...e); else pts.push(...e.slice(1));
    }
    // a straightened chain pins its two ends; a kept chain pins its whole
    // mapped shape (the L over an island stays an L)
    // kerb jogs of a metre or two are not a zigzag: judge the 2 m-simplified shape
    const straight = j - i >= 2 && zigzags(simplifyLine(pts, 2));
    anchors?.push(...(straight ? [pts[0], pts[pts.length - 1]] : pts));
    push(straight ? [pts[0], pts[pts.length - 1]] : pts);
    i = j;
  }
  return out;
}

function zigzags(coords: [number, number][]): boolean {
  if (coords.length < 3) return false;
  const lat0 = coords[0][1];
  const mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const mLat = 110_540;
  const xy = coords.map(([lng, lat]) => [lng * mLng, lat * mLat] as [number, number]);
  // a zigzag is a STAGGERED shape: at least two sharp turns in OPPOSITE
  // directions (E-N-W-N island crossings). A single L — a two-part junction
  // crossing turning once — is real mapped shape and stays (it was being
  // chorded into a "jaywalk" diagonal, Adickesallee/Bertramstraße
  // 2026-08-20).
  const sharp: number[] = [];
  for (let i = 1; i < xy.length - 1; i++) {
    const a = xy[i - 1], p = xy[i], b = xy[i + 1];
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    if (la < 0.5 || lb < 0.5) continue;
    const dot = ((p[0] - a[0]) * (b[0] - p[0]) + (p[1] - a[1]) * (b[1] - p[1])) / (la * lb);
    const turn = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
    if (turn >= ZIGZAG_DEG) {
      const cross = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
      sharp.push(Math.sign(cross));
    }
  }
  for (let i = 1; i < sharp.length; i++) if (sharp[i] !== sharp[i - 1]) return true;
  return false;
}

/** Cut `startM` / `endM` metres off a lng/lat polyline (display only). */
export function cutEnds(coords: [number, number][], startM = 0, endM = 0): [number, number][] {
  if (coords.length < 2 || (startM <= 0 && endM <= 0)) return coords;
  const lat0 = coords[0][1];
  const mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const mLat = 110_540;
  const xy = coords.map(([lng, lat]) => [lng * mLng, lat * mLat] as [number, number]);
  let total = 0;
  for (let i = 1; i < xy.length; i++) total += segLen(xy[i - 1], xy[i]);
  if (startM + endM >= total - 1) return coords;
  const out: [number, number][] = [];
  let acc = 0;
  if (startM > 0) out.push(pointAt(xy, startM));
  else out.push(xy[0]);
  for (let i = 1; i < xy.length; i++) {
    acc += segLen(xy[i - 1], xy[i]);
    if (acc > startM && acc < total - endM) out.push(xy[i]);
  }
  out.push(endM > 0 ? pointAt(xy, total - endM) : xy[xy.length - 1]);
  return out.map(([x, y]) => [x / mLng, y / mLat]);
}
