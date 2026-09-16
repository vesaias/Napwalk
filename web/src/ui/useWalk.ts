// The numbers a walk in progress needs (UI redesign Task 12, fix round 1).
//
// Three things the shell derives from the plan and the live fix: which
// candidate is on screen, how far the destination still is (and therefore
// when the walk is over), what is left of the route — plus the departure-hour
// profile the leave-at sheet reads, which lives here because it too is a
// measurement OF the plan rather than a piece of the shell's state.
//
// Task 13 added Wander's walks, which are the same three questions asked of
// a route that ends where it began: the destination is the loop's first
// node, arrival needs the walker to have gone away first, and "what is left"
// has to know how far along they are (nav.ts) or a self-crossing loop reads
// as barely started.
import { useEffect, useMemo, useRef } from "react";
import type { LngLat } from "../components/MapView";
import { shadeByHour } from "../plan/hours";
import type { Candidate } from "../plan/plan";
import type { Daylight } from "../router/astar";
import { bandsReady, type Graph } from "../router/graph";
import { ARRIVED_M, LEFT_M, distanceM } from "./geo";
import { onPath, shadeAhead, type OnPath, type ShadeAhead } from "./nav";
import type { Action, PlanResult, ShellState } from "./shellState";
import { nowMinutes } from "./time";

export type Walk = {
  /** The candidate the reader picked, falling back to the recommendation
   *  when a new (shorter) plan invalidates the index. */
  selCand: Candidate | null;
  /** Metres from the fix to the destination — null off a walk, or with no fix. */
  toDestM: number | null;
  /** What is still ahead, from the nearest route node on. */
  ahead: ShadeAhead | null;
  /** Where the fix sits relative to the walk's own line: how far off it is
   *  (the off-route clock reads this) and which way the route runs from
   *  there (the camera's bearing). Null off a walk, or with no fix. */
  onPath: OnPath | null;
  /** The leave-at histogram and the walk it measures, or null before any
   *  plan has landed for this walk. `pct` and `minutes` describe the
   *  SELECTED candidate — the card on top — which is what the leave-at
   *  sheet and the "same N minutes" promise are about (S2 review, finding
   *  5); `perCandidate` carries one profile for every candidate, in the
   *  order the cards are rendered, so the "no shade after HH:MM" warning
   *  belongs to the card it sits on (slice 3 fix F3). */
  hourProfile: { pct: number[]; minutes: number; perCandidate: number[][] } | null;
};

/** How far ahead the navigate strip prices the walk. `shadeAhead`'s own
 *  budget is a fixed number of metres; three hours is more clock than that
 *  can ever cover at 4 km/h, so it is a safe span to require. */
const AHEAD_MIN = 180;

