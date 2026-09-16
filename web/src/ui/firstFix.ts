// The first fix takes the map with it (phone round 4 item 1, 2026-09-16).
//
// The GPS watch starts at boot (ui/useGps.ts) and the blue dot appears
// wherever the device says the reader is — but nothing moved the CAMERA
// there. `following`, which is what MapView's dot effect keys its recentre
// on, is armed only by a Locate tap, by Start, or by ▴. So a reader who had
// already granted the permission opened the app on a dot in one corner and a
// map still framing the city centre ("the map does not move to your location
// dot after accepting location services", Viktor, 2026-09-16).
//
// The answer is a ONE-SHOT, not a second kind of following: the first fix of
// a page load eases the map onto the dot at `FIRST_FIX_ZOOM`, and every fix
// after it leaves the camera alone until the reader asks. Four things stand
// it down, each of them a camera that already belongs to someone:
//
//   - a fix OUTSIDE the city's box. There is nothing to show around it, and
//     the outside-city banner ("Show Frankfurt") is what speaks there.
//   - a TRIP on the map. Routes, loops and the walk own their camera
//     (ui/mapFit.ts, HANDOVER §4.3) and a share link opens straight onto one.
//   - a RESTORED camera (B4, ui/resume.ts). Coming back to the view you left
//     is the whole point of the snapshot; the fix must not undo it.
//   - a PAN, pinch or wheel since boot. The gesture handed the map to the
//     reader (MapView's `onUserPan`) and this may not take it back.
//   - a city still being GUESSED at. On a first visit whose time zone names
//     no city the shell opens on a provisional one and asks the edge (B1,
//     ui/where.ts); the answer can move the map to another city entirely.
//     A fix inside the provisional city's box passes `inCity` while that
//     answer is in flight, and the focus it dispatches is then clamped into
//     the NEW city's `maxBounds` — which parks the map in the corner of a
//     city the reader has never been in (2026-09-16, Europe/Berlin + an edge
//     that says Paris: the camera settled on 2.516, 48.935, the NE corner of
//     Paris's padded box, instead of on Paris). The shot waits for the
//     answer; once the city is settled the ordinary rule decides.
//
// Only the decision is here, and it is pure, so all of that is testable
// without a map (firstFix.test.ts). `useFirstFix` below is the four lines of
// wiring it needs — the page-load memory and the pan flag — kept beside it
// rather than in AppShell, which is at its line budget.
import { useEffect, useRef } from "react";
import { inCity, type City } from "../cities";
import type { LngLat } from "../components/MapView";
import type { Action } from "./shellState";

/** Close enough to read the street the dot stands in, and far enough out to
 *  keep a block of context around it. The city opens at 13 and a walk in
 *  progress runs at 17 (MapView's `NAV_ZOOM`); this sits between them. */
export const FIRST_FIX_ZOOM = 15;

export type FirstFixInput = {
  /** The device's position, or null while there is none. */
  fix: LngLat | null;
  /** The city the shell is showing — its box is the test. */
  city: City;
  /** Is a walk on the map, planned or being walked? */
  trip: boolean;
  /** Has the reader moved the map themselves since boot? */
  panned: boolean;
  /** Did this page load come back to a stored camera (B4)? */
  resumed: boolean;
  /** Has the one shot already been spent? */
  done: boolean;
  /** Is the city still the boot guess, with the edge's answer in flight? */
  guessing: boolean;
};

/** Should this fix take the camera with it? */
export function focusFirstFix(i: FirstFixInput): boolean {
  if (i.done || i.panned || i.resumed || i.trip || i.guessing) return false;
  if (i.fix === null) return false;
  return inCity(i.city, i.fix[0], i.fix[1]);
}

export type FirstFix = {
  /** Hand to MapView's `onUserPan`: a gesture spends the shot. */
  onPan: () => void;
};

/** Watch the fix, and move the map onto the first one that qualifies. */
export function useFirstFix(
  fix: LngLat | null,
  dispatch: (a: Action) => void,
  o: { city: City; trip: boolean; resumed: boolean; guessing: boolean }
): FirstFix {
  const { city, trip, resumed, guessing } = o;
  const done = useRef(false);
  const panned = useRef(false);
  useEffect(() => {
    const at = fix;
    if (
      !focusFirstFix({
        fix: at,
        city,
        trip,
        resumed,
        guessing,
        panned: panned.current,
        done: done.current,
      })
    ) {
      return;
    }
    done.current = true;
    dispatch({ type: "focus", at, zoom: FIRST_FIX_ZOOM });
  }, [fix, city, trip, resumed, guessing, dispatch]);
  return {
    onPan: () => {
      panned.current = true;
    },
  };
}
