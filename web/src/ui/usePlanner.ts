// The shell's planner (UI redesign Task 12, fix round 1 — lifted out of
// AppShell unchanged, apart from the skeleton timer that used to sit with
// the map data).
//
// One debounced call into plan/plan.ts per question, a one-slot cache so
// walking from a place card into the routes screen does not re-ask the same
// question, and the two flags the screens read: `computing` (in the shell's
// state) and `showSkeleton` (this hook's, because it is a rendering
// decision, not a planning one).
import { useEffect, useRef, useState } from "react";
import type { LngLat } from "../components/MapView";
import { debugLog } from "../debug";
import { planAB, planLoops, planLoopsVia, type PlanResult } from "../plan/plan";
import type { Settings } from "../plan/settings";
import { insideBorder } from "../plan/hours";
import { PREFETCH_AFTER_MIN, PREFETCH_BEFORE_MIN } from "./useShadeBands";
import type { Daylight } from "../router/astar";
import { bandsReady, type Graph } from "../router/graph";
import type { BorderGeom } from "../shade/ShadeLayer";
import { pointKey } from "./geo";
import { tripSettings, type Action, type Origin, type ShellState } from "./shellState";

/** The planner is expensive enough to be worth waiting out a drag of the
 *  leave-at slider or a run of taps. */
export const PLAN_DEBOUNCE_MS = 250;
/** The skeleton sheet only appears once the wait is longer than the debounce
 *  by a visible margin — otherwise every real replan flashes one, and a plan
 *  that lands quickly replaces the old one with no flicker at all. */
export const SKELETON_MS = PLAN_DEBOUNCE_MS + 200;

export type Job =
  | { k: "ab"; start: LngLat; dest: LngLat }
  /** `via` is W3's "loop via a place": a loop planned THROUGH a point, by
   *  plan/planLoopsVia rather than by the loop planner (which has no via
   *  constraint — see DECISIONS.md 2026-09-07). With one, the place sets
   *  the length and `dur` is not asked for. */
  | { k: "loop"; start: LngLat; dur: number; via: LngLat | null };

export function originAt(o: Origin, gps: LngLat | null): LngLat | null {
  return o.kind === "point" ? o.at : gps;
}

/** What the current screen wants planned, if anything. The place and pin
 *  cards ask for the same A→B walk the routes screen would, because their
 *  minute count IS that walk. */
export function planJob(s: ShellState, border: BorderGeom | null = null): Job | null {
  // A point outside the city's data is not a place to walk from or to: the
  // router would snap it to the nearest edge — hundreds of kilometres away
  // for a fix in another city — and search from there for a very long time.
  // With the border known, such a point is no job at all; the routes screen
  // says why (noRouteReason). Without it (still loading) the point passes.
  const inside = (p: LngLat | null): LngLat | null =>
    p && border && !insideBorder(border, p[0], p[1]) ? null : p;
  if (s.tab === "wander") {
    if (s.wander.k !== "loops") return null;
    const start = inside(originAt(s.origin, s.gps));
    if (!start) return null;
    // A via outside the city's data is not a place to walk through; without
    // it the loops are the ordinary ones, which is the honest fallback.
    const via = s.trip.via ? inside(s.trip.via.at) : null;
    return { k: "loop", start, dur: s.durationMin, via };
  }
  if (s.tab !== "route") return null;
  const from = inside(originAt(s.origin, s.gps));
  switch (s.route.k) {
    case "place": {
      const dest = inside([s.route.place.lng, s.route.place.lat]);
      return from && dest ? { k: "ab", start: from, dest } : null;
    }
    case "pin": {
      const dest = inside(s.route.at);
      return from && dest ? { k: "ab", start: from, dest } : null;
    }
    case "routes": {
      const start = inside(originAt(s.route.origin, s.gps));
      const dest = inside(s.route.dest);
      return start && dest ? { k: "ab", start, dest } : null;
    }
    default:
      return null;
  }
}

/** Everything the planner reads, in one string. The effect below fires when
 *  it changes and on nothing else, so it is also the definition of "which
 *  settings replan": the city (a different graph), access, the cobble wall
 *  and the pace (a different cost and a different clock) — and not the
 *  theme, the noise layer or the language, which the planner never sees.
 *
 *  Access and the cobble wall are read through `tripSettings`: the routes
 *  header's chip overrides them for one walk, and an override the key did
 *  not carry would leave the old answer on screen (R4).
 *  Pure and exported for the test that pins that list down. */
