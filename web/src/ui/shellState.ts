// The app shell's state machine (UI redesign Task 11, 2026-09-05).
//
// One reducer for the whole phone UI: which tab is showing, which screen
// inside that tab, the modal on top of it, and the planning inputs
// (preference, start minute, duration) whose result the effects in
// AppShell.tsx hand back as `plan`. Pure and DOM-free — no browser API, no
// React — so it is testable without jsdom (shell.test.ts).
//
// Two additions to the state sketched in the task brief, both forced by
// transitions the brief itself asks for:
//   - `origin`, the start the next walk will use. The routes screen carries
//     its own copy (Task 12's swap acts on that one), but a pin's "Start
//     here" sets an origin while no routes screen exists yet, and `end` has
//     to rebuild the routes screen the navigation came from.
//   - the `pinInfo` and `origin` actions. The pin screen holds an address
//     and a shade percentage that arrive later, from reverseGeocode and
//     shadeAround; no action in the brief's list can deliver them.
import type { LngLat } from "../components/MapView";
import type { Place } from "../plan/geocode";
import type { PlanResult } from "../plan/plan";
import type { Preference } from "../plan/preference";
import type { Settings } from "../plan/settings";
import type { Access } from "../router/astar";
import { durationFromBackBy } from "./wander";

export type { Place, PlanResult };

export type Tab = "route" | "wander" | "settings";
export type Origin = { kind: "gps" } | { kind: "point"; at: LngLat; label: string | null };

/** Which end of the walk a search screen is editing (R4, 2026-09-06). Both
 *  ends are editable from the routes header, so a search has to say which
 *  field opened it — and where back should put the reader down again. */
export type SearchEnd = "from" | "to";

/** The two access settings this ONE walk is planned with (handover §3.2).
 *  `null` on either field means "whatever Settings says"; the chip in the
 *  routes header writes them and "Make default" moves them into Settings.
 *  Reset on a new destination and on a tab switch — an override taken to
 *  get around one blocked street is not a decision about the next walk. */
export type Trip = {
  access: Access | null;
  avoidCobbles: boolean | null;
  /** Wander W3: the place this loop goes through. `name` is null until the
   *  reverse geocode answers — a share link's `v=` carries a coordinate and
   *  no word for it (handover §3.2/§3.3). */
  via: Via | null;
  /** Wander W2: "be back by 15:30", as minutes since midnight. The LENGTH
   *  is still `durationMin` — this is the same number said the other way
   *  round, kept so a shared link can say it the way the reader did
   *  (`bb=HHMM`). Null when the length came from a tile. */
  backBy: number | null;
};

/** A place a loop is asked to go through (W3). */
export type Via = { at: LngLat; name: string | null };

export const NO_TRIP: Trip = { access: null, avoidCobbles: null, via: null, backBy: null };

/** The planned walk: an A, a B, and the candidates the cards list.
 *
 *  `from` is the place card this walk was started from, when it was: the ✕
 *  on the From row goes back THERE rather than to Home (R4, §3.2). A
 *  destination reached from Home, a dropped pin or a share link has none.
 *
 *  Named on its own since round 4 item 4, because the pin card now carries
 *  one — and a union member cannot refer to itself by shape. */
export type RoutesScreen = {
  k: "routes";
  origin: Origin;
  dest: LngLat;
  destName: string;
  from?: Place;
};

export type RouteScreen =
  | { k: "home" }
  /** `back` is the screen the search was opened from: the routes screen with
   *  its destination, or home. Escape/back returns there WITHOUT replanning —
   *  opening and closing a search must not throw away the plan behind it. */
  | { k: "search"; q: string; end: SearchEnd; back: RouteScreen }
  | { k: "place"; place: Place }
  /** `back` is the planned walk this pin was dropped ON TOP OF, when there
   *  was one. The destination lives on the routes screen and nowhere else, so
   *  a long press used to throw it away: "Route here" and then "Start here"
   *  left the reader with an origin and no destination, and no way back to it
   *  but the map ("the 'finish here' dot is not saved", Viktor, 2026-09-16).
   *  A pin is a detour like a search, not a new beginning — "Start here" puts
   *  the walk back with the new origin in it, and dismissing the pin puts it
   *  back untouched. */
  | { k: "pin"; at: LngLat; address: string | null; shadePct: number | null; back?: RoutesScreen }
  | RoutesScreen
  /** `from` rides on the walk as well (final review I2): End rebuilds the
   *  routes screen this navigation started on, and DECISIONS (slice 2)
   *  promises the ✕ then lands back on the place card the walk came from.
   *  Dropping it here made End the one way to lose that card. */
  | { k: "navigate"; dest: LngLat; destName: string; from?: Place }
  // atMin: the minute the walk ENDED. The screen may sit there for an hour;
  // re-reading the clock while it does would tick the arrival time forward.
  | { k: "arrived"; destName: string; atMin: number };

