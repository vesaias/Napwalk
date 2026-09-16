// Draw a route as ONE polyline with a continuous sidewalk-offset profile
// (2026-08-18). The previous model drew each "run" (street stretch on one
// side / path stretch) as its own offset line with ramps to the shared node
// and a stack of trims — every run boundary was a place for a triangle or a
// hook. Here the whole route is one polyline; every vertex carries a target
// offset (± OFFSET_M on a street, 0 on a path/sidewalk/crossing, the same as
// its neighbours on a short connector), the profile is slope-limited into
// gentle ramps, and the polyline is offset once, per vertex, along averaged
// normals. No boundaries, no ramps to nodes.
import { edgeLatLngs, type Graph } from "./graph";
import { OFFSET_M, removeSpurs, roundCorners, runCoords, sidewalkRuns } from "./sidewalk";

const TAPER_M = 5; // metres to move OFFSET_M sideways — was 12 when the offset was 6 m; at 3 m that slope kept streets near-centre for ~15 m after every transition (2026-08-20)
const PASS_M = 25; // a centred piece shorter than this between offset pieces is a connector: blend through it
const MITER_LIMIT = 1.6;
const DENSIFY_M = 4; // max segment length fed to the profile
const JOIN_M = 12; // metres of a path CUT at a street transition (the chord eats them)

/** Coordinates of a route with per-vertex target offset (metres, + = right
 *  of travel). Head/tail are the snap pieces to the pins; they take the
 *  offset of the first/last edge (no ramp at a route's free ends). */
function targets(g: Graph, eids: number[], startMin: number, head: [number, number][], tail: [number, number][]) {
  const side = new Map<number, number>();
  for (const run of sidewalkRuns(g, eids, startMin)) for (const e of run.eids) side.set(e, run.side);
  const anchors: [number, number][] = [];
  const coords: [number, number][] = [];
  const tgt: number[] = [];
  // runCoords straightens crossing chains — rebuild it edge by edge so each
  // vertex knows its edge: the coords of edge k are appended, its target
  // applies to the vertices it adds
  const all = runCoords(g, eids, anchors);
  // map every vertex of `all` to the edge whose geometry contains it (walk
  // edges in order, matching vertices exactly)
  let k = 0;
  let pts = edgeLatLngs(g, eids[0]) as [number, number][];
  let pi = 0;
  const edgeOf: number[] = [];
  for (let i = 0; i < all.length; i++) {
    const [x, y] = all[i];
    // advance through edges until this vertex is found (chains skip vertices)
    let guard = 0;
    while (guard++ < 100000) {
      while (pi < pts.length && !(pts[pi][0] === x && pts[pi][1] === y)) pi++;
      if (pi < pts.length) break;
      k++;
      if (k >= eids.length) { k = eids.length - 1; break; }
      pts = edgeLatLngs(g, eids[k]) as [number, number][];
      pi = 1; // the first vertex of the next edge is the last of this one
    }
    edgeOf.push(k);
  }
  // segment i (all[i] → all[i+1]) lies on the edge that owns vertex i+1.
  // A sidewalk=no street (bit7 + bit0) is walked on the road border: 1 m
  // offset instead of the sidewalk's 3 m (wish 2026-08-19).
  const hard: boolean[] = [];
  for (let i = 0; i < all.length; i++) {
    coords.push(all[i]);
    const e = eids[edgeOf[Math.min(i + 1, all.length - 1)]];
    // OSM tiles draw carriageways ~2x their real width, so a 1 m offset
    // reads as ON the road. Streets draw at 3 m (the drawn road's edge)
    // whether or not sidewalk evidence exists; only explicit sidewalk=no
    // (bit7) hugs the kerb at 1 m (2026-08-20).
    const f = g.flags[e];
    const mag = (f & 128) !== 0 ? 1 : OFFSET_M;
    tgt.push((side.get(e) ?? 0) * mag);
    // a genuine walkway piece (not a street, not a crossing) must be drawn
    // ON its geometry even when short — never blended over like a crossing
    // hop (way 28390723, 2026-08-20)
    hard.push((f & 4) === 0 && ((f & 1) === 0 || (f & 128) !== 0));
  }
  // a street→path boundary vertex must HOLD the street's offset — the
  // target of the segment leaving it is the path's 0, so without this the
  // line slid back onto the node (Joachim-Becher 2026-08-18). Anchor both
  // kinds of boundary so simplify keeps the corner.
  {
    const orig = tgt.slice(); // judge boundaries on the ORIGINAL values —
    // holding in place cascaded the street offset down the whole path
    // (2026-08-19)
    const lat0 = coords[0]?.[1] ?? 50;
    const mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
    const mLat = 110_540;
    const segM = (i: number) => Math.hypot((coords[i + 1][0] - coords[i][0]) * mLng, (coords[i + 1][1] - coords[i][1]) * mLat);
    const shortHard: [number, number][] = [];
    let i = 0;
    while (i < tgt.length) {
      if (orig[i] !== 0) { i++; continue; }
      let j = i, len = 0;
      while (j < tgt.length && orig[j] === 0) { if (j + 1 < tgt.length) len += segM(j); j++; }
      const groupHard = hard.slice(i, j).some(Boolean);
      if (i > 0) anchors.push(coords[i]);
      if (j < tgt.length) anchors.push(coords[j - 1]);
      if (groupHard && len < PASS_M) {
        // a SHORT genuine walkway between streets: draw it ON its geometry —
        // no hold, and pull the exit street vertex down to it (way 28390723,
        // 2026-08-20). The street's last metres before its nodes are cut
        // below so the join is one straight diagonal across the road mouth
        // instead of a 12 m ramp inside the carriageway.
        if (j < tgt.length) tgt[j] = 0;
        shortHard.push([i, j]);
      } else if (i > 0 && (hard[i] || len < PASS_M)) {
        // crossing hop or a long walkway (JOIN cut eats its first metres):
        // the boundary vertex holds the street offset. NOT held when a LONG
        // group starts with a crossing piece (soft head): the street line
        // must converge onto the crossing head so the zebra is drawn on its
        // own line — holding put the 3 m ramp ACROSS the zebra (Oeder Weg
        // 2026-08-21); the transition block below then corners the offset
        // line onto the crossing's extension.
        tgt[i] = orig[i - 1];
      }
      i = j;
    }
    // cut the street approach on both sides of each short walkway (6 m):
    // the offset line then jumps straight from the kept street vertex to
    // the walkway end — a corner-cut diagonal, not an on-road ramp
    const CUT_M = 6;
    const drop = new Uint8Array(coords.length);
    for (const [gi, gj] of shortHard) {
      let d = 0;
      for (let k = gi - 1; k > 0 && orig[k] !== 0 && d < CUT_M; k--) {
        d += segM(k);
        if (d < CUT_M) drop[k] = 1;
      }
      d = 0;
      for (let k = gj + 1; k < coords.length - 1 && orig[k] !== 0 && d < CUT_M; k++) {
        d += segM(k - 1);
        if (d < CUT_M) drop[k] = 1;
      }
    }
    for (let k = coords.length - 1; k >= 0; k--) {
      if (drop[k]) { coords.splice(k, 1); tgt.splice(k, 1); hard.splice(k, 1); }
    }
  }
  const first = tgt[0] ?? 0, last = tgt[tgt.length - 1] ?? 0;
  const c2 = [...head.slice(0, -1), ...coords, ...tail.slice(1)];
  const t2 = [...head.slice(0, -1).map(() => first), ...tgt, ...tail.slice(1).map(() => last)];
  // pin snap tails are REAL mapped geometry (the piece of the snapped
  // edge the walker actually walks) — always hard, never blended over.
  // Inheriting the first route edge's softness let a tail + 6 m crossing
  // smooth into a diagonal ACROSS the carriageway (Roßmarkt 2026-08-21).
  const h2 = [...head.slice(0, -1).map(() => true), ...hard, ...tail.slice(1).map(() => true)];
  return { coords: c2, tgt: t2, anchors, hard: h2 };
}

