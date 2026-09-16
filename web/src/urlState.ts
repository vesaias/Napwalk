// F6: full route state lives in URL parameters. A shared link reproduces
// the route exactly — routing is deterministic for a given graph artifact.
// Params: m=loop|ab, t=minutes, p=preset, a=access, ac=0|1 (avoid cobbles),
// d=duration, s=lng,lat, e=lng,lat, v=lng,lat (loop via), bb=HHMM (be
// back by), r=selected index.
import type { AccessKey, Mode, PresetKey } from "./debug/components/ControlBar";
import { getCity, type CityId } from "./cities";
import { isLngLat } from "./lngLat";
import { DAY_END_MIN, DAY_START_MIN, STEP_MIN } from "./debug/components/ControlBar";

// A loop's length. The Wander sheet offers 30/45/60/90 as tiles, and its
// "be back by" slider lands anywhere on the five-minute grid between these
// two bounds (Task 13, 2026-09-05) — `d` used to be checked against the
// debug page's fixed [30, 45, 60], which silently dropped every other one.
// The upper bound is a guard as much as a preference: the loop planner is
// asked for a walk, not for the rest of the day.
export const MIN_DURATION_MIN = 15;
export const MAX_DURATION_MIN = 180;

export type ShareState = {
  city: CityId;
  mode: Mode;
  minutes: number;
  preset: PresetKey;
  access: AccessKey;
  /** The cobble wall the walk was planned with, as `ac=1` / `ac=0`. Omitted
   *  (undefined) by the debug page, which has no such control. */
  avoidCobbles?: boolean;
  duration: number;
  start: [number, number] | null;
  dest: [number, number] | null;
  /** `v=lng,lat` — the place a loop is asked to go through (W3, handover
   *  §3.3). Loop links only; an A→B walk has a destination instead. */
  via?: [number, number] | null;
  /** `bb=HHMM` — the loop length said as the hour to be home by (W2). The
   *  LENGTH still travels as `d`; this is only how the reader said it. */
  backBy?: number | null;
  selected: number;
  /** The screen the link opens on, when `m` cannot say it. `m` is the kind
   *  of walk — A→B or a loop — and both of those are the walking tabs;
   *  Settings is a third screen with no walk in it at all. Added for the
   *  browser-back work (2026-09-06): every screen change pushes its own URL,
   *  so a refresh on Settings has to come back to Settings.
   *
   *  `wander` joined it with W0 (CR-02 slice A): the Wander tab's root has
   *  no walk on it either, so `m` cannot name it and a refresh there would
   *  otherwise come back on Home — or, if it borrowed `m=loop`, come back
   *  with loops nobody asked for. */
  screen?: "settings" | "wander";
};

const PRESET_KEYS = new Set(["balanced", "maxShade", "maxQuiet"]);

/** SPEC/handover §3.3 renames the presets to the words the UI now uses
 *  (`shade first` / `quiet first` / `balanced`). Links are forever, so both
 *  spellings decode; only the old one is written, until the day a version
 *  that reads the new one is old enough that nobody is running the other. */
const PRESET_ALIAS: Record<string, PresetKey> = {
  shade: "maxShade",
  quiet: "maxQuiet",
  balanced: "balanced",
};

// A pin is checked for being a coordinate at all, and for nothing else
// (QA 2026-09-06, F1-01/F2-03). The box check that used to live here — the
// selected city's bounds plus 0.1° of slack — dropped the pins of any link
// whose `c=` was missing or wrong, and the shell then opened Home with no
// pin, no route and no message: the reader could not tell a stale link from
// a link for another city from no link at all. Deciding a link is "for the
// wrong city" is the planner's job, not the parser's: `planJob` refuses a
// job whose ends fall outside the city's data border and `noRouteReason`
// turns that refusal into the "You're outside Frankfurt" card, with Show
// city / Switch city under it. So the pins survive decoding and the answer
// is given on screen.
//
// Range is still enforced, by the same guard the geocoder uses: a longitude
// past ±180 or a latitude past ±90 is not a place, and MapLibre throws on
// one (F6-01).
function parseLngLat(v: string | null): [number, number] | null {
  if (!v) return null;
  const parts = v.split(",").map(Number);
  if (parts.length !== 2) return null;
  const p: [number, number] = [Math.round(parts[0] * 1e5) / 1e5, Math.round(parts[1] * 1e5) / 1e5];
  return isLngLat(p) ? p : null;
}

/** "1530" → 930 minutes past midnight, on the same five-minute grid the
 *  clock, the planner and `t=` all move on. Null for anything that is not
 *  an hour of an actual day. */
function parseHHMM(v: string | null): number | null {
  if (!v || !/^\d{4}$/.test(v)) return null;
  const h = Number(v.slice(0, 2));
  const m = Number(v.slice(2));
  if (h > 23 || m > 59) return null;
  const min = Math.round((h * 60 + m) / STEP_MIN) * STEP_MIN;
  return min >= DAY_START_MIN && min <= DAY_END_MIN ? min : null;
}