// durationMin is NOT here: the length is a planning input like `startMin`
// and `pref`, not a piece of the loops screen. It used to live on the
// variant, and End / Done / Loop-back-home rebuilt that variant — so a
// 90-minute walk came back from its own end at 45 (review B-2).
// No `origin` on any of these: the start point is the SHELL's, one for both
// tabs (`ShellState.origin`, CR-03 A8 / backlog B3). It rode on every Wander
// screen from final review I1/I2 until 2026-09-09, so that a Wander tap
// could not rewrite the Route tab's FROM — which is exactly the behaviour
// Viktor asked for instead: "Route and wander should reuse the same pin …
// switch to wander — pin disappears. Same vice versa." One pin, one "here".
//
// `idle` is W0, the tab's ROOT since CR-02 slice A (SPEC §3 W0): a map, a
// pill that offers a loop, and nothing planned. The difference between it
// and `loops` is the QUESTION, not the point: W0 is the question not yet
// asked, so there is no walk for the planner to compute — the shared pin may
// well be standing on the map under it.
export type WanderScreen =
  | { k: "idle" }
  | { k: "loops" }
  | { k: "navigate" }
  | { k: "arrived"; atMin: number };

export type Overlay =
  | "pref"
  | "leave"
  /** The access chip's sheet: Walk / Stroller / Wheelchair + Avoid cobbles,
   *  for this trip only (R4, SPEC §4). */
  | "access"
  | "duration"
  /** The map layers: Shade and Noise, over the map they change (CR-02
   *  edit 3). A modal sheet on the phone, a popover on the web — the same
   *  piece of shell state either way, so `back` closes both. */
  | "layers"
  | "city"
  | "report"
  | null;

export type ShellState = {
  tab: Tab;
  route: RouteScreen;
  wander: WanderScreen;
  overlay: Overlay;
  pref: Preference;
  prefAuto: boolean;
  startMin: number;
  leaveNow: boolean;
  /** How long the next loop should take. A planning input, so it outlives
   *  every Wander screen (SPEC section 4); the duration sheet sets it. */
  durationMin: number;
  plan: PlanResult | null;
  selected: number;
  computing: boolean;
  toast: string | null;
  gps: LngLat | null;
  /** Which way the fix was travelling, degrees clockwise from north — or
   *  null: standing still, or a device that could not say. The arrow the dot
   *  becomes in Navigate reads it (ui/heading.ts, 2026-09-16). */
  gpsHeading: number | null;
  gpsDenied: boolean;
  /** The city's artifact would not load. Nothing can be planned until it
   *  does, so the screens say so instead of shimmering for ever. */
  graphFailed: boolean;
  /** A one-off camera target ("Show Frankfurt" on the outside-city banner),
   *  and only ever the map's fallback — a screen with a destination on it
   *  keeps pointing at the destination. Cleared by a city switch: pointing
   *  the new city's map at the old city's centre is a jump to the edge of
   *  its bounds (review B2). */
  focus: LngLat | null;
  /** Bumped on every `focus`, so tapping "Show Frankfurt" twice — or
   *  tapping it while the map already sits on the centre — still moves the
   *  map (the map keys its recentre on this, not on the point). */
  focusSeq: number;
  /** The zoom that focus asks for, or null to keep the map where it is. Only
   *  the FIRST GPS fix of a page load sets it (ui/firstFix.ts): "Show
   *  <city>" frames the centre at whatever zoom the reader left. */
  focusZoom: number | null;
  /** "Show <city>" was tapped while the fix was outside the data: the
   *  outside-city banner steps aside until the fix crosses the border or
   *  the city changes (Viktor, 2026-09-07 — the banner "did nothing"). */
  outsideSeen: boolean;
  /** Where the next walk starts, on BOTH tabs: a dropped pin, a tapped
   *  place, a FROM search, a share link's `s=` — or the live fix. One "here"
   *  for the reader, not one per tab (CR-03 A8, backlog B3). The routes
   *  screen keeps its own copy of it, because the header shows it and the
   *  swap acts on it. */
  origin: Origin;
  /** This walk's own access mode and cobble rule, over the settings. */
  trip: Trip;
  /** The minute the day scrubber is holding the sun at, or null when
   *  nothing is scrubbing and the map draws the walk's own departure
   *  (CR-02 edit 5, ui/scrub.ts). Web-only state — the scrubber exists on no
   *  phone — and cleared by every `replan`, so a plan or a skeleton puts the
   *  sun back where the trip says it is.  */
  scrub: number | null;
  /** The candidate index a share link asked for (`?r=`), consumed by the
   *  FIRST plan that lands — before then there is no candidate list to
   *  index into. Null once used, and for every session that is not a
   *  share link. */
  bootSelected: number | null;
};

