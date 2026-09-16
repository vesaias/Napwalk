// Round trips via Partial Shortest Paths — after Gemsa, Pajor, Wagner,
// Zündorf, "Efficient Computation of Jogging Routes" (SEA 2013), PSP2/PSP3.
//
// A good round walk of length L is a *simple cycle* through the start with
// low badness (our time-dependent cost per meter), low sharing (repeated
// edges), and length in [(1−ε)L, (1+ε)L]. The trick: build the cycle from
// shortest-path legs between via nodes that sit on distance RINGS around
// the start, so every leg is ~L/k and the cycle is round by construction.
//
//   PSP3 (quadrilateral):  s → u → v → w → s, legs ≈ L/4
//     ring_s   = nodes at walking length ≈ L/4 from s   (bounded Dijkstra)
//     u        ∈ ring_s, sampled by angular sector (16 sectors, best cost)
//     ring_u   = nodes at length ≈ L/4 from u, with P(s,u)'s edges forbidden
//     v        ∈ ring_u with length(s→v) ≈ L/2·α… — the far corner —
//                chosen as the best-cost node in ring_u whose straight-line
//                distance from s is largest (opposite the start)
//     w        ∈ ring_s in the sector opposite u's, reached from v by a
//                third leg with legs 1–2 forbidden; then w → s (leg 4).
//   PSP2 (triangle) fallback: s → u → v → s with legs ≈ L/3.
//
// Every leg is an A* under the real (green/shade/noise/surface) weighting
// with a hard forbid on edges of previous legs (edge-disjoint legs → no
// spurs, no out-and-back). Candidates scored by
//     score = badness/len + λ·sharing + μ·|len − L|/L
// and the best k with pairwise-distinct u-sectors are returned — the
// alternatives are diverse by construction.
import { edgeCost, minRate, route, SPEED_M_PER_MIN, type Preset } from "./astar";
import type { Graph } from "./graph";

export type Loop = {
  nodes: number[];
  eids: number[];
  meters: number;
  cost: number;
};

const SECTORS = 16;
const EPS = 0.12; // ring half-width as fraction of the leg length
const LAMBDA_SHARING = 3.0;
const MU_LENGTH = 1.5;
const FORBID_PENALTY = 25; // out-of-bounds (allowedEdge): rate += 25 per meter
// Retracing an edge already used by an earlier leg is discouraged, but the
// discouragement has to be PROPORTIONAL. A flat 25/m dwarfs every real rate
// (sidewalk 0.6-3, major carriageway 21), so on a dead-end spur — where the
// only sane move IS to retrace — it forced something worse: Schaumainkai
// 15300->65952 went out on 45 m of sidewalk (cost 164) and came back by a
// 135 m detour (cost 597), because retracing would have billed
// 164 + 25*45 = 1289 (2026-08-28). Charging a multiple of the edge's own
// rate keeps a cheap retrace cheap and an expensive one expensive.
const FORBID_FACTOR = 3;  // retrace costs this many times its own rate...
const FORBID_FLOOR = 2;   // ...and at least this, so free edges still resist

/**
 * Bounded Dijkstra from src under the real edge cost, stopped once every
 * settled node exceeds maxLen walking meters. Returns per-node cost/length
 * (Infinity where unreached) plus parents for path reconstruction.
 */
