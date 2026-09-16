// The city the shell is showing: its routing graph and its data border
// (UI redesign Task 12, fix round 1 — lifted out of AppShell unchanged).
//
// Both hang off the settings and nothing else, and neither has anything to
// say about a screen — which is why they were the easiest 40 lines to take
// out of the shell. `useTheme` lived here too until 2026-09-06; it now has
// its own file, because a theme that follows the sun has to tick.
import { useCallback, useEffect, useRef, useState } from "react";
import { coreUrls, getCity, type City, type CityId } from "../cities";
import { borderUrl } from "../components/MapView";
import { debugLog } from "../debug";
import { t } from "../i18n/t";
import type { Graph } from "../router/graph";
import { noteCityStem, pruneGraphCache, stemOf } from "../router/graphCache";
import type { BorderGeom } from "../shade/ShadeLayer";
import { useCityLoad } from "./cityLoad";
import type { Action } from "./shellState";
import { cityFromEdge, type EdgeWhere } from "./where";

/** The routing graph for the city on screen. Nothing is told to the reader
 *  while it arrives.
 *
 *  Since 2026-09-15 this is the ONLY graph download in the app. A city
 *  switch used to be a second one — the next city streamed under its own
 *  machine while the current one kept routing, and the settings record moved
 *  only once the artifact had parsed (CR-03 Q5). Viktor: "When you click on
 *  a city, it should appear right away, with tiles loaded fast. The router
 *  graph loads in the background; if the user is too fast and the graph is
 *  not yet loaded, we just wait longer for computing." So the tap moves the
 *  record, the map goes at once, the graph is DROPPED, and this hook loads
 *  the new one from nothing — which is exactly what it already did on a page
 *  load. One path, one machine (ui/cityLoad.ts), and the thing that waits is
 *  the planner (ui/usePlanner.ts), which now treats "no graph yet" as
 *  computing rather than as no route.
 *
 *  Later the same day the last thing this hook had to SAY went too: the
 *  compact pill over the map — city name, byte count, bar, ✕ — is gone, so
 *  there is no progress to report, no download to cancel, and the graph
 *  arrives in silence. What is left is a graph, or a failure.
 *
 *  A failure is reported into the shell (Task 14): the artifact is 4–34 MB
 *  over a mobile connection, and when it never arrives every screen that
 *  needs a plan used to shimmer for ever with nothing to say. */
export type CityGraph = {
  graph: Graph | null;
  /** Ask for the artifact again. The Retry on the cityFailed card, so a
   *  failure a walker can see is a failure they can act on (QA F2-07) — a
   *  dropped connection is the usual cause and it usually comes back — and
   *  the planner's own one retry, so a reader who asks for a walk after a
   *  failed download is never left on a skeleton with no end
   *  (ui/usePlanner.ts, 2026-09-15). */
  reload: () => void;
};

/** `hold` is TWO waits, and the caller ANDs them.
 *
 *  The first is B1's: on a first visit whose time zone named no city, the
 *  edge has been asked which city this is (ui/boot.ts) and the
 *  answer may still arrive. Starting the download now would mean throwing
 *  away up to 34 MB of the wrong city's artifact a moment later, so the load
 *  waits — for the round trip, and at most WHERE_TIMEOUT_MS. It is false on
 *  every other page load there is: a stored city, a share link, or a zone
 *  with one city in it all skip the request entirely. It also ends early
 *  when the reader picks a city while the request is still out — see
 *  `AppShell`'s `store.cityChosen` (S7 review F6).
 *
 *  The second is round 3 item 12's: the basemap paints first, and the core
 *  is not asked for until it has (or until the 1.5 s cap, ui/bootPhase.ts). */
