// Browser back (2026-09-06, compact UI slice 1) — the pure half.
//
// This app is one page. On a phone, in a browser tab, the back gesture IS
// the back button: a reader who swipes back and lands on the page they came
// from before opening the app has lost their walk. So every screen change
// pushes a history entry, and `popstate` puts the screen it names back on.
//
// Everything here is a pure function of the shell's state, so which
// transitions push and what a pop maps to are testable without a DOM
// (history.test.ts). `useHistory.ts` is the only module in the app that
// touches `window.history`.
import type { Settings } from "../plan/settings";
import type { LngLat } from "../components/MapView";
import { isLngLat } from "../lngLat";
import {
  GPS_ORIGIN,
  navigating,
  NO_TRIP,
  type Origin,
  type Place,
  type SearchEnd,
  type Via,
  type RouteScreen,
  type ShellState,
  type Tab,
  type Trip,
  type WanderScreen,
} from "./shellState";
import type { Snap } from "./kit/sheetSnap";
import { shareUrl } from "./share";

/** What a pushed entry carries: enough to put the reader back where they
 *  were, and nothing else. Plain data — `history.state` is structured-cloned
 *  by the browser, and every field here survives that (numbers, strings and
 *  the Place / LngLat objects the screens hold).
 *
 *  The plan is NOT in it. A restored screen recomputes: the graph, the
 *  clock and the settings may all have moved on, and a route drawn from a
 *  five-minute-old shade lookup would be a lie (CLAUDE.md rule 4).
 *
 *  `trip` is the one exception to "no planning inputs" (review B-3). The
 *  preference and the clock come back from the URL; the access override must
 *  not, because `a=` in a URL boots as a SESSION override and would outlive
 *  the walk it was set for. So it travels in `history.state`, where it can
 *  come back as exactly what it is. */
export type HistoryEntry = {
  /** Marks the entry as ours. Another script's `pushState`, an extension's,
   *  or the entry the browser made before the app loaded, all lack it. */
  sw: 1;
  tab: Tab;
  route: RouteScreen;
  wander: WanderScreen;
  trip: Trip;
  /** The reader's shared start point (CR-03 A8). It used to ride on the
   *  Wander screens and on the routes screen; the routes screen still keeps
   *  its own copy, and this is the one both tabs read. */
  origin: Origin;
};

export function entryFor(s: ShellState): HistoryEntry {
  return { sw: 1, tab: s.tab, route: s.route, wander: s.wander, trip: s.trip, origin: s.origin };
}

/** The start point an entry names, validated like everything else on it.
 *  Entries written before CR-03 A8 have none, and fall back to the live fix
 *  — which is where a reload lands anyway. */
export function originOn(e: HistoryEntry): Origin {
  return originOf((e as { origin?: unknown }).origin);
}

/** The override an entry names. Entries written before `trip` existed have
 *  none, and a hand-edited one may have anything, so it is validated rather
 *  than trusted — `history.state` is attacker-adjacent in the same way a URL
 *  parameter is. */
export function tripOf(e: HistoryEntry): Trip {
  const t: unknown = (e as { trip?: unknown }).trip;
  if (!t || typeof t !== "object") return NO_TRIP;
  const { access, avoidCobbles, via, backBy } = t as {
    access?: unknown;
    avoidCobbles?: unknown;
    via?: unknown;
    backBy?: unknown;
  };
  return {
    access:
      access === "walk" || access === "stroller" || access === "wheelchair" ? access : null,
    avoidCobbles: typeof avoidCobbles === "boolean" ? avoidCobbles : null,
    via: viaOf(via),
    backBy: typeof backBy === "number" && Number.isFinite(backBy) ? backBy : null,
  };
}

/** The place a restored entry says its loops go through (W3). Validated the
 *  same way as the rest of the entry: a coordinate that is not one is not a
 *  place, and MapLibre throws on it. */
function viaOf(v: unknown): Via | null {
  if (!v || typeof v !== "object") return null;
  const { at, name } = v as { at?: unknown; name?: unknown };
  if (!isLngLat(at)) return null;
  return { at, name: typeof name === "string" ? name : null };
}

/** The origin an entry names. `{kind:"gps"}` carries no coordinate, so it
 *  is the safe fallback for anything unrecognised. */
function originOf(v: unknown): Origin {
  if (!v || typeof v !== "object") return GPS_ORIGIN;
  const { kind, at, label } = v as { kind?: unknown; at?: unknown; label?: unknown };
  if (kind !== "point" || !isLngLat(at)) return GPS_ORIGIN;
  return { kind: "point", at, label: typeof label === "string" ? label : null };
}

