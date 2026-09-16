// Composer: "go to a nice park, do n laps of a known-good circuit, come
// home." Circuits come precomputed from the artifact (pipeline/14_circuits:
// planar faces + park outlines, scored, human-vetoed). The runtime only
// decides WHICH circuit, HOW MANY laps, and the way there and back.
//
//   walk = approach (start -> circuit node) + n × circuit [+ link + circuit] + return
//
// Objective (2026-08-15, after Miquelanlage/Sinaipark feedback): NOT mean
// cost per meter — averages reward bland short walks to tiny pockets. A
// walk is scored by what it CONTAINS (arc-orienteering view):
//
//   value = parkShare · parkQuality            (time in a real park, how good)
//         − approachBadness · approachShare    (how unpleasant the way there)
//         − lapPenalty(laps, circuit/target)   (laps of a SMALL circuit are
//                                               silly; laps of a big one fine)
//         − lengthMiss                         (fit to the requested duration)
//
// parkQuality comes from the catalog (roundness, green, quiet, surface,
// size) with the walker's shade preference at the arrival hour. Tours are
// limited to two ADJACENT circuits (a legible figure-eight), never chains
// through the park interior. Cards = distinct walks, at most two per park.
import { edgeCost, minRate, route, shadeAtOrThrow, SPEED_M_PER_MIN, type Preset } from "./astar";
import type { Circuit, Graph } from "./graph";
import { boundedDijkstra, pathFromParents, type Loop } from "./psp";

// Small rings need many laps to make a walk: a 312 m circuit is 8 laps of a
// 30-minute walk. lapPen already discounts repeats of a small circuit, so the
// cap only has to stop the absurd (Viktor, 2026-08-29: "you can make nice 10
// laps there").
const MAX_LAPS = 10;
const MIN_PARK_SHARE = 0.35; // below this it is an errand, not a park walk
const DIVERSITY_SLACK = 0.3; // a walk this much worse than the best is not worth a card just for variety
const PARK_Q = Math.round(0.78 * 255); // an edge this green counts as park (same as the catalog's pockets)
const PROMENADE_KEY = 200_000; // + turning node: candidate key space for out-and-back walks

/** Composer weights. Mutable so the ?debug panel can tune them live; the
 *  values here are the shipped defaults. */
export type ComposerKnobs = {
  wLength: number;   // fit to the requested duration
  wApproach: number; // unpleasant way there (Miquelanlage motorway junction must lose, 2026-08-15)
  lapBase: number;   // per extra lap, scaled by circuit smallness; mild — laps of a nice park are fine
  wIq: number;       // roundness of the circuit (tiebreak: every circuit is a simple cycle)
  wSize: number;     // bigger loop, fewer laps wins over a rounder one lapped 4x
  wStreet: number;   // share of the circuit on rim streets — not "in the park"
  outBack: number;   // fixed penalty for a there-and-back walk: fine when no ring exists, a ring wins otherwise
};
export const COMPOSER_DEFAULTS: ComposerKnobs = {
  wLength: 1.2, wApproach: 0.9, lapBase: 0.05, wIq: 0.2, wSize: 0.2, wStreet: 1.2, outBack: 0.75,
};
export const KNOBS: ComposerKnobs = { ...COMPOSER_DEFAULTS };

export type WalkKind = "laps" | "eight" | "promenade";
export type Walk = Loop & { circuit: number; laps: number; park: number; kind: WalkKind };

/** Score breakdown, kept on candidates for the ?debug probe. */
export type Scored = Walk & {
  score: number;
  quality: number;
  parkShare: number;
  appBad: number;
  lapPen: number;
  lenMiss: number;
  street: number;
  circuitLen: number;
};

/** the twin edge v->u of e = u->v, or -1 (all pipeline edges have one) */
function reverseEdge(g: Graph, e: number): number {
  const u = g.edgeSource[e];
  const v = g.edgeTarget[e];
  for (let k = g.firstEdge[v]; k < g.firstEdge[v + 1]; k++) if (g.edgeTarget[k] === u) return k;
  return -1;
}

function rotate(c: Circuit, g: Graph, startNode: number): number[] | null {
  const i = c.eids.findIndex((e) => g.edgeSource[e] === startNode);
  if (i < 0) return null;
  return [...c.eids.slice(i), ...c.eids.slice(0, i)];
}

function trueCost(g: Graph, eids: number[], startMin: number, p: Preset): number {
  let cost = 0;
  let meters = 0;
  for (const e of eids) {
    cost += edgeCost(g, e, startMin + meters / SPEED_M_PER_MIN, p, 0);
    meters += g.lenDm[e] / 10;
  }
  return cost;
}

