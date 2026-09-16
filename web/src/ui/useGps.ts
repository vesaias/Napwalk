// The device's location, for the shell (UI redesign Task 12, fix round 1).
//
// Lifted out of AppShell unchanged: `watchPosition` starts on the first
// Locate tap and stays on for good, the tap is remembered so a returning
// session resumes the watch without asking again, and a denial becomes a
// toast rather than a silent dead end.
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n/t";
import { motionHeading } from "./heading";
import type { Action } from "./shellState";
import { SPOOFED } from "./useFakeWalk";

const GPS_ASKED = "sw.gpsAsked";
/** A boot-time ask that was refused: never ask again unprompted, and say
 *  nothing about it until the reader taps Locate (E2). */
const GPS_REFUSED = "sw.gpsRefused";

export type Gps = {
  /** Ask for the location. The FIRST call is what triggers the browser's
   *  permission prompt, so it must come from a tap. */
  ask: () => void;
  /** True once the watch is running (or was, in an earlier session). */
  on: boolean;
};

/** `following` is the shell's, not ours: the map recentres on a tap and
 *  stops on a pan, which is a map concern. This hook only feeds fixes in. */
export function useGps(dispatch: (a: Action) => void, gpsDenied: boolean, onFollow: () => void): Gps {
  // The watch starts at boot (HANDOVER §3.1: the position is asked for
  // once for Home) unless an earlier boot-time ask was refused — then it
  // waits for a Locate tap, which is the only ask that gets a toast.
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(GPS_REFUSED) !== "1";
    } catch {
      return true;
    }
  });
  /** True until the first Locate tap of this session: a boot-time refusal
   *  is remembered, not announced. */
  const unprompted = useRef(true);

  /** One toast per Locate tap. A watch under `enableHighAccuracy` reports
   *  TIMEOUT and POSITION_UNAVAILABLE freely — indoors, most of the time —
   *  and each one used to be treated as a refusal and toasted again (M5). */
  const said = useRef(false);

  useEffect(() => {
    // a spoofed fix (`?debug=1&fix=`) replaces the device's — useFakeWalk
    if (SPOOFED || !on || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        said.current = false;
        dispatch({
          type: "gps",
          pos: [p.coords.longitude, p.coords.latitude],
          heading: motionHeading(p.coords),
        });
      },
      (err) => {
        // Only a refusal is worth reporting. The others are the watch still
        // trying: leave the last fix alone and say nothing.
        if (err.code !== err.PERMISSION_DENIED) return;
        // A refusal leaves the last fix alone too — it is the WATCH that
        // stopped, not the reader who moved. The reducer keeps whatever
        // position it has and raises `gpsDenied` beside it, so a walk resumed
        // from `nav.lastFix` keeps its walker until a real fix replaces it
        // (P2, 2026-09-10; the "Open" item from backlog-R).
        dispatch({ type: "gps", pos: null, denied: true });
        if (unprompted.current) {
          try {
            localStorage.setItem(GPS_REFUSED, "1");
          } catch {
            /* no storage */
          }
          return;
        }
        if (said.current) return;
        said.current = true;
        dispatch({ type: "toast", text: t("edge.locationOff") });
      },
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [on, dispatch]);

  const ask = () => {
    if (!navigator.geolocation) {
      dispatch({ type: "toast", text: t("edge.locationOff") });
      return;
    }
    try {
      localStorage.setItem(GPS_ASKED, "1");
      localStorage.removeItem(GPS_REFUSED);
    } catch {
      /* no storage */
    }
    unprompted.current = false;
    setOn(true);
    onFollow();
    said.current = false; // a new tap earns a new answer
    // a second tap after a denial has nothing to prompt: say so again
    if (gpsDenied) {
      said.current = true;
      dispatch({ type: "toast", text: t("edge.locationOff") });
    }
  };

  return { ask, on };
}
