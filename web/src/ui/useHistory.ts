// Browser back (2026-09-06, compact UI slice 1) — the impure half.
//
// The ONLY module in the app that touches `window.history`. It decides
// nothing: `historyPlan` says push / replace / nothing and `popFor` says what
// a `popstate` means, both pure and both tested in history.test.ts. What is
// left here is four lines of wiring and two refs.
//
// Two things worth saying out loud.
//
// A modal sheet does not push an entry (handover §3.2), so when back closes
// one it has consumed an entry that belonged to the screen underneath. If we
// let it go, the stack gets one shorter every time a reader opens a sheet and
// backs out of it, and eventually back walks off the app. So closing a sheet
// re-pushes the entry the pop just took. Same for a back gesture during a
// walk, which the reducer refuses.
//
// And the shell re-renders far more often than the address bar changes — a
// GPS fix every few metres, a clock tick every 30 s. `historyPlan` returns
// `none` for those, so no `replaceState` is made for anything the URL cannot
// show. That matters: Safari throws `SecurityError` past ~100 history calls
// in 30 s, and a walk in progress is exactly the case that would get there.
import { useEffect, useRef } from "react";
import { currentHasPeek, currentSnap, setSnap } from "./sheetSnapStore";
import type { Action, ShellState } from "./shellState";
import {
  entryFor,
  entryStamp,
  historyPlan,
  popFor,
  originOn,
  routeOf,
  screenKey,
  tabOf,
  tripOf,
  wanderOf,
  type Written,
} from "./history";

/** Keep the browser's history in step with the shell.
 *
 *  `url` is what the address bar should read for the state showing —
 *  history.ts's `historyUrl`, computed by the caller because only it knows
 *  the settings. */
export function useHistory(s: ShellState, dispatch: (a: Action) => void, url: string): void {
  // What is on screen right now, for the popstate handler — which is
  // registered once and must not read a stale render's state.
  const now = useRef<{ s: ShellState; url: string }>({ s, url });
  now.current = { s, url };

  // What the last entry we wrote was for, and a one-shot flag saying "this
  // render is the result of a pop, do not push it back".
  const written = useRef<Written | null>(null);
  const popped = useRef(false);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const { s: live, url: liveUrl } = now.current;
      const action = popFor(live, e.state, currentSnap(), currentHasPeek());
      switch (action.do) {
        case "leave":
          // not ours: the browser is going somewhere else, and should
          return;
        case "closeOverlay":
          dispatch({ type: "overlay", overlay: null });
          // the sheet never pushed, so give the consumed entry back
          window.history.pushState(entryFor(live), "", liveUrl);
          written.current = { key: screenKey(live), url: liveUrl, entry: entryStamp(live) };
          return;
        case "snapPeek":
          // one rung down the sheet's ladder, and the same refund: a snap
          // pushed nothing either (SPEC §3b)
          setSnap("peek");
          window.history.pushState(entryFor(live), "", liveUrl);
          written.current = { key: screenKey(live), url: liveUrl, entry: entryStamp(live) };
          return;
        case "dismiss":
          // The same way out the ✕ takes, and no refund: the reader has
          // moved DOWN a screen, so the entry the gesture spent is the one
          // the screen underneath adopts (historyPlan's `afterPop`). Back
          // again leaves the app, which is what back on Home means (B13).
          popped.current = true;
          dispatch({ type: "back" });
          return;
        case "stay":
          window.history.pushState(entryFor(live), "", liveUrl);
          written.current = { key: screenKey(live), url: liveUrl, entry: entryStamp(live) };
          return;
        case "restore": {
          // Every field of the entry is validated, not only `trip` (final
          // review M3): a coordinate off `history.state` reaches MapLibre.
          popped.current = true;
          dispatch({
            type: "restore",
            tab: tabOf(action.entry.tab),
            route: routeOf(action.entry.route),
            wander: wanderOf(action.entry.wander),
            trip: tripOf(action.entry),
            origin: originOn(action.entry),
          });
          return;
        }
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [dispatch]);

  useEffect(() => {
    const next: Written = { key: screenKey(s), url, entry: entryStamp(s) };
    const plan = historyPlan(written.current, next, popped.current);
    popped.current = false;
    if (plan.op === "none") return;
    written.current = next;
    const entry = entryFor(s);
    if (plan.op === "push") window.history.pushState(entry, "", plan.url);
    else {
      window.history.replaceState(entry, "", plan.url);
      // …and on the first write, a second copy of it: the base entry the app
      // owns under whatever screen it booted on, so that back from an open
      // sheet closes the sheet instead of unloading the page (handover §3.2,
      // fix round 1). Two writes, once per session.
      if (plan.op === "seed") window.history.pushState(entry, "", plan.url);
    }
  }, [s, url]);
}