export function planKey(jobKey: string, s: ShellState, settings: Settings, night = false): string {
  const e = tripSettings(s, settings);
  return `${e.city}|${jobKey}|${s.startMin}|${s.pref}|${e.access}|${e.avoidCobbles}|${e.pace}|${night ? "night" : "day"}`;
}

/** What the planner does with the question on screen — the one decision the
 *  effect below makes before it does anything, and the only one worth
 *  testing without a renderer.
 *
 *  "wait" is the new answer (2026-09-15). A city tap switches the map at
 *  once and the graph follows in the background, so there is now an ordinary
 *  stretch of seconds in which a reader can ask for a walk in a city whose
 *  artifact is still on the wire. Viktor: "if the user is too fast and the
 *  graph is not yet loaded, we just wait longer for computing." Before this
 *  the effect simply returned, `computing` stayed false, and the routes
 *  screen drew a no-route card — "No stroller route without cobbles", about
 *  a city it had not read a single edge of. */
export type PlanPhase =
  /** Nothing to plan, or nothing that CAN be planned. */
  | "none"
  /** The answer is coming: the graph, or the departure's shade bands. */
  | "wait"
  /** The download failed and someone is asking for a walk anyway: ask for
   *  the artifact once more (2026-09-15). */
  | "retry"
  | "run";

export function planPhase(o: {
  /** There is a question on screen (a destination, or a loop to plan). */
  hasJob: boolean;
  /** …and nothing has answered it yet (`s.plan === null`). */
  wanted: boolean;
  hasGraph: boolean;
  /** The artifact did not arrive. A screen says so and offers a Retry;
   *  a skeleton on top of it would be a wait with no end (shellState
   *  `replan` keeps the same rule). Since the loader pill went there is no
   *  other way back to a graph on screen, so a plan asked for in this state
   *  re-triggers the download itself — once, in the hook below. */
  graphFailed: boolean;
  /** The bands this departure needs are in (router/graph `bandsReady`). */
  bandsIn: boolean;
}): PlanPhase {
  if (!o.hasJob || !o.wanted) return "none";
  if (o.graphFailed) return "retry";
  if (!o.hasGraph || !o.bandsIn) return "wait";
  return "run";
}

export type Planner = {
  /** Identifies the WALK (start, destination, duration) but not the clock or
   *  the preference — the ghost route is keyed on it, because a new
   *  destination should not inherit the previous walk's lines. */
  jobKey: string;
  /** Computing, and long enough for a skeleton to be worth the flicker. */
  showSkeleton: boolean;
};

