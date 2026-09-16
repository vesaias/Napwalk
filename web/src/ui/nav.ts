// What the Navigate screen shows (UI redesign Task 12, 2026-09-05).
//
// No turn instructions — those are deferred. What the walker gets instead
// is "how much of the next ten minutes is shaded", which needs the piece of
// the route still ahead of them: the nearest route node to the fix, the
// edges from there on, and the sun/shade ribbon over the first ten minutes
// of what is left.
//
// Every shade lookup uses the ARRIVAL time at its edge (CLAUDE.md rule 4):
// `atMin` is when the walker is at `gps`, and each edge adds its own walking
// time before the next one is read.
import type { LngLat } from "../components/MapView";
import type { Candidate } from "../plan/plan";
import { shadeAt, ShadePendingError, SPEED_M_PER_MIN } from "../router/astar";
import { sunMinutes } from "../plan/hours";
import { SHADE_PENDING, type Graph } from "../router/graph";
import { distanceM } from "./geo";

/** The strip covers this much of the walk ahead — the design's promise is
 *  about the "next 10 min", so the ribbon ends there. */
export const AHEAD_MIN = 10;
/** An edge counts as shaded when at least half of it is (same threshold as
 *  sunMinutes and the router's own shade term). */
const SHADED = 0.5;
/** How far the walker may be from the part of the route still ahead before
 *  the search is allowed to look behind them again. Inside this radius the
 *  forward answer always wins, which is what keeps a self-crossing loop from
 *  teleporting the walker onto the return leg; outside it, they are not on
 *  the rest of the walk at all (a shortcut, a detour, a fix that jumped) and
 *  the whole route is the honest place to look. */
export const BACKTRACK_M = 80;
/** Close enough to a node of the walk to be standing ON it, as far as a
 *  phone's fix can tell — the same street-crossing width `ARRIVED_M` uses,
 *  and for the same reason.
 *
 *  A loop comes back to where it started, so the last nodes of one sit a few
 *  metres from the first, and two laps of a circuit put every node of it
 *  twice within a stride of itself. When the fix is that near to more than
 *  one node, index alone can separate them, and the EARLIEST wins: progress
 *  only ratchets forward (`nearestNodeIdx`'s `minIdx`), so claiming too much
 *  of the walk is permanent while claiming too little corrects itself on the
 *  next fix that moves. */
export const ON_NODE_M = 30;

export type ShadeAhead = {
  /** Index into `cand.nodes` of the node the walker is standing nearest. */
  fromIdx: number;
  /** The edges still to walk, from that node on. */
  remainingEids: number[];
  remainingM: number;
  remainingMin: number;
  /** Minutes of the whole remaining walk spent in the sun. */
  sunMin: number;
  /** The ShadeStrip's blocks over the next AHEAD_MIN minutes, adjacent
   *  edges of the same kind merged into one block. */
  segments: { shade: boolean; m: number }[];
};

/** The node of the walk at or after `from` the fix is standing on, and how
 *  far the fix is from the nearest node in that range.
 *
 *  `i` is the FIRST node within `ON_NODE_M` when there is one, not the
 *  closest: on a loop the fix at the start is a few metres from the return
 *  leg as well, and the closest node of the two can be the last one, which
 *  reads the walk as already over (B18). Only when nothing is that near —
 *  the walker is between nodes, or off the line — does the plain nearest
 *  node answer, which is what keeps two neighbours 100 m apart rounding to
 *  the nearer of them.
 *
 *  `d` is always the true minimum over the range: it measures how far the
 *  walker is from the walk, which is what `BACKTRACK_M` asks about. */