/** How good is this circuit as a destination, 0..~1.5, for this walker
 *  arriving at tEntry. Catalog attributes + preset-weighted shade. */
function circuitQuality(g: Graph, c: Circuit, tEntryMin: number, p: Preset): number {
  // shade of the circuit at arrival hour (catalog per-bucket vector)
  // the shade window is seasonal since v7 (2026-08-28): 57 buckets from 06:30
  // in August, 64 from 05:30 in June. This hardcoded 48 buckets from 08:00,
  // so it read the circuit's shade ~1.5 h early and could never see the
  // evening buckets at all.
  const nB = c.shade.length;
  const b = Math.max(0, Math.min(nB - 1, (tEntryMin - g.bucketStartMin) / g.bucketStepMin));
  const b0 = Math.floor(b);
  const b1 = Math.min(nB - 1, b0 + 1);
  const f = b - b0;
  const shade = (c.shade[b0] * (1 - f) + c.shade[b1] * f) / 255;
  const wSum = p.wShade + p.wNoise + p.wSurface + p.wGreen + 0.01;
  // size bonus: a real park loop (>= 1500 m) beats a pocket square. Every
  // catalog circuit is already a simple cycle, so roundness (IQ) is only a
  // tiebreak; a bigger loop with fewer laps wins over a rounder small one
  // lapped 4x ("prio longer route without laps", 2026-08-15)
  const size = Math.min(1, c.length / 1500);
  // a circuit that runs along the park's rim STREETS is not "in the park"
  // (Sinaipark outline feedback 2026-08-15): laps of an interior loop beat
  // an outline that leaves the green
  return (
    KNOBS.wIq * c.iq +
    KNOBS.wSize * size +
    // "green" inside a park is 1 everywhere; DEPTH tells the path through
    // the middle from the path along the rim (2026-08-16)
    (p.wGreen / wSum) * (0.5 * c.green + 0.5 * c.deep) +
    (p.wShade / wSum) * shade +
    (p.wNoise / wSum) * (1 - c.noise) +
    (p.wSurface / wSum) * (1 - c.surface) -
    KNOBS.wStreet * c.street
  );
}

/** Mean cost rate of a path relative to the best possible rate: 0 = ideal,
 *  1 = a plain street at full penalty. */
/** Length-weighted mean noise of a walk, 0..1. */
function walkNoise(g: Graph, eids: number[]): number {
  let n = 0, m = 0;
  for (const e of eids) { const len = g.lenDm[e] / 10; n += (g.noiseQ[e] / 255) * len; m += len; }
  return m > 0 ? n / m : 0;
}

function badness(g: Graph, eids: number[], startMin: number, p: Preset): number {
  if (eids.length === 0) return 0;
  let meters = 0;
  for (const e of eids) meters += g.lenDm[e] / 10;
  const rate = trueCost(g, eids, startMin, p) / Math.max(1, meters);
  const lo = minRate(p);
  const hi = 1 + p.wShade + p.wNoise + p.wSurface;
  return Math.max(0, Math.min(1, (rate - lo) / (hi - lo)));
}

type Cand = { ci: number; node: number; approachLen: number };

/** Every feasible walk, best first, with score components. */
// "In the park" is green AND off the roadway. 13_green_edges buffers green
// polygons by 15 m so a path on a park's rim counts as green, which also
// makes the RIM STREET green: from Eckenheim a promenade up Kirschwaldstraße
// scored 92 % park while walking the road beside Sinaipark (Viktor,
// 2026-08-29). 14_circuits already vetoes rim outlines by the same test
// (street types or a mapped sidewalk are the rim, not the park).
export function inPark(g: Graph, eid: number): boolean {
  if (g.greenQ[eid] < PARK_Q) return false;
  const f = g.flags[eid];
  if ((f & 1) !== 0) return false;                    // carriageway
  if ((f & 16) !== 0) return false;                   // sidewalk, tier >= 2
  if ((f & 8) !== 0 && (f & 4) === 0) return false;   // sidewalk, tier >= 1 (bit3 on a crossing means "marked")
  return true;
}

