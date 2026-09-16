// Time-dependent A* over the client graph (SPEC §6).
//
// rate(edge, t) = 1 − wGreen·green            (green is a DISCOUNT, ORS-style:
//                                              parks pull the route, they are
//                                              not merely less-penalized streets)
//               + wShade·(1 − shade(t))       (shade = shadier sidewalk of the two;
//                                              sunshine differs per street side)
//               + wNoise·noiseCurve(noise)    (nonlinear: quiet classes ~free,
//                                              loud ones hurt quadratically)
//               + wSurface·surface + extra
// cost = length · rate. Minimum rate is (1 − wGreen), so the straight-line
// heuristic scaled by that bound stays admissible under time-varying costs.
// tArrival is the clock time the walker REACHES the edge (CLAUDE.md rule 4).
import { SHADE_PENDING, shadeByte, type Graph } from "./graph";

/** Accessibility mode (docs/accessibility-modes.md, 2026-08-27). Rides on
 *  the Preset so every caller (route, loops, psp) inherits it. */
export type Access = "wheelchair" | "stroller" | "walk";
/** When the sun is up on the day being planned, in minutes since midnight.
 *  Plain numbers on purpose: the router computes no astronomy and imports no
 *  `ui/` — `ui/useSunDay.ts` reads the city's sun and passes this down. */
export type Daylight = { sunriseMin: number; sunsetMin: number };

export type Preset = {
  wShade: number;
  wNoise: number;
  wSurface: number;
  wGreen: number; // discount, must stay < 1
  access?: Access; // default stroller
  /** The day's daylight, for minutes the artifact's shade buckets do not
   *  cover (`lerpShade`). It rides on the preset because the preset is
   *  already everything `edgeCost` needs besides the graph and the minute —
   *  `access` is a fact about the walker rather than a weight in the same
   *  way. Absent, dawn and dusk price as night, which is what shipped. */
  day?: Daylight;
};
/** stroller vs plain steps: heavy penalty, not a wall (V. 2026-08-27) */
export const STEPS_STROLLER_M = 400;
/** stroller over a raised kerb (> 7 cm): small penalty (V. 2026-08-27) */
export const KERB_STROLLER_M = 75;
export const PRESETS: Record<string, Preset> = {
  balanced: { wShade: 1.5, wNoise: 1.5, wSurface: 2.0, wGreen: 0.6 },
  maxShade: { wShade: 3.5, wNoise: 0.8, wSurface: 2.0, wGreen: 0.4 },
  maxQuiet: { wShade: 0.0, wNoise: 3.0, wSurface: 2.0, wGreen: 0.6 }, // cloudy-day mode
};

/** Walking speed in m/min. A `let` so the pace setting can change it at
 *  runtime; importers use the named import and see the update through
 *  the ES live binding (Task 4, 2026-09-05). Default 4 km/h (SPEC). */
export let SPEED_M_PER_MIN = 4000 / 60;
export function setSpeedKmh(kmh: number): void {
  SPEED_M_PER_MIN = (kmh * 1000) / 60;
}
// window comes from the artifact header (seasonal since v7, 2026-08-28)

export type RouteLeg = {
  nodes: number[];
  eids: number[];
  meters: number;
  cost: number;
};

/** Thrown when a cost is asked for a minute whose shade band has not been
 *  downloaded (artifact v8, backlog B11).
 *
 *  It is an assertion, not a control path: `usePlanner` waits on
 *  `bandsReady` before it plans, and `plan/hours.ts` asks per hour and draws
 *  a skeleton for the hours it cannot price. Nothing may catch this and
 *  carry on with a substituted shade value — that is CLAUDE.md rule 4. */
export class ShadePendingError extends Error {
  eid: number;
  minuteOfDay: number;
  constructor(eid: number, minuteOfDay: number) {
    super(`shade band for minute ${Math.round(minuteOfDay)} is not loaded (edge ${eid})`);
    this.name = "ShadePendingError";
    this.eid = eid;
    this.minuteOfDay = minuteOfDay;
  }
}