/** Slope-limited profile: connectors blend through, then forward/backward
 *  limiting at OFFSET_M / TAPER_M per metre, keeping the value nearer zero
 *  (ramps happen on the street side of a boundary, a short street stretch
 *  becomes a tent). */
function profile(xy: [number, number][], tgt: number[], hard: boolean[], lock?: boolean[]): number[] {
  const n = xy.length;
  const seg = (i: number) => Math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]);
  // connectors: maximal zero groups shorter than PASS_M with non-zero
  // neighbours on both sides blend linearly between them — unless the group
  // is a genuine walkway (hard vertices) longer than a kerb link: that one
  // is drawn on its geometry (slope-limited dip instead of a blend). Groups
  // containing a locked join vertex (an offset-line intersection inserted
  // by the transition step) are never blended — their position IS the join.
  const t = tgt.slice();
  let i = 0;
  while (i < n) {
    if (t[i] !== 0) { i++; continue; }
    let j = i, len = 0;
    let anyHard = false, anyLock = false;
    while (j < n && t[j] === 0) { if (j + 1 < n) len += seg(j); anyHard = anyHard || hard[j]; anyLock = anyLock || (lock?.[j] ?? false); j++; }
    if (i > 0 && j < n && len < PASS_M && !(anyHard && len >= 8) && !anyLock) {
      const a = t[i - 1], b = t[j];
      let acc = 0;
      const total = len + seg(i - 1);
      for (let m = i; m < j; m++) { acc += seg(m - 1); t[m] = a + (b - a) * (total > 0 ? acc / total : 0); }
    }
    i = j;
  }
  const k = OFFSET_M / TAPER_M;
  const fwd = t.slice(), bwd = t.slice();
  for (let m = 1; m < n; m++) {
    const d = seg(m - 1) * k;
    fwd[m] = Math.max(fwd[m - 1] - d, Math.min(fwd[m - 1] + d, t[m]));
  }
  for (let m = n - 2; m >= 0; m--) {
    const d = seg(m) * k;
    bwd[m] = Math.max(bwd[m + 1] - d, Math.min(bwd[m + 1] + d, t[m]));
  }
  const out = new Array<number>(n);
  for (let m = 0; m < n; m++) out[m] = Math.abs(fwd[m]) <= Math.abs(bwd[m]) ? fwd[m] : bwd[m];
  return out;
}