export function boundedDijkstra(
  g: Graph,
  src: number,
  startMin: number,
  p: Preset,
  maxLen: number,
  forbidden?: Set<number>,
  allowedEdge?: (eid: number) => boolean
): { cost: Float64Array; len: Float64Array; parentEdge: Int32Array; settled: number[] } {
  const n = g.nNodes;
  const cost = new Float64Array(n).fill(Infinity);
  const len = new Float64Array(n).fill(Infinity);
  const parentEdge = new Int32Array(n).fill(-1);
  const settledFlag = new Uint8Array(n);
  const settled: number[] = [];
  // simple binary heap over (cost, node)
  const hk: number[] = [];
  const hv: number[] = [];
  const push = (k: number, v: number) => {
    hk.push(k);
    hv.push(v);
    let i = hk.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (hk[par] <= hk[i]) break;
      [hk[par], hk[i]] = [hk[i], hk[par]];
      [hv[par], hv[i]] = [hv[i], hv[par]];
      i = par;
    }
  };
  const pop = (): number => {
    const top = hv[0];
    const lk = hk.pop()!;
    const lv = hv.pop()!;
    if (hk.length > 0) {
      hk[0] = lk;
      hv[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= hk.length) break;
        const r = l + 1;
        const c = r < hk.length && hk[r] < hk[l] ? r : l;
        if (hk[c] >= hk[i]) break;
        [hk[c], hk[i]] = [hk[i], hk[c]];
        [hv[c], hv[i]] = [hv[i], hv[c]];
        i = c;
      }
    }
    return top;
  };
  cost[src] = 0;
  len[src] = 0;
  push(0, src);
  while (hk.length > 0) {
    const u = pop();
    if (settledFlag[u]) continue;
    settledFlag[u] = 1;
    settled.push(u);
    if (len[u] > maxLen) continue; // frontier beyond the ring: don't expand
    const t = startMin + len[u] / SPEED_M_PER_MIN;
    for (let k = g.firstEdge[u]; k < g.firstEdge[u + 1]; k++) {
      if (forbidden && forbidden.has(pairKey(g.edgeSource[k], g.edgeTarget[k]))) continue;
      const v = g.edgeTarget[k];
      if (allowedEdge && !allowedEdge(k)) continue;
      if (settledFlag[v]) continue;
      const nc = cost[u] + edgeCost(g, k, t, p, 0);
      if (nc < cost[v]) {
        cost[v] = nc;
        len[v] = len[u] + g.lenDm[k] / 10;
        parentEdge[v] = k;
        push(nc, v);
      }
    }
  }
  return { cost, len, parentEdge, settled };
}

export function pathFromParents(
  g: Graph,
  parentEdge: Int32Array,
  src: number,
  dst: number
): { nodes: number[]; eids: number[] } | null {
  const nodes: number[] = [];
  const eids: number[] = [];
  let n = dst;
  let guard = 0;
  while (n !== src) {
    const e = parentEdge[n];
    if (e < 0) return null;
    eids.push(e);
    nodes.push(n);
    n = g.edgeSource[e];
    if (++guard > 1_000_000) return null;
  }
  nodes.push(src);
  nodes.reverse();
  eids.reverse();
  return { nodes, eids };
}

function pairKey(a: number, b: number): number {
  return a < b ? a * 16_777_216 + b : b * 16_777_216 + a;
}

/** Roundness proxy: convex-hull area over the area of a circle with the
 *  same perimeter as the hull. ~0 for a there-and-back line, ~1 for a disc. */
function thinness(g: Graph, nodes: number[]): number {
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
  if (hull.length < 3) return 0;
  let area = 0;
  let per = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    area += x1 * y2 - x2 * y1;
    per += Math.hypot(x2 - x1, y2 - y1);
  }
  area = Math.abs(area) / 2;
  return per > 0 ? area / ((per * per) / (4 * Math.PI)) : 0;
}

function sectorOf(g: Graph, s: number, n: number): number {
  const a = Math.atan2(g.y[n] - g.y[s], g.x[n] - g.x[s]);
  return ((Math.floor(((a + Math.PI) / (2 * Math.PI)) * SECTORS) % SECTORS) + SECTORS) % SECTORS;
}

/** Best-cost node per angular sector among nodes whose walking length from
 *  s lies in [lo, hi]. */
function ringBySector(
  g: Graph,
  s: number,
  d: { cost: Float64Array; len: Float64Array; settled: number[] },
  lo: number,
  hi: number
): Map<number, number> {
  const best = new Map<number, number>();
  for (const n of d.settled) {
    const l = d.len[n];
    if (l < lo || l > hi || n === s) continue;
    const sec = sectorOf(g, s, n);
    const cur = best.get(sec);
    if (cur === undefined || d.cost[n] < d.cost[cur]) best.set(sec, n);
  }
  return best;
}

