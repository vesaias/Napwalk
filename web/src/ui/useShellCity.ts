// Everything the shell downloads, and the order it downloads it in (phone
// round 3, items 2, 5 and 12).
//
// Five things used to sit in five lines of AppShell: the edge's guess at
// which city this is, the routing graph, the shade bands, the data border,
// and — since CR-03 Q5 — a second city arriving in the background. Item 12
// turned them into one question, so they live in one hook:
//
//   "make the map load ASAP, the tiles themselves. Rest can be post-loaded
//    to make at least the illusion we are not loading 30 MB."
//
// Which means: nothing is in flight until the basemap has painted. Neither
// the 4–34 MB core nor its shade bands (which wait on the core anyway). Then
// the core, over a map the reader can already pan — and in silence, since
// Viktor dropped the compact loader (2026-09-15): the only wait shown for a
// graph is the skeleton on the screen that asked for a walk. Then the bands,
// as before.
//
// The cap is the other half of the rule. A tile host that is down, a style
// whose sprite never arrives, a viewport over the sea — each of them leaves
// the map's `idle` unfired, and routing must not wait on any of them for
// ever. `useBootPaint` opens the gate at 1.5 s whatever the map is doing.
import { useCallback } from "react";
import type { City, CityId } from "../cities";
import type { Graph } from "../router/graph";
import type { BorderGeom } from "../shade/ShadeLayer";
import { useBootPaint } from "./bootPhase";
import { BOOT_EDGE } from "./boot";
import type { Action, ShellState } from "./shellState";
import { useCityBorder, useCityGraph, useEdgeCity } from "./useCity";
import type { SettingsStore } from "./useSettings";
import { useShadeBands } from "./useShadeBands";

export type ShellCity = {
  graph: Graph | null;
  /** The shade-band counter: it changes whenever one lands (useShadeBands). */
  bands: number;
  /** The city on screen is still the boot GUESS and the edge has not
   *  answered (B1). Round 4's first-fix camera waits for it: a focus
   *  dispatched under the provisional city is clamped into the next one's
   *  maxBounds (ui/firstFix.ts). */
  cityGuessPending: boolean;
  border: BorderGeom | null;
  /** The basemap has not drawn yet: the one spinner left, and it is the
   *  MAP's (ui/bootPhase.ts). The graph never puts anything on screen. */
  mapWait: boolean;
  /** MapView's first-paint callback — the gate everything else hangs off. */
  onPainted: () => void;
  /** Retry, for the cityFailed card (QA F2-07) and for the planner's own
   *  one retry after a failed download (ui/usePlanner.ts). */
  retry: () => void;
  /** A row in the city sheet was tapped (item 5, and 2026-09-15). */
  pickCity: (id: CityId) => void;
};

export function useShellCity(
  s: ShellState,
  dispatch: (a: Action) => void,
  store: SettingsStore,
  city: City
): ShellCity {
  // On a first visit whose time zone named no city, the one request B1
  // makes: Cloudflare's own answer to "which city is this?" (ui/where.ts,
  // functions/api/where.ts). It was fired at import; this waits for it, so
  // the graph load does not download the wrong city. The hold ends the
  // moment the reader picks a city themselves — an answer nobody waits for
  // must not hold the graph for 1.5 s (S7 F6).
  const edgePending = useEdgeCity(BOOT_EDGE, city.id, store.defaultCity);
  const paint = useBootPaint();
  const hold = (edgePending && !store.cityChosen) || !paint.gate;
  const { graph, reload } = useCityGraph(city, dispatch, hold);

  // The core arrives without shade (artifact v8, B11): this downloads the
  // bands the chosen departure needs, then the rest in the background, and
  // returns a number that changes whenever one lands. Everything that
  // PRICES a minute takes it, so the answer appears the moment it can be
  // computed — and never before, which is CLAUDE.md rule 4.
  const bands = useShadeBands(city, graph, s.startMin);
  const border = useCityBorder(city);

  // …and the switch to another city, which is now three lines and no machine
  // of its own (2026-09-15). Viktor: "When you click on a city, it should
  // appear right away, with tiles loaded fast. The router graph loads in the
  // background; if the user is too fast and the graph is not yet loaded, we
  // just wait longer for computing."
  //
  // So the tap WRITES the city. The record moves, the sheet closes, the
  // reducer clears the pin, the destination and the plan — they belong to
  // the city that is going — and MapView widens its bounds, jumps the camera
  // and rebuilds the style on the new city's pmtiles, all in the same frame.
  // `useCityGraph` above sees the new city, drops the old graph and starts
  // the core. Nothing waits for the artifact except the planner.
  //
  // What this replaced (CR-03 Q5, round 3 item 5) was the opposite trade:
  // the next city streamed in the background and the switch happened on the
  // PARSE, so the reader sat on the old city's map for 10-30 s with a byte
  // count over it. That protected a walk in progress from a download the
  // reader might cancel; it also made "click on a city" mean "ask for a city
  // and wait". The walk is protected by the fact that a tap is one tap back.
  const pickCity = useCallback(
    (id: CityId) => {
      // The row you are already on closes the sheet and does nothing else
      // (reducer, review B3).
      dispatch({ type: "city", changed: id !== city.id });
      if (id === city.id) return;
      store.patch({ city: id });
    },
    [city.id, dispatch, store]
  );

  return {
    graph,
    bands,
    cityGuessPending: edgePending && !store.cityChosen,
    border,
    mapWait: !paint.painted,
    onPainted: paint.onPainted,
    retry: reload,
    pickCity,
  };
}