function lerpShade(
  g: Graph,
  eid: number,
  minuteOfDay: number,
  day?: Daylight
): number {
  const nB = g.buckets;
  // Buckets cover daylight only (10_sun_shade refuses a sun below the
  // horizon). Before the first or after the last, the sun is down and
  // everything is shaded — clamping to the edge bucket instead would route a
  // 22:00 walk against the evening sun (2026-08-28).
  //
  // ...but the window is the EXPORT DAY's daylight, not the selected day's,
  // and the two come apart by more than an hour over a year: Frankfurt's
  // artifact was exported in late August and runs 06:30-20:30, while in June
  // the sun is up from 05:25. Without `day` every minute in the gap read as
  // full shade, so the leave-at strip drew a fabricated 100 % bar at each end
  // of June and `bestHour` recommended it ("Best: 05:00 - 100 % shade",
  // measured 2026-09-09). With the day's real sunrise and sunset in hand the
  // rule splits in two: the sun is DOWN -> 1, as before; the sun is UP but
  // the artifact does not price this minute -> the nearest edge bucket, i.e.
  // dawn is priced like the earliest morning the export knows and dusk like
  // its latest evening. That is an approximation and it is the honest one
  // available client-side — the true fix is to export the whole year's
  // daylight span (docs/BACKLOG.md B14).
  const last = g.bucketStartMin + g.bucketStepMin * (nB - 1);
  let m = minuteOfDay;
  if (m < g.bucketStartMin || m > last) {
    if (day === undefined || m < day.sunriseMin || m > day.sunsetMin) return 1;
    m = m < g.bucketStartMin ? g.bucketStartMin : last;
  }
  const b = (m - g.bucketStartMin) / g.bucketStepMin;
  const b0 = Math.max(0, Math.min(nB - 1, Math.floor(b)));
  const b1 = Math.min(nB - 1, b0 + 1);
  const f = Math.max(0, Math.min(1, b - b0));
  // Since v8 the buckets live in bands that arrive separately, and a bucket
  // whose band is not in yet has NO value — not a stale one, not a
  // neighbour's. Either both bytes are here or the answer is "ask again once
  // the band lands" (SHADE_PENDING). A v7 graph is one band that is always
  // loaded, so this reads exactly as it did.
  const s0 = shadeByte(g.shade, eid, b0);
  const s1 = b1 === b0 ? s0 : shadeByte(g.shade, eid, b1);
  if (s0 === SHADE_PENDING || s1 === SHADE_PENDING) return SHADE_PENDING;
  return (s0 * (1 - f) + s1 * f) / 255;
}

/** Shade fraction 0..1 of the SHADIER sidewalk of an edge at a clock time.
 *  The walker picks the shady side; direction of travel does not change
 *  which side is shady, so the max side is the right number for routing.
 *
 *  `day` is the SELECTED day's daylight, in plain minutes since midnight —
 *  the router never imports `ui/`, so the caller reads the sun and hands the
 *  two numbers over (plan/hours.ts, ui/usePlanner.ts). Without it a minute
 *  the artifact cannot price reads as fully shaded, which is right at night
 *  and wrong at dawn. */
export function shadeAt(g: Graph, eid: number, minuteOfDay: number, day?: Daylight): number {
  return lerpShade(g, eid, minuteOfDay, day);
}

/** `shadeAt`, but loud rather than pending: every caller that PRICES
 *  something goes through this, so a missing band can never be quietly
 *  averaged into a route's cost or a card's shade percentage.
 *
 *  The planner never reaches it — it waits on `bandsReady` first — which is
 *  the point: if this ever throws, the gate is missing, and a thrown error
 *  is the only way to find that out. */
export function shadeAtOrThrow(g: Graph, eid: number, minuteOfDay: number, day?: Daylight): number {
  const s = lerpShade(g, eid, minuteOfDay, day);
  if (s === SHADE_PENDING) throw new ShadePendingError(eid, minuteOfDay);
  return s;
}