type Leg = { nodes: number[]; eids: number[]; meters: number; cost: number };

function legVia(
  g: Graph,
  from: number,
  to: number,
  tMin: number,
  p: Preset,
  forbidden: Set<number>,
  allowedEdge?: (eid: number) => boolean
): Leg | null {
  const r = route(g, from, to, tMin, p, (eid) => {
    if (allowedEdge !== undefined && !allowedEdge(eid)) return FORBID_PENALTY;
    if (!forbidden.has(pairKey(g.edgeSource[eid], g.edgeTarget[eid]))) return 0;
    const len = g.lenDm[eid] / 10;
    const base = edgeCost(g, eid, tMin, p, 0);
    const rate = len > 0 && isFinite(base) ? base / len : 0;
    return Math.max(FORBID_FLOOR, FORBID_FACTOR * rate);
  });
  if (!r) return null;
  return { nodes: r.nodes, eids: r.eids, meters: r.meters, cost: r.cost };
}

function addForbidden(g: Graph, set: Set<number>, leg: Leg) {
  for (const e of leg.eids) set.add(pairKey(g.edgeSource[e], g.edgeTarget[e]));
}

function concat(legs: Leg[]): Loop {
  const nodes = [legs[0].nodes[0]];
  const eids: number[] = [];
  let meters = 0;
  let cost = 0;
  for (const l of legs) {
    nodes.push(...l.nodes.slice(1));
    eids.push(...l.eids);
    meters += l.meters;
    cost += l.cost;
  }
  return { nodes, eids, meters, cost };
}

/** Honest cost of a loop: re-walk its edges under the real weighting at
 *  arrival times, without any routing penalties (forbid/reuse). */
export function trueCost(g: Graph, loop: Loop, startMin: number, p: Preset): number {
  let cost = 0;
  let meters = 0;
  for (const e of loop.eids) {
    const t = startMin + meters / SPEED_M_PER_MIN;
    cost += edgeCost(g, e, t, p, 0);
    meters += g.lenDm[e] / 10;
  }
  return cost;
}

export function sharing(g: Graph, loop: Loop): number {
  const seen = new Set<number>();
  let rep = 0;
  for (const e of loop.eids) {
    const k = pairKey(g.edgeSource[e], g.edgeTarget[e]);
    if (seen.has(k)) rep += g.lenDm[e] / 10;
    seen.add(k);
  }
  return loop.meters > 0 ? rep / loop.meters : 0;
}

type Cand = { loop: Loop; sector: number; score: number; circuitId?: number };

/** All PSP cycle candidates through s of length ≈ targetM (unranked).
 *  `allowed` restricts every leg to a node subset (used for park circuits). */