export function useCityGraph(city: City, dispatch: (a: Action) => void, hold = false): CityGraph {
  const [graph, setGraph] = useState<Graph | null>(null);
  // Bumped by `reload`: the effect below hangs off it, so a retry is one
  // more run of exactly the same load rather than a second code path.
  const [attempt, setAttempt] = useState(0);

  const fail = useCallback(
    (id: CityId) => {
      dispatch({ type: "graph", failed: true });
      dispatch({ type: "toast", text: t("edge.cityFailed", { city: t(`city.${id}`) }) });
    },
    [dispatch]
  );

  const { start } = useCityLoad({
    onLoaded: (id, g) => {
      setGraph(g);
      dispatch({ type: "graph", failed: false });
      debugLog.current?.(
        `graph ${id}: ${g.nNodes} nodes ${g.nEdges} edges, ${g.shade.bands.length} shade band(s)`
      );
      // ...and the cities before the last two go, once THIS one is safely
      // parsed: evicting earlier would risk dropping a city whose core
      // turned out not to load.
      const stem = stemOf(coreUrls(getCity(id), __BUILD__)[0]);
      if (stem) void pruneGraphCache(noteCityStem(stem));
    },
    onFailed: fail,
  });

  useEffect(() => {
    // The city may still change under us — nothing has been dropped and
    // nothing has failed, so the shell keeps shimmering and says nothing.
    if (hold) return;
    // The old city's graph goes the moment the new city does. It is the
    // walker's whole world and it is the wrong city's: a plan off it would
    // be a route through Frankfurt drawn on a map of Berlin.
    setGraph(null);
    if (!city.available) {
      dispatch({ type: "graph", failed: true });
      dispatch({ type: "toast", text: t("edge.cityFailed", { city: t(`city.${city.id}`) }) });
      return;
    }
    dispatch({ type: "graph", failed: false });
    // graphFetch puts the Cache API in front of the network: a second visit
    // to a city reads the core (and, later, its bands) off disk instead of
    // downloading 4-34 MB again (B11 step 5). Nothing intercepts anything —
    // no service worker, which stays on the v1 cut list.
    //
    // A city that changes again mid-download aborts the first, quietly and
    // completely — every file of it (B19). That is the machine's own
    // replace-in-flight path, and it is why this effect needs no cleanup.
    start(city.id);
  }, [city, dispatch, start, attempt, hold]);

  return { graph, reload: useCallback(() => setAttempt((n) => n + 1), []) };
}

/**
 * The edge's answer to "which city is this?", applied once (backlog B1).
 *
 * The request itself is not ours — `ui/boot.ts` fired it at import, before
 * React mounted. This hook only waits for it, and returns whether it is
 * still outstanding, which is what holds the graph load above.
 *
 * `onCity` is called at most once, with a registry city, and only when the
 * edge names a DIFFERENT one from the one the shell opened on — a boot that
 * fell back to Frankfurt and an edge that says Frankfurt change nothing.
 */
export function useEdgeCity(
  edge: Promise<EdgeWhere | null> | null,
  current: CityId,
  onCity: (id: CityId) => void
): boolean {
  const [pending, setPending] = useState(edge !== null);
  // The callback and the current city are read when the answer lands, not
  // when the effect ran: both change on every render, and neither is a
  // reason to re-subscribe to a promise that was created once.
  const now = useRef({ current, onCity });
  now.current = { current, onCity };
  useEffect(() => {
    if (!edge) return;
    let live = true;
    void edge.then((w) => {
      if (!live) return;
      const id = cityFromEdge(w);
      debugLog.current?.(`edge: ${w === null ? "no answer" : (id ?? "no city")}`);
      if (id !== null && id !== now.current.current) now.current.onCity(id);
      setPending(false);
    });
    return () => {
      live = false;
    };
  }, [edge]);
  return pending;
}

/** The city's data border, for the screens that ask where the walker stands
 *  relative to it (ui/outside.ts). The map fetches the same document for its
 *  own line, wash and shade clip; this is the second reader of a small,
 *  cached, versioned file rather than a prop threaded out of MapView. */
export function useCityBorder(city: City): BorderGeom | null {
  const [border, setBorder] = useState<BorderGeom | null>(null);
  useEffect(() => {
    let cancelled = false;
    setBorder(null);
    fetch(borderUrl(city.id))
      .then((r) => (r.ok ? (r.json() as Promise<GeoJSON.Feature>) : null))
      .then((f) => {
        if (!cancelled) setBorder((f?.geometry as BorderGeom | undefined) ?? null);
      })
      .catch(() => {
        if (!cancelled) setBorder(null);
      });
    return () => {
      cancelled = true;
    };
  }, [city]);
  return border;
}