/** Offset each vertex by its profile value along the averaged normal of its
 *  two segments (mitred, limited). Vertices whose offset would fold the
 *  line back on itself are dropped. */
function offsetProfile(xy: [number, number][], off: number[]): [number, number][] {
  const n = xy.length;
  if (n < 2) return xy;
  const nrm: [number, number][] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = xy[i + 1][0] - xy[i][0], dy = xy[i + 1][1] - xy[i][1];
    const L = Math.hypot(dx, dy) || 1;
    nrm.push([dy / L, -dx / L]); // right of travel
  }
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    let nx: number, ny: number;
    if (i === 0) [nx, ny] = nrm[0];
    else if (i === n - 1) [nx, ny] = nrm[n - 2];
    else {
      const a = nrm[i - 1], b = nrm[i];
      nx = a[0] + b[0]; ny = a[1] + b[1];
      const L = Math.hypot(nx, ny);
      if (L < 1e-6) { nx = b[0]; ny = b[1]; }
      else {
        // miter: scale so the offset segments stay parallel, with a limit
        const cosHalf = L / 2;
        const s = Math.min(MITER_LIMIT, 1 / Math.max(cosHalf, 1e-3));
        nx = (nx / L) * s; ny = (ny / L) * s;
      }
    }
    out.push([xy[i][0] + nx * off[i], xy[i][1] + ny * off[i]]);
  }
  // drop fold-backs: a vertex whose offset point lies behind the previous
  // offset point along the travel direction of the raw segment
  const kept: [number, number][] = [out[0]];
  for (let i = 1; i < n; i++) {
    const dx = xy[i][0] - xy[i - 1][0], dy = xy[i][1] - xy[i - 1][1];
    const p = kept[kept.length - 1];
    const adv = (out[i][0] - p[0]) * dx + (out[i][1] - p[1]) * dy;
    if (adv <= 0 && i < n - 1) continue;
    kept.push(out[i]);
  }
  return kept;
}

/** Length-aware denoise: drop an interior vertex only when one of its
 *  segments is shorter than NOISE_SEG_M AND it lies within NOISE_DEV_M of
 *  the line between its kept neighbours. Long segments (a footpath drawn
 *  with 20 m strokes) are real geometry and are never touched. Anchors
 *  (crossing ends, street-path boundaries) are always kept. */
const NOISE_SEG_M = 3;
const NOISE_DEV_M = 1.2;
function denoise(coords: [number, number][], anchors: [number, number][]): [number, number][] {
  if (coords.length < 3) return coords;
  const lat0 = coords[0][1];
  const mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const mLat = 110_540;
  const keep = new Set<number>();
  for (const [alng, alat] of anchors) {
    const ax = alng * mLng, ay = alat * mLat;
    for (let i = 0; i < coords.length; i++) {
      if (Math.hypot(coords[i][0] * mLng - ax, coords[i][1] * mLat - ay) < 0.5) { keep.add(i); break; }
    }
  }
  let pts = coords.map(([lng, lat], i) => ({ x: lng * mLng, y: lat * mLat, i }));
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    const out: typeof pts = [pts[0]];
    for (let k = 1; k < pts.length - 1; k++) {
      const a = out[out.length - 1], p = pts[k], b = pts[k + 1];
      if (keep.has(p.i)) { out.push(p); continue; }
      const la = Math.hypot(p.x - a.x, p.y - a.y);
      const lb = Math.hypot(b.x - p.x, b.y - p.y);
      if (Math.min(la, lb) >= NOISE_SEG_M) { out.push(p); continue; }
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
      const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      if (d < NOISE_DEV_M) { changed = true; continue; }
      out.push(p);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
    if (!changed) break;
  }
  return pts.map((p) => coords[p.i]);
}

/** Trim an end overshoot in place: if the last (first) point projects onto
 *  an earlier (later) segment within OVERSHOOT_M, the vertices between are
 *  a there-and-back to a node past the pin — drop them. */
const OVERSHOOT_M = 5;
function trimOvershoot(coords: [number, number][], tgt: number[], hard: boolean[], atStart: boolean): void {
  const n = coords.length;
  if (n < 3) return;
  if (atStart) { coords.reverse(); tgt.reverse(); hard.reverse(); }
  const lat0 = coords[0][1];
  const mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const mLat = 110_540;
  const xy = coords.map(([lng, lat]) => [lng * mLng, lat * mLat] as [number, number]);
  const P = xy[xy.length - 1];
  let cut = -1;
  for (let i = Math.max(0, xy.length - 12); i < xy.length - 2; i++) {
    const [ax, ay] = xy[i], [bx, by] = xy[i + 1];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    if (L2 < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((P[0] - ax) * dx + (P[1] - ay) * dy) / L2));
    if (Math.hypot(P[0] - (ax + t * dx), P[1] - (ay + t * dy)) < OVERSHOOT_M) { cut = i; break; }
  }
  if (cut >= 0) {
    const keepT = tgt[cut];
    coords.splice(cut + 1, coords.length - cut - 2);
    tgt.splice(cut + 1, tgt.length - cut - 2);
    hard.splice(cut + 1, hard.length - cut - 2);
    tgt[tgt.length - 1] = keepT;
  }
  if (atStart) { coords.reverse(); tgt.reverse(); hard.reverse(); }
}