/** Noise 0..1 (linear in LDEN class) -> cost term 0..1, ORS-shaped:
 *  up to ~55 dB (urban ambient; park interiors sit at 3.3 in the LDEN
 *  raster) is free, then quadratic to 1 at >= 75 dB.
 *  noiseQ/255 = meanClass/8; class 4 (55-59 dB) is the knee. */
export function noiseCurve(noise01: number): number {
  const knee = 4 / 8;
  if (noise01 <= knee) return 0;
  const x = (noise01 - knee) / (1 - knee);
  return x * x;
}

/** Lower bound of the cost rate under a preset — for the A* heuristic. */
export function minRate(p: Preset): number {
  return Math.max(0.05, 1 - p.wGreen);
}

/** Walking on the carriageway of a street that HAS a mapped sidewalk
 *  (flags bit1): the sidewalk edge is the pedestrian's way, the road is
 *  only for crossing — a short penalised hop (2026-08-17). */
// 4 was too mild: at Jean-Paul-Straße/Ginnheim the router paid 9 m of
// carriageway (36) to shortcut a junction mouth instead of the two zebras
// around the corner (2026-08-19). With a mapped sidewalk the carriageway is
// not for walking, full stop.
export const CARRIAGEWAY_PENALTY = 12;
/** ...and on a MAJOR road (flags bit5) with a mapped sidewalk: 20/m — a
 *  four-lane road is not for walking between crossings. */
export const MAJOR_CARRIAGEWAY_PENALTY = 20;
/** Cost of a street crossing (flags bit2), in metres-equivalent: people
 *  stick to their side unless the other side pays for it (2026-08-17).
 *  Charged per ~15 m of crossing pieces, so a marked crossing split into
 *  kerb/island/kerb pieces costs about one crossing, not three — else the
 *  informal junction hop (one piece) beat every marked crossing (2026-08-18). */
export const CROSSING_M = 150;
export const CROSSING_LEN_M = 15;
/** A cycle crossing (flags bit6) is a bike crossing, not a zebra: walkable,
 *  but at this multiple of the crossing cost, so a signalled zebra 20 m
 *  away wins (Eschersheimer/Bremer 2026-08-18). */
export const CYCLE_CROSSING_FACTOR = 4;
/** A jaywalk link (bits 0+2+6): a street piece crossing its OWN street's
 *  other carriageway at a fork/split — no crosswalk exists there. Priced
 *  far above a real crossing so a signalled crossing a block away wins
 *  (Hügelstraße fork 36877720, 2026-08-20). Finite: sometimes it is the
 *  only link. */
export const JAYWALK_FACTOR = 15;
/** A street tagged sidewalk=no on both sides (flags bit7 with bit0): the
 *  walker is on the carriageway itself — small extra rate so a parallel
 *  path wins when one exists (side-aware model 2026-08-18). Car-free roads
 *  carry bit7 without bit0 and stay free. */
// 0 since 2026-08-20: many sidewalk=no streets are quiet lanes along green
// areas — walking them is normal, the tag is not a hazard signal. Drawing
// still hugs the road edge (1 m).
export const NO_SIDEWALK_PENALTY = 0;
/** A pure cycleway stretch (flags bit6 without bit2): a signed Radweg is
 *  not a walkway — a parallel sidewalk must always win (Platenstraße,
 *  2026-08-19). Still walkable when it is the only link. */
export const CYCLEWAY_PENALTY = 15; // "do not allow or way more penalty" (2026-08-19); stays finite so a cycleway-only link keeps the graph connected
/** An explicitly mapped crosswalk (bit2 with bit3): footway=crossing /
 *  traffic_island in OSM — an organized place to cross. Discounted below
 *  an inferred crossing so the zebra 30 m away beats an informal junction
 *  cut (Oeder Weg / Eschenheimer Tor, 2026-08-21). */
export const MARKED_CROSSING_FACTOR = 0.6;

