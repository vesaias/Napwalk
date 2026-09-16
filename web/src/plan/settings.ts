// User settings for the planning layer (UI redesign Task 4, 2026-09-05).
// One flat record persisted in localStorage under "sw.settings"; the router
// itself does not read it — callers pass the pieces through (access on the
// Preset, cobble wall via hardFilter as `extraCost`, pace via setSpeedKmh).
import { CITIES, DEFAULT_CITY, type CityId } from "../cities";
import { getLocale, setLocale, type Locale } from "../i18n/t";
import { isPhone, layoutFor, sideways } from "../ui/layout/breakpoints";
import { setSpeedKmh, type Access } from "../router/astar";
import type { Graph } from "../router/graph";
import { COBBLE_Q } from "../router/stats";

export type Pace = "easy" | "normal" | "brisk";
export const PACE_KMH: Record<Pace, number> = { easy: 4, normal: 4.8, brisk: 5.5 };
/** Light by default; dark when the reader asks for it; "daylight" follows
 *  the sun in the SELECTED CITY — light from sunrise to sunset, dark either
 *  side of it (2026-09-06). The device's own `prefers-color-scheme` is no
 *  longer a theme: a phone that dims at dusk is not a reason to dim a walk
 *  planned for tomorrow lunchtime. */
export type ThemePref = "light" | "dark" | "daylight";

/** Which map overlays the reader has asked to see (CR-02 edit 1). Noise is
 *  the second opinion you go looking for, so it is off. Shade DEPENDS ON THE
 *  FRAME (Viktor, 2026-09-09): on for the web, off for the phone, where the
 *  overlay costs about 3 MiB of DSM tiles on the first paint of Home over
 *  mobile data, before the reader has asked for anything. `defaultsFor`
 *  below is the only place that decides it, and it decides it once — a
 *  stored `layers` record wins over the viewport for ever after, so a phone
 *  reader who turns shade on keeps it at every width and a desktop reader
 *  who turns it off keeps that on their phone.
 *
 *  Neither layer is a planning input: the router costs its own shade per
 *  edge at the arrival time (CLAUDE.md rule 4) and never reads this. Since
 *  CR-03 A1 nothing overrides it either: a drawn walk used to force shade on
 *  whatever this said, and Viktor's ruling (backlog B6) is that the switch
 *  is the only thing that moves the overlay. */
export type Layers = { shade: boolean; noise: boolean };

export type Settings = {
  access: Access;
  avoidCobbles: boolean;
  pace: Pace;
  autoPref: boolean;
  city: CityId;
  layers: Layers;
  theme: ThemePref;
  locale: Locale;
};

/** The record every field falls back to. `layers.shade` here is the WEB
 *  answer — `defaultsFor({ phone: true })` is the other one, and
 *  `loadSettings` asks the viewport which it wants. Anything with no
 *  viewport at all (a unit test, a worker) gets the web answer. */
export const DEFAULT_SETTINGS: Settings = {
  access: "stroller",
  avoidCobbles: false,
  pace: "easy",
  autoPref: true,
  city: DEFAULT_CITY,
  layers: { shade: true, noise: false },
  theme: "light",
  locale: getLocale(),
};

const KEY = "sw.settings";

export { COBBLE_Q };

const ACCESS: Access[] = ["walk", "stroller", "wheelchair"];
const THEMES: ThemePref[] = ["light", "dark", "daylight"];
const LOCALES: Locale[] = ["en", "de"];

function oneOf<T extends string>(allowed: readonly T[], v: unknown, dflt: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
}
function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === "boolean" ? v : dflt;
}

/** The map layers, with the one migration this field has needed: until
 *  CR-02 the noise raster was a Settings row of its own, `noiseDefault`, and
 *  a reader who turned it on meant "show me noise" — which is exactly
 *  `layers.noise`. It is read ONLY when the stored record has no `layers` of
 *  its own; the first save after that writes the new shape and the old key
 *  is gone for good. Shade has nothing to migrate from: before CR-02 it was
 *  never a setting, only a consequence of having drawn a walk. */
function layers(o: Record<string, unknown>, d: Layers): Layers {
  const l = o.layers;
  if (l !== null && typeof l === "object" && !Array.isArray(l)) {
    const r = l as Record<string, unknown>;
    return { shade: bool(r.shade, d.shade), noise: bool(r.noise, d.noise) };
  }
  return { shade: d.shade, noise: bool(o.noiseDefault, d.noise) };
}

/** A fresh copy of the defaults for one frame, `layers` included — a shallow
 *  spread of DEFAULT_SETTINGS would hand every caller the SAME nested object.
 *
 *  `phone` is the only thing the frame decides: shade off there, on
 *  everywhere else (Viktor, 2026-09-09 — the 3 MiB of DSM tiles a bare Home
 *  fetches at boot). Taken as an argument rather than read from `window`
 *  here so that the parser below stays pure and testable at both answers. */
export function defaultsFor(env: { phone: boolean; city?: CityId }): Settings {
  return {
    ...DEFAULT_SETTINGS,
    city: env.city ?? DEFAULT_SETTINGS.city,
    layers: { shade: !env.phone, noise: false },
  };
}