/** The displayed line of a route (lng/lat). */
export function routeLine(g: Graph, eids: number[], startMin: number,
  head: [number, number][] = [], tail: [number, number][] = []): [number, number][] {
  if (eids.length === 0) return [];
  const { coords, tgt, anchors, hard } = targets(g, eids, startMin, head, tail);
  // the router ends at the nearest NODE, which can lie past the pin; the
  // pin tail then retraces the same edge — trim the overshoot so the line
  // stops at the pin instead of going there and back (2026-08-20)
  trimOvershoot(coords, tgt, hard, false);
  trimOvershoot(coords, tgt, hard, true);
  // clean the raw geometry (kerb spurs, fussy steps) — keep the targets
  // aligned by looking each surviving vertex up in the raw list
  // denoise, not simplify (wish 2026-08-19): only vertices sitting on SHORT
  // segments are kerb/stitching noise that would flap the offset normals; a
  // vertex between two long segments is a real, gentle bend of the mapped
  // way and stays verbatim.
  // crossing-piece vertices (target 0 and soft) are semantic corners; the
  // spur cleaner must not eat the walk-to-the-head-and-cross V. Spread one
  // vertex each way so both crossing ENDS are covered.
  const soft = tgt.map((tv, i) => tv === 0 && !(hard[i] ?? true));
  const protect = soft.map((s, i) => s || soft[i - 1] || soft[i + 1]);
  const cleaned = denoise(removeSpurs(coords, undefined, undefined, protect), anchors);
  const lat0 = coords[0][1];
  const mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const mLat = 110_540;
  const xy = cleaned.map(([lng, lat]) => [lng * mLng, lat * mLat] as [number, number]);
  const rawXY = coords.map(([lng, lat]) => [lng * mLng, lat * mLat] as [number, number]);
  const t: number[] = [];
  const h: boolean[] = [];
  let j = 0;
  for (const p of xy) {
    // vertices survive in order; advance j to the matching raw vertex
    while (j < rawXY.length - 1 && Math.hypot(rawXY[j][0] - p[0], rawXY[j][1] - p[1]) > 0.05) j++;
    t.push(tgt[Math.min(j, tgt.length - 1)]);
    h.push(hard[Math.min(j, hard.length - 1)] ?? false);
  }
  const lk: boolean[] = xy.map(() => false); // locked join vertices (see profile)
  // transitions (wish 2026-08-18): where an offset street meets a genuine
  // path stretch (zero group >= PASS_M), the street keeps its offset to the
  // node and the path's first JOIN_M metres are CUT — the drawn line joins
  // with one straight chord. (Extending the offset into the path instead
  // displaced the path sideways along its own normal — an S-bulge at
  // right-angle joins, Plieningerstraße 2026-08-18.)
  {
    const seg = (i: number) => Math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]);
    // A street's centreline flares/kinks inside a junction mouth, and its
    // shared node sits mid-carriageway — drawing "node + offset" swung the
    // line INTO the drawn road at every walkway boundary (Myliusstraße
    // 2026-08-20). Instead: take the street's STRAIGHT section past the
    // mouth (first CUT_STREET_M metres dropped), extend its offset line
    // until it intersects the walkway, and make that intersection the one
    // corner — the walker turns off the walkway before the kerb and never
    // enters the mouth. Falls back to the JOIN_M chord at the held boundary
    // vertex when the lines don't cross (street continuing straight ahead
    // as a path).
    const CUT_STREET_M = 10;
    const SEARCH_M = 20;
    const drop = new Uint8Array(xy.length);
    const insBefore = new Map<number, [number, number]>();
    // re-entry anchors: street-target vertices on the real street line so a
    // join chord over sparse geometry lands early (2026-08-21)
    const insStreet = new Map<number, [[number, number], number]>();
    // param s of segment P→Q where it crosses the line through A along d
    const hit = (A: [number, number], d: [number, number], P: [number, number], Q: [number, number]) => {
      const den = (Q[0] - P[0]) * d[1] - (Q[1] - P[1]) * d[0];
      if (Math.abs(den) < 1e-9) return NaN;
      return ((A[0] - P[0]) * d[1] - (A[1] - P[1]) * d[0]) / den;
    };
    let i = 0;
    while (i < xy.length) {
      if (t[i] !== 0) { i++; continue; }
      let j = i;
      while (j < xy.length && t[j] === 0) j++;
      let len = 0;
      for (let m = i; m < j - 1; m++) len += seg(m);
      const groupHard = h.slice(i, j).some(Boolean);
      if (len < PASS_M && groupHard && i > 0 && j < xy.length && j - i >= 2 && t[i - 1] !== 0 && t[j] !== 0) {
        // A SHORT mapped connector between two streets (way 28390723-style,
        // Guiollett stagger 2026-08-20): its endpoints are street NODES
        // mid-carriageway. The drawn connector follows the way's OWN line;
        // each end extends OUTWARD along it until it meets the street's
        // 3 m offset line (the "virtual kerb") — the corner sits on that
        // kerb line. Where the extension diverges from the kerb line (the
        // stagger's far end), the way stays drawn to its node and a
        // straight chord dives from the offset line to it (2026-08-20,
        // "must follow the virtual kerb we build via offset").
        const EXT_MAX = 18;
        const lineDir = (a: [number, number], b: [number, number]): [number, number] | null => {
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          return L > 1e-6 ? [(b[0] - a[0]) / L, (b[1] - a[1]) / L] : null;
        };
        const wHead = lineDir(xy[i], xy[i + 1]);
        const wTail = lineDir(xy[j - 2], xy[j - 1]);
        const INSET_M = 2.5;
        if (wHead && wTail) {
          // head: extend the way's line backward past its node; find where
          // it crosses the street's drawn OFFSET polyline (each street
          // segment offset by its own normal × t — the virtual kerb,
          // curve-following)
          let joined = false;
          {
            let acc = 0;
            for (let k = i; k >= 1 && (k === i || t[k] !== 0) && acc < 25; k--) {
              const dv = lineDir(xy[k - 1], xy[k]);
              const tt = t[k] !== 0 ? t[k] : t[k - 1];
              if (dv) {
                const oa: [number, number] = [xy[k - 1][0] + dv[1] * tt, xy[k - 1][1] - dv[0] * tt];
                const ob: [number, number] = [xy[k][0] + dv[1] * tt, xy[k][1] - dv[0] * tt];
                const u = hit(xy[i], wHead, oa, ob);
                if (Number.isFinite(u) && u >= 0 && u <= 1) {
                  const X: [number, number] = [oa[0] + (ob[0] - oa[0]) * u, oa[1] + (ob[1] - oa[1]) * u];
                  const s = (X[0] - xy[i][0]) * wHead[0] + (X[1] - xy[i][1]) * wHead[1];
                  if (s < 0 && Math.hypot(X[0] - xy[i][0], X[1] - xy[i][1]) <= EXT_MAX) {
                    for (let r = k; r <= i; r++) drop[r] = 1; // street tail + node
                    insBefore.set(k, X);
                    joined = true;
                    break;
                  }
                }
              }
              acc += seg(k - 1);
            }
          }
          if (!joined) {
            // diverging end: dive from the offset line straight to a point
            // ON the way ~2.5 m INSIDE its end — never to the node itself
            // (mid-carriageway: that chord sliced the band) and never
            // tapering/curling around it (user sketch 2026-08-20). The
            const wl = Math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]);
            const dIn = Math.min(INSET_M, wl * 0.4);
            const W: [number, number] = [xy[i][0] + wHead[0] * dIn, xy[i][1] + wHead[1] * dIn];
            drop[i] = 1;
            insBefore.set(i + 1, W);
            // street vertices stay: the chord spans only to the nearest
            // kept street vertex, and the offset polyline then follows the
            // street's own curve ("doesnt follow street curve", 2026-08-20)
          }
          // tail: mirrored — way's line extended forward past its node
          joined = false;
          {
            let acc = 0;
            for (let k = j - 1; k < xy.length - 1 && (k === j - 1 || t[k] !== 0) && acc < 25; k++) {
              const dv = lineDir(xy[k], xy[k + 1]);
              const tt = t[k] !== 0 ? t[k] : t[k + 1];
              if (dv) {
                const oa: [number, number] = [xy[k][0] + dv[1] * tt, xy[k][1] - dv[0] * tt];
                const ob: [number, number] = [xy[k + 1][0] + dv[1] * tt, xy[k + 1][1] - dv[0] * tt];
                const u = hit(xy[j - 1], wTail, oa, ob);
                if (Number.isFinite(u) && u >= 0 && u <= 1) {
                  const X: [number, number] = [oa[0] + (ob[0] - oa[0]) * u, oa[1] + (ob[1] - oa[1]) * u];
                  const s = (X[0] - xy[j - 1][0]) * wTail[0] + (X[1] - xy[j - 1][1]) * wTail[1];
                  if (s > 0 && Math.hypot(X[0] - xy[j - 1][0], X[1] - xy[j - 1][1]) <= EXT_MAX) {
                    for (let r = j - 1; r <= k; r++) drop[r] = 1; // node + street head
                    insBefore.set(k + 1, X);
                    joined = true;
                    break;
                  }
                }
              }
              acc += seg(k);
            }
          }
          if (!joined) {
            const wl = Math.hypot(xy[j - 1][0] - xy[j - 2][0], xy[j - 1][1] - xy[j - 2][1]);
            const dIn = Math.min(INSET_M, wl * 0.4);
            const W: [number, number] = [xy[j - 1][0] - wTail[0] * dIn, xy[j - 1][1] - wTail[1] * dIn];
            drop[j - 1] = 1;
            insBefore.set(j, W);
          }
        }
      } else if (len >= PASS_M) {
        if (i > 0) { // street → walkway
          let d0 = 0, m = i - 2; // drop the mouth (i-1 is the held node)
          while (m > 0 && t[m] !== 0 && d0 + seg(m) < CUT_STREET_M) { d0 += seg(m); drop[m] = 1; m--; }
          // sparse street geometry: when the cut leaves the nearest kept
          // vertex far away, the join chord would BECOME the street for
          // 100+ m (Walldorfer 2026-08-21: 7.5 m convergence chord). Insert
          // a re-entry anchor ON the real street line ~CUT_STREET_M before
          // the last dropped vertex so the chord lands and the line then
          // follows the street.
          if (m >= 0 && m < i - 2 && t[m] !== 0 &&
              Math.hypot(xy[m][0] - xy[i - 1][0], xy[m][1] - xy[i - 1][1]) > 3 * CUT_STREET_M) {
            const D = xy[m + 1]; // dropped vertex nearest the kept one
            const L = Math.hypot(D[0] - xy[m][0], D[1] - xy[m][1]);
            if (L > 2 * CUT_STREET_M) {
              const f = CUT_STREET_M / L;
              insStreet.set(m + 1, [[D[0] + (xy[m][0] - D[0]) * f, D[1] + (xy[m][1] - D[1]) * f], t[m]]);
            }
          }
          let joined = false;
          if (m >= 0 && t[m] !== 0 && !drop[m]) {
            const p1 = xy[m];
            // the straight section's direction: when mouth vertices were
            // dropped, the segment p1→held-node is a synthetic chord over
            // the flare — use the genuine segment before p1 instead. When
            // NOTHING was dropped, the boundary-adjacent segment is ≥
            // CUT_STREET_M of real geometry — its own direction is the one
            // to extend (using p1's incoming direction here projected the
            // pre-bend heading straight across the block, Joachim-Becher
            // 2026-08-20).
            const adj: [number, number] = [xy[i - 1][0] - p1[0], xy[i - 1][1] - p1[1]];
            const p0 = m > 0 && t[m - 1] !== 0 && !drop[m - 1] ? xy[m - 1] : null;
            // a LONG chord back to the boundary is real street geometry, not
            // a synthetic flare hop — trust it over the segment beyond p1,
            // which can belong to the NEXT street entirely (Walldorfer /
            // Letzter Hasenpfad 2026-08-21: a 160 m street was one segment,
            // the rule projected the cross-street's direction and hung the
            // corner 7.5 m off the road)
            const dir: [number, number] = m === i - 2 || !p0 || Math.hypot(adj[0], adj[1]) >= CUT_STREET_M
              ? adj : [p1[0] - p0[0], p1[1] - p0[1]];
            const L0 = Math.hypot(dir[0], dir[1]);
            if (L0 > 1e-6) {
              const dv: [number, number] = [dir[0] / L0, dir[1] / L0];
              const A: [number, number] = [p1[0] + dv[1] * t[m], p1[1] - dv[0] * t[m]];
              let acc = 0;
              for (let q = i - 1; q < j - 1 && acc < SEARCH_M; q++) {
                const s = hit(A, dv, xy[q], xy[q + 1]);
                if (s > 0 && s <= 1) {
                  const X: [number, number] = [xy[q][0] + (xy[q + 1][0] - xy[q][0]) * s, xy[q][1] + (xy[q + 1][1] - xy[q][1]) * s];
                  if (Math.hypot(X[0] - xy[i - 1][0], X[1] - xy[i - 1][1]) > SEARCH_M) break;
                  for (let r = i - 1; r <= q; r++) drop[r] = 1; // held node + walkway head
                  insBefore.set(q + 1, X);
                  joined = true;
                  break;
                }
                acc += seg(q);
              }
            }
          }
          // originally crossings only; hard walkways joined by the JOIN_M
          // chord — the user's sketches keep asking for the virtual-kerb
          // corner instead (Walldorfer / Letzter Hasenpfad 2026-08-21), so
          // the back-extension now applies to every group head/tail.
          if (!joined) {
            // group starts with a CROSSING piece (soft, drawn on its own
            // geometry): the offset street line crosses the crossing's
            // LINE behind its head, which the forward search above cannot
            // see (Oeder Weg 2026-08-21: the corner chorded 3 m south of
            // the zebra). Extend the crossing's first segment backward
            // until it meets the street's offset polyline — the corner
            // sits ON the crossing line and the zebra is drawn whole.
            const cd0 = i + 1 < j ? Math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]) : 0;
            if (cd0 > 1e-6) {
              // the crossing's own first segment, extended BACKWARD past its head
              const wd: [number, number] = [(xy[i + 1][0] - xy[i][0]) / cd0, (xy[i + 1][1] - xy[i][1]) / cd0];
              let acc = 0;
              for (let k = i; k >= 1 && (k >= i - 1 || t[k] !== 0) && acc < 25; k--) {
                const dL = Math.hypot(xy[k][0] - xy[k - 1][0], xy[k][1] - xy[k - 1][1]);
                const tt = t[k] !== 0 ? t[k] : t[k - 1];
                if (dL > 1e-6) {
                  const dv: [number, number] = [(xy[k][0] - xy[k - 1][0]) / dL, (xy[k][1] - xy[k - 1][1]) / dL];
                  const oa: [number, number] = [xy[k - 1][0] + dv[1] * tt, xy[k - 1][1] - dv[0] * tt];
                  const ob: [number, number] = [xy[k][0] + dv[1] * tt, xy[k][1] - dv[0] * tt];
                  const u = hit(xy[i], wd, oa, ob);
                  // the offset polyline ends AT the boundary; the crossing's
                  // line can pass just beyond its end — let the boundary
                  // segment project up to 6 m past itself
                  if (Number.isFinite(u) && u >= 0 && (u <= 1 || (k === i && (u - 1) * dL <= 6))) {
                    const X: [number, number] = [oa[0] + (ob[0] - oa[0]) * u, oa[1] + (ob[1] - oa[1]) * u];
                    const s = (X[0] - xy[i][0]) * wd[0] + (X[1] - xy[i][1]) * wd[1];
                    if (s < 0 && Math.hypot(X[0] - xy[i][0], X[1] - xy[i][1]) <= 12) {
                      for (let r = k; r <= i - 1; r++) drop[r] = 1; // street mouth + held node
                      insBefore.set(k, X);
                      joined = true;
                      break;
                    }
                  }
                }
                acc += dL;
              }
            }
          }
          if (!joined) { // chord to the held node: cut the group's first JOIN_M
            let d2 = 0, m2 = i;
            while (m2 < j - 1 && d2 + seg(m2) < JOIN_M) { d2 += seg(m2); drop[m2] = 1; m2++; }
          }
        }
        if (j < xy.length) { // walkway → street (mirrored)
          let d0 = 0, m = j + 1; // drop the mouth (j is the shared node)
          while (m < xy.length - 1 && t[m] !== 0 && d0 + seg(m - 1) < CUT_STREET_M) { d0 += seg(m - 1); drop[m] = 1; m++; }
          // sparse-geometry re-entry anchor, mirrored (2026-08-21)
          if (m < xy.length && m > j + 1 && t[m] !== 0 &&
              Math.hypot(xy[m][0] - xy[j][0], xy[m][1] - xy[j][1]) > 3 * CUT_STREET_M) {
            const D = xy[m - 1];
            const L = Math.hypot(D[0] - xy[m][0], D[1] - xy[m][1]);
            if (L > 2 * CUT_STREET_M) {
              const f = CUT_STREET_M / L;
              insStreet.set(m, [[D[0] + (xy[m][0] - D[0]) * f, D[1] + (xy[m][1] - D[1]) * f], t[m - 1] !== 0 ? t[m - 1] : t[m]]);
            }
          }
          let joined = false;
          if (m < xy.length && t[m] !== 0 && !drop[m]) {
            const p1 = xy[m];
            // same direction rule as the entry side: with mouth vertices
            // dropped, p1→shared-node is a synthetic chord — use the genuine
            // segment past p1; with nothing dropped the adjacent segment IS
            // the straight section.
            const adj: [number, number] = [p1[0] - xy[j][0], p1[1] - xy[j][1]];
            const p2 = m + 1 < xy.length && t[m + 1] !== 0 && !drop[m + 1] ? xy[m + 1] : null;
            // same long-chord rule as the entry side (2026-08-21)
            const dir: [number, number] = m === j + 1 || !p2 || Math.hypot(adj[0], adj[1]) >= CUT_STREET_M
              ? adj : [p2[0] - p1[0], p2[1] - p1[1]];
            const L0 = Math.hypot(dir[0], dir[1]);
            if (L0 > 1e-6) {
              const dv: [number, number] = [dir[0] / L0, dir[1] / L0];
              const A: [number, number] = [p1[0] + dv[1] * t[m], p1[1] - dv[0] * t[m]];
              let acc = 0;
              for (let q = j; q > i && acc < SEARCH_M; q--) {
                const s = hit(A, dv, xy[q - 1], xy[q]);
                if (s > 0 && s <= 1) {
                  const X: [number, number] = [xy[q - 1][0] + (xy[q][0] - xy[q - 1][0]) * s, xy[q - 1][1] + (xy[q][1] - xy[q - 1][1]) * s];
                  if (Math.hypot(X[0] - xy[j][0], X[1] - xy[j][1]) > SEARCH_M) break;
                  for (let r = q; r <= j; r++) drop[r] = 1; // walkway tail + shared node
                  insBefore.set(q, X);
                  joined = true;
                  break;
                }
                acc += seg(q - 1);
              }
            }
          }
          if (!joined) {
            // group ENDS with a crossing piece — mirrored backward-extension
            // of the crossing's last segment to the street's offset polyline
            // the walkway's true last segment is (j-1 -> j): vertex j is the
            // shared node (its outgoing segment is the street). Extend that
            // segment FORWARD past the shared node to the street's offset
            // polyline — the corner sits on the virtual kerb.
            const cd0 = Math.hypot(xy[j][0] - xy[j - 1][0], xy[j][1] - xy[j - 1][1]);
            if (cd0 > 1e-6) {
              const wd: [number, number] = [(xy[j][0] - xy[j - 1][0]) / cd0, (xy[j][1] - xy[j - 1][1]) / cd0];
              let acc = 0;
              for (let k = j + 1; k < xy.length && (k <= j + 2 || t[k - 1] !== 0) && acc < 25; k++) {
                const dL = Math.hypot(xy[k][0] - xy[k - 1][0], xy[k][1] - xy[k - 1][1]);
                const tt = t[k - 1] !== 0 ? t[k - 1] : t[k];
                if (dL > 1e-6) {
                  const dv: [number, number] = [(xy[k][0] - xy[k - 1][0]) / dL, (xy[k][1] - xy[k - 1][1]) / dL];
                  const oa: [number, number] = [xy[k - 1][0] + dv[1] * tt, xy[k - 1][1] - dv[0] * tt];
                  const ob: [number, number] = [xy[k][0] + dv[1] * tt, xy[k][1] - dv[0] * tt];
                  const u = hit(xy[j], wd, oa, ob);
                  // 6 m projection before the boundary segment's start
                  if (Number.isFinite(u) && u <= 1 && (u >= 0 || (k === j + 1 && -u * dL <= 6))) {
                    const X: [number, number] = [oa[0] + (ob[0] - oa[0]) * u, oa[1] + (ob[1] - oa[1]) * u];
                    const s = (X[0] - xy[j][0]) * wd[0] + (X[1] - xy[j][1]) * wd[1];
                    if (s > 0 && Math.hypot(X[0] - xy[j][0], X[1] - xy[j][1]) <= 12) {
                      for (let r = j + 1; r <= k - 1; r++) drop[r] = 1; // street mouth
                      insBefore.set(k, X);
                      joined = true;
                      break;
                    }
                  }
                }
                acc += dL;
              }
            }
          }
          if (!joined) { // chord to the shared node: cut the group's last JOIN_M
            let d2 = 0, m2 = j - 1;
            while (m2 > i && d2 + seg(m2 - 1) < JOIN_M) { d2 += seg(m2 - 1); drop[m2] = 1; m2--; }
          }
        }
      }
      i = j;
    }
    const nx: [number, number][] = [], ntg: number[] = [], nhd: boolean[] = [], nlk: boolean[] = [];
    for (let m = 0; m < xy.length; m++) {
      const ins = insBefore.get(m);
      if (ins) { nx.push(ins); ntg.push(0); nhd.push(true); nlk.push(true); }
      const insS = insStreet.get(m);
      if (insS) { nx.push(insS[0]); ntg.push(insS[1]); nhd.push(false); nlk.push(false); }
      if (!drop[m]) { nx.push(xy[m]); ntg.push(t[m]); nhd.push(h[m]); nlk.push(false); }
    }
    xy.length = 0; for (const p of nx) xy.push(p);
    t.length = 0; for (const v of ntg) t.push(v);
    h.length = 0; for (const v of nhd) h.push(v);
    lk.length = 0; for (const v of nlk) lk.push(v);
  }
  // densify so ramps have vertices to live on (a straight 100 m street is
  // two vertices after simplification; the ramp must not span all of it) —
  // but never a transition chord (endpoint targets differ): the chord must
  // stay a straight two-vertex segment or its interior would be offset
  // along its own normal
  const dx: [number, number][] = [], dt: number[] = [], dh: boolean[] = [], dl: boolean[] = [];
  // A LONG segment with differing targets is not a chord but a whole street
  // edge whose boundary vertex was released to 0 (soft crossing head): with
  // two vertices the ramp spanned all 87 m of Bruchstraße and the line hit
  // the junction on the road's centre (2026-08-27). Densify those too,
  // carrying the offset inside so the slope limiter ramps at the node.
  const CHORD_MAX_M = 30;
  for (let i = 0; i < xy.length; i++) {
    const L = i > 0 ? Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]) : 0;
    const differ = i > 0 && t[i - 1] !== t[i];
    if (i > 0 && (!differ || L > CHORD_MAX_M)) {
      const n = Math.ceil(L / DENSIFY_M);
      const inner = differ ? (t[i - 1] !== 0 ? t[i - 1] : t[i]) : t[i - 1];
      for (let m = 1; m < n; m++) {
        const f = m / n;
        dx.push([xy[i - 1][0] + (xy[i][0] - xy[i - 1][0]) * f, xy[i - 1][1] + (xy[i][1] - xy[i - 1][1]) * f]);
        dt.push(inner);
        dh.push(h[i - 1]);
        dl.push(false);
      }
    }
    dx.push(xy[i]); dt.push(t[i]); dh.push(h[i]); dl.push(lk[i]);
  }
  const off = profile(dx, dt, dh, dl);
  const o = offsetProfile(dx, off);
  return roundCorners(o.map(([x, y]) => [x / mLng, y / mLat] as [number, number]));
}
