// What the Locate button does, per tab.
//
// It asks for the fix and follows it — and on the two screens that SHOW the
// start point (the routes header, the Wander pill) it also takes that start
// point back to "your location" when a pin, a share link's `s=` or a tap on
// the map had replaced it. Without this there was no way back to the fix
// short of switching city or reloading (final review I2).
//
// One start point, so one reset: since CR-03 A8 there is a single `s.origin`
// and the button on either tab takes BOTH back to the live fix (backlog B3's
// ruling). `scope` is now only about which screen is showing it.
//
// Not on Home, where nothing on screen says the origin is pinned and
// silently dropping a shared start would be a surprise.
//
// A plain function, not a hook, and named like one since CR-C's review: the
// file was `useLocate.ts`, which React's hook lint keys off and which
// promised a hook this module never had (CR-C review, C6).
import { GPS_ORIGIN, type Action, type ShellState } from "./shellState";

export type LocateScope = "route" | "wander";

/** The handler factory the shell hands to both tabs. */
export function locateFor(
  s: ShellState,
  dispatch: (a: Action) => void,
  askLocation: () => void
): (scope: LocateScope) => () => void {
  return (scope) => () => {
    askLocation();
    const shown = scope === "wander" ? s.wander.k === "loops" : s.route.k === "routes";
    if (shown && s.origin.kind === "point") dispatch({ type: "origin", origin: GPS_ORIGIN });
  };
}