export function edgeCost(
  g: Graph,
  eid: number,
  tArrivalMin: number,
  p: Preset,
  extra: number
): number {
  const len = g.lenDm[eid] / 10;
  const rate =
    1 -
    p.wGreen * (g.greenQ[eid] / 255) +
    p.wShade * (1 - shadeAtOrThrow(g, eid, tArrivalMin, p.day)) +
    p.wNoise * noiseCurve(g.noiseQ[eid] / 255) +
    p.wSurface * (g.surfaceQ[eid] / 255) +
    // a street piece that IS a crossing (bits 0+2) is crossed, not walked
    // along — charging the carriageway rate on top of the crossing cost
    // double-billed junction mouths (Kaiserstraße 2026-08-22: a 60 m trip
    // became a 700 m detour to Kaiserplatz)
    ((g.flags[eid] & 2) !== 0 && (g.flags[eid] & 4) === 0 ? ((g.flags[eid] & 32) !== 0 ? MAJOR_CARRIAGEWAY_PENALTY : CARRIAGEWAY_PENALTY) : 0) +
    extra;
  const flags = g.flags[eid];
  // sidewalk=no street (bit7 with bit0): walking the carriageway itself
  const nsw = ((flags & 128) !== 0 && (flags & 1) !== 0 ? NO_SIDEWALK_PENALTY : 0)
    + ((flags & 64) !== 0 && (flags & 4) === 0 ? CYCLEWAY_PENALTY : 0);
  // crossing cost is proportional to crossing length (CROSSING_M per
  // CROSSING_LEN_M), NOT capped per piece: OSM chops one zebra into 3-6
  // pieces at islands/kerbs, and a per-piece cap made a chopped zebra cost
  // twice an unchopped one (Heinestraße vs Vogtstraße, 2026-08-18)
  // an INFERRED street-piece crossing (bits 0+2, not marked, not jaywalk)
  // spans OSM's junction geometry, not the roadway width — you cross the
  // street once whatever the piece length. Cap its effective length at
  // 1.5 crossings (Kaiserstraße mouth: 36 m billed as 2.4 crossings).
  const xlen = (flags & 4) !== 0 && (flags & 1) !== 0 && (flags & 64) === 0 && (flags & 8) === 0
    ? Math.min(len, 1.5 * CROSSING_LEN_M) : len;
  const base = len * (rate + nsw) + ((flags & 4) !== 0 ? CROSSING_M * (xlen / CROSSING_LEN_M) * ((flags & 64) !== 0 ? ((flags & 1) !== 0 ? JAYWALK_FACTOR : CYCLE_CROSSING_FACTOR) : (flags & 8) !== 0 ? MARKED_CROSSING_FACTOR : 1) : 0);
  // --- accessibility mode (flags2 bits: 1 steps, 2 stroller ramp, 4 wheelchair
  // ramp, 8 kerb>7cm, 16 wc-block, 32 limited, 64 hard, 128 rough) ---
  const a = p.access ?? "stroller";
  const f2 = g.acc[eid];
  const sl = Math.abs(g.slope[eid]) / 2; // percent
  const up = g.slope[eid] > 0;
  let mult = 1;
  let fixed = 0;
  if (a === "wheelchair") {
    if ((f2 & 1) !== 0 && (f2 & 4) === 0) return Infinity; // steps without a wheelchair ramp
    if ((f2 & (8 | 16 | 64 | 128)) !== 0) return Infinity; // raised kerb, wheelchair=no, hard, rough
    if (sl > 8) return Infinity;
    if ((f2 & 4) !== 0) mult *= 1.5;
    if ((f2 & 32) !== 0) mult *= 3;
    if (g.surfaceQ[eid] >= 150) mult *= 2.5; // sett / cobble grade
    if (sl > 6) mult *= 3;
    else if (sl > 3) mult *= up ? 1.5 : 1.2;
  } else if (a === "stroller") {
    if ((f2 & 64) !== 0) return Infinity;
    // slope never walls a stroller off (DTM noise at underpasses/ramps would
    // cut the graph); it just gets very expensive
    if (sl > 20) mult *= 6;
    if ((f2 & 1) !== 0) {
      if ((f2 & 4) !== 0) { /* wheelchair ramp: free */ }
      else if ((f2 & 2) !== 0) mult *= 1.5;
      else { mult *= 3; fixed += STEPS_STROLLER_M; }
    }
    if ((f2 & 8) !== 0) fixed += KERB_STROLLER_M;
    if ((f2 & 16) !== 0) mult *= 2;
    if ((f2 & 32) !== 0) mult *= 1.2;
    if ((f2 & 128) !== 0) mult *= 2.5;
    if (sl > 12) mult *= 4;
    else if (sl > 8) mult *= 2.5;
    else if (sl > 6) mult *= 1.5;
  } else {
    if ((f2 & 1) !== 0) mult *= 3; // ~ per-step cost at 0.3 m/step
    if ((f2 & 64) !== 0) mult *= 2;
  }
  return base * mult + fixed;
}