export function useWalk(
  s: ShellState,
  dispatch: (a: Action) => void,
  graph: Graph | null,
  plan: PlanResult | null,
  jobKey: string,
  /** The day's daylight hours (plan/hours.ts `daylightHours`) — one profile
   *  entry per bar the leave-at sheet draws. */
  hours: number[],
  /** ...and its two ends, for the bars the artifact's shade buckets do not
   *  reach: without them a June 05:00 bar reads a fabricated 100 % and wins
   *  the "shadiest hour" badge (router/astar.ts `lerpShade`). */
  day: Daylight,
  /** ui/useShadeBands.ts's counter. The leave-at strip prices every
   *  daylight hour, so it needs EVERY band — until they are all in it
   *  reports no profile at all, which is the state `bestHour` and
   *  `HourBars` already draw as "nothing measured yet" (B11). */
  bands = 0
): Walk {
  const cands = plan ? [plan.recommended, ...plan.alternatives] : [];
  const selCand = cands[s.selected] ?? cands[0] ?? null;

  // A loop ends where it began, and the shell's own origin is no use for
  // that: under "your location" it moves with the walker. The first node of
  // the route being walked is the spot the loop came from.
  const loopWalk = s.tab === "wander" && s.wander.k === "navigate";
  const loopStart: LngLat | null =
    graph && loopWalk && selCand && selCand.nodes.length > 0
      ? [graph.lng[selCand.nodes[0]], graph.lat[selCand.nodes[0]]]
      : null;
  const navDest = s.tab === "route" && s.route.k === "navigate" ? s.route.dest : loopStart;
  const toDestM = navDest && s.gps ? distanceM(s.gps, navDest) : null;

  const navigating = (s.tab === "route" && s.route.k === "navigate") || loopWalk;

  // Close enough is arrived. 30 m is about a street crossing — as precise
  // as a phone's fix gets under the trees this app routes you towards.
  // A loop, though, STARTS on its own destination: it has arrived only once
  // it has been properly away, or every Wander walk would end on the first
  // fix after Start.
  const leftStart = useRef(false);
  useEffect(() => {
    leftStart.current = false;
  }, [jobKey, navigating]);
  useEffect(() => {
    if (toDestM === null) return;
    if (toDestM > LEFT_M) leftStart.current = true;
    if (toDestM > ARRIVED_M) return;
    if (loopWalk && !leftStart.current) return;
    // the minute is captured HERE, once: the arrived screen must not tick
    dispatch({ type: "arrived", atMin: nowMinutes() });
  }, [toDestM, loopWalk, dispatch]);

  // How far along the walk the walker is already known to be. A loop reuses
  // its own streets, so the nearest node alone would put someone on the way
  // home back at the start (nav.ts, BACKTRACK_M).
  const progress = useRef(0);
  useEffect(() => {
    progress.current = 0;
  }, [jobKey, navigating]);

  const gps = s.gps;
  const ahead = useMemo(() => {
    if (!graph || !selCand || !gps || !navigating) return null;
    const at = nowMinutes();
    // the walk ahead is priced from the clock forward; without its bands
    // there is no shade to report and the strip stays as it was
    if (!bandsReady(graph, at, at + AHEAD_MIN)) return null;
    return shadeAhead(graph, selCand, gps, at, progress.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, selCand, gps, navigating, bands]);
  useEffect(() => {
    if (ahead) progress.current = ahead.fromIdx;
  }, [ahead]);

  // The same fix measured against the LINE rather than its nodes: a walker
  // halfway down a 200 m block is 100 m from either end of it and perfectly
  // on route, so neither "off route" nor the camera's heading can be asked
  // of the nearest node (nav.ts, onPath).
  //
  // ...measured against the whole DRAWN line, not only its routing nodes:
  // a walker who is 60 m from the nearest walkable edge has a dashed
  // connector from their own feet to it (plan.ts, `connectors`), and the
  // head/tail stubs run along the first and last edges. Leaving those out
  // said "off route" about a walker standing on the line they can see, and
  // a reroute from there produced a plan that was just as far off — for
  // ever (fix round 1, B-1).
  const drawn = useMemo(() => {
    if (!plan) return [];
    const parts = [...plan.connectors, plan.head, selCand?.tail ?? plan.tail];
    return parts.filter((p) => p.length > 1);
  }, [plan, selCand]);
  const path = useMemo(() => {
    if (!graph || !selCand || !gps || !navigating) return null;
    return onPath(graph, selCand.nodes, gps, ahead?.fromIdx ?? 0, drawn);
  }, [graph, selCand, gps, navigating, ahead, drawn]);

  // One routeStats pass per daylight hour over each candidate, RETAINED
  // across a replan: a silent clock tick nulls the plan while the leave-at
  // sheet is open, and bars dropping to zero under "0 % of this walk in
  // shade — same 0 minutes" is a measurement nobody took.
  const hourNow = useMemo(() => {
    if (!graph || !plan) return null;
    // every daylight hour is priced, so every band has to be in; while the
    // background walk is still fetching them the strip shows the previous
    // profile (hourRef) or nothing, never a bar built on half a day
    if (hours.length > 0 && !bandsReady(graph, hours[0] * 60, hours[hours.length - 1] * 60 + 59)) {
      return null;
    }
    // one profile per card: at most three walks x one pass per bar (9 in
    // December, 17 in June), and the recommended walk's profile is simply
    // the first of them
    const all = [plan.recommended, ...plan.alternatives];
    const perCandidate = all.map((c) => shadeByHour(graph, c.eids, hours, day));
    // ...but the strip and the "same N minutes" promise describe the walk
    // the reader is LOOKING AT, not the recommendation. After a promotion
    // the card on top was one walk and the bars under it another's (S2
    // review, finding 5). Same fallback as `selCand` above: an index a
    // shorter replan has invalidated falls back to the recommendation.
    const i = s.selected < all.length ? s.selected : 0;
    return {
      pct: perCandidate[i],
      minutes: all[i].stats.minutes,
      perCandidate,
    };
    // `bands` is not read in the body: it is the SIGNAL that the store
    // inside `graph` has changed, which is the one thing a dependency
    // array cannot see (GraphContext keeps the graph out of React)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, plan, hours, day, s.selected, bands]);
  const hourRef = useRef<Walk["hourProfile"]>(null);
  if (hourNow) hourRef.current = hourNow;
  // a different walk invalidates the old profile rather than inheriting it
  useEffect(() => {
    hourRef.current = null;
  }, [jobKey]);

  return { selCand, toDestM, ahead, onPath: path, hourProfile: hourNow ?? hourRef.current };
}
