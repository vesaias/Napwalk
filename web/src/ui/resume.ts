// Coming back after a tab discard (backlog B4, 2026-09-10) — the pure half.
//
// A phone browser under memory pressure throws the tab away and reloads the
// page when the reader comes back to it. Nothing on the page can stop that;
// what it can do is come back where it was. Two stores share the work, and
// the split is deliberate:
//
//   - the URL carries the WALK. `m`, `s`, `e`, `t`, `d`, `p`, `a`, `sc` and
//     `r` say which tab, which destination, which departure, which loop
//     length, which preference and which candidate (ui/history.ts writes it
//     on every screen change). A share link and a reload restore the same
//     thing, which is why there is one encoder for both.
//   - `sessionStorage` carries the VIEW: where the map is looking, how far
//     the sheet is up, the minute the day scrubber is holding, and whether a
//     walk was being walked. None of those belong in a link — nobody hands
//     over "my sheet was at tall" — and all of them are lost on a reload.
//
// A snapshot is only ever applied to the URL it was taken on (`screenId`
// below), in the CITY it was taken in, and only for half an hour. A reader
// who edits the address bar, or opens a different link in the same tab, gets
// a fresh page: restoring a camera onto somebody else's walk is worse than
// not restoring at all. The city is on the snapshot rather than in
// `screenId` because a city chosen from the Settings sheet never reaches the
// URL at all — and a Frankfurt camera applied to Paris put the reader in the
// far north-east corner of Paris's bounds, turned 44°, with the debug badge
// saying it was deliberate (S6 review, finding 1).
//
// Everything here is a pure function of plain data, so what is written and
// what a stale or hostile snapshot restores to are testable without a
// browser (resume.test.ts). `useResume.ts` is the only module that touches
// `sessionStorage`.
import { CITIES, type CityId } from "../cities";
import type { Camera, LngLat } from "../components/MapView";
import { isLngLat } from "../lngLat";
import type { Snap } from "./kit/sheetSnap";
import { navigating, type ShellState } from "./shellState";

/** The map's camera, re-exported so a reader of this module has the whole
 *  snapshot in one place. */
export type { Camera };

/** The one key. `sessionStorage`, never `localStorage`: this is about ONE
 *  tab's page load, and a snapshot that outlived the tab would put a reader
 *  who opened the app fresh tomorrow back on yesterday's camera. */
export const RESUME_KEY = "sw.resume";

/** Bumped when the shape below changes. An older or newer snapshot is
 *  ignored rather than half-read. */
export const RESUME_VERSION = 1;

/** How old a snapshot may be and still be worth restoring. Half an hour is
 *  about the longest a "I was just here" is true for; past it the sun has
 *  moved, the walk has not been walked, and a fresh plan fit is the honest
 *  answer. */
export const RESUME_MAX_AGE_MS = 30 * 60_000;

/** The URL parameters that identify the screen a snapshot belongs to: the
 *  kind of walk, its two ends, the departure, the loop length and the
 *  screen `m` cannot name. Not `p`/`a`/`r`: a preference tap or a promoted
 *  candidate is the same screen with the same camera on it, and a snapshot
 *  thrown away by one would be thrown away on every tap. */
const SCREEN_KEYS = ["m", "s", "e", "t", "d", "sc"] as const;

/** A walk in progress. `lastFix` is what `useWalk` is seeded with until the
 *  GPS watch produces a real one — the alternative is a Navigate screen with
 *  no walker on it for the second or two the first fix takes.
 *
 *  `startedAt` is the wall clock the walk began at, carried for the debug
 *  badge and for the day somebody wants "you have been walking 20 minutes";
 *  nothing restores from it today. */
export type ResumeNav = {
  walking: boolean;
  startedAt: number;
  lastFix: LngLat | null;
};

/** What one page load leaves behind for the next one. Plain JSON — it is
 *  stringified into `sessionStorage`, so nothing here may be a Map, a Set or
 *  a typed array. Small by construction: four numbers, a word, two
 *  coordinates and a URL, well under the 2 kB the backlog asks for. */
export type Resume = {
  v: number;
  /** The screen this snapshot was taken on (`screenId`). */
  url: string;
  /** The city the shell was showing. Not part of `screenId`: a city picked
   *  in the Settings sheet never appears in the URL (S6 review, finding 1). */
  city: CityId;
  /** `Date.now()` at the write. */
  ts: number;
  selected: number;
  snap: Snap | null;
  camera: Camera | null;
  scrub: number | null;
  /** Was the map following the walker? Restored only when it was: a reader
   *  who had panned off the walker comes back to their own view, and one who
   *  had not comes back to a camera that keeps up with them (S6 review,
   *  finding 2 — the resumed walk otherwise froze while the walker left the
   *  frame). Absent in a snapshot written before this field existed, which
   *  validates to `false`, which is the old behaviour. */
  following: boolean;
  nav: ResumeNav | null;
};

