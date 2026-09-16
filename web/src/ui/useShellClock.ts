// The two timers the shell itself owns: "leave now", and the toast.
//
// Both are the same shape — something in the state expires on the wall clock
// rather than on a tap — and neither belongs to a screen, which is why they
// were AppShell's for eleven slices and are here now (CR-02 slice B, to keep
// that file under SPEC's 450-line ceiling). Nothing else moved with them:
// the auto-preference effect reads the SUN over the selected city, which is
// the shell's own composition of the day and the city, and stays there.
import { useEffect } from "react";
import type { City } from "../cities";
import type { Action } from "./shellState";
import { cityNowClamped } from "./time";

/** The three fields the two timers read. Named rather than taken as the
 *  whole `ShellState`: a hook that asks for the shell cannot be reasoned
 *  about — or tested — without the reducer, and these effects touch nothing
 *  else (CR-02 slice B review, finding 7). */
export type ShellClock = {
  leaveNow: boolean;
  startMin: number;
  toast: string | null;
  /** Which city's clock "now" is. A departure is planned in the city the
   *  walk is in, and the window it sits in is measured from that city's
   *  sunrise and sunset — so the minute the tick re-snaps to has to come
   *  from the same place (S2 review, finding 2). */
  city: City;
};

/** `dispatch` is in both dependency arrays, which it was not while this code
 *  lived in AppShell: there it was visibly useReducer's own, and stable. As a
 *  parameter that is a promise the caller makes rather than one the compiler
 *  can see, so the hook depends on it honestly — a stable dispatch re-runs
 *  nothing. */
export function useShellClock(s: ShellClock, dispatch: (a: Action) => void): void {
  // "Leave now" means now: the effective start minute is kept in the state,
  // and re-snapped whenever the wall clock crosses a five-minute step.
  useEffect(() => {
    if (!s.leaveNow) return;
    const tick = () => {
      const m = cityNowClamped(s.city);
      // silent: the clock moving on is not a tap, and must not shut a sheet
      if (m !== s.startMin) dispatch({ type: "leave", startMin: m, now: true, silent: true });
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    // A tab that comes back from the bfcache — or from an OS app switch —
    // has had its timers frozen for as long as it was away, so the interval
    // above resumes mid-period and the departure can be up to 30 s stale on
    // the frame the reader is looking at. One tick on the way in settles it
    // (B4). The fake walk's own interval needs nothing: it resumes where it
    // was, which is where the walker is.
    const wake = (e: Event) => {
      if (e.type === "visibilitychange" && document.visibilityState !== "visible") return;
      tick();
    };
    window.addEventListener("pageshow", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("pageshow", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [dispatch, s.leaveNow, s.startMin, s.city]);

  useEffect(() => {
    if (s.toast === null) return;
    // SPEC §4: three seconds, and gone.
    const id = window.setTimeout(() => dispatch({ type: "toast", text: null }), 3_000);
    return () => window.clearTimeout(id);
  }, [dispatch, s.toast]);
}
