// Clock helpers for the app shell (UI redesign Task 11, 2026-09-05).
//
// The debug page keeps the same three constants in its ControlBar; they are
// repeated here rather than imported because debug/ is the dev-only build
// (Task 3) and the shipped shell must not reach into it.
import type { City } from "../cities";
import { sunriseMinutes, sunsetMinutes } from "../plan/preference";
import type { Observer } from "../shade/sun";
import { num1 } from "./kit/format";

export const DAY_START_MIN = 0;
export const DAY_END_MIN = 24 * 60 - 5;
/** The clock, the leave-at sheet and the URL all move in five-minute steps. */
export const STEP_MIN = 5;

/** How close to sunset a departure may still be planned. Under five minutes
 *  of daylight there is no shade left to route around, and the walk itself
 *  is longer than the light (SPEC §1.1's "no shade after 17:40" is the same
 *  fact said one card earlier). */
export const SUNSET_MARGIN_MIN = 5;

/** The departure window the leave-at slider offers: the DAYLIGHT of the
 *  city's day, five minutes in from each end — sunrise↑5 to sunset↓5, both
 *  on the five-minute grid.
 *
 *  It has been three windows. The whole 00:00–23:55 day, whose left end was
 *  fourteen hours in the past and whose right end was hours after the sun
 *  had gone (UX sweep U4); then [now, sunset−5], which was too tight the
 *  other way (backlog B7 — Viktor: "allow all sunlight day selection in
 *  slider"). The clock is out of it altogether now: a departure earlier than
 *  now is a WHAT-IF for today, which is a real question — the shade of this
 *  walk at 08:00 is a fact about today whether or not 08:00 has been and
 *  gone — and there is no tomorrow in this app to mean anything else.
 *
 *  `afterSunset` is a fact about the CLOCK, not about the window: the sun is
 *  down, so the sheet says there is no shade left to plan for. The slider
 *  still offers the day behind it (B7). The window itself only collapses
 *  where there is no daylight to offer at all — a polar winter, where
 *  `sunriseMinutes`/`sunsetMinutes` fold onto the same minute.
 *
 *  `priced` narrows the TRACK, and only the track, to the minutes the
 *  artifact can price (plan/hours.ts `pricedDaylight`, P1 review F1). The
 *  window's ends come from the shade buckets when those fall inside the
 *  daylight — Frankfurt's June sunrise is 05:15↑5 = 05:25 and its first
 *  bucket is 05:30 — so no departure the slider offers reaches `lerpShade`'s
 *  clamp. `afterSunset` is unchanged by it: whether the sun has gone is a
 *  fact about the SUN, not about the artifact's window. */
export function leaveWindow(
  sunriseMin: number,
  sunsetMin: number,
  nowMin: number,
  priced?: { sunriseMin: number; sunsetMin: number }
): { min: number; max: number; afterSunset: boolean } {
  const grid = (m: number) => Math.min(DAY_END_MIN, Math.max(DAY_START_MIN, m));
  const lo = Math.max(sunriseMin + SUNSET_MARGIN_MIN, priced?.sunriseMin ?? -Infinity);
  const hi = Math.min(sunsetMin - SUNSET_MARGIN_MIN, priced?.sunsetMin ?? Infinity);
  const min = grid(Math.ceil(lo / STEP_MIN) * STEP_MIN);
  const max = grid(Math.floor(hi / STEP_MIN) * STEP_MIN);
  const afterSunset = nowMin >= sunsetMin - SUNSET_MARGIN_MIN;
  return max <= min ? { min, max: min, afterSunset } : { min, max, afterSunset };
}

/** Does the departure the reader is LOOKING AT have any shade left to plan
 *  for? — the condition behind the leave-at sheet's "After sunset" note.
 *
 *  It is a question about the PICKED minute, not about the clock. The note
 *  used to hang off `leaveWindow`'s `afterSunset`, which says where the sun
 *  is NOW: a reader who opened the sheet at 21:00 and dragged the slider
 *  back to 11:00 was still told there was no shade to plan for, over a strip
 *  of bars showing the shade of exactly that departure (Viktor, phone round
 *  3, item 3). The slider offers the whole day on purpose (B7) and every
 *  minute of it is a real what-if for today.
 *
 *  The second clause is the case the first cannot see on its own: a window
 *  that lies entirely past sunset — a winter's day the artifact prices to
 *  its very end, or a collapsed polar one — offers no minute that ISN'T
 *  after sunset, and the note is true of the whole sheet rather than of the
 *  pick. */
