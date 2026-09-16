// Getting back on a walk you have left (compact rework slice 5, 2026-09-07;
// bounded in fix round 1).
//
// HANDOVER §6.2: "off-route > 40 m for 10 s → recompute from walkPos
// (silently)". Silently is the whole design. A walker who took the other
// side of the square, or whose fix drifted through a courtyard, does not
// want a dialog — they want the line under their feet to be the line on the
// screen. So this hook never toasts, never changes the screen, and never
// re-picks the card: it swaps the route the walk is drawn from and nothing
// else (shellState, `reroute`).
//
// And it must TERMINATE. Some places are simply not on the graph: the middle
// of a square, a courtyard, a mall, an indoor fix that has drifted a block.
// A walker standing there is beyond 40 m of the nearest edge no matter how
// often the walk is replanned, so "still far from the line" cannot on its own
// be a reason to plan again — that is an unbounded run of synchronous
// `planAB` calls on their phone (review fix round 1, B-1). Two things stop
// it: the distance is measured against the whole DRAWN line, connector
// included (`useWalk`, `onPath`), so a rerouted walk that starts at the
// walker's own feet reads as 0 m off; and if a reroute nevertheless fails to
// help, the walk is marked **off-network** and no further reroute is tried
// until the walker is back within OFF_ROUTE_M of the line they have.
//
// Only the Route tab reroutes. A loop has no destination to be re-routed to
// — replanning `planLoops` from where the walker stands hands them a
// DIFFERENT walk, which is the one thing a silent recompute must not do
// (DECISIONS 2026-09-07).
import { useEffect, useRef } from "react";
import type { LngLat } from "../components/MapView";
import { debugLog } from "../debug";
import { planAB } from "../plan/plan";
import type { Settings } from "../plan/settings";
import type { Graph } from "../router/graph";
import { kindsOf, restoreSelected } from "./kinds";
import { offRoute, onPath, OFF_ROUTE_M, type OffSample } from "./nav";
import { tripSettings, type Action, type ShellState } from "./shellState";
import { DAY_END_MIN, DAY_START_MIN, nowMinutes } from "./time";
import type { Walk } from "./useWalk";

/** Readings older than this cannot be part of a ten-second run any more, and
 *  a walk is long: the buffer is trimmed rather than grown for an hour. */
const KEEP_MS = 30_000;

/** Did the replan actually do anything for the walker? Either it put them on
 *  the line (inside the tolerance) or it at least brought the line closer.
 *  Anything else means the walk is off-network and planning it again would
 *  produce the same answer for ever.
 *
 *  Pure, so the loop it guards can be tested without a browser. */
export function rerouteHelps(beforeM: number, afterM: number): boolean {
  return afterM < OFF_ROUTE_M || afterM < beforeM;
}

/** The minute a reroute prices its new route at (CLAUDE.md rule 4: shade is
 *  read at the time the walker is THERE, never at a departure that has been
 *  and gone).
 *
 *  Under "leave now" the wall clock is the answer, and the shell's own
 *  `startMin` is following it anyway. Under an explicit leave-at — or a `?t=`
 *  share link — `startMin` is frozen at a departure the walker left from, so
 *  the honest reading is that departure plus however long they have been
 *  walking. Either way the new route is priced for the sun that is actually
 *  out, which is what the ETA strip above it already assumes. */
export function rerouteMin(
  leaveNow: boolean,
  startMin: number,
  elapsedMin: number,
  nowMin: number
): number {
  const m = leaveNow ? nowMin : startMin + Math.max(0, elapsedMin);
  return Math.min(DAY_END_MIN, Math.max(DAY_START_MIN, Math.round(m)));
}

export function useReroute(
  s: ShellState,
  dispatch: (a: Action) => void,
  graph: Graph | null,
  settings: Settings,
  /** Minutes since midnight at which the sun sets today, in this city: the
   *  reroute decides `night` from ITS OWN minute, not the shell's. */
  sunsetMin: number,
  walk: Walk
): void {
  const samples = useRef<OffSample[]>([]);
  /** The walk is off the network: replanning it produced a line no closer
   *  than the one it replaced. Cleared the moment the walker is back within
   *  OFF_ROUTE_M of the line they have. */
  const offNetwork = useRef(false);
  /** When the walk began, so a leave-at walk can be priced for now. */
  const startedAt = useRef(Date.now());

  const walkScreen = s.tab === "route" && s.route.k === "navigate" ? s.route : null;
  const navigating = walkScreen !== null;
  const dest: LngLat | null = walkScreen?.dest ?? null;
  const offM = walk.onPath?.offM ?? null;
  const gps = s.gps;
  const plan = s.plan;

  // A new walk starts on the line by definition; so does a rerouted one.
  useEffect(() => {
    samples.current = [];
  }, [navigating, plan]);
  useEffect(() => {
    if (!navigating) return;
    startedAt.current = Date.now();
    offNetwork.current = false;
  }, [navigating]);

  useEffect(() => {
    if (!navigating || !graph || !gps || !dest || offM === null || !plan) return;
    // Back on the line: whatever happened before, the walk is on the network
    // again and the next detour earns a fresh recompute.
    if (offM <= OFF_ROUTE_M) offNetwork.current = false;
    if (offNetwork.current) return;

    const now = Date.now();
    const kept = [...samples.current, { t: now, m: offM }].filter((x) => now - x.t <= KEEP_MS);
    samples.current = kept;
    if (!offRoute(kept)) return;

    // The pick has to survive: a reader walking the "Quieter" alternative
    // must still be walking a quiet one after the swap (kinds.ts).
    const want = { kinds: kindsOf(plan), selected: s.selected };
    const eff = tripSettings(s, settings);
    const at = rerouteMin(s.leaveNow, s.startMin, (now - startedAt.current) / 60_000, nowMinutes());
    let next = null;
    try {
      next = planAB(graph, gps, dest, at, s.pref, eff, at >= sunsetMin);
    } catch (e) {
      debugLog.current?.(`reroute failed: ${e}`);
    }
    samples.current = [];
    if (!next) return; // no route from here: keep the old line rather than none

    // Did it help? Measured the same way the walk measures itself, against
    // the new plan's own drawn line — connector and stubs included.
    const pick = restoreSelected(next, want);
    const cand = [next.recommended, ...next.alternatives][pick] ?? next.recommended;
    const drawn = [...next.connectors, next.head, cand.tail ?? next.tail].filter(
      (p) => p.length > 1
    );
    const after = onPath(graph, cand.nodes, gps, 0, drawn)?.offM ?? offM;
    offNetwork.current = !rerouteHelps(offM, after);
    debugLog.current?.(
      `reroute: ${Math.round(offM)} m off -> ${Math.round(after)} m` +
        (offNetwork.current ? " (off-network, no more)" : "")
    );
    dispatch({ type: "reroute", plan: next, selected: pick });
    // `offM` is the only input that moves per fix; everything else is read at
    // the moment the recompute fires, and re-running on a settings change
    // would replan a walk that is perfectly on its line
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offM, gps, navigating]);
}
