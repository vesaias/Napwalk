// Which shade bands are in, and getting the rest of them (backlog B11).
//
// The core arrives with no shade at all. This hook downloads the bands the
// chosen departure needs FIRST — nothing can be planned before they land —
// and then walks the DAY'S WALKING WINDOW one band at a time, at low
// priority, so a scrub or a later departure inside the next few hours is
// priceable before anybody asks for it.
//
// It used to walk every band of the city, for ever. That made rule 7's
// "what a session downloads" the whole city — Berlin 45.45 MB, NYC 38.18,
// measured live at ten graph requests inside fifteen seconds for one
// Frankfurt A→B (P1 review F3). Everything outside the walking window is
// fetched when something ASKS: a departure the reader sets, the scrubber's
// minute, or a screen that prices the whole daylight day declaring itself
// through `useWholeDayBands` below (the leave-at sheet, and the hour strip
// on the frames that draw it). `bandsReady` keeps the answer honest until
// the file lands, exactly as it does for the departure's own bands.
//
// It returns a version number, not the graph and not the bytes: the graph
// object never changes identity when a band lands (the store is mutated in
// place, deliberately — see GraphContext's note on what a Graph as a React
// value costs), so a plain number is what makes the tree re-render.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { isBanded, shadeBandUrl, type City } from "../cities";
import { debugLog } from "../debug";
import {
  bandLoaded,
  bandsForMinutes,
  dropShadeBands,
  loadShadeBand,
  type Graph,
} from "../router/graph";
import { forgetGraph, graphFetch } from "../router/graphCache";
import { cityClock } from "./time";

/** How far either side of the departure must be priceable before a plan can
 *  be computed.
 *
 *  Fifteen minutes back because the leave-at slider and a clock tick both
 *  move the departure a little without meaning a new question; three hours
 *  forward because that is longer than any walk this app plans, and the A*
 *  frontier reaches past the answer it settles on. At the shipped band width
 *  (2 h) that span touches two or three bands. */
export const PREFETCH_BEFORE_MIN = 15;
export const PREFETCH_AFTER_MIN = 180;

/** How far either side of the city's own clock the background walk reaches:
 *  the day's walking window. Three hours is the same span `PREFETCH_AFTER_MIN`
 *  calls "longer than any walk this app plans", taken in both directions
 *  because a departure a reader nudges backwards is as likely as one they
 *  push forward. At the shipped band width (2 h) it is three or four bands. */
export const WALKING_WINDOW_MIN = 180;

// --- who is asking for the whole day -------------------------------------
//
// A screen that prices EVERY daylight hour — the leave-at sheet, and the
// hour strip on the frames that draw it — says so while it is mounted, and
// the background walk adds those bands to the ones it was going to fetch
// anyway. It is a module store rather than a prop because the ask comes from
// deep in the tree (Routes, LeaveAtSheet) and is read at the top of it
// (AppShell's `useShadeBands`), which is the same shape and the same reason
// as `ui/sheetSnapStore.ts`.
const asks = new Map<string, number>();
const demandSubs = new Set<() => void>();
let demand = "";

function recomputeDemand(): void {
  let lo = Infinity;
  let hi = -Infinity;
  for (const key of asks.keys()) {
    const [a, b] = key.split(",").map(Number);
    lo = Math.min(lo, a);
    hi = Math.max(hi, b);
  }
  const next = asks.size === 0 ? "" : `${lo},${hi}`;
  if (next === demand) return;
  demand = next;
  for (const fn of demandSubs) fn();
}

function subscribeDemand(fn: () => void): () => void {
  demandSubs.add(fn);
  return () => {
    demandSubs.delete(fn);
  };
}

const currentDemand = () => demand;
const noDemand = () => "";

/** Declare, while this component is mounted, that it prices every minute of
 *  [fromMin, toMin] and therefore needs every band under them.
 *
 *  `active` is what keeps the phone honest: the routes sheet passes its hour
 *  strip to the TALL snap, so the ask belongs to the snap being open and not
 *  to the sheet existing. An inactive ask is no ask at all. */
export function useWholeDayBands(fromMin: number, toMin: number, active: boolean): void {
  useEffect(() => {
    if (!active || !(toMin > fromMin)) return;
    const key = `${Math.round(fromMin)},${Math.round(toMin)}`;
    asks.set(key, (asks.get(key) ?? 0) + 1);
    recomputeDemand();
    return () => {
      const n = (asks.get(key) ?? 0) - 1;
      if (n <= 0) asks.delete(key);
      else asks.set(key, n);
      recomputeDemand();
    };
  }, [fromMin, toMin, active]);
}

/** Resolve on the next `visibilitychange`, or at once if abandoned. The
 *  background walk parks on this when it has nothing left to fetch: the only
 *  thing that can undo it is a hidden tab handing its bands back, and that is
 *  announced by exactly this event (S8 review F4). */
function nextVisibilityChange(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      document.removeEventListener("visibilitychange", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    if (signal.aborted) return done();
    document.addEventListener("visibilitychange", done);
    signal.addEventListener("abort", done);
  });
}

/** Wait until the tab is visible again, or until the load is abandoned. */
function whenVisible(signal: AbortSignal): Promise<void> {
  if (!document.hidden || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (document.hidden && !signal.aborted) return;
      document.removeEventListener("visibilitychange", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    document.addEventListener("visibilitychange", done);
    signal.addEventListener("abort", done);
  });
}

