// Why the routes screen has nothing to show (UI redesign Task 12, fix round 1).
//
// "No plan" has two quite different causes, and the screen used to blame the
// second for the first: a walk with no START POINT (location off or denied,
// or a share link that carries `?e=` and no `?s=`) was told there was no
// stroller route without cobbles, and offered two settings that cannot help.
//
// Pure over the shell's state and the user's settings, so the diagnosis is a
// testable function rather than a shape of JSX.
import type { CityId } from "../cities";
import type { Settings } from "../plan/settings";
import type { Access } from "../router/astar";
import { insideBorder } from "../plan/hours";
import type { BorderGeom } from "../shade/ShadeLayer";
import { tripSettings, type ShellState } from "./shellState";
import { originAt } from "./usePlanner";

export type NoRouteReason =
  /** The city's artifact never arrived. Nothing below this matters until it
   *  does, so it is checked first; the id is here so the card can name the
   *  city without a prop threaded through two screens. */
  | { k: "cityFailed"; city: CityId }
  /** Nothing to plan FROM. The fix is a location, not a setting. */
  | { k: "noOrigin" }
  /** One end of the walk is outside the city's data: the fix (or the pinned
   *  start) or the destination. The planner refuses such a job (planJob);
   *  the card offers the city switch instead of a setting. */
  | { k: "outside"; end: "origin" | "dest"; city: CityId }
  /** The planner ran and found nothing. `canAllowCobbles` / `canWalkMode`
   *  say which of the two offers could actually change the answer — with
   *  cobbles already allowed, "Allow cobbles" is a button that does nothing
   *  (and cobbles are allowed by default). `access` is the mode the walk was
   *  refused FOR, so the card can name it: the title used to say "stroller"
   *  whatever the header's chip said (review B-4). */
  | { k: "noRoute"; access: Access; canAllowCobbles: boolean; canWalkMode: boolean };

/** The walk on the routes screen has a start point: a pinned origin always,
 *  "your location" only once there is a fix. */
export function hasOrigin(s: ShellState): boolean {
  if (s.route.k !== "routes") return s.origin.kind === "point" || s.gps !== null;
  return s.route.origin.kind === "point" || s.gps !== null;
}

/** What to tell the reader when `plan` is null and nothing is computing. */
export function noRouteReason(
  s: ShellState,
  settings: Settings,
  border: BorderGeom | null = null
): NoRouteReason {
  if (s.graphFailed) return { k: "cityFailed", city: settings.city };
  if (!hasOrigin(s)) return { k: "noOrigin" };
  if (border && s.tab === "wander" && s.wander.k === "loops") {
    const from = originAt(s.origin, s.gps);
    if (from && !insideBorder(border, from[0], from[1])) {
      return { k: "outside", end: "origin", city: settings.city };
    }
  }
  if (border && s.tab === "route" && s.route.k === "routes") {
    const from = originAt(s.route.origin, s.gps);
    if (from && !insideBorder(border, from[0], from[1])) {
      return { k: "outside", end: "origin", city: settings.city };
    }
    if (!insideBorder(border, s.route.dest[0], s.route.dest[1])) {
      return { k: "outside", end: "dest", city: settings.city };
    }
  }
  // The two offers are about the walk on screen, so they read the walk's
  // OWN access pair — the access chip's per-trip override over the settings
  // (shellState.tripSettings). Tapping "Allow cobbles" sets that override,
  // and the card must stop offering it afterwards.
  const eff = tripSettings(s, settings);
  return {
    k: "noRoute",
    access: eff.access,
    canAllowCobbles: eff.avoidCobbles,
    canWalkMode: eff.access !== "walk",
  };
}