/** Is this the phone frame? `wantsPanel` cannot change the answer — the
 *  panel frames are both ≥ 768 — so it is passed as false. `isPhone` rather
 *  than `=== "phone"` since CR-03 Q4: a phone held on its side is still the
 *  phone this default is about, which after the S5 review's F3 ruling means
 *  narrow OR sideways — a first run at 844 × 390 is an iPhone 14 on its
 *  side and gets the phone's shade-off default (CR-03 A2), where before the
 *  ruling it read as a tablet and turned shade on. No window (a unit test,
 *  a worker): not a phone, i.e. the web default. */
function onPhone(): boolean {
  if (typeof window === "undefined") return false;
  // the same rule layoutFor states, read the way this default states it:
  // width < 768 || the viewport is a phone on its side (`sideways`)
  const short = sideways(window.innerWidth, window.innerHeight);
  return isPhone(layoutFor(window.innerWidth, false, short));
}

/** The theme, with the one migration this record has needed: everything
 *  stored before 2026-09-06 that said "auto" meant "follow the device", and
 *  the answer to that is now the default, `light` — NOT "daylight", which is
 *  a different promise the reader never made. */
function theme(v: unknown, dflt: ThemePref): ThemePref {
  return v === "auto" ? "light" : oneOf(THEMES, v, dflt);
}

/** Stored fields validated one by one over the defaults handed in — a stale
 *  value from an older schema falls back on its own instead of poisoning the
 *  rest. Missing record, bad JSON or a non-object → those defaults, copied.
 *
 *  Pure: `raw` is the stored string and `d` is what to fall back to, so the
 *  phone and web answers are the same function asked twice. */
export function parseSettings(raw: string | null, d: Settings): Settings {
  try {
    if (!raw) return { ...d, layers: { ...d.layers } };
    const p: unknown = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p)) return { ...d, layers: { ...d.layers } };
    const o = p as Record<string, unknown>;
    return {
      access: oneOf(ACCESS, o.access, d.access),
      avoidCobbles: bool(o.avoidCobbles, d.avoidCobbles),
      pace: oneOf(Object.keys(PACE_KMH) as Pace[], o.pace, d.pace),
      autoPref: bool(o.autoPref, d.autoPref),
      city: CITIES.some((c) => c.id === o.city) ? (o.city as CityId) : d.city,
      layers: layers(o, d.layers),
      theme: theme(o.theme, d.theme),
      locale: oneOf(LOCALES, o.locale, d.locale),
    };
  } catch {
    return { ...d, layers: { ...d.layers } };
  }
}

/** The stored settings for the frame the app is running in.
 *
 *  `city` is the default the record falls back to when it names no city of
 *  its own — the clock's or the edge's guess at where the reader is (backlog
 *  B1, ui/where.ts). A DEFAULT, not an override: a stored city always wins,
 *  and nothing here writes. */
export function loadSettings(city?: CityId): Settings {
  const d = defaultsFor({ phone: onPhone(), city });
  try {
    return parseSettings(localStorage.getItem(KEY), d);
  } catch {
    // no storage at all (a blocked third-party context reading localStorage
    // throws rather than returning null)
    return d;
  }
}

/** The city the STORED record names, or null when it names none — a first
 *  run, no storage, or a record written before `city` existed.
 *
 *  `loadSettings().city` cannot answer this: it has already fallen back to a
 *  default, and B1's whole question is whether the reader ever chose. Reading
 *  the raw record is the only way to tell "Frankfurt, because they picked it"
 *  from "Frankfurt, because nothing else said". */
export function storedCityId(): CityId | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p: unknown = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p)) return null;
    const id = (p as Record<string, unknown>).city;
    return CITIES.some((c) => c.id === id) ? (id as CityId) : null;
  } catch {
    return null;
  }
}

/** Push the settings into the modules that act on them (locale, pace).
 *  Called at boot with loadSettings() and by saveSettings.
 *
 *  The theme is NOT applied here any more (2026-09-06): "daylight" changes
 *  on its own between two settings changes, so it needs something that
 *  ticks. `ui/useTheme.ts` owns `data-theme` now — this function is called
 *  once per settings change and would leave the page one sunset stale. */
export function applySettings(s: Settings): void {
  setLocale(s.locale);
  setSpeedKmh(PACE_KMH[s.pace]);
}

/**
 * Write the record, and apply the pieces other modules act on.
 *
 * `cityChosen` is B1's one qualification (S7 review F2): while the city on
 * screen is only a GUESS — the device's time zone, or the edge's answer —
 * `city` is left out of the stored JSON altogether, so `storedCityId()`
 * keeps answering null and a reader who toggles "Avoid cobbles" in London
 * does not thereby adopt London for good. The moment they pick a city it is
 * their choice and it is written like any other setting. It is a delete
 * rather than a skip because the record is rewritten whole: a city that was
 * once a guess must not survive as a stale key.
 */
export function saveSettings(s: Settings, cityChosen = true): void {
  try {
    const rec: Record<string, unknown> = { ...s };
    if (!cityChosen) delete rec.city;
    localStorage.setItem(KEY, JSON.stringify(rec));
  } catch {
    /* no storage */
  }
  applySettings(s);
}

/** Extra per-edge cost for route(): a wall on cobbles when the user asked to
 *  avoid them, otherwise nothing (undefined keeps the fast path). Loops have
 *  no extraCost hook; the planner post-filters them instead. */
export function hardFilter(g: Graph, s: Settings): ((eid: number) => number) | undefined {
  if (!s.avoidCobbles) return undefined;
  return (eid) => (g.surfaceQ[eid] >= COBBLE_Q ? Infinity : 0);
}
