// Umami events and virtual page views (2026-09-16).
//
// The owner's ruling: "just as much analytics as we can get." The page
// counter (vite.config.ts, `umamiPlugin`) became a schema the dashboard is
// built on, and this file IS the schema. Everything in it is pure except the
// two senders at the bottom; ui/useAnalytics.ts wires it behind the shell's
// dispatch, so the screens know nothing about it. Two exceptions send on
// their own because nothing in shell state can see them: the report sheet
// (`report`) and the error boundary (`error`).
//
// One privacy line the owner did not ask for and we keep: NO COORDINATES,
// addresses, place names, search text or report text ever leave the page.
// Cities, kinds, counts, minutes, booleans and enum values do. `clean` is
// the guard — a key that so much as contains lat/lng/lon/query/text/address/
// name/label/coord is dropped, and so is any string that looks like a
// coordinate pair or is long enough to be prose. analytics.test.ts holds
// every event below to it.
//
// EVENTS — name, data keys (all keys are in SCHEMA below), when
// ┌───────────┬────────────────────────────────────────────┬──────────────────────────────────────────┐
// │ plan      │ city screen pref auto access cobbles now   │ an A→B plan landed on the routes, place  │
// │           │ leave ok n minutes km                      │ or pin screen — not the clock's own      │
// │           │                                            │ five-minute replans, nor Start's rebase  │
// │ wander    │ city minutes via ok loops                  │ loops landed (minutes = the length asked)│
// │ pick      │ city tab kind                              │ another card was tapped                  │
// │ navigate  │ city tab kind minutes km                   │ Start (a resumed walk does not count)    │
// │ arrived   │ city tab elapsed                           │ the walker reached the end               │
// │ end       │ city tab elapsed pct                       │ End mid-walk; pct = elapsed / planned    │
// │ city      │ from to how                                │ how: picker | where (edge) | timezone    │
// │ layer     │ layer on                                   │ shade / noise toggled                    │
// │ scrub     │ min                                        │ first day-scrubber use, 30-min bucket    │
// │ theme     │ theme                                      │ light | dark | daylight                  │
// │ language  │ locale                                     │ en | de                                  │
// │ settings  │ key value scope                            │ key: access | cobbles | pace | autoPref; │
// │           │                                            │ scope: default (Settings) | trip (chip)  │
// │ report    │ city kind                                  │ a report was sent; kind only, never text │
// │ locate    │ granted                                    │ first fix / first refusal of the session │
// │ resume    │ walking                                    │ a session snapshot was restored (B4)     │
// │ error     │ component                                  │ the ErrorBoundary caught a render        │
// │ where     │ found city                                 │ the edge's answer on a first visit (B1)  │
// └───────────┴────────────────────────────────────────────┴──────────────────────────────────────────┘
// Units: minutes and elapsed are whole minutes, km has one decimal, leave is
// the departure's offset from now in minutes (15-min buckets under two
// hours, hourly beyond, 0 for "leave now"), pct is rounded to 5.
//
// VIRTUAL PAGES — `pageFor`. Umami's own auto-track is off (the real URL
// carries pins), so these are the only page views it sees:
//   /route  /route/search  /route/place  /route/pin  /route/results
//   /route/navigate  /route/arrived
//   /wander  /wander/loops  /wander/navigate  /wander/arrived
//   /settings
// and `<page>/<sheet>` while one of the shell's sheets is open (pref, leave,
// access, duration, layers, city, report). The Settings page's own option
// sheets are local state and do not show.
import type { CityId } from "../cities";
import type { Candidate, PlanResult } from "../plan/plan";
import type { Settings } from "../plan/settings";
import { navigating, tripSettings, type Action, type ShellState } from "./shellState";

export type EventValue = string | number | boolean;
export type EventData = Record<string, EventValue>;
export type Event = { name: string; data: EventData };

/** The data keys each event may carry — the table above, as code. The test
 *  holds every event `eventsFor` and `settingsEvents` build to it. */
export const SCHEMA: Record<string, readonly string[]> = {
  plan: ["city", "screen", "pref", "auto", "access", "cobbles", "now", "leave", "ok", "n", "minutes", "km"],
  wander: ["city", "minutes", "via", "ok", "loops"],
  pick: ["city", "tab", "kind"],
  navigate: ["city", "tab", "kind", "minutes", "km"],
  arrived: ["city", "tab", "elapsed"],
  end: ["city", "tab", "elapsed", "pct"],
  city: ["from", "to", "how"],
  layer: ["layer", "on"],
  scrub: ["min"],
  theme: ["theme"],
  language: ["locale"],
  settings: ["key", "value", "scope"],
  report: ["city", "kind"],
  locate: ["granted"],
  resume: ["walking"],
  error: ["component"],
  where: ["found", "city"],
};