export function pspCandidates(
  g: Graph,
  s: number,
  targetM: number,
  startMin: number,
  p: Preset,
  allowedEdge?: (eid: number) => boolean
): Cand[] {
  const candidates: Cand[] = [];
  const legLen4 = targetM / 4;
  const legLen3 = targetM / 3;

  // ring around s at L/4 (quadrilateral) — reuse for L/3 by re-querying len
  const ds = boundedDijkstra(g, s, startMin, p, legLen3 * (1 + EPS), undefined, allowedEdge);
  const ring4 = ringBySector(g, s, ds, legLen4 * (1 - EPS), legLen4 * (1 + EPS));
  const ring3 = ringBySector(g, s, ds, legLen3 * (1 - EPS), legLen3 * (1 + EPS));

  const scoreLoop = (loop: Loop) => {
    loop.cost = trueCost(g, loop, startMin, p);
    return loop.cost / loop.meters +
      LAMBDA_SHARING * sharing(g, loop) +
      MU_LENGTH * (Math.abs(loop.meters - targetM) / targetM);
  };

  // ---- PSP3: quadrilaterals ------------------------------------------
  for (const [secU, u] of ring4) {
    const leg1 = pathFromParents(g, ds.parentEdge, s, u);
    if (!leg1) continue;
    const l1: Leg = { ...leg1, meters: ds.len[u], cost: ds.cost[u] };
    const forbid = new Set<number>();
    addForbidden(g, forbid, l1);
    const tU = startMin + l1.meters / SPEED_M_PER_MIN;
    // ring around u at L/4, avoiding leg 1
    const du = boundedDijkstra(g, u, tU, p, legLen4 * (1 + EPS), forbid, allowedEdge);
    // far corner v: among ring_u nodes, prefer those far from s (opposite
    // side) — take best cost per "distance-from-s" band, keep 3 best
    const vs: number[] = [];
    {
      const cand: { n: number; key: number }[] = [];
      for (const n of du.settled) {
        const l = du.len[n];
        if (l < legLen4 * (1 - EPS) || l > legLen4 * (1 + EPS)) continue;
        if (n === s || n === u) continue;
        const dS = Math.hypot(g.x[n] - g.x[s], g.y[n] - g.y[s]);
        // want dS ≈ diagonal of a square with side L/4 ≈ 1.41·L/4
        const want = 1.41 * legLen4;
        const key = du.cost[n] / du.len[n] + 2.0 * Math.abs(dS - want) / want;
        cand.push({ n, key });
      }
      cand.sort((a, b) => a.key - b.key);
      for (const c of cand.slice(0, 3)) vs.push(c.n);
    }
    for (const v of vs) {
      const leg2p = pathFromParents(g, du.parentEdge, u, v);
      if (!leg2p) continue;
      const l2: Leg = { ...leg2p, meters: du.len[v], cost: du.cost[v] };
      const forbid2 = new Set(forbid);
      addForbidden(g, forbid2, l2);
      const tV = tU + l2.meters / SPEED_M_PER_MIN;
      // w: ring_s node in the sector opposite u (±2 sectors), reachable
      const secOpp = (secU + SECTORS / 2) % SECTORS;
      let done = false;
      for (const dsec of [0, 1, -1, 2, -2]) {
        const w = ring4.get((secOpp + dsec + SECTORS) % SECTORS);
        if (w === undefined || w === u || w === v) continue;
        const l3 = legVia(g, v, w, tV, p, forbid2, allowedEdge);
        if (!l3) continue;
        const forbid3 = new Set(forbid2);
        addForbidden(g, forbid3, l3);
        const tW = tV + l3.meters / SPEED_M_PER_MIN;
        const l4 = legVia(g, w, s, tW, p, forbid3, allowedEdge);
        if (!l4) continue;
        const loop = concat([l1, l2, l3, l4]);
        candidates.push({ loop, sector: secU, score: scoreLoop(loop) });
        done = true;
        break;
      }
      if (done) break; // one quadrilateral per u is plenty
    }
  }

  // ---- PSP2: triangles (fallback / extra diversity) -------------------
  for (const [secU, u] of ring3) {
    const leg1 = pathFromParents(g, ds.parentEdge, s, u);
    if (!leg1) continue;
    const l1: Leg = { ...leg1, meters: ds.len[u], cost: ds.cost[u] };
    const forbid = new Set<number>();
    addForbidden(g, forbid, l1);
    const tU = startMin + l1.meters / SPEED_M_PER_MIN;
    const du = boundedDijkstra(g, u, tU, p, legLen3 * (1 + EPS), forbid, allowedEdge);
    // v ∈ ring_u ∩ ring_s(L/3): pick best cost
    let bestV = -1;
    let bestKey = Infinity;
    for (const n of du.settled) {
      const lu = du.len[n];
      const ls = ds.len[n];
      if (lu < legLen3 * (1 - EPS) || lu > legLen3 * (1 + EPS)) continue;
      if (!isFinite(ls) || ls < legLen3 * (1 - EPS) || ls > legLen3 * (1 + EPS)) continue;
      if (n === s || n === u) continue;
      const key = du.cost[n] + ds.cost[n];
      if (key < bestKey) {
        bestKey = key;
        bestV = n;
      }
    }
    if (bestV < 0) continue;
    const leg2p = pathFromParents(g, du.parentEdge, u, bestV);
    if (!leg2p) continue;
    const l2: Leg = { ...leg2p, meters: du.len[bestV], cost: du.cost[bestV] };
    const forbid2 = new Set(forbid);
    addForbidden(g, forbid2, l2);
    const tV = tU + l2.meters / SPEED_M_PER_MIN;
    const l3 = legVia(g, bestV, s, tV, p, forbid2, allowedEdge);
    if (!l3) continue;
    const loop = concat([l1, l2, l3]);
    candidates.push({ loop, sector: secU, score: scoreLoop(loop) });
  }
  return candidates;
}

