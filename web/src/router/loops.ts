// Loop generation (SPEC §6).
//
// Primary: the composer — go to a nice park, do n laps of a precomputed,
// scored, human-vetoed circuit (pipeline/14_circuits), come home.
// Fallback (no circuit in reach): PSP round loops (psp.ts).
import { PRESETS, SPEED_M_PER_MIN, type Preset } from "./astar";
import type { Graph } from "./graph";
import { composeWalks } from "./composer";
import { type Loop } from "./psp";
import { quietLoops } from "./quietLoop";

export type { Loop } from "./psp";

const LOOP_GREEN_BOOST = 1.25; // discount 0.6 -> 0.75 in loops (must stay < 1)

export function loops(
  g: Graph,
  start: number,
  durationMin: number,
  startMin: number,
  preset: Preset = PRESETS.balanced
): Loop[] {
  const targetM = durationMin * SPEED_M_PER_MIN;
  const loopPreset: Preset = {
    ...preset,
    wGreen: Math.min(0.9, preset.wGreen * LOOP_GREEN_BOOST),
  };
  const walks = composeWalks(g, start, targetM, startMin, loopPreset, 3);
  if (walks.length >= 3) return walks;
  // no (or not enough) parks in reach: the quietest / shadiest street loops
  const out: Loop[] = [...walks];
  for (const q of quietLoops(g, start, targetM, startMin, loopPreset, 3)) {
    if (out.length === 3) break;
    const a = new Set(q.eids);
    if (out.some((w) => w.eids.filter((e) => a.has(e)).length / Math.min(w.eids.length, q.eids.length) > 0.5)) continue;
    out.push(q);
  }
  return out;
}