// --- the guard ---------------------------------------------------------------

/** A key containing any of these never leaves the page, whatever it holds. */
const FORBIDDEN = ["lat", "lng", "lon", "query", "text", "address", "name", "label", "coord"];
/** Two decimals with a comma between them is a coordinate pair. */
const COORD_PAIR = /-?\d+\.\d+\s*,\s*-?\d+\.\d+/;
/** Longer than any enum value or city id; long enough to be prose. */
const MAX_STRING = 40;

/** Drop what must not be sent. Strips rather than throws: an analytics call
 *  is never worth a crash, and a stripped key is a red test here rather
 *  than a leak in production. */
export function clean(data: EventData): EventData {
  const out: EventData = {};
  for (const [k, v] of Object.entries(data)) {
    const key = k.toLowerCase();
    if (FORBIDDEN.some((f) => key.includes(f))) continue;
    if (typeof v === "string" && (v.length > MAX_STRING || COORD_PAIR.test(v))) continue;
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    out[k] = v;
  }
  return out;
}

// --- virtual pages -----------------------------------------------------------

const ROUTE_PAGE: Record<ShellState["route"]["k"], string> = {
  home: "/route",
  search: "/route/search",
  place: "/route/place",
  pin: "/route/pin",
  routes: "/route/results",
  navigate: "/route/navigate",
  arrived: "/route/arrived",
};
const WANDER_PAGE: Record<ShellState["wander"]["k"], string> = {
  idle: "/wander",
  loops: "/wander/loops",
  navigate: "/wander/navigate",
  arrived: "/wander/arrived",
};

/** The page the shell is showing, as Umami should see it. */
export function pageFor(s: ShellState): string {
  const base =
    s.tab === "settings"
      ? "/settings"
      : s.tab === "wander"
        ? WANDER_PAGE[s.wander.k]
        : ROUTE_PAGE[s.route.k];
  return s.overlay === null ? base : `${base}/${s.overlay}`;
}

// --- the session ---------------------------------------------------------------

/** What one page load remembers between events. Module-scope in the hook,
 *  handed in here so the mapping stays a function of its arguments. */
export type Session = {
  /** The scrubber has been counted this session. */
  scrubbed: boolean;
  /** The first fix / the first refusal has been counted. */
  located: boolean;
  refused: boolean;
  /** `Date.now()` when the walk on screen began, 0 between walks. */
  walkStartedAt: number;
  /** A resumed walk's own start (B4): the `start` that restores it is not a
   *  new navigation, and its elapsed time began before this page load. */
  resumeWalkAt: number;
  /** The plan in flight was asked for by the clock (a silent `leave`) or by
   *  the auto-preference rule, not by the reader: no `plan` event for it. */
  autoReplan: boolean;
  /** The kind last picked on this screen. Start's rebase replans and then
   *  re-selects the same kind (ui/useStartWalk.ts): the same choice twice
   *  is one `pick`. Forgotten with the screen. */
  pickedKind: string | null;
};

export function newSession(): Session {
  return {
    scrubbed: false,
    located: false,
    refused: false,
    walkStartedAt: 0,
    resumeWalkAt: 0,
    autoReplan: false,
    pickedKind: null,
  };
}

export type Ctx = {
  settings: Settings;
  /** `Date.now()`. */
  now: number;
  /** The city clock's minute of the day, for the leave-at offset. */
  nowMin: number;
  sess: Session;
};

// --- helpers ---------------------------------------------------------------------

/** The departure's offset from now, bucketed: quarter hours under two
 *  hours, whole hours beyond (either side of now). */
export function leaveBucket(deltaMin: number): number {
  const step = Math.abs(deltaMin) < 120 ? 15 : 60;
  return Math.floor(deltaMin / step) * step;
}

function candidateAt(p: PlanResult | null, i: number): Candidate | null {
  if (!p) return null;
  return i <= 0 ? p.recommended : (p.alternatives[i - 1] ?? p.recommended);
}

function selected(s: ShellState): Candidate | null {
  return candidateAt(s.plan, s.selected);
}

function km1(c: Candidate): number {
  return Math.round(c.stats.km * 10) / 10;
}

function elapsedMin(sess: Session, now: number): number {
  return sess.walkStartedAt === 0 ? 0 : Math.max(0, Math.round((now - sess.walkStartedAt) / 60_000));
}

/** Did this action throw the plan away and ask for a new one? */
function replanned(prev: ShellState, next: ShellState): boolean {
  return next !== prev && next.plan === null && next.computing && (prev.plan !== null || !prev.computing);
}

