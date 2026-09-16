// The two things the shell asks the network and the graph about
// (UI redesign Task 12, fix round 1 — lifted out of AppShell unchanged):
// what a typed query matches, and what is under a dropped pin.
//
// Both are debounced or aborted, and both check `signal.aborted` before
// they touch state — an abort is ours (a keystroke, a moved pin), and the
// answer on screen belongs to the question that replaced this one.
import { useEffect, useRef, useState } from "react";
import type { City } from "../cities";
import type { LngLat } from "../components/MapView";
import { reverseGeocode, searchPlaces, type Place } from "../plan/geocode";
import { shadeAround } from "../plan/hours";
import type { Graph } from "../router/graph";
import type { Action, ShellState } from "./shellState";

/** Typing settles for this long before a query leaves the device. */
const SEARCH_DEBOUNCE_MS = 300;
/** One character matches half a city; two is where results mean something. */
const MIN_QUERY = 2;

/** What the search screen knows about its own query.
 *  - `idle`    nothing has been asked, or the answer is the list below
 *  - `loading` the query has left the device and has not come back
 *  - `empty`   Photon answered, and nothing matched
 *  - `error`   Photon could not be reached, or answered with an error
 *
 *  `empty` and `error` used to be the same screen (QA F2-02/F2-05): a walker
 *  on a flaky connection saw exactly what a walker whose word matched
 *  nothing saw, with no way to tell or to retry. */
export type SearchStatus = "idle" | "loading" | "empty" | "error";
export type SearchState = { results: Place[]; status: SearchStatus };
export type PlaceSearch = SearchState & { retry: () => void };

const SEARCH_IDLE: SearchState = { results: [], status: "idle" };

/** Everything that can happen to a query, and what it leaves on screen.
 *  Pure, so the four states are testable without a network or a clock.
 *  `pending` keeps the results already showing: a keystroke should not blank
 *  the list it is about to replace. */
export type SearchEvent =
  | { k: "reset" }                    // the query got too short, or was cleared
  | { k: "pending" }                  // the debounce elapsed; the request is out
  | { k: "ok"; results: Place[] }     // Photon answered
  | { k: "fail" };                    // Photon did not

export function searchState(prev: SearchState, ev: SearchEvent): SearchState {
  switch (ev.k) {
    case "reset":
      return SEARCH_IDLE;
    case "pending":
      return { results: prev.results, status: "loading" };
    case "ok":
      return { results: ev.results, status: ev.results.length === 0 ? "empty" : "idle" };
    case "fail":
      return { results: [], status: "error" };
  }
}

/** Photon results for the search screen's query, and how that query is
 *  going. `near` biases them towards the walker, and is read from a ref so a
 *  moving fix never re-runs the query it biased.
 *
 *  The 300 ms debounce doubles as the loading row's own delay: `loading` is
 *  entered when the request leaves, which is 300 ms after the last
 *  keystroke, so a search that lands quickly never flashes one. */
export function usePlaceSearch(query: string, city: City, near: LngLat | null): PlaceSearch {
  const [state, setState] = useState<SearchState>(SEARCH_IDLE);
  const [attempt, setAttempt] = useState(0);
  const nearRef = useRef<LngLat | null>(near);
  nearRef.current = near;

  useEffect(() => {
    if (query.length < MIN_QUERY) {
      setState((p) => searchState(p, { k: "reset" }));
      return;
    }
    const ac = new AbortController();
    const id = window.setTimeout(() => {
      setState((p) => searchState(p, { k: "pending" }));
      searchPlaces(query, city, nearRef.current ?? undefined, ac.signal)
        .then((r) => {
          if (!ac.signal.aborted) setState((p) => searchState(p, { k: "ok", results: r }));
        })
        .catch(() => {
          // An abort is ours — a keystroke replaced this question, and the
          // answer belongs to the new one. Anything else is a failure the
          // walker should see.
          if (!ac.signal.aborted) setState((p) => searchState(p, { k: "fail" }));
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(id);
      ac.abort();
    };
  }, [query, city, attempt]);

  return { ...state, retry: () => setAttempt((a) => a + 1) };
}

/** The address and the shade under a dropped pin, dispatched into the pin
 *  screen as they arrive. Split in two on purpose: the shade follows the
 *  clock, the address does not — geocoding once per pin, not once per tick. */
export function usePinInfo(
  s: ShellState,
  dispatch: (a: Action) => void,
  graph: Graph | null,
  /** ui/useShadeBands.ts's counter — the shade under a pin is a reading of
   *  the same bytes a route is priced from, so it waits for the same band
   *  rather than averaging over one that has not arrived (B11). */
  bands = 0,
): void {
  // `at` is the array the longPress action stored, and pinInfo spreads the
  // screen rather than rebuilding it — so its identity IS the pin's
  const pinAt = s.route.k === "pin" ? s.route.at : null;
  const startMin = s.startMin;

  useEffect(() => {
    if (!pinAt || !graph) return;
    const shadePct = shadeAround(graph, pinAt[0], pinAt[1], startMin);
    if (shadePct === null) return; // this minute's shade band is still coming
    dispatch({ type: "pinInfo", shadePct });
  }, [pinAt, graph, startMin, dispatch, bands]);

  useEffect(() => {
    if (!pinAt) return;
    const ac = new AbortController();
    reverseGeocode(pinAt[0], pinAt[1], ac.signal).then((address) => {
      if (!ac.signal.aborted) dispatch({ type: "pinInfo", address });
    });
    return () => ac.abort();
  }, [pinAt, dispatch]);
}

/** Names for the ends a share link left unnamed: the `s=` pin and the `e=`
 *  destination. One lookup each, when the routes screen shows them. */
export function useLinkNames(s: ShellState, dispatch: (a: Action) => void): void {
  const originAt =
    s.route.k === "routes" && s.route.origin.kind === "point" && s.route.origin.label === null
      ? s.route.origin.at
      : null;
  const destAt = s.route.k === "routes" && s.route.destName === "" ? s.route.dest : null;

  useEffect(() => {
    if (!originAt) return;
    const ac = new AbortController();
    reverseGeocode(originAt[0], originAt[1], ac.signal).then((name) => {
      if (!ac.signal.aborted && name) dispatch({ type: "names", originLabel: name });
    });
    return () => ac.abort();
  }, [originAt, dispatch]);

  useEffect(() => {
    if (!destAt) return;
    const ac = new AbortController();
    reverseGeocode(destAt[0], destAt[1], ac.signal).then((name) => {
      if (!ac.signal.aborted && name) dispatch({ type: "names", destName: name });
    });
    return () => ac.abort();
  }, [destAt, dispatch]);
}