export type Action =
  | { type: "tab"; tab: Tab }
  /** `end` says which field opened the search; it is read only when the
   *  search screen is being OPENED — a keystroke on a screen that is already
   *  a search keeps the end (and the screen behind it) it was opened with. */
  | { type: "search"; q: string; end?: SearchEnd }
  | { type: "pickPlace"; place: Place }
  | { type: "longPress"; at: LngLat }
  | { type: "pinInfo"; address?: string | null; shadePct?: number | null }
  /** A link carries coordinates, never names: the reverse geocode fills
   *  them in once it answers. An empty destName means "not looked up yet";
   *  the screens show the dropped-pin label until then. */
  | { type: "names"; originLabel?: string; destName?: string }
  /** The reader's "here" moves — a map tap, "Start here", a FROM search,
   *  the Locate button. There is no scope: it is one point for both tabs
   *  (CR-03 A8), so a Wander tap re-plans a planned route's FROM and Locate
   *  on either tab takes both back to the live fix. Refused while a walk is
   *  being walked, on either tab. */
  | { type: "origin"; origin: Origin }
  | { type: "routeTo"; dest: LngLat; name: string }
  | { type: "plan"; plan: PlanResult | null }
  /** A walk in progress got a new line: the walker had left the old one for
   *  long enough that it was no longer the walk they were on (ui/useReroute).
   *  Deliberately NOT `plan`, which resets the pick and would be swallowed
   *  by `replan`'s walking() guard: this one changes the lines and nothing
   *  else — same screen, same destination, same card. */
  | { type: "reroute"; plan: PlanResult; selected: number }
  | { type: "computing"; on: boolean }
  | { type: "select"; i: number }
  | { type: "overlay"; overlay: Overlay }
  | { type: "pref"; pref: Preference; auto: boolean }
  // `silent` is the clock's own tick under "leave now": it moves the start
  // minute without treating the move as a tap, so an open sheet stays open
  | { type: "leave"; startMin: number; now: boolean; silent?: boolean }
  | { type: "start" }
  | { type: "end" }
  | { type: "arrived"; atMin: number }
  | { type: "done" }
  | { type: "loopHome" }
  /** A fix, with the direction it was travelling in when the device knows
   *  one (ui/heading.ts `motionHeading`). A fix without one KEEPS the last:
   *  a walker who stopped is still facing the way they were going, and the
   *  arrow holds it until a moving fix says otherwise. `start` forgets it. */
  | { type: "gps"; pos: LngLat | null; denied?: boolean; heading?: number | null }
  | { type: "graph"; failed: boolean }
  /** The city sheet was tapped. `changed` false is the row you are already
   *  on: it closes the sheet and nothing else (review B3). */
  | { type: "city"; changed: boolean }
  /** The day scrubber moved (a drag, play, ←/→, or Now). Throttled to
   *  10 fps by ui/DayScrubber.tsx: this reducer runs once per dispatch. */
  | { type: "scrub"; min: number }
  /** ...and the scrubber went away. Nothing else clears the minute on its
   *  own — `replan` does it for every plan, and this for the rest. */
  | { type: "scrubEnd" }
  | { type: "focus"; at: LngLat | null; zoom?: number }
  | { type: "outsideSeen"; seen: boolean }
  | { type: "toast"; text: string | null }
  /** The loop length, and — when it was picked as an hour to be home by —
   *  the hour itself, for the link (SPEC §3 W2). A tile passes `backBy:
   *  null`, which is the same tap saying "not that way round any more". */
  | { type: "duration"; min: number; backBy?: number | null }
  /** The access chip (R4) and the two no-route retries. An omitted field is
   *  left as it was; `null` puts that half back under the settings. */
  | { type: "trip"; access?: Access | null; avoidCobbles?: boolean | null }
  /** "↻ Loop via" on a place card, and the ✕ that undoes it (W3). A via
   *  switches to the Wander tab and plans loops THROUGH the place; `null`
   *  puts the tab back on "Loops from here". */
  | { type: "loopVia"; via: Via | null }
  /** The browser's back (or forward) button landed on a history entry, and
   *  this is the screen that entry named (ui/history.ts). Only useHistory
   *  dispatches it. */
  | { type: "restore"; tab: Tab; route: RouteScreen; wander: WanderScreen; trip: Trip; origin: Origin }
  | { type: "back" };

export const GPS_ORIGIN: Origin = { kind: "gps" };

/** The loop length Wander opens on (SPEC section 4); Task 13 owns the picker. */
export const DEFAULT_DURATION_MIN = 45;

export function initialShell(startMin: number, pref: Preference): ShellState {
  return {
    tab: "route",
    route: { k: "home" },
    wander: { k: "idle" },
    overlay: null,
    pref,
    prefAuto: true,
    startMin,
    leaveNow: true,
    durationMin: DEFAULT_DURATION_MIN,
    plan: null,
    selected: 0,
    computing: false,
    toast: null,
    gps: null,
    gpsHeading: null,
    gpsDenied: false,
    graphFailed: false,
    focus: null,
    focusSeq: 0,
    focusZoom: null,
    outsideSeen: false,
    origin: GPS_ORIGIN,
    trip: NO_TRIP,
    scrub: null,
    bootSelected: null,
  };
}

/** The share-link parameters the shell boots from — urlState.decodeState's
 *  result, narrowed to what the shell reads. Kept as a type of its own so
 *  the boot is testable without a browser URL. */
export type BootLink = {
  mode?: "ab" | "loop";
  /** `sc=settings` / `sc=wander`: the two screens `mode` cannot name — the
   *  third tab, and the Wander tab with nothing planned on it (urlState.ts). */
  screen?: "settings" | "wander";
  minutes?: number;
  duration?: number;
  // null is what urlState reports for a pin it rejected (wrong city box)
  start?: LngLat | null;
  dest?: LngLat | null;
  /** `v=lng,lat`: the place the loop goes through (W3). */
  via?: LngLat | null;
  /** `bb=HHMM`: the length said as an hour to be home by. */
  backBy?: number | null;
  selected?: number;
};

/** The state a link opens on. Every parameter is consumed here except the
 *  two the shell reads outside the reducer: `c` (city) and `a` (access) go
 *  into the boot settings, and `p` (preset) into `pref` before this runs. */
