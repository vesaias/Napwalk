// The GeoJSON the shell hands MapView (UI redesign Task 12, 2026-09-05).
//
// Lifted out of AppShell so the shell keeps its effects and the drawing
// rules live somewhere they can be read: which candidates are drawn, which
// one is marked selected, and the fact that an alternative may end at the
// OTHER end of the destination edge and so carries its own tail.
import type { FeatureCollection } from "geojson";
import { emptyFC } from "../components/MapView";
import type { PlanResult } from "../plan/plan";
import { routeLine } from "../router/draw";
import type { Graph } from "../router/graph";

/** One shared empty collection: a fresh literal on every render would make
 *  MapView push data into its sources on every render. */
export const NO_FC: FeatureCollection = emptyFC();

/** Every candidate of a plan as a drawn polyline, `selected` flagged so the
 *  map paints it in the route colour and the rest as alternatives. */
export function routeLinesOf(
  g: Graph | null,
  plan: PlanResult | null,
  selected: number
): FeatureCollection {
  if (!g || !plan) return NO_FC;
  const cands = [plan.recommended, ...plan.alternatives];
  return {
    type: "FeatureCollection",
    features: cands.map((c, i) => ({
      type: "Feature" as const,
      properties: { i, selected: i === selected },
      geometry: {
        type: "LineString" as const,
        // an alternative can end at the other end of the destination edge
        coordinates: routeLine(g, c.eids, plan.startMin, plan.head, c.tail ?? plan.tail),
      },
    })),
  } as FeatureCollection;
}

/** Only the selected candidate — what a walk in progress shows, and what
 *  the ghost layer keeps while the next plan is computed. */
export function selectedLineOf(
  g: Graph | null,
  plan: PlanResult | null,
  selected: number
): FeatureCollection {
  if (!g || !plan) return NO_FC;
  const c = [plan.recommended, ...plan.alternatives][selected] ?? plan.recommended;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature" as const,
        properties: { i: 0, selected: true },
        geometry: {
          type: "LineString" as const,
          coordinates: routeLine(g, c.eids, plan.startMin, plan.head, c.tail ?? plan.tail),
        },
      },
    ],
  } as FeatureCollection;
}

/** The grey dashes from a pin to the walkable point it snapped to. */
export function connectorLinesOf(plan: PlanResult | null): FeatureCollection {
  if (!plan || plan.connectors.length === 0) return NO_FC;
  return {
    type: "FeatureCollection",
    features: plan.connectors.map((c) => ({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates: c },
    })),
  } as FeatureCollection;
}

/** The lng/lat box around every LineString in a collection, for the map to
 *  fit — or null when there is nothing drawn. */
export function boundsOf(fc: FeatureCollection): [[number, number], [number, number]] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const f of fc.features) {
    if (f.geometry.type !== "LineString") continue;
    for (const [x, y] of f.geometry.coordinates) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null;
}