/** A search result the entry carried, or null. Every field is checked: a
 *  Place's coordinate reaches MapLibre and its name reaches the DOM. */
function placeOf(v: unknown): Place | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  if (typeof p.name !== "string" || typeof p.kind !== "string") return null;
  if (typeof p.lng !== "number" || typeof p.lat !== "number") return null;
  if (!isLngLat([p.lng, p.lat])) return null;
  return {
    name: p.name,
    kind: p.kind,
    district: typeof p.district === "string" ? p.district : null,
    lng: p.lng,
    lat: p.lat,
    inCity: p.inCity === true,
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The route screen an entry names — validated, not trusted (final review
 *  M3). `trip` has been checked since review B-3 while the two SCREENS, which
 *  carry the coordinates that reach MapLibre and the names that reach the
 *  DOM, were taken as read. `history.state` is attacker-adjacent in the same
 *  way a URL parameter is (same origin only, so the reach is small), and one
 *  bogus `dest` is a thrown "Invalid LngLat" inside a render — the failure
 *  lngLat.ts exists for. Anything unrecognised is Home, which is where a
 *  reload lands anyway. */
export function routeOf(v: unknown): RouteScreen {
  const home: RouteScreen = { k: "home" };
  if (!v || typeof v !== "object") return home;
  const r = v as Record<string, unknown>;
  switch (r.k) {
    case "home":
      return home;
    case "search": {
      const end: SearchEnd = r.end === "from" ? "from" : "to";
      return { k: "search", q: str(r.q), end, back: routeOf(r.back) };
    }
    case "place": {
      const place = placeOf(r.place);
      return place ? { k: "place", place } : home;
    }
    case "pin": {
      if (!isLngLat(r.at)) return home;
      return {
        k: "pin",
        at: r.at,
        address: typeof r.address === "string" ? r.address : null,
        shadePct: typeof r.shadePct === "number" && Number.isFinite(r.shadePct) ? r.shadePct : null,
      };
    }
    case "routes": {
      if (!isLngLat(r.dest)) return home;
      const from = placeOf(r.from);
      return {
        k: "routes",
        origin: originOf(r.origin),
        dest: r.dest,
        destName: str(r.destName),
        ...(from ? { from } : {}),
      };
    }
    case "navigate": {
      if (!isLngLat(r.dest)) return home;
      const from = placeOf(r.from);
      return {
        k: "navigate",
        dest: r.dest,
        destName: str(r.destName),
        ...(from ? { from } : {}),
      };
    }
    case "arrived":
      return {
        k: "arrived",
        destName: str(r.destName),
        atMin: typeof r.atMin === "number" && Number.isFinite(r.atMin) ? r.atMin : 0,
      };
    default:
      return home;
  }
}

/** The Wander screen an entry names, validated the same way. Anything
 *  unrecognised is W0, the tab's root — which is where a reload lands
 *  anyway, exactly as `routeOf` falls to Home. */
export function wanderOf(v: unknown): WanderScreen {
  const idle: WanderScreen = { k: "idle" };
  if (!v || typeof v !== "object") return idle;
  const w = v as Record<string, unknown>;
  const atMin = typeof w.atMin === "number" && Number.isFinite(w.atMin) ? w.atMin : 0;
  switch (w.k) {
    case "navigate":
      return { k: "navigate" };
    case "arrived":
      return { k: "arrived", atMin };
    case "loops":
      return { k: "loops" };
    default:
      return idle;
  }
}

/** The tab an entry names. */
export function tabOf(v: unknown): Tab {
  return v === "wander" || v === "settings" ? v : "route";
}

export function isEntry(v: unknown): v is HistoryEntry {
  return typeof v === "object" && v !== null && (v as { sw?: unknown }).sw === 1;
}

/** The identity of the screen showing: two states with the same key are the
 *  same screen and must NOT push a second entry.
 *
 *  Two rules the key encodes:
 *   - a query is not a screen. Typing in the search field would otherwise
 *     push one entry per keystroke, and back would walk the word backwards
 *     one letter at a time. Which END is being edited is a screen, though —
 *     From and To open the same page onto different halves of the walk.
 *   - a destination is. Tapping a second park from a place card replaces the
 *     card, and back has to return to the first one. */
export function screenKey(s: ShellState): string {
  if (s.tab === "settings") return "settings";
  if (s.tab === "wander") return `wander:${s.wander.k}`;
  const r = s.route;
  switch (r.k) {
    case "search":
      return `route:search:${r.end}`;
    case "place":
      return `route:place:${r.place.lng},${r.place.lat}`;
    case "pin":
      return `route:pin:${r.at[0]},${r.at[1]}`;
    case "routes":
      return `route:routes:${r.dest[0]},${r.dest[1]}`;
    default:
      return `route:${r.k}`;
  }
}

/** Does moving from one state to the next add a history entry?
 *
 *  Opening or closing a modal sheet does not: SPEC/handover §3.2 — "sheets
 *  don't push; they close on back". Nor does a plan landing, the clock
 *  ticking, or a GPS fix arriving. Only the screen changing. */
export function pushes(before: ShellState, after: ShellState): boolean {
  return screenKey(before) !== screenKey(after);
}

/** What `popstate` should do. The overlay is checked first, because a modal
 *  sheet swallows the gesture before the screen does — and since opening it
 *  never pushed, the hook has to give the consumed entry back. */
export type Pop =
  | { do: "closeOverlay" }
  /** The sheet is up past its peek AND has a peek to go down to: back
   *  walks the LADDER before it walks the screens (SPEC §3b — "browser back
   *  at default → peek, at peek → dismiss"). Like an overlay, the snap
   *  never pushed an entry, so the one the gesture spent is given back. */
  | { do: "snapPeek" }
  /** Nothing moves: the walk is being walked. The entry is re-pushed. */
  | { do: "stay" }
  | { do: "restore"; entry: HistoryEntry }
  /** The screen has nothing on it — the no-route card is the whole of it —
   *  so back means what the ✕ means: the place card the walk was started
   *  from, or Home. It cannot be a `restore`, because a walk opened from a
   *  share link has only the seed entry under it, which is a COPY of the
   *  screen showing (useHistory), and restoring that left the reader exactly
   *  where they were: a dead end (B13). */
  | { do: "dismiss" }
  /** The entry is not one of ours (a hash link, an extension, the entry the
   *  page was opened on). Let the browser have it. */
  | { do: "leave" };

/** Is the routes screen showing the no-route card rather than a walk? The
 *  planner is not still running (`computing` stays true from the tap until a
 *  plan lands, shellState.replan), and nothing came back. */
function noRouteCard(s: ShellState): boolean {
  return s.tab === "route" && s.route.k === "routes" && s.plan === null && !s.computing;
}

export function popFor(
  s: ShellState,
  state: unknown,
  snap: Snap | null = null,
  /** Does that sheet HAVE a peek rung? (sheetSnapStore.ts) */
  hasPeek = false
): Pop {
  if (s.overlay !== null) return { do: "closeOverlay" };
  if (navigating(s)) return { do: "stay" };
  // …then the sheet's own ladder. A sheet at `default` or `tall` is covering
  // the map the reader is trying to get back to, so the first back puts it
  // down; only from `peek` does back leave the screen (SPEC §3b). `null` is
  // a screen with no sheet — Home, search, and every web frame — and is
  // what the phone's sheet publishes when it unmounts (sheetSnapStore.ts).
  //
  // A sheet with no `peek` of its own has no rung to be put down to: the
  // place and pin cards, no-route and the arrival open at `default` and are
  // drawn whole there. Stepping them down to a peek height they were never
  // laid out for clipped the tag row off the place card and cost a second
  // back to leave it (CR-01 review, F1), so for those back goes straight to
  // the screen underneath.
  if (hasPeek && (snap === "default" || snap === "tall")) return { do: "snapPeek" };
  if (noRouteCard(s)) return { do: "dismiss" };
  return isEntry(state) ? { do: "restore", entry: state } : { do: "leave" };
}

/** The start the address bar is allowed to carry: a PINNED one, never the
 *  live fix (ruling, 2026-09-06 fix round 1).
 *
 *  `shareUrl` resolves "your location" to a coordinate on purpose — a link
 *  the reader chose to hand over has to reproduce the walk. The address bar
 *  is not that link. Writing the fix there would put the reader's home in
 *  the visible URL, in every history entry, and in the `Referer` of anything
 *  the page loads cross-origin, without anyone asking for it. It buys
 *  nothing either: a reload re-acquires the fix. A pin — a long press, a
 *  tapped place, a shared `s=` — is the only start a refresh cannot get
 *  back on its own, so it is the only one written. */
function pinnedStart(s: ShellState): LngLat | null {
  return s.origin.kind === "point" ? s.origin.at : null;
}

/** The URL a pushed entry wears. It is the share link for what is on screen
 *  — one encoder, so a reload restores exactly what a shared link would open
 *  (urlState.ts) — with two subtractions:
 *
 *   - the live GPS fix, never (`pinnedStart` above);
 *   - the clock, while the walk leaves NOW. `t=` pins the departure time,
 *     and a reader who refreshes the page at 15:04 must not find themselves
 *     planning for 14:30 because that is when they opened the tab.
 *
 *   - the walk's OWN access, always. `shareUrl` pins `a=` and `ac=` so a
 *     link reproduces the walk (review B-3); the address bar must not, because
 *     a link's `a=` boots as a SESSION override — it survives the next
 *     destination and the next tab switch — and a per-trip override that
 *     came back from a refresh as a session one would have escaped its trip.
 *     The override travels on the entry instead (`HistoryEntry.trip`). What
 *     `a=` may say here is only what the session already says: the boot
 *     link's own override, which is the one thing a refresh cannot get back
 *     on its own. `persisted` is what tells the two apart.
 *
 *  What survives a refresh, then, is the tab, the destination, the loop
 *  length, the preference, the city, a pinned start and a link's own access
 *  override. The search, place and pin screens have no parameter of their own
 *  and come back on Home — the handover's §3.3 list has none for them
 *  either. */
export function historyUrl(
  base: string,
  s: ShellState,
  settings: Settings,
  /** The stored record, under this session's overrides (useSettings.ts). */
  persisted: Settings
): string {
  const url = shareUrl(base, s, settings, pinnedStart(s));
  const [path, qs] = url.split("?");
  if (qs === undefined) return url;
  const p = new URLSearchParams(qs);
  // the clock, while the walk leaves NOW
  if (s.leaveNow) p.delete("t");
  // the cobble wall is never a session override — only a link sets one, and
  // only for this session's access
  p.delete("ac");
  if (settings.access === persisted.access) p.delete("a");
  else p.set("a", settings.access);
  return `${path}?${p.toString()}`;
}

/** What the browser's history already says: the screen the last entry we
 *  wrote was for, the URL we wrote on it, and the entry itself, serialised
 *  so two renders can be compared by value.
 *
 *  The entry is compared as well as the URL because a screen can change
 *  without its URL doing so: a query typed into the search page, the address
 *  a reverse geocode fills into a dropped pin, the name a link's destination
 *  gets when it is looked up. Those belong on the entry, so back restores
 *  them — and none of them is a coordinate, a clock or a plan, which is why
 *  comparing entries does NOT bring the per-fix churn back. */
export type Written = { key: string; url: string; entry: string };

/** `entryFor`, serialised for that comparison. Small — four fields, the
 *  largest of them a Place. */
export function entryStamp(s: ShellState): string {
  return JSON.stringify(entryFor(s));
}

/** What `useHistory` should do to `window.history` on this render. */
export type HistoryOp =
  | { op: "push"; url: string }
  | { op: "replace"; url: string }
  /** The first write of the session: replace the entry the browser made for
   *  the page, and then push a second copy of it, so the app owns a spare
   *  rung under whatever screen it booted on.
   *
   *  Without it a link that opens straight onto Routes leaves the app with
   *  exactly ONE entry, and back from an open sheet pops the entry BELOW the
   *  app — a different document, so no `popstate` reaches us and the reader
   *  is unloaded with the sheet still on screen. Handover §3.2 orders it the
   *  other way round: close the sheet, then pop the screen, then leave. The
   *  price, recorded in DECISIONS.md, is that a reader who opens a share link
   *  and does nothing needs two backs to leave. */
  | { op: "seed"; url: string }
  /** Nothing changed that the address bar or the back button can see — the
   *  plan landing, a GPS fix, the clock ticking, a candidate selected. This
   *  is the common case, and it is the whole point of the function: the
   *  shell re-renders every few metres of a walk, and Safari throws past
   *  ~100 history calls in 30 s. */
  | { op: "none" };

/**
 * The pure decision behind the hook: given what the history already says and
 * what is on screen now, push, replace, or leave it alone.
 *
 *  - nothing written yet → seed: replace the entry the browser made for the
 *    page, then push a copy of it. Putting our state on the browser's entry
 *    is what lets back from the second screen find it; the copy is the rung
 *    a sheet's back gesture spends (see `HistoryOp`).
 *  - just came back from a `popstate` → replace. The browser has already
 *    moved; adopting the restored screen onto the entry it landed on is what
 *    stops a pop from turning into a push.
 *  - the screen changed → push.
 *  - the URL changed (a preference, a departure time, a city) or the entry
 *    did (a query, a looked-up name) → replace.
 *  - otherwise → nothing.
 */
export function historyPlan(prev: Written | null, next: Written, afterPop = false): HistoryOp {
  if (prev === null) return { op: "seed", url: next.url };
  if (afterPop) return { op: "replace", url: next.url };
  if (prev.key !== next.key) return { op: "push", url: next.url };
  if (prev.url !== next.url || prev.entry !== next.entry) {
    return { op: "replace", url: next.url };
  }
  return { op: "none" };
}
