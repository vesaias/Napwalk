// What the shell hands MapView (UI redesign Task 12, fix round 1).
//
// mapData.ts knows HOW a plan is drawn; this hook knows WHICH drawing
// applies to the screen that is up — every candidate while the routes sheet
// is choosing, only the chosen one once a walk has started, nothing at all
// anywhere else — and it keeps the previous drawing as the ghost the
// "finding shade" state shows underneath its skeletons.
import { useEffect, useMemo, useRef } from "react";
import type { FeatureCollection } from "geojson";
import { connectorLinesOf, NO_FC, routeLinesOf, selectedLineOf } from "./mapData";
import type { Graph } from "../router/graph";
import type { PlanResult, ShellState } from "./shellState";

export type RouteMap = {
  routeLines: FeatureCollection;
  connectorLines: FeatureCollection;
  /** The plan being replaced, dashed and grey — for the whole replan, quiet
   *  skeleton included, so the map never blanks between two answers. */
  ghostLines: FeatureCollection;
};

export function useRouteMap(
  s: ShellState,
  graph: Graph | null,
  plan: PlanResult | null,
  jobKey: string,
  /** The planner is busy on this job, so the screen is wearing a skeleton —
   *  quiet for the first 450 ms, shimmering after that (`Routes.tsx`,
   *  `computing || (planning && big === undefined)`).
   *
   *  Not `showSkeleton`, which is only the shimmering half: gating the ghost
   *  on that left the map — and the shade overlay riding on it — blank for
   *  the quiet 450 ms of every chip change, which is the flash CR-A 1 asked
   *  us to remove (CR-R, map.spec "stays on through the finding-shade
   *  skeleton"). */
  replanning: boolean
): RouteMap {
  // Which screen is up depends on the TAB as well as the screen: the route
  // tab keeps its own screen while Wander is showing, and drawing the loop
  // plan under the route tab's rules would put an A→B walk's lines on it.
  const onRoutes =
    s.tab === "route" ? s.route.k === "routes" : s.tab === "wander" && s.wander.k === "loops";
  const walking =
    s.tab === "route"
      ? s.route.k === "navigate" || s.route.k === "arrived"
      : s.tab === "wander" && (s.wander.k === "navigate" || s.wander.k === "arrived");
  const selected = s.selected;

  const routeLines = useMemo(() => {
    if (onRoutes) return routeLinesOf(graph, plan, selected);
    if (walking) return selectedLineOf(graph, plan, selected);
    return NO_FC;
  }, [graph, plan, onRoutes, walking, selected]);

  const connectorLines = useMemo(
    () => (onRoutes || walking ? connectorLinesOf(plan) : NO_FC),
    [plan, onRoutes, walking]
  );

  // Keyed by the walk the lines belong to, so a NEW destination starts with
  // a clean map instead of the previous walk's ghost. Written in an effect
  // and read during render, which is what makes it hold the PREVIOUS plan.
  const ghostRef = useRef<{ key: string; fc: FeatureCollection }>({ key: "", fc: NO_FC });
  useEffect(() => {
    if (routeLines !== NO_FC) ghostRef.current = { key: jobKey, fc: routeLines };
  }, [routeLines, jobKey]);

  return {
    routeLines,
    connectorLines,
    // …and only on the screen that draws walks: a place card sitting on the
    // same jobKey must not inherit the routes screen's ghost, or its shade.
    ghostLines:
      (onRoutes || walking) && replanning && ghostRef.current.key === jobKey
        ? ghostRef.current.fc
        : NO_FC,
  };
}