export function pspLoops(
  g: Graph,
  s: number,
  targetM: number,
  startMin: number,
  p: Preset,
  k = 3
): Loop[] {
  // Park walks are the PRIMARY shape (product decision 2026-08-15): go to a
  // nice park, do 2-4 laps of its circuit, come home. The three cards are
  // park walks — different lap counts of the nearest good park, or
  // different parks — and the geometric ring loops (PSP) fill in only when
  // no park walk fits the length.
  const laps = parkLapCandidates(g, s, targetM, startMin, p);
  const inBand = (c: Cand) => Math.abs(c.loop.meters - targetM) <= 0.35 * targetM;
  const lapOk = laps.filter(inBand).sort((a, b) => a.score - b.score);
  const picked: Cand[] = [];
  // Cards are distinct SHAPES: one card per circuit (its best-fitting lap
  // count), nearest park's circuits first, then other parks. Lap count is
  // detail, not a reason for a separate card (feedback 2026-08-15:
  // "options 2 and 3 are the same shape").
  for (const c of lapOk) {
    if (picked.length === k) break;
    if (picked.some((q) => q.circuitId === c.circuitId)) continue;
    if (picked.some((q) => overlap(q.loop, c.loop) > 0.6)) continue;
    picked.push(c);
  }
  if (picked.length < k) {
    const ring = pspCandidates(g, s, targetM, startMin, p);
    for (const loop of selectK(ring, targetM, k - picked.length)) {
      picked.push({ loop, sector: -1, score: scoreOf(ring, loop) });
    }
  }
  picked.sort((a, b) => a.score - b.score);
  return picked.map((c) => c.loop);
}

function scoreOf(cands: Cand[], loop: Loop): number {
  return cands.find((c) => c.loop === loop)?.score ?? Infinity;
}

function selectK(candidates: Cand[], targetM: number, k: number): Loop[] {
  // ---- select k best, pairwise-distinct sectors, low overlap ----------
  candidates.sort((a, b) => a.score - b.score);
  const picked: { loop: Loop; sector: number }[] = [];
  for (const c of candidates) {
    if (Math.abs(c.loop.meters - targetM) > 0.35 * targetM) continue;
    if (picked.some((q) => sectorDist(q.sector, c.sector) < 3)) continue;
    if (picked.some((q) => overlap(q.loop, c.loop) > 0.5)) continue;
    picked.push(c);
    if (picked.length === k) break;
  }
  // relax sector rule if we could not fill k
  if (picked.length < k) {
    for (const c of candidates) {
      if (picked.some((q) => q.loop === c.loop)) continue;
      if (Math.abs(c.loop.meters - targetM) > 0.35 * targetM) continue;
      if (picked.some((q) => overlap(q.loop, c.loop) > 0.5)) continue;
      picked.push(c);
      if (picked.length === k) break;
    }
  }
  return picked.map((c) => c.loop);
}

function sectorDist(a: number, b: number): number {
  const d = Math.abs(a - b) % SECTORS;
  return Math.min(d, SECTORS - d);
}