const PLAN_SCREEN: Partial<Record<ShellState["route"]["k"], string>> = {
  routes: "results",
  place: "place",
  pin: "pin",
};

// --- the mapping -------------------------------------------------------------------

/** The events one reducer step is worth. `sess` is written: the once-per-
 *  session flags and the walk's clock live there. */
export function eventsFor(prev: ShellState, next: ShellState, a: Action, c: Ctx): Event[] {
  const { sess } = c;
  const city = c.settings.city;
  const out: Event[] = [];

  // The clock's own replans and the auto-preference rule ask for plans
  // nobody tapped for; Start's rebase to now (useStartWalk) is a silent
  // `leave` too. Any replan the reader caused clears the mark.
  if (replanned(prev, next)) {
    sess.autoReplan =
      (a.type === "leave" && a.silent === true) || (a.type === "pref" && a.auto);
  }
  // a new screen is a new list of cards, and a new choice to make
  if (next.tab !== prev.tab || next.route !== prev.route || next.wander !== prev.wander) {
    sess.pickedKind = null;
  }

  switch (a.type) {
    case "plan": {
      const auto = sess.autoReplan;
      sess.autoReplan = false;
      if (auto) break;
      const p = a.plan;
      const n = p ? 1 + p.alternatives.length : 0;
      if (next.tab === "wander") {
        out.push({
          name: "wander",
          data: { city, minutes: next.durationMin, via: next.trip.via !== null, ok: p !== null, loops: n },
        });
      } else if (next.tab === "route") {
        const screen = PLAN_SCREEN[next.route.k];
        if (!screen) break;
        const ts = tripSettings(next, c.settings);
        const rec = p ? p.recommended : null;
        out.push({
          name: "plan",
          data: {
            city,
            screen,
            pref: next.pref,
            auto: next.prefAuto,
            access: ts.access,
            cobbles: ts.avoidCobbles,
            now: next.leaveNow,
            leave: next.leaveNow ? 0 : leaveBucket(next.startMin - c.nowMin),
            ok: p !== null,
            n,
            minutes: rec ? Math.round(rec.stats.minutes) : 0,
            km: rec ? km1(rec) : 0,
          },
        });
      }
      break;
    }

    case "select": {
      const cand = selected(next);
      if (cand && next.selected !== prev.selected && cand.kind !== sess.pickedKind) {
        sess.pickedKind = cand.kind;
        out.push({ name: "pick", data: { city, tab: next.tab, kind: cand.kind } });
      }
      break;
    }

    case "start": {
      if (navigating(prev) || !navigating(next)) break;
      if (sess.resumeWalkAt !== 0) {
        // the walk began on an earlier page load (ui/useResume.ts)
        sess.walkStartedAt = sess.resumeWalkAt;
        sess.resumeWalkAt = 0;
        break;
      }
      sess.walkStartedAt = c.now;
      const cand = selected(next);
      out.push({
        name: "navigate",
        data: {
          city,
          tab: next.tab,
          kind: cand ? cand.kind : "recommended",
          minutes: cand ? Math.round(cand.stats.minutes) : 0,
          km: cand ? km1(cand) : 0,
        },
      });
      break;
    }

    case "arrived": {
      if (!navigating(prev) || navigating(next)) break;
      out.push({ name: "arrived", data: { city, tab: prev.tab, elapsed: elapsedMin(sess, c.now) } });
      sess.walkStartedAt = 0;
      break;
    }

    case "end": {
      if (!navigating(prev) || navigating(next)) break;
      const elapsed = elapsedMin(sess, c.now);
      const cand = selected(prev);
      const planned = cand ? cand.stats.minutes : 0;
      const pct = planned > 0 ? Math.min(100, Math.round((20 * elapsed) / planned) * 5) : 0;
      out.push({ name: "end", data: { city, tab: prev.tab, elapsed, pct } });
      sess.walkStartedAt = 0;
      break;
    }

    case "gps": {
      if (a.denied && a.pos === null) {
        if (!sess.refused) {
          sess.refused = true;
          out.push({ name: "locate", data: { granted: false } });
        }
      } else if (a.pos && !sess.located) {
        sess.located = true;
        out.push({ name: "locate", data: { granted: true } });
      }
      break;
    }

    case "scrub": {
      if (sess.scrubbed) break;
      sess.scrubbed = true;
      out.push({ name: "scrub", data: { min: Math.round(a.min / 30) * 30 } });
      break;
    }

    case "trip": {
      if (a.access !== undefined && next.trip.access !== prev.trip.access) {
        out.push({
          name: "settings",
          data: { key: "access", value: a.access ?? "default", scope: "trip" },
        });
      }
      if (a.avoidCobbles !== undefined && next.trip.avoidCobbles !== prev.trip.avoidCobbles) {
        out.push({
          name: "settings",
          data: { key: "cobbles", value: a.avoidCobbles === null ? "default" : String(a.avoidCobbles), scope: "trip" },
        });
      }
      break;
    }

    default:
      break;
  }
  return out;
}