/**
 * The identity of a screen, from its query string: the six parameters above,
 * in a fixed order, so two URLs that differ only in the order they were
 * written compare equal.
 *
 * A missing parameter is left out rather than written empty, so `?m=ab&e=…`
 * and `?m=ab&e=…&t=` are the same screen — which they are.
 */
export function screenId(search: string): string {
  const p = new URLSearchParams(search);
  const out: string[] = [];
  for (const k of SCREEN_KEYS) {
    const v = p.get(k);
    if (v !== null && v !== "") out.push(`${k}=${v}`);
  }
  return out.join("&");
}

/** The snapshot for what is on screen now. `url` is `screenId(location.search)`
 *  — passed in rather than read, so this stays pure. */
export function snapshot(
  s: ShellState,
  camera: Camera | null,
  snap: Snap | null,
  o: { url: string; city: CityId; now: number; startedAt: number; following: boolean }
): Resume {
  return {
    v: RESUME_VERSION,
    url: o.url,
    city: o.city,
    ts: o.now,
    selected: s.selected,
    snap,
    camera: camera && isLngLat(camera.center) ? camera : null,
    scrub: s.scrub,
    following: o.following,
    nav: navigating(s)
      ? { walking: true, startedAt: o.startedAt, lastFix: s.gps }
      : null,
  };
}

/**
 * What a stored snapshot restores to on THIS page load, or null.
 *
 * `raw` is whatever was in `sessionStorage` — which is attacker-adjacent in
 * the same way `history.state` and a URL parameter are (same origin only, so
 * the reach is small, but a coordinate off it reaches MapLibre and one bad
 * `center` is a thrown "Invalid LngLat" inside a render). So every field is
 * checked rather than trusted, and anything unrecognised is no snapshot at
 * all: a fresh page, which is where a reload lands anyway.
 */
export function restore(raw: unknown, url: string, city: CityId, now: number): Resume | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== RESUME_VERSION) return null;
  if (typeof r.url !== "string" || r.url !== url) return null;
  // A different city is a different map, however identical the six screen
  // parameters are (S6 review, finding 1). A snapshot written before this
  // field existed carries no city and is refused for the same reason: it
  // cannot say which map its camera belongs to.
  if (!CITIES.some((c) => c.id === r.city) || r.city !== city) return null;
  if (typeof r.ts !== "number" || !Number.isFinite(r.ts)) return null;
  // …and not from the future either: a clock that has been put back would
  // otherwise keep a snapshot alive for as long as it was wrong by.
  if (r.ts > now || now - r.ts > RESUME_MAX_AGE_MS) return null;
  return {
    v: RESUME_VERSION,
    url,
    city,
    ts: r.ts,
    selected:
      typeof r.selected === "number" && Number.isInteger(r.selected) && r.selected >= 0 && r.selected <= 2
        ? r.selected
        : 0,
    snap: snapOf(r.snap),
    camera: cameraOf(r.camera),
    scrub: typeof r.scrub === "number" && Number.isFinite(r.scrub) ? r.scrub : null,
    following: r.following === true,
    nav: navOf(r.nav),
  };
}

function snapOf(v: unknown): Snap | null {
  return v === "peek" || v === "default" || v === "tall" ? v : null;
}

/** A camera MapLibre will take: a point it accepts, and three angles in the
 *  ranges it allows. Anything else is no camera, and the plan's own fit
 *  decides where to look. */
function cameraOf(v: unknown): Camera | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  if (!isLngLat(c.center)) return null;
  const num = (x: unknown, lo: number, hi: number): number | null =>
    typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi ? x : null;
  const zoom = num(c.zoom, 0, 24);
  const bearing = num(c.bearing, -360, 360);
  const pitch = num(c.pitch, 0, 85);
  if (zoom === null || bearing === null || pitch === null) return null;
  return { center: c.center, zoom, bearing, pitch };
}

function navOf(v: unknown): ResumeNav | null {
  if (!v || typeof v !== "object") return null;
  const n = v as Record<string, unknown>;
  if (n.walking !== true) return null;
  return {
    walking: true,
    startedAt: typeof n.startedAt === "number" && Number.isFinite(n.startedAt) ? n.startedAt : 0,
    lastFix: isLngLat(n.lastFix) ? n.lastFix : null,
  };
}