// binary min-heap over (f, node); arrays reused across calls
class Heap {
  keys = new Float64Array(1024);
  vals = new Int32Array(1024);
  size = 0;
  push(key: number, val: number) {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      k.set(this.keys);
      this.keys = k;
      const v = new Int32Array(this.size * 2);
      v.set(this.vals);
      this.vals = v;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.keys[i] = this.keys[parent];
      this.vals[i] = this.vals[parent];
      i = parent;
    }
    this.keys[i] = key;
    this.vals[i] = val;
  }
  pop(): number {
    const top = this.vals[0];
    const key = this.keys[--this.size];
    const val = this.vals[this.size];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= this.size) break;
      const r = l + 1;
      const c = r < this.size && this.keys[r] < this.keys[l] ? r : l;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c];
      this.vals[i] = this.vals[c];
      i = c;
    }
    this.keys[i] = key;
    this.vals[i] = val;
    return top;
  }
}

// per-search scratch, epoch-versioned so no clearing between runs
let scratchN = 0;
let gCost: Float64Array;
let gLen: Float64Array;
let cameEdge: Int32Array;
let seen: Int32Array;
let closed: Int32Array;
let epoch = 0;

function ensureScratch(n: number) {
  if (n > scratchN) {
    scratchN = n;
    gCost = new Float64Array(n);
    gLen = new Float64Array(n);
    cameEdge = new Int32Array(n);
    seen = new Int32Array(n);
    closed = new Int32Array(n);
    epoch = 0;
  }
}

/** Turn costs (edge-state router, docs/turn-router.md, 2026-08-21).
 *  Nothing is charged at a node with crossing infrastructure — the
 *  crossing edges themselves price it. */
export const CONT_DEG = 20; // a street edge this close to straight IS the continuation
export const TURN_MARGIN_DEG = 5; // e2 must be this much bendier than it to be a cut
/** T1: taking a carriageway walk although a meaningfully straighter
 *  street option existed — the walker cuts a junction mouth (Oeder Weg /
 *  Eschenheimer Tor). About half an unmarked crossing. */
export const TURN_CARRIAGEWAY_M = 60;
/** T2: passing through an uncontrolled node that lies ON a major road
 *  while not walking that road — the move crosses its carriageway for
 *  free in the node graph (Bertramstraße / Adickesallee). About one
 *  unmarked crossing. */
export const UNCONTROLLED_MAJOR_M = 150;
const COS_CONT = Math.cos((CONT_DEG * Math.PI) / 180);
const MARGIN_RAD = (TURN_MARGIN_DEG * Math.PI) / 180;