function nearestFrom(g: Graph, nodes: number[], gps: LngLat, from: number): { i: number; d: number } {
  let best = from;
  let bestD = Infinity;
  let onNode = -1;
  for (let i = from; i < nodes.length; i++) {
    const n = nodes[i];
    const d = distanceM(gps, [g.lng[n], g.lat[n]]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
    if (onNode < 0 && d <= ON_NODE_M) onNode = i;
  }
  return { i: onNode >= 0 ? onNode : best, d: bestD };
}

/** The node of the route the fix is closest to. Linear over the route's
 *  nodes — a city walk is a few hundred of them, once per fix.
 *
 *  `minIdx` is how far along the walker is already known to be. A loop comes
 *  back through streets it has already used (Wander's whole point), so the
 *  plain nearest node would put a walker on the home leg back at the start
 *  and report the walk as barely begun. Searching from the last known index
 *  on fixes that — and BACKTRACK_M keeps it from sticking: someone who is
 *  nowhere near the rest of the walk gets the whole route searched again.
 *
 *  With no progress yet (`minIdx` 0) the whole loop is in range and the
 *  walker is standing on its first node AND its last: `nearestFrom` breaks
 *  that by index, not by metres (ON_NODE_M). */
export function nearestNodeIdx(g: Graph, nodes: number[], gps: LngLat, minIdx = 0): number {
  if (nodes.length === 0) return 0;
  const from = Math.min(Math.max(0, minIdx), nodes.length - 1);
  const fwd = nearestFrom(g, nodes, gps, from);
  if (from === 0 || fwd.d <= BACKTRACK_M) return fwd.i;
  const all = nearestFrom(g, nodes, gps, 0);
  return all.d < fwd.d ? all.i : fwd.i;
}

/** The walk still ahead of a fix, and its first ten minutes as a ribbon.
 *  An empty candidate (or a walker past the last node) yields an empty
 *  strip, which ShadeStrip renders as nothing rather than as a lie.
 *
 *  NULL when a minute of the walk ahead cannot be priced yet: since v8 the
 *  shade arrives in bands, and `SHADE_PENDING` is −1, which is not `>=
 *  SHADED` — so a pending edge used to be drawn as SUNNY and counted into
 *  "X min in sun" (S8 review F7). `useWalk` already renders null as "the
 *  strip stays as it was", which is the honest answer. */
export function shadeAhead(
  g: Graph,
  cand: Pick<Candidate, "eids" | "nodes">,
  gps: LngLat,
  atMin: number,
  /** How far along the walk the walker is already known to be. */
  minIdx = 0
): ShadeAhead | null {
  const fromIdx = cand.nodes.length > 0 ? nearestNodeIdx(g, cand.nodes, gps, minIdx) : 0;
  const remainingEids = cand.eids.slice(Math.min(fromIdx, cand.eids.length));

  let remainingM = 0;
  for (const eid of remainingEids) remainingM += g.lenDm[eid] / 10;

  const budgetM = AHEAD_MIN * SPEED_M_PER_MIN;
  const segments: { shade: boolean; m: number }[] = [];
  let walked = 0;
  for (const eid of remainingEids) {
    if (walked >= budgetM) break;
    const len = g.lenDm[eid] / 10;
    // the walker reaches this edge `walked` metres from now
    const sh = shadeAt(g, eid, atMin + walked / SPEED_M_PER_MIN);
    if (sh === SHADE_PENDING) return null;
    const shade = sh >= SHADED;
    const m = Math.min(len, budgetM - walked);
    const last = segments[segments.length - 1];
    if (last && last.shade === shade) last.m += m;
    else segments.push({ shade, m });
    walked += len;
  }
  // ...and `sunMinutes` prices the WHOLE remaining walk, which can reach
  // past the bands the strip needed: it throws rather than counting a
  // pending edge as sun, and this is the one caller that would rather say
  // nothing than raise (S8 review F7).
  let sunMin: number;
  try {
    sunMin = sunMinutes(g, remainingEids, atMin);
  } catch (e) {
    if (e instanceof ShadePendingError) return null;
    throw e;
  }
  return {
    fromIdx,
    remainingEids,
    remainingM,
    remainingMin: Math.round(remainingM / SPEED_M_PER_MIN),
    sunMin,
    segments,
  };
}

// --- where the walker is relative to the line, and where they are pointed --
// (compact rework slice 5, 2026-09-07). Two questions the walk asks that the
// nearest NODE cannot answer: a walker halfway along a 200 m block is 100 m
// from both its ends and perfectly on route, so "off route" has to be
// measured against the polyline itself; and the camera wants the direction
// the route runs from that point, not the direction to a node behind it.

/** Metres from the route's line beyond which the walker is not on it. */
export const OFF_ROUTE_M = 40;
/** ...and how long they have to stay there before the walk is replanned.
 *  A fix that jumps a block and comes straight back is a fix, not a detour
 *  (HANDOVER §6.2). */
export const OFF_ROUTE_MS = 10_000;

/** Close enough to a node that the segment ENDING there says nothing about
 *  where the walk goes next: take the following segment's heading instead. */
const AT_NODE_M = 5;

const RAD = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;

/** Initial bearing from `a` to `b`, degrees clockwise from north — what
 *  MapLibre's camera calls `bearing`. */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = [a[0] * RAD, a[1] * RAD];
  const [lng2, lat2] = [b[0] * RAD, b[1] * RAD];
  const dLng = lng2 - lng1;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) / RAD) % 360 + 360) % 360;
}

