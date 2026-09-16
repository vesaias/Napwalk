// The one place analytics is wired (2026-09-16, ui/analytics.ts).
//
// A wrapper around the shell's dispatch: every action is reduced a second
// time here — the reducer is pure and cheap — so the mapping sees the state
// before and after it, and the settings record is diffed as it changes. The
// screens dispatch exactly as before and import nothing from here; the
// report sheet and the error boundary are the two senders this hook cannot
// see, and they call `track` themselves.
//
// The session's once-only flags live in module scope, not in state or a
// ref: a session is a page load, and neither a remount nor StrictMode's
// double effects is a new one.
import { useCallback, useEffect, useRef } from "react";
import { DEFAULT_CITY, getCity } from "../cities";
import {
  bootCityEvent,
  eventsFor,
  newSession,
  pageFor,
  pageview,
  settingsEvents,
  track,
} from "./analytics";
import { BOOT_CITY, BOOT_CITY_SOURCE, BOOT_EDGE } from "./boot";
import { reduce, type Action, type ShellState } from "./shellState";
import { cityClock } from "./time";
import { BOOT_RESUME } from "./useResume";
import type { SettingsStore } from "./useSettings";
import { cityFromEdge } from "./where";

type Dispatch = (a: Action) => void;

const SESSION = newSession();
let booted = false;

/** Returns the dispatch the shell should hand out. Stable for as long as
 *  the reducer's own is: hooks keep it in their dependency lists, and a
 *  fresh identity per render would restart the GPS watch on every fix. */
export function useAnalytics(s: ShellState, dispatch: Dispatch, store: SettingsStore): Dispatch {
  const state = useRef(s);
  state.current = s;
  const settings = useRef(store.settings);
  settings.current = store.settings;

  // --- the page load: its first page, and what it came back from ----------
  useEffect(() => {
    if (booted) return;
    booted = true;
    const r = BOOT_RESUME;
    if (r) {
      const walking = r.nav?.walking === true;
      // the `start` that restores the walk is not a new navigation, and its
      // elapsed time began on the page load the snapshot was written on
      if (walking) SESSION.resumeWalkAt = r.nav?.startedAt || Date.now();
      if (r.nav?.lastFix) SESSION.located = true;
      track("resume", { walking });
    }
    const guess = bootCityEvent(BOOT_CITY_SOURCE, DEFAULT_CITY, BOOT_CITY);
    if (guess) track(guess.name, guess.data);
    void BOOT_EDGE?.then((w) => {
      const id = cityFromEdge(w);
      track("where", { found: id !== null, city: id ?? "none" });
    });
    pageview(pageFor(state.current));
  }, []);

  // --- the settings record, as it changes ----------------------------------
  const seen = useRef(store.settings);
  useEffect(() => {
    const prev = seen.current;
    const next = store.settings;
    if (prev === next) return;
    seen.current = next;
    for (const e of settingsEvents(prev, next, store.cityChosen)) track(e.name, e.data);
  }, [store.settings, store.cityChosen]);

  // --- every action ---------------------------------------------------------
  return useCallback(
    (a: Action) => {
      dispatch(a);
      const prev = state.current;
      const next = reduce(prev, a);
      state.current = next;
      if (next === prev) return;
      const city = getCity(settings.current.city);
      const ctx = {
        settings: settings.current,
        now: Date.now(),
        nowMin: cityClock(city).minute,
        sess: SESSION,
      };
      for (const e of eventsFor(prev, next, a, ctx)) track(e.name, e.data);
      const page = pageFor(next);
      if (page !== pageFor(prev)) pageview(page);
    },
    [dispatch]
  );
}