export function turnCost(g: Graph, e1: number, e2: number): number {
  const n = g.edgeTarget[e1];
  if (g.nodeXing[n]) return 0;
  const f1 = g.flags[e1];
  const f2 = g.flags[e2];
  let cost = 0;
  // T1 — e2 is a carriageway walk (street with its sidewalk mapped away)
  // taken although a MEANINGFULLY STRAIGHTER street option existed: the
  // walker abandons the natural continuation to cut a junction mouth.
  // OSM way/name identity cannot express "same street" (Oeder Weg's
  // carriageway is three ways, its spur shares the name), so the natural
  // continuation is defined geometrically: the straightest street edge
  // out of the node, if it deviates < CONT_DEG. Way splits and genuine
  // forks (both options equally bent) stay free.
  if ((f2 & 3) === 3) {
    const my = g.exDx[e1] * g.enDx[e2] + g.exDy[e1] * g.enDy[e2];
    let best = -2;
    for (let k = g.firstEdge[n]; k < g.firstEdge[n + 1]; k++) {
      if (k === e2 || k === g.revEdge[e1] || (g.flags[k] & 1) === 0) continue;
      const dot = g.exDx[e1] * g.enDx[k] + g.exDy[e1] * g.enDy[k];
      if (dot > best) best = dot;
    }
    if (best > COS_CONT &&
        Math.acos(Math.min(1, Math.max(-1, my))) >
        Math.acos(Math.min(1, Math.max(-1, best))) + MARGIN_RAD)
      cost += TURN_CARRIAGEWAY_M;
  }
  // T2 — through-move on a major-road node while not walking the major
  if (g.nodeMajor[n] && (f1 & 32) === 0 && (f2 & 32) === 0) cost += UNCONTROLLED_MAJOR_M;
  return cost;
}

export function route(
  g: Graph,
  from: number,
  to: number,
  startMin: number,
  preset: Preset,
  extraCost?: (eid: number) => number
): RouteLeg | null {
  if (from === to) return { nodes: [from], eids: [], meters: 0, cost: 0 };
  // A* over DIRECTED EDGES (the state is the edge the walker is on), so
  // relaxation sees the previous edge and can price turns.
  ensureScratch(g.nEdges);
  epoch++;
  const heap = new Heap();
  const tx = g.x[to];
  const ty = g.y[to];
  // admissible: straight-line meters × the lowest rate any edge can have
  const hScale = minRate(preset);
  const h = (n: number) => hScale * Math.hypot(g.x[n] - tx, g.y[n] - ty);
  for (let k = g.firstEdge[from]; k < g.firstEdge[from + 1]; k++) {
    const c0 = edgeCost(g, k, startMin, preset, extraCost ? extraCost(k) : 0);
    if (!Number.isFinite(c0)) continue;
    seen[k] = epoch;
    gCost[k] = c0;
    gLen[k] = g.lenDm[k] / 10;
    cameEdge[k] = -1;
    heap.push(gCost[k] + h(g.edgeTarget[k]), k);
  }
  let goal = -1;
  while (heap.size > 0) {
    const e1 = heap.pop();
    if (closed[e1] === epoch) continue;
    closed[e1] = epoch;
    const u = g.edgeTarget[e1];
    if (u === to) { goal = e1; break; }
    const t = startMin + gLen[e1] / SPEED_M_PER_MIN;
    const first = g.firstEdge[u];
    const last = g.firstEdge[u + 1];
    for (let k = first; k < last; k++) {
      // no instant U-turn unless the node is a dead end
      if (k === g.revEdge[e1] && last - first > 1) continue;
      const c = edgeCost(g, k, t, preset, extraCost ? extraCost(k) : 0) + turnCost(g, e1, k);
      if (!Number.isFinite(c)) continue; // excluded in this accessibility mode
      const ng = gCost[e1] + c;
      if (seen[k] !== epoch || ng < gCost[k]) {
        seen[k] = epoch;
        gCost[k] = ng;
        gLen[k] = gLen[e1] + g.lenDm[k] / 10;
        cameEdge[k] = e1;
        heap.push(ng + h(g.edgeTarget[k]), k);
      }
    }
  }
  if (goal === -1) return null;
  const eids: number[] = [];
  for (let e = goal; e !== -1; e = cameEdge[e]) {
    eids.push(e);
    if (eids.length > g.nEdges) throw new Error("path reconstruction loop");
  }
  eids.reverse();
  const nodes: number[] = [g.edgeSource[eids[0]]];
  for (const e of eids) nodes.push(g.edgeTarget[e]);
  return { nodes, eids, meters: gLen[goal], cost: gCost[goal] };
}