export function bootShell(
  link: BootLink,
  o: { startMin: number; pref: Preference; prefAuto: boolean; destName: string }
): ShellState {
  const s = initialShell(o.startMin, o.pref);
  s.prefAuto = o.prefAuto;
  // `t=` pins the clock; without it the shell stays on "leave now"
  s.leaveNow = link.minutes === undefined;
  // `s=` is the start pin: an origin that outlives the screen it was set on
  if (link.start) s.origin = { kind: "point", at: link.start, label: null };
  // `d=` is the loop length, `m=loop` the tab it belongs to. A link that
  // carries only `bb=` says the same number the other way round — the hour
  // to be home by — and the two ends have to agree (final review I1). It is
  // measured from the DEPARTURE `t=` pins, exactly as the duration sheet
  // and the loops card are.
  s.durationMin =
    link.duration ??
    (link.backBy === undefined || link.backBy === null
      ? DEFAULT_DURATION_MIN
      : durationFromBackBy(link.backBy, s.startMin));
  if (link.mode === "loop") {
    s.tab = "wander";
    // `m=loop` is the one link that asks for loops; without it the Wander
    // tab opens on its root, W0 (CR-02 slice A).
    s.wander = { k: "loops" };
    // `v=` is W3: the same screen, planning through a place the link names
    // by coordinate only — the reverse geocode writes the title (W3).
    if (link.via) s.trip = { ...s.trip, via: { at: link.via, name: null } };
    if (link.backBy !== undefined && link.backBy !== null) {
      s.trip = { ...s.trip, backBy: link.backBy };
    }
    // `r=` picks a candidate, once there is a plan to pick from — a shared
    // loop names one of three walks just as a shared A→B link does
    s.bootSelected = link.selected ?? null;
  } else if (link.dest) {
    // `e=` is the destination; the link carries no name for it
    s.route = { k: "routes", origin: s.origin, dest: link.dest, destName: o.destName };
    s.bootSelected = link.selected ?? null;
  }
  // The Settings tab rides on top of whatever walk the link carries: back
  // from it lands on that walk, exactly as it would have in the session the
  // link was pushed from.
  // ...and `sc=wander` is W0 itself, which `m` cannot name: it is not a
  // kind of walk, it is the Wander tab with no walk in it (urlState.ts).
  if (link.screen === "settings") s.tab = "settings";
  else if (link.screen === "wander") s.tab = "wander";
  s.computing = needsPlan(s);
  return s;
}

/** Does the screen showing right now have a walk to compute? The routes
 *  screen does, Wander's loops do, and the place and pin cards do — their
 *  minute count is a real A→B plan from the current origin. */
export function needsPlan(s: ShellState): boolean {
  if (s.tab === "wander") return s.wander.k === "loops";
  if (s.tab !== "route") return false;
  return s.route.k === "routes" || s.route.k === "place" || s.route.k === "pin";
}

/** Does the shell know where "here" is? A pin the reader dropped (or a
 *  share link's `s=`), or a live fix. Both tabs share the one point (CR-03
 *  A8), so this is the whole question — and it is what decides whether the
 *  Wander tab opens on its planning screen or on W0 (round 3, item 1).
 *
 *  A fix that lands AFTER the switch leaves the reader on W0 on purpose:
 *  the pill is right there, and a screen that re-planned itself under a
 *  reader who had settled on W0 would be the tab moving on its own. */
export function hasStart(s: ShellState): boolean {
  return s.origin.kind === "point" || s.gps !== null;
}

/** Is a walk on screen? The tab that is showing is on its navigate or its
 *  arrived screen — the two screens that DRAW the plan rather than offer it.
 *  Two rules follow, and both were missing before the final review:
 *   - a replan must not throw that plan away (C1). The clock ticks every
 *     30 s under "leave now", and every tick that crosses a five-minute step
 *     is a silent `leave`; the auto-preference rule fires on the hour it
 *     changes at. Either one used to null `plan`, and since `planJob` asks
 *     for nothing while navigating, nothing ever computed it again: the
 *     route line vanished off the map, the ETA fell to "0 min · 0.0 km", and
 *     a Wander walk could no longer arrive.
 *   - a tap on the live map must not end the walk (I1). */
export function walking(s: ShellState): boolean {
  if (s.tab === "wander") return s.wander.k === "navigate" || s.wander.k === "arrived";
  return s.route.k === "navigate" || s.route.k === "arrived";
}

/** Is a walk being walked right now? Narrower than `walking`, which counts
 *  the arrival screen too: the browser's back button may leave an arrival
 *  (the walk is over and the reader is reading about it), but it may not
 *  leave a walk in progress — End does that (ui/history.ts, `restore`). */
export function navigating(s: ShellState): boolean {
  return s.tab === "wander" ? s.wander.k === "navigate" : s.route.k === "navigate";
}

/** The settings this walk is actually planned with: the routes header's
 *  access chip overrides them for ONE trip, and everything that reads
 *  access or the cobble wall — the planner, its key, the no-route
 *  diagnosis, the share link — has to read the same pair. Returns the
 *  record it was given, by identity, when nothing is overridden.
 *
 *  Pure, and here rather than in plan/settings.ts because the override is a
 *  piece of shell state, not a stored setting. */
export function tripSettings(s: ShellState, settings: Settings): Settings {
  const { access, avoidCobbles } = s.trip;
  if (access === null && avoidCobbles === null) return settings;
  return {
    ...settings,
    ...(access === null ? {} : { access }),
    ...(avoidCobbles === null ? {} : { avoidCobbles }),
  };
}

