// Fallback when no catalog circuit is in reach: the quietest / shadiest
// loop around here. This is the Cycle Trip Planning / Arc Orienteering
// problem (Verbeeck et al. 2014; Lu & Shahabi 2015; Lewis & Corcoran 2022):
// a closed walk from s of length ≈ L that collects the most "niceness"
// (lowest cost rate) with no repeated street. NP-hard; every practical
// system is construct-then-local-search:
//
//   seed  = PSP triangle/quadrilateral (psp.ts) — round by construction
//   move  = pick two loop vertices u_i, u_j (i<j); replace the sub-path
//           u_i..u_j by the best-cost path in G minus the rest of the loop
//           (so no repeats), accept if total length stays within band and
//           the loop's cost rate improves
//   stop  = no improving move over a full pass, or the time box
//
// Time-dependent shade is honoured because every evaluation re-walks the
// loop with arrival times (trueCost).
import { route, SPEED_M_PER_MIN, type Preset } from "./astar";
import type { Graph } from "./graph";
import { pspCandidates, trueCost, type Loop } from "./psp";

const BAND = 0.2;
const TIME_BOX_MS = 250;
const STRIDE = 3; // vertices between u_i and u_j candidates (skip tiny moves)
const FORBID = 25;

function pairKey(a: number, b: number): number {
  return a < b ? a * 16_777_216 + b : b * 16_777_216 + a;
}

function rebuild(g: Graph, s: number, eids: number[]): Loop {
  const nodes = [s];
  let meters = 0;
  for (const e of eids) {
    nodes.push(g.edgeTarget[e]);
    meters += g.lenDm[e] / 10;
  }
  return { nodes, eids, meters, cost: 0 };
}

export function improveLoop(
  g: Graph,
  s: number,
  seed: Loop,
  targetM: number,
  startMin: number,
  p: Preset,
  timeBoxMs = TIME_BOX_MS
): Loop {
  let best = { ...seed, cost: trueCost(g, seed, startMin, p) };
  const t0 = performance.now();
  let improved = true;
  while (improved && performance.now() - t0 < timeBoxMs) {
    improved = false;
    const n = best.eids.length;
    for (let i = 0; i < n - STRIDE && performance.now() - t0 < timeBoxMs; i += 2) {
      for (let j = i + STRIDE; j < Math.min(n, i + 12); j += 2) {
        // loop vertices: node before eid i is nodes[i]; after eid j-1 is nodes[j]
        const from = best.nodes[i];
        const to = best.nodes[j];
        if (from === to) continue;
        // forbid every edge of the loop OUTSIDE the segment being replaced
        const keep = new Set<number>();
        for (let k = 0; k < n; k++) {
          if (k >= i && k < j) continue;
          keep.add(pairKey(g.edgeSource[best.eids[k]], g.edgeTarget[best.eids[k]]));
        }
        // arrival time at u_i
        let mBefore = 0;
        for (let k = 0; k < i; k++) mBefore += g.lenDm[best.eids[k]] / 10;
        const tI = startMin + mBefore / SPEED_M_PER_MIN;
        const alt = route(g, from, to, tI, p, (eid) =>
          keep.has(pairKey(g.edgeSource[eid], g.edgeTarget[eid])) ? FORBID : 0
        );
        if (!alt || alt.eids.length === 0) continue;
        // reject if it reused kept edges (penalty leaked)
        if (alt.eids.some((e) => keep.has(pairKey(g.edgeSource[e], g.edgeTarget[e])))) continue;
        const eids = [...best.eids.slice(0, i), ...alt.eids, ...best.eids.slice(j)];
        const cand = rebuild(g, s, eids);
        if (Math.abs(cand.meters - targetM) > BAND * targetM) continue;
        cand.cost = trueCost(g, cand, startMin, p);
        const rateBest = best.cost / best.meters + 0.5 * Math.abs(best.meters - targetM) / targetM;
        const rateCand = cand.cost / cand.meters + 0.5 * Math.abs(cand.meters - targetM) / targetM;
        if (rateCand < rateBest - 1e-6) {
          best = cand;
          improved = true;
          break; // restart scan on the new loop
        }
      }
      if (improved) break;
    }
  }
  return best;
}

/** k quiet/shady loops: seed from PSP candidates in distinct sectors,
 *  improve each with the local search, return sorted by cost rate. */
export function quietLoops(
  g: Graph,
  s: number,
  targetM: number,
  startMin: number,
  p: Preset,
  k = 3
): Loop[] {
  const seeds = pspCandidates(g, s, targetM, startMin, p)
    .filter((c) => Math.abs(c.loop.meters - targetM) <= 0.35 * targetM)
    .sort((a, b) => a.score - b.score);
  const out: Loop[] = [];
  const usedSectors = new Set<number>();
  for (const c of seeds) {
    if (out.length === k) break;
    if (usedSectors.has(c.sector)) continue;
    usedSectors.add(c.sector);
    out.push(improveLoop(g, s, c.loop, targetM, startMin, p, TIME_BOX_MS / k));
  }
  out.sort((a, b) => a.cost / a.meters - b.cost / b.meters);
  return out;
}