export type OnPath = {
  /** The nearest point on the route's line to the fix. */
  at: LngLat;
  /** How far the fix is from it, in metres. */
  offM: number;
  /** Where the route runs from there, degrees from north. */
  bearing: number;
};

/** How far a fix is from a plain polyline, in metres — the same
 *  point-to-segment maths `onPath` runs over the graph's nodes, for the
 *  pieces of the drawn walk that are NOT nodes: the dashed connector from
 *  the walker's pin to the point it snapped to, and the head/tail stubs
 *  along the first and last edges (plan.ts, mapData.ts `selectedLineOf`).
 *  Infinity for a polyline with fewer than two points. */
export function polylineOffM(pts: LngLat[], gps: LngLat): number {
  if (pts.length === 0) return Infinity;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos(gps[1] * RAD);
  let best = Infinity;
  if (pts.length === 1) return distanceM(gps, pts[0]);
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = (pts[i][0] - gps[0]) * mPerDegLng;
    const ay = (pts[i][1] - gps[1]) * M_PER_DEG_LAT;
    const bx = (pts[i + 1][0] - gps[0]) * mPerDegLng;
    const by = (pts[i + 1][1] - gps[1]) * M_PER_DEG_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  return best;
}

/** The nearest point on the walk's own line, and the heading of the segment
 *  it falls on. Searched from one node behind the walker's known progress
 *  (nav's `fromIdx`) to the end, so a loop's return leg counts as route and
 *  the segment just walked still catches a fix that lags a corner.
 *
 *  `drawn` carries the parts of the line that are not routing nodes — the
 *  connector and the head/tail stubs. They belong in `offM` because they are
 *  what the walker SEES on the map: a fix 60 m from the nearest edge is
 *  standing on its own connector, not off the route (fix round 1, B-1).
 *  The heading is still the route's, never the connector's.
 *
 *  Null for a route with fewer than two nodes: there is no line to be off. */
export function onPath(
  g: Graph,
  nodes: number[],
  gps: LngLat,
  fromIdx = 0,
  drawn: LngLat[][] = []
): OnPath | null {
  if (nodes.length < 2) return null;
  // one flat metre grid around the fix — a walk is a kilometre or two, and
  // over that the error of treating degrees as metres is centimetres
  const mPerDegLng = M_PER_DEG_LAT * Math.cos(gps[1] * RAD);
  const x = (lng: number) => (lng - gps[0]) * mPerDegLng;
  const y = (lat: number) => (lat - gps[1]) * M_PER_DEG_LAT;

  let bestD = Infinity;
  let bestSeg = 0;
  let bestT = 0;
  const first = Math.min(Math.max(0, fromIdx - 1), nodes.length - 2);
  for (let i = first; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const ax = x(g.lng[a]);
    const ay = y(g.lat[a]);
    const bx = x(g.lng[b]);
    const by = y(g.lat[b]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.hypot(px, py);
    if (d < bestD) {
      bestD = d;
      bestSeg = i;
      bestT = t;
    }
  }

  const a = nodes[bestSeg];
  const b = nodes[bestSeg + 1];
  const at: LngLat = [
    g.lng[a] + (g.lng[b] - g.lng[a]) * bestT,
    g.lat[a] + (g.lat[b] - g.lat[a]) * bestT,
  ];
  const next: LngLat = [g.lng[b], g.lat[b]];
  // standing on the node the segment ends at: the heading that matters is
  // the one after the corner, not the one into it
  const after = nodes[bestSeg + 2];
  const head =
    after !== undefined && distanceM(at, next) < AT_NODE_M
      ? bearingDeg(next, [g.lng[after], g.lat[after]])
      : bearingDeg(at, next);

  let offM = bestD;
  for (const line of drawn) offM = Math.min(offM, polylineOffM(line, gps));

  return { at, offM, bearing: head };
}

/** One reading of how far the walker was from the line, and when. */
export type OffSample = { t: number; m: number };

/** Has the walker been off the route long enough to earn a new one?
 *
 *  Pure, and deliberately strict: the run of readings beyond OFF_ROUTE_M has
 *  to be unbroken and to span OFF_ROUTE_MS. One reading back on the line
 *  starts the clock again, so a fix that bounces off a building never
 *  replans a walk that is going fine. */
export function offRoute(samples: OffSample[]): boolean {
  const last = samples[samples.length - 1];
  if (last === undefined) return false;
  let since: number | null = null;
  for (const s of samples) {
    if (s.m > OFF_ROUTE_M) since ??= s.t;
    else since = null;
  }
  return since !== null && last.t - since >= OFF_ROUTE_MS;
}