/**
 * Keep this city's shade bands coming. Returns a number that changes every
 * time one lands — hand it to `usePlanner` and to anything that prices a
 * minute, so the answer appears the moment it can be computed.
 *
 * A v7 city has one band and it is already loaded, so this does nothing at
 * all for the seven cities that have not been re-exported.
 */
export function useShadeBands(city: City, graph: Graph | null, startMin: number): number {
  const [version, setVersion] = useState(0);

  // The bands the CURRENT departure needs, as a stable string. Keying the
  // effect on this rather than on `startMin` is what stops a clock tick, or
  // a drag of the leave-at slider, from cancelling a download and starting
  // it again: the set only changes when the departure crosses a band edge.
  const needKey = useMemo(() => {
    if (!graph) return "";
    return bandsForMinutes(graph, startMin - PREFETCH_BEFORE_MIN, startMin + PREFETCH_AFTER_MIN).join(",");
  }, [graph, startMin]);

  // The bands the background walk may fetch without being asked: the day's
  // walking window around the CITY's clock, plus whatever a mounted screen
  // has declared it prices (`useWholeDayBands`). Same trick as `needKey` —
  // it is the band SET that keys the effect, so a minute passing changes
  // nothing until it crosses a band edge.
  const asked = useSyncExternalStore(subscribeDemand, currentDemand, noDemand);
  const nowMin = graph ? cityClock(city).minute : 0;
  const soonKey = useMemo(() => {
    if (!graph) return "";
    const walking = bandsForMinutes(graph, nowMin - WALKING_WINDOW_MIN, nowMin + WALKING_WINDOW_MIN);
    const [from, to] = asked === "" ? [0, 0] : asked.split(",").map(Number);
    const wanted = asked === "" ? [] : bandsForMinutes(graph, from, to);
    return [...new Set([...walking, ...wanted])].sort((a, b) => a - b).join(",");
  }, [graph, nowMin, asked]);

  useEffect(() => {
    setVersion(0);
  }, [graph]);

  useEffect(() => {
    if (!graph || !isBanded(city) || needKey === "") return;
    const need = needKey.split(",").map(Number);
    // urgent first, in clock order, then the walking window (and anything a
    // screen has asked for) in clock order — and NOT the whole city, which
    // is what made a session download all of Berlin (P1 review F3).
    const soon = soonKey === "" ? [] : soonKey.split(",").map(Number);
    const rest = graph.shade.bands
      .map((b) => b.k)
      .filter((k) => soon.includes(k) && !need.includes(k));
    let live = true;
    const ac = new AbortController();

    // A backgrounded tab holds no band it is not about to need (B4's rule
    // for the DSM tiles, the same 2.5 MB-a-piece argument).
    const onHide = () => {
      if (!document.hidden || !live) return;
      const dropped = dropShadeBands(graph.shade, need);
      if (dropped > 0) debugLog.current?.(`shade bands: dropped ${dropped} while hidden`);
    };
    document.addEventListener("visibilitychange", onHide);

    const fetchBand = async (k: number, urgent: boolean) => {
      if (!live || bandLoaded(graph.shade, k)) return;
      const t0 = performance.now();
      const url = shadeBandUrl(city, k, __BUILD__, graph.shade.hash);
      try {
        await loadShadeBand(graph, k, url, {
          signal: ac.signal,
          fetcher: graphFetch,
          priority: urgent ? "high" : "low",
        });
      } catch (e) {
        // A band that arrived and was REFUSED — the wrong export's, by its
        // hash — has already been written to the cache by `graphFetch`, and
        // would be served from disk on every later visit. Take it back out
        // (S8 review F5). A band that never arrived leaves nothing behind
        // and this is a no-op.
        void forgetGraph(url);
        if (!live) return;
        // a band that will not load leaves the plan waiting; the city-failed
        // path is not right for it (the graph itself is fine), and a retry
        // on the next departure change is the honest recovery
        debugLog.current?.(`shade band ${k} failed: ${e}`);
        return;
      }
      if (!live) return;
      debugLog.current?.(
        `shade band ${k}${urgent ? " (needed)" : ""}: ${Math.round(performance.now() - t0)} ms`,
      );
      setVersion(graph.shade.version);
    };

    void (async () => {
      // The departure's own bands go out TOGETHER: they are independent
      // files, nothing can be planned until all of them are in, and running
      // them one after another paid a round trip per band for no reason
      // (measured 2026-09-10: three bands cost 2.3 s serially on emulated 4G
      // against 0.9 s in parallel). They are fetched even in a hidden tab —
      // a reader who left the app mid-plan wants the answer when they come
      // back, and it is at most three files.
      await Promise.all(need.map((k) => fetchBand(k, true)));
      // ...and the walking window follows one at a time, at low priority,
      // only while the tab is visible: nobody is waiting for these.
      //
      // FOR EVER, not once (S8 review F4): `onHide` below hands back every
      // band the departure does not need, so a tab that goes away and comes
      // back has bands to collect again — and the walk below used to be a
      // one-shot loop that had already finished, which left the leave-at
      // strip (it needs every band) gone until the departure changed. The
      // second pass is a Cache API read, not a download.
      for (;;) {
        for (const k of rest) {
          await whenVisible(ac.signal);
          if (!live) return;
          await fetchBand(k, false);
        }
        if (!live) return;
        await nextVisibilityChange(ac.signal);
        if (!live) return;
      }
    })();

    return () => {
      live = false;
      ac.abort();
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [graph, city, needKey, soonKey]);

  return version;
}
