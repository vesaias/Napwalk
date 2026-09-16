// A spoofed position for testing on a real phone (Viktor, 2026-09-08):
// there is no location spoof in mobile Safari, and the desktop tricks are
// clumsy. Debug-only: `?debug=1&fix=lng,lat` puts the walker anywhere, and
// `&walk=1` moves them along the selected route at walking pace (`walk=5`
// five times faster) once a walk has been started. Nothing here runs
// without `?debug` in the URL — the flag is read once at import, the same
// seam as the map handle in MapView.
import { useEffect, useRef } from "react";
import type { FeatureCollection } from "geojson";
import { isLngLat } from "../lngLat";
import { SPEED_M_PER_MIN } from "../router/astar";
import { distanceM } from "./geo";
import { bearingDeg } from "./nav";
import type { Action, ShellState } from "./shellState";

type Spoof = { fix: [number, number] | null; walk: number };

function readSpoof(): Spoof {
  const none: Spoof = { fix: null, walk: 0 };
  if (typeof location === "undefined") return none;
  const p = new URLSearchParams(location.search);
  if (!p.has("debug")) return none;
  const raw = p.get("fix")?.split(",").map(Number) ?? [];
  const fix: [number, number] | null =
    raw.length === 2 && isLngLat([raw[0], raw[1]]) ? [raw[0], raw[1]] : null;
  const walk = Number(p.get("walk") ?? 0);
  return { fix, walk: Number.isFinite(walk) && walk > 0 ? walk : 0 };
}

const SPOOF = readSpoof();
const TICK_MS = 1000;

/** The drawn line's coordinates, first feature marked `selected` (mapData
 *  draws every candidate; the walk follows the one the reader picked). */
function walkLine(fc: FeatureCollection): [number, number][] {
  const f =
    fc.features.find((x) => x.properties?.selected === true) ?? fc.features[0];
  if (!f || f.geometry.type !== "LineString") return [];
  return f.geometry.coordinates as [number, number][];
}

/** Whether a spoof is active: the shell then leaves the real geolocation off. */
export const SPOOFED = SPOOF.fix !== null;

export function useFakeWalk(
  s: ShellState,
  dispatch: (a: Action) => void,
  routeLines: FeatureCollection
): void {
  const along = useRef(0); // metres walked along the line
  const walking =
    s.tab === "route" ? s.route.k === "navigate" : s.wander.k === "navigate";

  // the pinned fix, once — and again whenever nothing is walking
  useEffect(() => {
    if (!SPOOF.fix || walking) return;
    along.current = 0;
    dispatch({ type: "gps", pos: SPOOF.fix });
  }, [walking, dispatch]);

  // the walk: advance along the selected line every second
  useEffect(() => {
    if (!SPOOF.fix || !SPOOF.walk || !walking) return;
    const line = walkLine(routeLines);
    if (line.length < 2) return;
    const step = (SPEED_M_PER_MIN / 60) * SPOOF.walk; // m per tick
    const id = window.setInterval(() => {
      along.current += step;
      let left = along.current;
      for (let i = 1; i < line.length; i++) {
        const seg = distanceM(line[i - 1], line[i]);
        if (left <= seg) {
          const t = seg === 0 ? 0 : left / seg;
          dispatch({
            type: "gps",
            pos: [
              line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
              line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t,
            ],
            // ...facing along the segment, as a moving phone's fix would
            // say — so the arrow can be tried without one (2026-09-16)
            heading: bearingDeg(line[i - 1], line[i]),
          });
          return;
        }
        left -= seg;
      }
      dispatch({ type: "gps", pos: line[line.length - 1] });
      window.clearInterval(id);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [walking, routeLines, dispatch]);
}
