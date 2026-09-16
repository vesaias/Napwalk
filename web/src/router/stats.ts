// Result-card numbers (SPEC F5): minutes · km · shade % (for this start
// time) · quiet % · cobblestone meters. Shade uses arrival time per edge,
// the same lookup the router costs use; quiet = length-weighted quietness,
// 1 below 55 dB LDEN (the router's noise knee) ramping linearly to 0 at
// 75 dB — a walk entirely in the 55-59 band is 75 % quiet, not 0
// (2026-08-16: replaced the A-E mean-class letter, which nobody could read).
import { shadeAtOrThrow, SPEED_M_PER_MIN, type Daylight } from "./astar";
import type { Graph } from "./graph";

export type RouteStats = {
  minutes: number;
  km: number;
  shadePct: number;
  quietPct: number;
  cobbleM: number;
};

export const COBBLE_Q = 178; // surface_cost >= 0.7, same threshold as the pipeline
/** noiseQ (0..255 = class 0..8, 5 dB per class from 40 dB) -> quietness 0..1 */
function quietness(noiseQ: number): number {
  const cls = (noiseQ / 255) * 8; // 3 = 50-54, 4 = 55-59, ... 7 = 70-74
  return Math.max(0, Math.min(1, (7 - cls) / 4));
}

/** `day` is the selected day's daylight (astar.ts `Daylight`): without it a
 *  departure the artifact's shade buckets do not cover reads as fully
 *  shaded, which is right after sunset and wrong before the export day's
 *  first bucket — the leave-at strip's fabricated 100 % bars (S1/S2 fix
 *  report, and the ruling on it 2026-09-09). */
export function routeStats(
  g: Graph,
  eids: number[],
  startMin: number,
  day?: Daylight
): RouteStats {
  let meters = 0;
  let shadeWeighted = 0;
  let quietM = 0;
  let cobbleM = 0;
  for (const eid of eids) {
    const len = g.lenDm[eid] / 10;
    const t = startMin + meters / SPEED_M_PER_MIN;
    // shadeAtOrThrow, not shadeAt: a card's shade percentage must never
    // be an average over a band that has not arrived (rule 4). The
    // callers gate on `bandsReady` — see plan/hours.ts.
    shadeWeighted += shadeAtOrThrow(g, eid, t, day) * len;
    quietM += quietness(g.noiseQ[eid]) * len;
    if (g.surfaceQ[eid] >= COBBLE_Q) cobbleM += len;
    meters += len;
  }
  return {
    minutes: Math.round(meters / SPEED_M_PER_MIN),
    km: Math.round(meters / 100) / 10,
    shadePct: meters > 0 ? Math.round((shadeWeighted / meters) * 100) : 0,
    quietPct: meters > 0 ? Math.round((quietM / meters) * 100) : 0,
    cobbleM: Math.round(cobbleM / 10) * 10,
  };
}