export function usePlanner(
  s: ShellState,
  dispatch: (a: Action) => void,
  graph: Graph | null,
  settings: Settings,
  border: BorderGeom | null,
  /** After sunset: the planner drops the shade term (spec §1). */
  night: boolean,
  /** The city's daylight today, in plain minutes (ui/useSunDay.ts). The
   *  router prices a minute its artifact's shade buckets do not cover by
   *  clamping to the nearest edge bucket while the sun is up, and as full
   *  shade once it is down — it cannot tell the two apart without this
   *  (router/astar.ts `lerpShade`). Stable by identity, so it may sit in
   *  the effect's inputs. */
  day: Daylight,
  /** Ask for the city's artifact again (ui/useCity.ts `reload`). Called at
   *  most once per failure, and only when a walk is actually being asked
   *  for: with the loader pill gone (2026-09-15) a failed download would
   *  otherwise be a dead end for anyone who did not notice the toast, and
   *  the cityFailed card's Retry is on the Home screen they may never go
   *  back to. */
  onReloadGraph: () => void,
  /** `ui/useShadeBands.ts`'s counter: it changes whenever a shade band
   *  lands. The planner cannot price a walk whose bands are not in — a
   *  substituted shade byte is a wrong route at a wrong time (rule 4) — so
   *  it waits, and this is what wakes it up. Always 0 for a v7 city, whose
   *  single band is loaded with the graph. */
  bands = 0
): Planner {
  const job = planJob(s, border);
  const jobRef = useRef<Job | null>(job);
  jobRef.current = job;
  const jobKey = job
    ? job.k === "ab"
      ? `ab|${pointKey(job.start)}|${pointKey(job.dest)}`
      : `loop|${pointKey(job.start)}|${job.dur}|${job.via ? pointKey(job.via) : ""}`
    : "";
  const key = planKey(jobKey, s, settings, night);
  // What the planner is actually handed: the same pair the key is built on.
  const eff = tripSettings(s, settings);

  // The last question asked of the planner, and its answer. Walking from a
  // place card into the routes screen asks the SAME question again — the
  // screen change cleared the plan, but nothing the planner reads moved —
  // so the answer is handed back instead of recomputed. Without this the
  // routes screen would sit on "finding shade" for ever: its effect has no
  // changed input to fire on.
  const askedKey = useRef("");
  const answer = useRef<PlanResult | null>(null);
  const wanted = s.plan === null;

  // A retry the planner asked for, spent. It is refilled by a graph — one
  // that lands ends the failure, and the next failure after that is a new
  // one — so a download that keeps failing is asked for once and then left
  // to the card's own Retry rather than re-fetched on every replan.
  const retried = useRef(false);

  // a different graph is a different answer to the same question
  useEffect(() => {
    askedKey.current = "";
    answer.current = null;
    if (graph) retried.current = false;
  }, [graph]);

  // Nothing to plan — no destination, or no origin because location is off.
  // Say so, rather than leaving the screen on "finding shade" for ever.
  // Keyed on `computing` as well: the pin card and the routes screen it
  // leads to can share an EMPTY job key (a fix outside the city, or none),
  // and `routeTo` sets computing again — an effect keyed on the job alone
  // never re-ran, and the screen sat on "finding shade" for good.
  const computing = s.computing;
  useEffect(() => {
    if (!jobKey && computing) dispatch({ type: "computing", on: false });
  }, [jobKey, computing, dispatch]);

  useEffect(() => {
    // Two reasons to wait, and the screens cannot tell them apart — nor
    // should they. The graph for this city is still streaming (a page load,
    // or a city tap a moment ago), or it is in and the shade bands this
    // departure needs are not (artifact v8, backlog B11). Either way: stay
    // on "finding shade", which the sheet already wears as a skeleton, and
    // come back when `graph` or `bands` changes. The band wait is bounded by
    // one band; the graph wait by the download.
    const phase = planPhase({
      hasJob: jobKey !== "",
      wanted,
      hasGraph: graph !== null,
      graphFailed: s.graphFailed,
      bandsIn:
        graph !== null &&
        bandsReady(graph, s.startMin - PREFETCH_BEFORE_MIN, s.startMin + PREFETCH_AFTER_MIN),
    });
    if (phase === "none") return;
    if (phase === "retry") {
      // The artifact did not arrive and a walk is being asked for anyway.
      // One more attempt, and exactly one: `reload` clears `graphFailed`,
      // so the next render is an ordinary "wait" with the skeleton on it —
      // and if it fails again the screen says so and stays said.
      if (retried.current) return;
      retried.current = true;
      onReloadGraph();
      return;
    }
    if (phase === "wait") {
      dispatch({ type: "computing", on: true });
      return;
    }
    if (!graph) return; // unreachable: "run" implies a graph. TS does not know.
    if (askedKey.current === key) {
      dispatch({ type: "plan", plan: answer.current });
      return;
    }
    dispatch({ type: "computing", on: true });
    const id = window.setTimeout(() => {
      const j = jobRef.current;
      if (!j) return;
      const t0 = performance.now();
      let p: PlanResult | null = null;
      try {
        p =
          j.k === "ab"
            ? planAB(graph, j.start, j.dest, s.startMin, s.pref, eff, night, day)
            : j.via
              ? planLoopsVia(graph, j.start, j.via, s.startMin, s.pref, eff, night, day)
              : planLoops(graph, j.start, j.dur, s.startMin, s.pref, eff, night, day);
        // a via loop is not a `planLoops` call and must not read as one in
        // the timing log (final review M5) — it is the slowest of the three
        debugLog.current?.(
          `plan ${j.k === "loop" && j.via ? "via" : j.k}: ${Math.round(performance.now() - t0)} ms`
        );
      } catch (e) {
        debugLog.current?.(`plan failed: ${e}`);
      }
      askedKey.current = key;
      answer.current = p;
      dispatch({ type: "plan", plan: p });
    }, PLAN_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
    // `key` carries every input the planner reads; the job itself comes
    // from the ref, so a moved pin never leaves a stale closure behind
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, key, wanted, bands, s.graphFailed, onReloadGraph]);

  // A plan that lands inside the debounce (or comes back from the cache)
  // replaces the old one without ever showing a skeleton.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!s.computing) {
      setSlow(false);
      return;
    }
    const id = window.setTimeout(() => setSlow(true), SKELETON_MS);
    return () => window.clearTimeout(id);
  }, [s.computing]);

  return { jobKey, showSkeleton: s.computing && slow };
}
