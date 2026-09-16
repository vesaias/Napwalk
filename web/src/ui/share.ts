// The link a walk is handed over on (UI redesign Task 15, 2026-09-05).
//
// One builder for both kinds of walk: Wander's "Share" (a loop) and the
// desktop panel's "Send to phone" (an A→B route). Both were writing the same
// query string by hand — `loopShareUrl` in wander.ts and, on the other side of
// the round trip, `bootShell`'s reading of it. Keeping the two ends in one
// module is what makes the round trip testable without a browser URL.
import type { LngLat } from "../components/MapView";
import type { CityId } from "../cities";
import { t } from "../i18n/t";
import type { Preference } from "../plan/preference";
import type { Settings } from "../plan/settings";
import type { Access } from "../router/astar";
import { encodeState } from "../urlState";
import { tripSettings, type Action, type ShellState } from "./shellState";

/** A link speaks in presets, the shell in preferences (AppShell's PRESET_PREF
 *  reads this the other way round at boot). */
const PREF_PRESET: Record<Preference, "balanced" | "maxShade" | "maxQuiet"> = {
  balanced: "balanced",
  shade: "maxShade",
  quiet: "maxQuiet",
};

export type LoopLink = {
  city: CityId;
  access: Access;
  avoidCobbles: boolean;
  pref: Preference;
  startMin: number;
  durationMin: number;
  /** Where the loop starts, resolved: a pinned point, or the fix the walk
   *  was planned from. A link reproduces the WALK, so it always pins a
   *  coordinate when there is one; null only when there was no origin at
   *  all, and then whoever opens it plans from their own location. */
  start: LngLat | null;
  /** The place the loop goes through, when it has one (W3). */
  via?: LngLat | null;
  /** "be back by", when that is how the length was picked (W2). */
  backBy?: number | null;
  selected: number;
};

/** The URL Share hands over: everything the loop was computed from, so the
 *  same graph gives the same walk (urlState.ts). `base` is the page the app
 *  is served from, query string and hash stripped by the caller. */
export function loopShareUrl(base: string, o: LoopLink): string {
  const qs = encodeState({
    city: o.city,
    mode: "loop",
    minutes: o.startMin,
    preset: PREF_PRESET[o.pref],
    access: o.access,
    avoidCobbles: o.avoidCobbles,
    duration: o.durationMin,
    start: o.start,
    dest: null,
    via: o.via ?? null,
    backBy: o.backBy ?? null,
    selected: o.selected,
  });
  return `${base}?${qs}`;
}

/** The destination a link would carry, or null when the screen has none.
 *  Only the route tab has one, and only from the routes screen on — a place
 *  or pin card is a question, not a walk. */
function destOf(s: ShellState): LngLat | null {
  if (s.tab !== "route") return null;
  return s.route.k === "routes" || s.route.k === "navigate" ? s.route.dest : null;
}

/** The link for whatever the shell is showing: a loop on the Wander tab, an
 *  A→B route everywhere else. `from` is the resolved origin — the pinned
 *  point or the fix the walk was planned from — because the shell's own
 *  `origin` says "your location" without saying where that is. */
export function shareUrl(
  base: string,
  s: ShellState,
  settings: Settings,
  from: LngLat | null
): string {
  // The walk's own access, not the stored one: the routes header's chip may
  // have planned this one as a wheelchair walk for a reader whose settings
  // say stroller, and the link has to reproduce the walk (shellState.ts).
  const eff = tripSettings(s, settings);
  // W0 has no loop to hand over — nothing is planned on it — so it takes the
  // plain branch and names itself with `sc=wander`, the way Settings does
  // (CR-02 slice A). Borrowing `m=loop` for it would make a refresh on the
  // Wander root come back with loops the reader never asked for.
  if (s.tab === "wander" && s.wander.k !== "idle") {
    return loopShareUrl(base, {
      city: settings.city,
      access: eff.access,
      avoidCobbles: eff.avoidCobbles,
      pref: s.pref,
      startMin: s.startMin,
      durationMin: s.durationMin,
      start: from,
      via: s.trip.via?.at ?? null,
      backBy: s.trip.backBy,
      selected: s.selected,
    });
  }
  const qs = encodeState({
    city: settings.city,
    mode: "ab",
    minutes: s.startMin,
    preset: PREF_PRESET[s.pref],
    access: eff.access,
    avoidCobbles: eff.avoidCobbles,
    duration: s.durationMin,
    start: from,
    dest: destOf(s),
    selected: s.selected,
    // `m` names the kind of walk, and Settings is not one: the third tab
    // needs a parameter of its own to come back from a refresh (urlState.ts)
    screen: s.tab === "settings" ? "settings" : s.tab === "wander" ? "wander" : undefined,
  });
  return `${base}?${qs}`;
}

/** The page the app is served from, query string and hash stripped — what
 *  every builder above wants as its `base`. */
export function pageBase(): string {
  return `${location.origin}${location.pathname}`;
}

/** Hand a link over where there is no system share sheet: the clipboard, and
 *  a toast that says so. A browser without one promises the reader nothing
 *  rather than lying about it. */
export function copyLink(dispatch: (a: Action) => void, url: string): void {
  navigator.clipboard
    ?.writeText(url)
    .then(() => dispatch({ type: "toast", text: t("share.copied") }))
    .catch(() => {
      /* no clipboard: nothing to promise the reader */
    });
}
