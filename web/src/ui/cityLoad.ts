// One city's core, on the wire: the state machine behind every graph
// download there is (2026-09-15).
//
// It was written for CR-03 Q5, where it downloaded the NEXT city while the
// current one kept routing, and lived in the city sheet. Viktor, 2026-09-15:
// "When you click on a city, it should appear right away… The router graph
// loads in the background; if the user is too fast and the graph is not yet
// loaded, we just wait longer for computing." So there is no "next city" any
// more — the tap IS the switch, and what streams is the city the reader is
// already looking at. The machine did not change for that; its OWNER did
// (ui/useCity.ts `useCityGraph`), and with the owner went the module-level
// box the parsed graph used to be handed through. A graph now goes straight
// to the hook that asked for it, in `onLoaded`.
//
// What DID change, later the same day: the download says nothing. The pill
// over the map is gone (Viktor's ruling, see DECISIONS.md), and with it the
// byte count it drew, the manifest total it counted against, the throttle
// that kept it to ten emits a second, and the ✕ that stopped it. A reader
// can no longer cancel a download, so there is no "loud" abort left: every
// abort here is a change of mind (another city) or an unmount, and neither
// is anything to report.
//
// Two halves (review B-8): `createCityLoad` is the state machine — one
// download at a time, a replace-in-flight path and an abort — with the
// network and React injected; `useCityLoad` is the ten lines that wire it to
// a component. The machine is where every transition lives, so it is where
// they are tested, without a renderer.
import { useCallback, useEffect, useRef, useState } from "react";
import { coreUrls, getCity, type CityId } from "../cities";
import { loadGraph, type Graph, type LoadProgress } from "../router/graph";
import { graphFetch } from "../router/graphCache";

export type CityLoadHandlers = {
  /** The artifact is in and parsed. It is handed over rather than stored
   *  anywhere: the caller is the hook that holds the city's graph. */
  onLoaded: (id: CityId, graph: Graph) => void;
  onFailed: (id: CityId) => void;
};

export type CityLoader = {
  start: (id: CityId) => void;
};

/** Everything the machine below talks to. Both are injected so a test can
 *  drive a download without a network, a graph or a renderer. */
export type CityLoadDeps = {
  /** The handlers, read afresh each time: they close over the caller's
   *  state and change every render, while a download outlives several. */
  handlers: () => CityLoadHandlers;
  /** Fetch and parse one city's artifact. `loadGraph`, in the hook. */
  fetch: (id: CityId, opts: LoadProgress) => Promise<Graph>;
};

export type CityLoadCore = {
  start: (id: CityId) => void;
  /** Another city has taken over, or the owner went away. Abort, without a
   *  word — nobody asked about either. */
  dispose: () => void;
};

/** The one download in flight. */
type Job = { id: CityId; c: AbortController };

export function createCityLoad(deps: CityLoadDeps): CityLoadCore {
  let live: Job | null = null;

  const abort = () => live?.c.abort();

  const start = (id: CityId) => {
    // Already downloading this one — unless it has been ABORTED and is
    // merely waiting for its rejection to arrive. `live` is cleared in the
    // promise chain, a microtask later, and StrictMode remounts an effect
    // inside that window: dispose, then start the same city again. Without
    // the second half of this test that remount returned here and the city
    // never loaded at all.
    if (live?.id === id && !live.c.signal.aborted) return;
    // A tap on another city is a change of mind, not a queue: the old
    // download is dropped without a word and the new one takes over.
    abort();
    const me: Job = { id, c: new AbortController() };
    live = me;
    const finish = () => {
      if (live === me) live = null;
    };
    deps
      .fetch(id, { signal: me.c.signal })
      .then((g) => {
        finish();
        // An abort that lands between the last chunk and the parse: this
        // city is not the one on screen any more, so the graph is dropped
        // rather than adopted.
        if (me.c.signal.aborted) return;
        deps.handlers().onLoaded(id, g);
      })
      .catch(() => {
        const aborted = me.c.signal.aborted;
        finish();
        if (!aborted) deps.handlers().onFailed(id);
      });
  };

  return { start, dispose: abort };
}

export function useCityLoad(handlers: CityLoadHandlers): CityLoader {
  // Handlers close over the caller's state and change every render; the
  // download outlives several. Read them through a ref so the machine is
  // built once and a re-render cannot restart anything.
  const h = useRef(handlers);
  h.current = handlers;
  const [core] = useState(() =>
    createCityLoad({
      handlers: () => h.current,
      // the CORE for a v8 city (B11): its shade bands follow once the graph
      // is in hand and useShadeBands knows the departure
      fetch: (id, opts) => loadGraph(coreUrls(getCity(id), __BUILD__), { ...opts, fetcher: graphFetch }),
    })
  );

  // Nothing may keep streaming into a component that is gone — and quietly,
  // because an unmount is not a failure to report.
  useEffect(() => core.dispose, [core]);

  return { start: useCallback((id: CityId) => core.start(id), [core]) };
}