export function composeCandidates(
  g: Graph,
  s: number,
  targetM: number,
  startMin: number,
  p: Preset
): Scored[] {
  if (g.circuits.length === 0) return [];
  const d = boundedDijkstra(g, s, startMin, p, targetM * 0.5);
  // A promenade gets its OWN tree, grown without major carriageways. On
  // Friedrich-Ebert-Anlage the walk crossed the B44, padded 129 m up the far
  // carriageway and crossed back, purely to reach the target length (Viktor,
  // 2026-08-29). Two crossings cost 300 m-equivalent, cheaper than missing
  // the length, and nothing said "do not cross an arterial for padding".
  // Denying the far carriageway makes the crossing pointless, so the walk
  // turns later on the near side instead — which is what a person does.
  const dProm = boundedDijkstra(g, s, startMin, p, targetM * 0.5, undefined,
    (eid) => !((g.flags[eid] & 1) !== 0 && (g.flags[eid] & 32) !== 0));
  const cands: Cand[] = [];
  const seen = new Set<number>();
  for (const n of d.settled) {
    const cis = g.circuitsAtNode.get(n);
    if (!cis) continue;
    for (const ci of cis) {
      if (seen.has(ci)) continue;
      seen.add(ci);
      cands.push({ ci, node: n, approachLen: d.len[n] });
    }
  }

  const walks: Scored[] = [];
  const push = (
    eids: number[],
    meters: number,
    parkMeters: number,
    laps: number,
    circuitKey: number,
    park: number,
    quality: number,
    approachEids: number[],
    circuitLen: number,
    street: number,
    kind: WalkKind = "laps"
  ) => {
    const parkShare = parkMeters / meters;
    if (parkShare < MIN_PARK_SHARE) return;
    if (Math.abs(meters - targetM) > 0.35 * targetM) return;
    const appBad = badness(g, approachEids, startMin, p);
    const approachShare = 1 - parkShare;
    // laps of a small circuit are penalized; laps of a big one barely
    const smallness = 1 - Math.min(1, circuitLen / targetM);
    const lapPen = KNOBS.lapBase * (laps - 1) * smallness;
    const lenMiss = KNOBS.wLength * Math.abs(meters - targetM) / targetM;
    const value = parkShare * quality - KNOBS.wApproach * appBad * approachShare - lapPen - lenMiss;
    const nodes: number[] = [s];
    for (const e of eids) nodes.push(g.edgeTarget[e]);
    walks.push({
      nodes, eids, meters, cost: trueCost(g, eids, startMin, p),
      circuit: circuitKey, laps, park, kind, score: -value,
      quality, parkShare, appBad, lapPen, lenMiss, street, circuitLen,
    });
  };

  // ---- single circuit, n laps ---------------------------------------
  // 14_circuits marks which access modes can actually use a circuit (bit0
  // walk, bit1 stroller, bit2 wheelchair). The catalog used to be mode-blind,
  // so a loop of Sinai-Wildnis ground trails was offered to a wheelchair and
  // all three modes returned identical loops (2026-08-28). Laps come from the
  // catalog verbatim, so this is the only place the mode can be honoured.
  const modeBit = p.access === "wheelchair" ? 4 : p.access === "walk" ? 1 : 2;
  const usable = (c: { modes?: number }) => ((c.modes ?? 7) & modeBit) !== 0;

  for (const { ci, node, approachLen } of cands) {
    const c = g.circuits[ci];
    if (!usable(c)) continue;
    const lapEids = rotate(c, g, node);
    if (!lapEids) continue;
    const appr = pathFromParents(g, d.parentEdge, s, node);
    if (!appr) continue;
    const budget = targetM - 2 * approachLen;
    if (budget < c.length * 0.6) continue;
    const tEntry = startMin + approachLen / SPEED_M_PER_MIN;
    const q = circuitQuality(g, c, tEntry, p);
    const lapsRound = Math.max(1, Math.min(MAX_LAPS, Math.round(budget / c.length)));
    // Also try MORE laps than fill the leftover budget. Sizing laps to
    // `budget` alone fits the target length but says nothing about how much
    // of the walk is actually in the park, and the two fight when the park
    // is far: from Eckenheim the nearest stroller-usable ring is 758 m away,
    // so 1,516 m of a 2,000 m walk is the trip there and back, 1-2 laps put
    // 17-29 % inside the park, MIN_PARK_SHARE rejected every lap candidate
    // and the stroller was left walking the street (Viktor, 2026-08-29).
    // Three laps clear the floor and still sit inside the +-35 % length
    // window; the length and park-share tests already decide, so the only
    // bug was never offering them.
    const opts = new Set([lapsRound, Math.max(1, lapsRound - 1),
                          Math.min(MAX_LAPS, lapsRound + 1),
                          Math.min(MAX_LAPS, lapsRound + 2)]);
    for (const laps of opts) {
      const tBack = tEntry + (laps * c.length) / SPEED_M_PER_MIN;
      const back = route(g, node, s, tBack, p);
      if (!back) continue;
      const eids = [...appr.eids];
      for (let l = 0; l < laps; l++) eids.push(...lapEids);
      eids.push(...back.eids);
      const meters = approachLen + laps * c.length + back.meters;
      push(eids, meters, laps * c.length, laps, ci, c.pocket, q,
        [...appr.eids, ...back.eids], c.length, c.street);
    }
  }

  // ---- figure-eight: two ADJACENT circuits of one park, one lap each --
  const byPark = new Map<number, Cand[]>();
  for (const c of cands) {
    const arr = byPark.get(g.circuits[c.ci].pocket);
    if (arr) arr.push(c);
    else byPark.set(g.circuits[c.ci].pocket, [c]);
  }
  for (const [park, list] of byPark) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.approachLen - b.approachLen);
    const top = list.slice(0, 5);
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const a = top[i];
        const b = top[j];
        const ca = g.circuits[a.ci];
        const cb = g.circuits[b.ci];
        if (!usable(ca) || !usable(cb)) continue;
        // adjacent = share a node (touching faces / outline + face); not
        // heavily overlapping (else it is a lap in disguise)
        const nodesA = new Set(ca.eids.map((e) => g.edgeSource[e]));
        const shared = cb.eids.filter((e) => nodesA.has(g.edgeSource[e])).length;
        if (shared === 0 || shared / cb.eids.length > 0.5) continue;
        const lapA = rotate(ca, g, a.node);
        if (!lapA) continue;
        const appr = pathFromParents(g, d.parentEdge, s, a.node);
        if (!appr) continue;
        // start circuit B at the shared node closest along A
        const junction = cb.eids.map((e) => g.edgeSource[e]).find((n) => nodesA.has(n))!;
        const lapB = rotate(cb, g, junction);
        if (!lapB) continue;
        // rotate A so it ends at the junction: walk A from a.node, then B
        // from junction, then continue A? Simpler: A full lap from a.node,
        // walk along A to junction (part of A again = small repeat), B lap,
        // then back to a.node. To keep it clean: start A at the junction
        // when reachable, else skip.
        const lapAj = rotate(ca, g, junction);
        const apprJ = pathFromParents(g, d.parentEdge, s, junction);
        if (!lapAj || !apprJ) continue;
        const approachLen = d.len[junction];
        const budget = targetM - 2 * approachLen;
        if (budget < (ca.length + cb.length) * 0.7) continue;
        const tEntry = startMin + approachLen / SPEED_M_PER_MIN;
        const tBack = tEntry + (ca.length + cb.length) / SPEED_M_PER_MIN;
        const back = route(g, junction, s, tBack, p);
        if (!back) continue;
        const eids = [...apprJ.eids, ...lapAj, ...lapB, ...back.eids];
        const meters = approachLen + ca.length + cb.length + back.meters;
        // a figure-eight is only as good as its worse half: a nice face
        // must not carry a rim outline (2026-08-16)
        const q = Math.min(circuitQuality(g, ca, tEntry, p), circuitQuality(g, cb, tEntry, p));
        const key = Math.min(a.ci, b.ci) * 100_000 + Math.max(a.ci, b.ci);
        const st = (ca.street * ca.length + cb.street * cb.length) / (ca.length + cb.length);
        push(eids, meters, ca.length + cb.length, 1, key, park, q,
          [...apprJ.eids, ...back.eids], ca.length + cb.length, st, "eight");
      }
    }
  }

  // ---- promenade: there and back along a park path -----------------------
  // A linear park (Elisabeth-Schwarzhaupt-Anlage, a river bank) has no ring
  // worth lapping; the walk people take is out along its path and back the
  // same way (feedback 2026-08-17). Candidates = Dijkstra-tree paths that
  // end inside a park; retracing is by design here.
  for (const n of dProm.settled) {
    const pe = dProm.parentEdge[n];
    if (pe < 0 || !inPark(g, pe)) continue; // turn around inside a park
    if (dProm.len[n] < 0.3 * targetM) continue;
    const out = pathFromParents(g, dProm.parentEdge, s, n);
    if (!out) continue;
    const back: number[] = [];
    let ok = true;
    for (let i = out.eids.length - 1; i >= 0; i--) {
      const r = reverseEdge(g, out.eids[i]);
      if (r < 0) { ok = false; break; }
      back.push(r);
    }
    if (!ok) continue;
    const eids = [...out.eids, ...back];
    let meters = 0, parkM = 0, greenSum = 0, shadeSum = 0, noiseSum = 0, surfSum = 0;
    const streetEids: number[] = [];
    let tArr = startMin;
    for (const e of eids) {
      const len = g.lenDm[e] / 10;
      if (inPark(g, e)) {
        parkM += len;
        greenSum += (g.greenQ[e] / 255) * len;
        // shadeAtOrThrow: this is PRICING a loop's quality, and −1 averaged
        // into it would be a park scored on a band that has not arrived
        // (S8 review F7). `usePlanner` gates on `bandsReady`, so a throw
        // here is an assertion about a missing gate, not a control path.
        shadeSum += shadeAtOrThrow(g, e, tArr) * len;
        noiseSum += (g.noiseQ[e] / 255) * len;
        surfSum += (g.surfaceQ[e] / 255) * len;
      } else streetEids.push(e);
      meters += len;
      tArr = startMin + meters / SPEED_M_PER_MIN;
    }
    if (parkM === 0) continue;
    const wSum = p.wShade + p.wNoise + p.wSurface + p.wGreen + 0.01;
    const q =
      KNOBS.wSize * Math.min(1, parkM / 2 / 1500) +
      // rings score 0.5·green + 0.5·depth; edges carry no depth, 0.75 is a
      // typical ring's value — keeps the two kinds comparable
      (p.wGreen / wSum) * 0.75 * (greenSum / parkM) +
      (p.wShade / wSum) * (shadeSum / parkM) +
      (p.wNoise / wSum) * (1 - noiseSum / parkM) +
      (p.wSurface / wSum) * (1 - surfSum / parkM) -
      KNOBS.outBack;
    push(eids, meters, parkM, 1, PROMENADE_KEY + n, -1 - n, q, streetEids, parkM / 2, 0, "promenade");
  }

  walks.sort((a, b) => a.score - b.score);
  return walks;
}