/** Anything that changes what the planner would answer throws the current
 *  answer away, and says so: `computing` stays true from the tap until the
 *  new plan lands, so no screen shows a stale route as if it were fresh. */
function replan(s: ShellState): ShellState {
  // Not while it is being walked: the walker is following these lines.
  if (walking(s)) return s;
  // With no graph there is nothing to wait for: a failed city must not put
  // the skeleton back up on the next preference tap.
  // The scrubbed minute goes with the answer: the scrubber only exists with
  // nothing drawn (ui/layers.ts, `scrubberVisible`), so a walk on its way in
  // takes the sun back to the trip's own departure, and a walk on its way
  // out brings the scrubber back at Leave-at (CR-02 "Done when").
  return { ...s, plan: null, selected: 0, scrub: null, computing: !s.graphFailed && needsPlan(s) };
}

/** The screen a walk ends on, and the one `back` falls through to. */
const HOME: RouteScreen = { k: "home" };

/** Put a new start point on the routes screen, which carries its own copy
 *  (the header shows it, and the swap acts on it). Every other screen has no
 *  origin of its own and is handed back untouched. */
function withOrigin(screen: RouteScreen, origin: Origin): RouteScreen {
  return screen.k === "routes" ? { ...screen, origin } : screen;
}

export function reduce(s: ShellState, a: Action): ShellState {
  switch (a.type) {
    case "tab": {
      if (a.tab === s.tab) return s;
      // Not while a walk is on: `tab` is the one action that used to cross
      // the boundary of a live walk, and it took the walk's plan with it
      // (`replan` nulls it on the way back). The tab bar is hidden on
      // Navigate and the web chrome is off, so today only code can reach
      // it — but a guard is what makes that a rule rather than a layout
      // accident (final review M1).
      if (walking(s)) return s;
      // Switching TO Wander with a start in hand asks the question at once
      // (Viktor, phone round 3, item 1): "Route → Wander shows a prelim
      // screen; I expect the planning screen immediately." W0 is a map, a
      // pill and nothing planned — and when the app already knows where
      // "here" is, tapping the tab IS the tap on that pill. W0 stays the
      // tab's root and the ✕'s target, so it is still one gesture away and
      // still where a reader with no fix and no pin lands.
      const wander: WanderScreen =
        a.tab === "wander" && s.wander.k === "idle" && hasStart(s) ? { k: "loops" } : s.wander;
      return replan({ ...s, tab: a.tab, wander, overlay: null, trip: NO_TRIP });
    }

    // The three map/search entries into the route tab. None of them lands
    // mid-walk: on Navigate and Arrived the map is live under the sheet, and
    // a tap on a POI label used to swap the whole screen for a place card —
    // ending the walk with no confirmation and no End (final review I1).
    case "search": {
      if (walking(s)) return s;
      // A keystroke on a search already open changes the query and nothing
      // else: the end being edited and the screen behind it belong to the
      // field that opened it.
      const open = s.route.k === "search" ? s.route : null;
      const end = open ? open.end : (a.end ?? "to");
      // Only the routes screen is worth coming back to; every card's header
      // is the search bar itself, and back from one returns to the map.
      const back = open ? open.back : s.route.k === "routes" ? s.route : HOME;
      return { ...s, tab: "route", overlay: null, route: { k: "search", q: a.q, end, back } };
    }

    case "pickPlace": {
      if (walking(s)) return s;
      // Picking a result for the FROM field is not a destination: it moves
      // the start of the walk already on screen and goes straight back to it.
      if (s.route.k === "search" && s.route.end === "from") {
        const origin: Origin = {
          kind: "point",
          at: [a.place.lng, a.place.lat],
          label: a.place.name,
        };
        return replan({ ...s, overlay: null, origin, route: withOrigin(s.route.back, origin) });
      }
      return replan({
        ...s,
        tab: "route",
        overlay: null,
        trip: NO_TRIP,
        route: { k: "place", place: a.place },
      });
    }

    case "longPress": {
      // a dropped pin is a route-tab thing, and never lands mid-walk
      if (s.tab !== "route") return s;
      if (walking(s)) return s;
      // The walk the pin lands on top of is remembered rather than replaced
      // (round 4 item 4). A second pin dropped over the first keeps the same
      // walk behind it: the detour is the pin, however many are dropped.
      const back =
        s.route.k === "routes" ? s.route : s.route.k === "pin" ? s.route.back : undefined;
      return replan({
        ...s,
        trip: NO_TRIP,
        route: { k: "pin", at: a.at, address: null, shadePct: null, back },
      });
    }

    case "pinInfo": {
      // the lookups are async: by the time they answer the pin may be gone
      if (s.route.k !== "pin") return s;
      const address = a.address === undefined ? s.route.address : a.address;
      const shadePct = a.shadePct === undefined ? s.route.shadePct : a.shadePct;
      return { ...s, route: { ...s.route, address, shadePct } };
    }

    case "names": {
      let out = s;
      if (a.originLabel !== undefined && s.origin.kind === "point" && s.origin.label === null) {
        const origin: Origin = { ...s.origin, label: a.originLabel };
        const route = s.route.k === "routes" && s.route.origin.kind === "point" && s.route.origin.label === null
          ? { ...s.route, origin }
          : s.route;
        out = { ...out, origin, route };
      }
      if (a.destName !== undefined && (out.route.k === "routes" || out.route.k === "navigate") && out.route.destName === "") {
        out = { ...out, route: { ...out.route, destName: a.destName } };
      }
      return out;
    }

    case "origin": {
      // Refused while a walk is being walked, on either tab: the walker is
      // following these lines and their start is behind them.
      if (walking(s)) return s;
      // ONE start point for both tabs (CR-03 A8, backlog B3). Whoever set
      // it — a Wander map tap, the Route tab's "Start here", a FROM search,
      // either tab's Locate button — the other tab is looking at the same
      // pin, and a planned route re-plans from it.
      const route: RouteScreen =
        s.tab !== "route"
          ? // from the Wander tab only the ROUTES screen moves: it is the
            // one that draws a FROM. A place or pin card the reader left on
            // the other tab is not a walk and has nothing to re-plan.
            withOrigin(s.route, a.origin)
          : s.route.k === "routes"
            ? { ...s.route, origin: a.origin }
            : s.route.k === "pin"
              ? // "Start here" has done its job and the pin card steps aside —
                // onto the walk it was covering, if it was covering one, which
                // now starts from the pin. Setting one end of a walk never
                // costs the other (round 4 item 4).
                s.route.back
                ? withOrigin(s.route.back, a.origin)
                : HOME
              : // "Your location" at the top of a FROM search: the same answer
                // the field was opened for, so the search closes with it
                s.route.k === "search" && s.route.end === "from"
                ? withOrigin(s.route.back, a.origin)
                : s.route;
      // From W0 a start point IS the question: the map tap and the idle pill
      // both arrive here, and both mean "loops from there" (SPEC §3 W0). A
      // start set on the ROUTE tab does not ask it — W0 stays the root, with
      // the shared pin standing on its map until the pill is tapped.
      const wander: WanderScreen =
        s.tab === "wander" && s.wander.k === "idle" ? { k: "loops" } : s.wander;
      // A new start is a new question: "loop via Günthersburgpark from here"
      // cannot survive a move of "here" (W3), wherever the move came from.
      return replan({ ...s, origin: a.origin, trip: { ...s.trip, via: null }, route, wander });
    }

    case "routeTo": {
      // A walk started from a place card comes back to that card, not to
      // Home: the ✕ on the From row undoes the "Route · 21 min" that got
      // here (R4). Every other entry — a pin, a share link, a swap — has
      // no card behind it.
      const from =
        s.route.k === "place"
          ? s.route.place
          : // a swap re-routes from the routes screen itself: the card the
            // walk came from is still the way back out of it
            s.route.k === "routes"
            ? s.route.from
            : undefined;
      return replan({
        ...s,
        tab: "route",
        overlay: null,
        trip: NO_TRIP,
        route: { k: "routes", origin: s.origin, dest: a.dest, destName: a.name, from },
      });
    }

    case "trip": {
      const trip: Trip = {
        ...s.trip,
        access: a.access === undefined ? s.trip.access : a.access,
        avoidCobbles: a.avoidCobbles === undefined ? s.trip.avoidCobbles : a.avoidCobbles,
      };
      if (trip.access === s.trip.access && trip.avoidCobbles === s.trip.avoidCobbles) return s;
      // The sheet stays open (SPEC §4: tapping a segment applies and the
      // reader closes it themselves), so `overlay` is left exactly as it is.
      return replan({ ...s, trip });
    }

    case "loopVia": {
      if (walking(s)) return s;
      if (a.via === null) {
        if (s.trip.via === null) return s;
        // back to "Loops from here", from the same point the loops start at
        return replan({ ...s, trip: { ...s.trip, via: null } });
      }
      // The Wander tab's own start is left alone: a loop VIA a park still
      // begins where the walker is standing. `tab` would have wiped the
      // trip, so the switch happens here rather than through it.
      return replan({
        ...s,
        tab: "wander",
        overlay: null,
        trip: { ...NO_TRIP, via: a.via },
        wander: { k: "loops" },
      });
    }

    case "plan": {
      // a share link's `?r=` survives exactly until there is a list to
      // index; it is clamped, because the plan it names may have fewer
      // candidates than the one the link was made from
      const n = a.plan ? 1 + a.plan.alternatives.length : 0;
      const want = s.bootSelected;
      const selected = want === null || n === 0 ? 0 : Math.min(Math.max(0, want), n - 1);
      return { ...s, plan: a.plan, selected, computing: false, bootSelected: null };
    }

    case "reroute": {
      // Only a walk in progress: an arrival is over, and every other screen
      // gets its plans through the planner.
      if (!navigating(s)) return s;
      const n = 1 + a.plan.alternatives.length;
      return {
        ...s,
        plan: a.plan,
        selected: Math.min(Math.max(0, a.selected), n - 1),
        computing: false,
      };
    }

    case "computing":
      // The first plan of a session has no ghost to hide behind, so the
      // skeleton's own flag is the other half of "a walk is coming".
      return { ...s, computing: a.on, scrub: a.on ? null : s.scrub };

    case "select": {
      // Clamped at BOTH ends, the way `plan` and `reroute` above already
      // clamp: an index past the end of this plan's candidate list is a
      // card that is not there. Reachable — a restored snapshot carries the
      // link's 0…2 cap, not this plan's count, and the address bar drops
      // `t=` while "leave now", so a reload can re-plan at a different
      // minute and come back with fewer candidates (S6 review, finding 5).
      if (a.i < 0) return s;
      // No plan yet is not an out-of-range index — it is a pick made before
      // the list exists, which `plan` resolves against `bootSelected` on the
      // way in. Only a plan can say how many candidates there are.
      if (!s.plan) return { ...s, selected: a.i };
      return { ...s, selected: Math.min(a.i, s.plan.alternatives.length) };
    }

    case "overlay":
      return { ...s, overlay: a.overlay };

    case "pref":
      return replan({ ...s, pref: a.pref, prefAuto: a.auto, overlay: null });

    case "leave":
      return replan({
        ...s,
        startMin: a.startMin,
        leaveNow: a.now,
        overlay: a.silent ? s.overlay : null,
      });

    case "duration": {
      // Apply always closes its sheet — tapping it on the length that is
      // already set is the likeliest thing to do after opening the sheet to
      // check, and it used to leave the reader stuck behind the scrim. Only
      // a CHANGED length is worth throwing the answer away for.
      const backBy = a.backBy === undefined ? null : a.backBy;
      const sameBack = backBy === s.trip.backBy;
      const closed = s.overlay === null ? s : { ...s, overlay: null };
      // The hour is the link's business, not the planner's: changing only
      // the way the length was SAID must not throw the loops away.
      const withBack = sameBack ? closed : { ...closed, trip: { ...closed.trip, backBy } };
      if (s.durationMin === a.min) return withBack;
      return replan({ ...withBack, durationMin: a.min });
    }

    case "start": {
      // a new walk starts with no heading: the arrow is drawn only once
      // THIS walk has seen a moving fix (ui/heading.ts)
      if (s.tab === "wander") {
        return s.wander.k === "loops"
          ? { ...s, overlay: null, gpsHeading: null, wander: { k: "navigate" } }
          : s;
      }
      if (s.route.k !== "routes") return s;
      return {
        ...s,
        overlay: null,
        gpsHeading: null,
        // the place card the walk was started from rides along, so End can
        // put it back (final review I2)
        route: {
          k: "navigate",
          dest: s.route.dest,
          destName: s.route.destName,
          from: s.route.from,
        },
      };
    }

    case "end": {
      if (s.tab === "wander") {
        // The ✕ on the loops header, a pull below the sheet's peek, and
        // Escape: SPEC §3 W1 reads "✕ always (→ W0, clears loops)". W0 is
        // the tab's root, so there is nowhere else for them to go — and the
        // via goes with the loops, because "loop via the park from here" is
        // a question about a walk that is being thrown away (CR-02 slice A).
        // The LENGTH stays: it is a planning input, not part of the answer,
        // and W0's own pill shows it.
        if (s.wander.k === "loops") {
          return replan({
            ...s,
            overlay: null,
            trip: { ...s.trip, via: null },
            wander: { k: "idle" },
          });
        }
        if (s.wander.k !== "navigate") return s;
        // End puts the question back exactly as it was asked, from the point
        // the loop was planned from — which the walk carried with it.
        // The point the loop was planned from is still `s.origin`: an
        // origin change is refused for the whole of a walk.
        return replan({ ...s, overlay: null, wander: { k: "loops" } });
      }
      if (s.route.k !== "navigate") return s;
      return replan({
        ...s,
        overlay: null,
        route: {
          k: "routes",
          origin: s.origin,
          dest: s.route.dest,
          destName: s.route.destName,
          from: s.route.from,
        },
      });
    }

    case "arrived": {
      if (s.tab === "wander") {
        return s.wander.k === "navigate"
          ? { ...s, overlay: null, wander: { k: "arrived", atMin: a.atMin } }
          : s;
      }
      if (s.route.k !== "navigate") return s;
      return {
        ...s,
        overlay: null,
        route: { k: "arrived", destName: s.route.destName, atMin: a.atMin },
      };
    }

    // Done and Loop back home both mean "I am standing at the end of that
    // walk". Whatever point was pinned as the start belongs to the walk that
    // is over — a share link's `s=`, a pin's "Start here", a tapped park —
    // and planning the next walk from it would plan from where the walker
    // WAS (final review I2/M10). Both go back to the live fix.
    case "done": {
      if (s.tab === "wander") {
        // …and "back where I started" means the tab's ROOT, on both tabs.
        // Route's `done` goes to HOME; Wander's went to a freshly computed
        // W1, i.e. loops nobody asked for — the exact thing W0 exists to
        // remove (CR-02 slice A review, F2). `loopHome` is the one case that
        // still lands on loops, because there the reader asked for them.
        return replan({
          ...s,
          overlay: null,
          origin: GPS_ORIGIN,
          trip: NO_TRIP,
          wander: { k: "idle" },
        });
      }
      return replan({ ...s, overlay: null, origin: GPS_ORIGIN, trip: NO_TRIP, route: HOME });
    }

    case "loopHome":
      return replan({
        ...s,
        tab: "wander",
        overlay: null,
        origin: GPS_ORIGIN,
        trip: NO_TRIP,
        route: HOME,
        wander: { k: "loops" },
      });

    case "gps":
      // A REFUSAL is not news about where the reader is. It says the watch
      // has stopped, which is what `gpsDenied` records; the last known fix
      // is exactly as true as it was a moment ago, so it stays.
      //
      // It used to be wiped, and that took a resumed walk down with it: a
      // reload restores `nav.lastFix` through this same action (ui/useResume
      // .ts) and a PERMISSION_DENIED arriving behind it left Navigate with no
      // walker at all — the "Open" item this closes (backlog-R, 2026-09-10,
      // and `resume:189`, which had to stub the watch silent to avoid it).
      // The ruling: keep the fix, keep walking, and let the first real fix
      // replace it. The toast is unchanged, and `useGps` still dispatches it.
      //
      // A fix and a denial can be true together — a permission revoked in
      // site settings mid-session is the ordinary way — and everything that
      // reads the two reads them separately.
      return a.denied && a.pos === null
        ? s.gpsDenied ? s : { ...s, gpsDenied: true }
        : { ...s, gps: a.pos, gpsHeading: a.heading ?? s.gpsHeading, gpsDenied: a.denied ?? false };

    case "graph":
      // a failure ends the wait; a fresh load simply clears the flag
      return a.failed
        ? { ...s, graphFailed: true, computing: false }
        : s.graphFailed
          ? { ...s, graphFailed: false }
          : s;

    case "city": {
      // Tapping the city you are already on must not wipe the screen.
      if (!a.changed) return s.overlay === null ? s : { ...s, overlay: null };
      // A pin, a destination and a walk all belong to the city they were
      // made in; the new one starts from nothing but the tab you are on.
      return replan({
        ...s,
        overlay: null,
        graphFailed: false,
        focus: null,
        focusZoom: null,
        outsideSeen: false,
        route: HOME,
        // ...and the new city's Wander tab starts where every Wander tab
        // starts: W0, with nothing planned (CR-02 slice A). Loops from a fix
        // that is still in the old city are no answer to any question.
        wander: { k: "idle" },
        origin: GPS_ORIGIN,
        trip: NO_TRIP,
      });
    }

    case "scrub":
      return s.scrub === a.min ? s : { ...s, scrub: a.min };

    case "scrubEnd":
      return s.scrub === null ? s : { ...s, scrub: null };

    case "focus":
      return { ...s, focus: a.at, focusZoom: a.zoom ?? null, focusSeq: s.focusSeq + 1 };

    case "outsideSeen":
      return s.outsideSeen === a.seen ? s : { ...s, outsideSeen: a.seen };

    case "toast":
      return { ...s, toast: a.text };

    // The browser's back button, restoring a screen it pushed. Two rules,
    // both borrowed from the two neighbours of this case:
    //   - a walk is left by End, never by a back gesture (see `back`), so a
    //     restore while navigating is refused. useHistory pushes the entry
    //     back, and the reader stays on the walk.
    //   - a walk is STARTED, never restored (the same rule the reload takes:
    //     handover §3.2, "Navigate → Routes"). An entry that names a
    //     navigate screen lands on the screen it was started from, exactly
    //     as End does.
    case "restore": {
      if (navigating(s)) return s;
      const route: RouteScreen =
        a.route.k === "navigate"
          ? {
              k: "routes",
              origin: s.origin,
              dest: a.route.dest,
              destName: a.route.destName,
              from: a.route.from,
            }
          : // An arrival is not restorable either (final review M2): back
            // after Done pops the `route:arrived` entry, and the screen it
            // names is a walk that has no plan behind it any more — "You're
            // there" over nothing. There is no destination on the entry to
            // rebuild a routes screen from, so it falls to Home, which is
            // where Done itself leaves the reader.
            a.route.k === "arrived"
            ? HOME
            : a.route;
      const wander: WanderScreen =
        a.wander.k === "navigate" || a.wander.k === "arrived" ? { k: "loops" } : a.wander;
      // The per-trip access override rides on the entry (review B-3): it is
      // the one planning input the address bar must NOT carry, because a
      // link's `a=` boots as a SESSION override and this one may not outlive
      // the walk it was set for. Restoring it from `history.state` is what
      // keeps a back-and-forward round trip honest without the URL.
      return replan({ ...s, tab: a.tab, route, wander, trip: a.trip, origin: a.origin, overlay: null });
    }

    case "back": {
      // an open sheet swallows the gesture before the screen does
      if (s.overlay !== null) return { ...s, overlay: null };
      if (s.tab === "wander") return s;
      switch (s.route.k) {
        // A search is a detour, not a screen of its own: it returns to
        // whatever opened it, and — crucially — without replanning. Opening
        // the From field and closing it again must leave the walk on screen
        // exactly as it was (R4).
        case "search":
          return { ...s, route: s.route.back };
        // The ✕ on the From row (and the browser gesture) undoes the step
        // that got here: back to the place card the walk was started from,
        // and to the map when there was none (R4, handover §3.2).
        case "routes":
          return replan({
            ...s,
            trip: NO_TRIP,
            route: s.route.from ? { k: "place", place: s.route.from } : HOME,
          });
        // the place card's header is the search bar, not a query it kept:
        // back from it returns to the map, as it does from every card
        case "place":
          return replan({ ...s, route: HOME });
        // ...and a pin returns to the walk it was dropped over, when it was
        // dropped over one. Dismissing a detour is not throwing a walk away
        // (round 4 item 4).
        case "pin":
          return replan({ ...s, route: s.route.back ?? HOME });
        default:
          return s; // a walk is left by End, never by the back gesture
      }
    }
  }
}