export function noShadeAt(
  pickMin: number,
  sunsetMin: number,
  win: { min: number; max: number }
): boolean {
  const gone = sunsetMin - SUNSET_MARGIN_MIN;
  return pickMin >= gone || win.min >= gone;
}

/** A minute count the shell cannot know yet — no origin, so no walk to
 *  measure. It is a value, not a label: the sentence around it comes from
 *  the catalog either way. U+2014 EM DASH. */
export const UNKNOWN_MIN = "—";

/** A minute of the day on the planner's five-minute grid, inside the day. */
function snapMinute(m: number): number {
  const snapped = Math.round(m / STEP_MIN) * STEP_MIN;
  return Math.min(DAY_END_MIN, Math.max(DAY_START_MIN, snapped));
}

/** The local wall clock as minutes since midnight, snapped to STEP_MIN. */
export function nowClamped(d = new Date()): number {
  return snapMinute(d.getHours() * 60 + d.getMinutes());
}

/** The local wall clock as minutes since midnight, unsnapped — what the
 *  navigation screen adds the remaining walk to. `nowClamped` is the
 *  planner's five-minute grid; this is the clock on the wall. */
export function nowMinutes(d = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** The sun observer for a city: its centre is close enough — sunset moves
 *  by well under a minute across a city-sized box. */
export function observerOf(c: City): Observer {
  return { lat: c.center[1], lng: c.center[0], timeZone: c.timeZone };
}

// sunsetMinutes steps minute by minute from noon (plan/preference.ts), so
// it is worth exactly one call per day and city.
const sunsetCache = new Map<string, number>();

export function sunsetFor(day: string, c: City): number {
  const key = `${day}|${c.id}`;
  const hit = sunsetCache.get(key);
  if (hit !== undefined) return hit;
  const v = sunsetMinutes(day, observerOf(c));
  sunsetCache.set(key, v);
  return v;
}

const sunriseCache = new Map<string, number>();

/** The other end of the daylight window (ui/theme.ts), cached the same way
 *  and for the same reason: it is a minute-by-minute walk from midnight. */
export function sunriseFor(day: string, c: City): number {
  const key = `${day}|${c.id}`;
  const hit = sunriseCache.get(key);
  if (hit !== undefined) return hit;
  const v = sunriseMinutes(day, observerOf(c));
  sunriseCache.set(key, v);
  return v;
}

// One formatter per zone: Intl.DateTimeFormat construction is the expensive
// half, and the theme asks this question once a minute.
const TZ_FMT = new Map<string, Intl.DateTimeFormat>();

/** The real wall clock IN THE CITY: its calendar day and its minutes since
 *  midnight. Deliberately not `nowMinutes()`, which is the browser's zone,
 *  and deliberately not the shell's `startMin`, which a `?t=` link or the
 *  leave-at sheet may have pinned to a time nobody is standing in. Whether
 *  the sun is up over Frankfurt is a fact about Frankfurt. */
export function cityClock(c: City, d = new Date()): { day: string; minute: number } {
  let f = TZ_FMT.get(c.timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: c.timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    TZ_FMT.set(c.timeZone, f);
  }
  const parts = f.formatToParts(d);
  const g = (type: string) => parts.find((x) => x.type === type)!.value;
  return {
    day: `${g("year")}-${g("month")}-${g("day")}`,
    minute: (Number(g("hour")) % 24) * 60 + Number(g("minute")),
  };
}

/** ...and the same clock on the planner's five-minute grid: what "now"
 *  means for a DEPARTURE in the selected city (S2 review, finding 2).
 *
 *  Every minute the leave-at sheet reasons about is the city's, because the
 *  window it sits in is: `leaveWindow` measures from the city's sunrise and
 *  sunset. Reading "now" off the browser instead made 23:00 in Berlin, with
 *  New York selected, print "After sunset — no shade to plan for" over a
 *  slider clamped to 20:25 — in broad New York daylight. */
export function cityNowClamped(c: City, d = new Date()): number {
  return snapMinute(cityClock(c, d).minute);
}

/** One decimal, the way every km figure in the design is written — and in
 *  the reader's language: "2.3" in English, "2,3" in German (QA F4-01). */
export function km(meters: number): string {
  return num1(Math.round(meters / 100) / 10);
}