function overlap(a: Loop, b: Loop): number {
  const setA = new Set(a.eids);
  let shared = 0;
  for (const e of b.eids) if (setA.has(e)) shared++;
  return shared / Math.max(1, Math.min(a.eids.length, b.eids.length));
}

// re-export for callers that want the rate bound
export { minRate };

// ---------------------------------------------------------------------
// Park laps: "a couple of loops in the park". Find green pockets near s,
// build a ROUND circuit inside the pocket (PSP restricted to the pocket's
// nodes), repeat it to fill the target length, add approach/return legs.
// Intentional laps are not "sharing"; only the approach/return legs are.
// ---------------------------------------------------------------------

const GREEN_EDGE_Q = 200; // edge counts as park path if green >= 200/255
const MAX_LAPS = 4;
const MIN_PARK_GREEN_M = 800; // a 'nice park' has at least this much green path to lap

/** Green pockets: connected components of GREEN EDGES reachable within
 *  reachM walking from s. Entry = the component node nearest to s. */
export function greenPockets(
  g: Graph,
  s: number,
  startMin: number,
  p: Preset,
  reachM: number
): { entry: number; members: Set<number>; approachLen: number; greenM: number }[] {
  const d = boundedDijkstra(g, s, startMin, p, reachM);
  const isGreen = (eid: number) => g.greenQ[eid] >= GREEN_EDGE_Q;
  // seeds: settled nodes with at least one green edge, nearest first
  const seeds = d.settled
    .filter((n) => {
      for (let k = g.firstEdge[n]; k < g.firstEdge[n + 1]; k++) if (isGreen(k)) return true;
      return false;
    })
    .sort((a, b) => d.len[a] - d.len[b]);
  const assigned = new Set<number>();
  const pockets: { entry: number; members: Set<number>; approachLen: number; greenM: number }[] = [];
  for (const seed of seeds) {
    if (assigned.has(seed)) continue;
    if (pockets.length >= 4) break;
    // BFS over green edges only (bounded to 3 km of green paths)
    const members = new Set<number>([seed]);
    const q = [seed];
    let greenM = 0;
    while (q.length && members.size < 600) {
      const m = q.pop()!;
      for (let k = g.firstEdge[m]; k < g.firstEdge[m + 1]; k++) {
        if (!isGreen(k)) continue;
        greenM += g.lenDm[k] / 10;
        const v = g.edgeTarget[k];
        if (!members.has(v)) {
          members.add(v);
          q.push(v);
        }
      }
    }
    for (const m of members) assigned.add(m);
    if (members.size >= 8) pockets.push({ entry: seed, members, approachLen: d.len[seed], greenM });
  }
  return pockets;
}

/**
 * A round circuit inside a pocket starting/ending at `entry`: out to a far
 * member, back by a different way if the pocket allows it (mild penalty on
 * reuse — a park's path network is sparse; a lap that shares a junction is
 * still a lap, not a spur). Returns null if the pocket is too small.
 */