export function decodeState(qs: string): Partial<ShareState> {
  const p = new URLSearchParams(qs);
  const out: Partial<ShareState> = {};
  const cityParam = p.get("c");
  const city = getCity(cityParam).id;
  if (cityParam && city === cityParam) out.city = city;
  if (p.get("m") === "ab") out.mode = "ab";
  else if (p.get("m") === "loop") out.mode = "loop";
  // Number(null) and Number("") are both 0, which would read a link with no
  // `t` as midnight; only an actual value counts.
  const tRaw = p.get("t");
  const t = tRaw ? Number(tRaw) : NaN;
  if (Number.isFinite(t) && t >= DAY_START_MIN && t <= DAY_END_MIN) {
    out.minutes = Math.round(t / STEP_MIN) * STEP_MIN;
  }
  const preset = p.get("p");
  if (preset && PRESET_KEYS.has(preset)) out.preset = preset as PresetKey;
  // hasOwn, not `in`: `in` walks the prototype chain, so `p=toString` would
  // decode to a Function typed as a PresetKey.
  else if (preset && Object.hasOwn(PRESET_ALIAS, preset)) out.preset = PRESET_ALIAS[preset];
  const sc = p.get("sc");
  if (sc === "settings" || sc === "wander") out.screen = sc;
  const acc = p.get("a");
  if (acc === "wheelchair" || acc === "stroller" || acc === "walk") out.access = acc;
  const cob = p.get("ac");
  if (cob === "1" || cob === "0") out.avoidCobbles = cob === "1";
  const d = Number(p.get("d"));
  if (Number.isInteger(d) && d % STEP_MIN === 0 && d >= MIN_DURATION_MIN && d <= MAX_DURATION_MIN) {
    out.duration = d;
  }
  const s = parseLngLat(p.get("s"));
  if (s) out.start = s;
  const v = parseLngLat(p.get("v"));
  if (v) out.via = v;
  const bb = parseHHMM(p.get("bb"));
  if (bb !== null) out.backBy = bb;
  const e = parseLngLat(p.get("e"));
  if (e) out.dest = e;
  const rRaw = p.get("r");
  if (rRaw !== null) {
    const r = Number(rRaw);
    if (Number.isInteger(r) && r >= 0 && r <= 2) out.selected = r;
  }
  return out;
}

export function encodeState(s: ShareState): string {
  const p = new URLSearchParams();
  // ALWAYS written, the default city included (S7 review F1, 2026-09-10).
  // It used to be omitted for Frankfurt "so Frankfurt links stay exactly as
  // they were", which meant every Frankfurt link carried pins and no city —
  // and B1's boot then had nothing to tell "a link for this city" from "no
  // link at all", so it guessed, and opened a Frankfurt walk in London.
  // A link carries a walk and a walk has a city; the two bytes are cheap.
  // Links written before this still open: `decodeState` reads them as
  // before, and `ui/boot.ts` reads a `c=`-less link WITH PINS as the
  // default city, which is what it always meant.
  // getCity, not s.city: an unknown or missing id must fall back to the
  // default rather than write c=undefined into a shared link
  p.set("c", getCity(s.city).id);
  p.set("m", s.mode);
  p.set("t", String(s.minutes));
  p.set("p", s.preset);
  // A shared link reproduces the WALK, so it always pins the two settings
  // that decide which routes exist — the effective access and the cobble
  // wall, i.e. the routes header's per-trip chip over the reader's settings
  // (review B-3). Writing `a=` only when it differed from some default left
  // a reader whose own Settings say "wheelchair" opening a stroller walk as
  // a wheelchair walk. `ac=` is omitted only where the caller has no such
  // control (the debug page).
  p.set("a", s.access);
  if (s.avoidCobbles !== undefined) p.set("ac", s.avoidCobbles ? "1" : "0");
  // The loop LENGTH also travels with a link that has no loop in it: W0 is
  // the Wander tab's root, its pill reads `45 min ▾`, and the reader's own
  // duration has to survive a refresh there (CR-02 slice A review, F1).
  // `decodeState` already reads `d` unconditionally, and `bootShell` takes
  // `link.duration` before it looks at `m`, so this is the whole fix.
  if (s.mode === "loop" || s.screen === "wander") p.set("d", String(s.duration));
  if (s.mode === "loop") {
    // the place the loop goes through, and the hour the length was said as
    if (s.via) p.set("v", s.via.map((n) => n.toFixed(5)).join(","));
    if (s.backBy !== undefined && s.backBy !== null) {
      const h = Math.floor(s.backBy / 60);
      p.set("bb", `${String(h).padStart(2, "0")}${String(s.backBy - h * 60).padStart(2, "0")}`);
    }
  }
  if (s.start) p.set("s", s.start.map((n) => n.toFixed(5)).join(","));
  if (s.dest && s.mode === "ab") p.set("e", s.dest.map((n) => n.toFixed(5)).join(","));
  if (s.selected > 0) p.set("r", String(s.selected));
  if (s.screen) p.set("sc", s.screen);
  return p.toString();
}