export function composeWalks(
  g: Graph,
  s: number,
  targetM: number,
  startMin: number,
  p: Preset,
  k = 3
): Walk[] {
  const walks = composeCandidates(g, s, targetM, startMin, p);
  const overlap = (a: Walk, b: Walk) => {
    const sa = new Set(a.eids);
    const sb = new Set(b.eids);
    let n = 0;
    for (const e of sb) if (sa.has(e)) n++;
    return n / Math.min(sa.size, sb.size);
  };
  // spatial distinctness: a second card from the same park must be in a
  // different PART of it (>= 250 m between circuit centroids) — three loops
  // of the same wood are one idea, not three (Sinaipark feedback 2026-08-15)
  const centroid = (w: Walk): [number, number] | null => {
    if (w.circuit >= 100_000) return null; // figure-eight: use its parts' mean
    const c = g.circuits[w.circuit];
    return [c.cx, c.cy];
  };
  const picked: Scored[] = [];
  // wNoise 1 (balanced) -> 0.20 of slack; wNoise 3 (maxQuiet) -> 0.07
  const noiseBand = walks.length ? 0.2 / Math.max(1, p.wNoise) : 1;
  const bestNoise = walks.length ? walkNoise(g, walks[0].eids) : 0;
  const distinct = (w: Scored) =>
    !picked.some((q) => q.circuit === w.circuit) && !picked.some((q) => overlap(q, w) > 0.6);
  // pass 1: diverse cards — at most two per park, in different parts of it
  for (const w of walks) {
    if (picked.length === k) break;
    if (w.score > walks[0].score + DIVERSITY_SLACK) break; // too far below the best walk
    // Variety must not override the preference the user actually asked for.
    // On maxQuiet a card at noise 0.65 sat next to the best at 0.51 purely
    // for diversity (Viktor, 2026-08-29): three cards should mean three QUIET
    // options, not three options. The band tightens as wNoise rises.
    if (noiseBand < 1 && walkNoise(g, w.eids) > bestNoise + noiseBand) continue;
    if (!distinct(w)) continue;
    if (picked.filter((q) => q.park === w.park).length >= 2) continue;
    const cw = centroid(w);
    if (cw && picked.some((q) => {
      const cq = centroid(q);
      return cq !== null && q.park === w.park && Math.hypot(cq[0] - cw[0], cq[1] - cw[1]) < 250;
    })) continue;
    picked.push(w);
  }
  // pass 2: a poor walk elsewhere is not a better card than a third good
  // walk in the same park ("3 loops in a park and back") — fill with the
  // best remaining distinct walks, diversity rules relaxed
  for (const w of walks) {
    if (picked.length === k) break;
    if (picked.includes(w) || !distinct(w)) continue;
    picked.push(w);
  }
  picked.sort((a, b) => a.score - b.score);
  return picked;
}