function pocketCircuit(
  g: Graph,
  entry: number,
  tMin: number,
  p: Preset,
  wantM: number
): Loop | null {
  const greenEdge = (eid: number) => g.greenQ[eid] >= GREEN_EDGE_Q;
  // candidates for the far end: members at ~wantM/2 walking distance
  const d = boundedDijkstra(g, entry, tMin, p, wantM * 0.75, undefined, greenEdge);
  // several far-end candidates (best cost/length fit), keep the ROUNDEST
  // resulting circuit — a park lap should be a loop, not a lens
  const cands: { n: number; key: number }[] = [];
  for (const n of d.settled) {
    if (n === entry) continue;
    const l = d.len[n];
    if (l < wantM * 0.3) continue;
    cands.push({ n, key: Math.abs(l - wantM / 2) / wantM + 0.5 * (d.cost[n] / Math.max(1, l)) });
  }
  cands.sort((a, b) => a.key - b.key);
  let bestLoop: Loop | null = null;
  let bestRound = 0;
  for (const { n: far } of cands.slice(0, 6)) {
    const outPath = pathFromParents(g, d.parentEdge, entry, far);
    if (!outPath) continue;
    const l1: Leg = { ...outPath, meters: d.len[far], cost: d.cost[far] };
    const used = new Set<number>();
    addForbidden(g, used, l1);
    const tFar = tMin + l1.meters / SPEED_M_PER_MIN;
    const back = route(g, far, entry, tFar, p, (eid) =>
      !greenEdge(eid) || used.has(pairKey(g.edgeSource[eid], g.edgeTarget[eid]))
        ? FORBID_PENALTY
        : 0
    );
    if (!back) continue;
    // a lap must be a genuine cycle: reject there-and-back
    const backPairs = new Set(back.eids.map((e) => pairKey(g.edgeSource[e], g.edgeTarget[e])));
    let reused = 0;
    for (const k of backPairs) if (used.has(k)) reused++;
    if (reused / Math.max(1, backPairs.size) > 0.25) continue;
    const nodes = [...l1.nodes, ...back.nodes.slice(1)];
    const round = thinness(g, nodes);
    if (round < 0.12) continue;
    if (round > bestRound) {
      bestRound = round;
      bestLoop = concat([l1, { nodes: back.nodes, eids: back.eids, meters: back.meters, cost: back.cost }]);
    }
  }
  return bestLoop;
}

export function parkLapCandidates(
  g: Graph,
  s: number,
  targetM: number,
  startMin: number,
  p: Preset
): Cand[] {
  const out: Cand[] = [];
  const pockets = greenPockets(g, s, startMin, p, targetM * 0.45)
    .filter((pk) => pk.greenM >= MIN_PARK_GREEN_M);
  for (const pk of pockets) {
    const approach = route(g, s, pk.entry, startMin, p);
    if (!approach) continue;
    const budget = targetM - 2 * approach.meters;
    if (budget < 300) continue;
    const tEntry = startMin + approach.meters / SPEED_M_PER_MIN;
    // Circuit sized so that 2-4 laps fill the budget ("go to the park, do
    // a couple of loops, come back"): aim for budget/3, also try budget/2
    // (bigger circuit, fewer laps) and budget/4. Every lap count that lands
    // within the length band becomes a candidate, so the user can pick
    // 2x vs 3x vs 4x of the same park.
    const circuits: Loop[] = [];
    for (const wantM of [budget / 3, budget / 2, budget / 4]) {
      if (wantM < 250) continue;
      const c = pocketCircuit(g, pk.entry, tEntry, p, wantM);
      if (c && !circuits.some((q) => Math.abs(q.meters - c.meters) < 80)) circuits.push(c);
    }
    for (const c of circuits) for (let laps = 1; laps <= MAX_LAPS; laps++) {
      if (laps * c.meters > budget * 1.35) break;
      // return: entry -> s. Walking home the way you came is how people go
      // to a park; forcing a different street produced pointless block
      // detours. The no-repeat rule applies INSIDE the circuit only.
      const tBack = tEntry + (laps * c.meters) / SPEED_M_PER_MIN;
      const back = route(g, pk.entry, s, tBack, p);
      if (!back) continue;
      const nodes = [...approach.nodes];
      const eids = [...approach.eids];
      let cost = approach.cost;
      for (let l = 0; l < laps; l++) {
        nodes.push(...c.nodes.slice(1));
        eids.push(...c.eids);
        cost += c.cost;
      }
      nodes.push(...back.nodes.slice(1));
      eids.push(...back.eids);
      cost += back.cost;
      const meters = approach.meters + laps * c.meters + back.meters;
      const loop: Loop = { nodes, eids, meters, cost };
      loop.cost = trueCost(g, loop, startMin, p);
      cost = loop.cost;
      const score = cost / meters + MU_LENGTH * (Math.abs(meters - targetM) / targetM);
      out.push({ loop, sector: sectorOf(g, s, pk.entry), score, circuitId: circuits.indexOf(c) + 100 * pockets.indexOf(pk) } as Cand);
    }
  }
  return out;
}