/** The events one settings change is worth (ui/useSettings.ts writes them
 *  outside the reducer). `cityChosen` tells a picked city from the edge's
 *  late guess (B1): a pick sets it, `defaultCity` leaves it false. */
export function settingsEvents(prev: Settings, next: Settings, cityChosen: boolean): Event[] {
  const out: Event[] = [];
  if (next.city !== prev.city) {
    out.push({ name: "city", data: { from: prev.city, to: next.city, how: cityChosen ? "picker" : "where" } });
  }
  if (next.layers.shade !== prev.layers.shade) {
    out.push({ name: "layer", data: { layer: "shade", on: next.layers.shade } });
  }
  if (next.layers.noise !== prev.layers.noise) {
    out.push({ name: "layer", data: { layer: "noise", on: next.layers.noise } });
  }
  if (next.theme !== prev.theme) out.push({ name: "theme", data: { theme: next.theme } });
  if (next.locale !== prev.locale) out.push({ name: "language", data: { locale: next.locale } });
  const setting = (key: string, value: string) =>
    out.push({ name: "settings", data: { key, value, scope: "default" } });
  if (next.access !== prev.access) setting("access", next.access);
  if (next.avoidCobbles !== prev.avoidCobbles) setting("cobbles", String(next.avoidCobbles));
  if (next.pace !== prev.pace) setting("pace", next.pace);
  if (next.autoPref !== prev.autoPref) setting("autoPref", String(next.autoPref));
  return out;
}

/** The event a boot's city guess is worth: the device's time zone moved the
 *  default before anything was shown (ui/where.ts). Null when it did not. */
export function bootCityEvent(source: string, from: CityId, to: CityId): Event | null {
  if (source !== "timezone") return null;
  return { name: "city", data: { from, to, how: "timezone" } };
}

/** The component a React componentStack names first, or "unknown". Dev
 *  stacks read "in Shell (created by …)", production ones "at Shell (…)". */
export function componentOf(stack: string | null | undefined): string {
  const m = /^\s*(?:at|in)\s+([A-Za-z0-9_$.]+)/m.exec(stack ?? "");
  return m ? m[1].slice(0, MAX_STRING) : "unknown";
}

// --- the senders ---------------------------------------------------------------------

type Umami = { track: (...args: unknown[]) => unknown };

declare global {
  interface Window {
    umami?: Umami;
  }
}

function umami(): Umami | null {
  try {
    return typeof window !== "undefined" && window.umami ? window.umami : null;
  } catch {
    return null;
  }
}

/** Calls made before `s.js` has landed. It is a deferred script, so the
 *  boot's own page view can run ahead of it on a slow line; the queue holds
 *  a few and retries with a doubling delay, then gives up. A build without
 *  the tag (dev, no VITE_UMAMI_ID) simply drops them. */
const QUEUE_MAX = 32;
const RETRIES = 5;
const queue: ((u: Umami) => void)[] = [];
let retry = 0;
let timer = 0;

function flush(u: Umami): void {
  for (const fn of queue.splice(0)) {
    try {
      fn(u);
    } catch {
      /* the counter is never worth a crash */
    }
  }
}

function arm(): void {
  if (timer !== 0 || retry >= RETRIES || typeof setTimeout === "undefined") return;
  timer = Number(
    setTimeout(() => {
      timer = 0;
      retry += 1;
      const u = umami();
      if (u) flush(u);
      else if (retry >= RETRIES) queue.length = 0;
      else arm();
    }, 1000 * 2 ** retry)
  );
}

function send(fn: (u: Umami) => void): void {
  const u = umami();
  if (u) {
    flush(u);
    try {
      fn(u);
    } catch {
      /* see flush */
    }
    return;
  }
  if (queue.length < QUEUE_MAX) queue.push(fn);
  arm();
}

/** An event. A no-op without `window.umami`, and never throws. */
export function track(name: string, data: EventData): void {
  const safe = clean(data);
  send((u) => u.track(name, safe));
}

/** A virtual page view: `umami.track({ url })` merges the url into the
 *  default payload, so tabs and screens show up as pages in the dashboard. */
export function pageview(url: string): void {
  send((u) => u.track({ url }));
}

/** Test seam: forget the queue and its retry clock. */
export function resetSender(): void {
  queue.length = 0;
  retry = 0;
  if (timer !== 0) clearTimeout(timer);
  timer = 0;
}
