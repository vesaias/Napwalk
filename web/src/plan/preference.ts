// Route preference and the time-of-day rule that picks one automatically
// (UI redesign Task 5, 2026-09-05). Pure functions over minutes-of-day; the
// planner feeds in the wall clock (or the picked start time) and a sunset it
// computed once per day and city.
import { PRESETS, type Daylight, type Preset } from "../router/astar";
import { sunPosition, type Observer } from "../shade/sun";
import type { Settings } from "./settings";

export type Preference = "shade" | "quiet" | "balanced";
export type Daypart = "morning" | "afternoon" | "evening";

/** The comparison baseline: surface only, so "fastest" still avoids the
 *  worst pavement but ignores shade, noise and greenery. */
export const FASTEST: Preset = { wShade: 0, wNoise: 0, wSurface: 2.0, wGreen: 0 };

const PRESET_OF: Record<Preference, Preset> = {
  shade: PRESETS.maxShade,
  quiet: PRESETS.maxQuiet,
  balanced: PRESETS.balanced,
};

/** The router preset for a preference, carrying the user's access mode and
 *  the day's daylight. After sunset (`night`) the shade term is zeroed:
 *  shade data in the dark is meaningless (spec §1, `autoPreference`'s
 *  nightShade). `day` is what lets `lerpShade` tell a minute the artifact
 *  cannot price from a minute after dark (astar.ts). */
export function presetFor(
  pref: Preference,
  s: Settings,
  night = false,
  day?: Daylight
): Preset {
  const p = { ...PRESET_OF[pref], access: s.access, day };
  return night ? { ...p, wShade: 0 } : p;
}

/** Sunset as the almanacs define it: the sun's centre 0.833° below the
 *  horizon (refraction plus the solar radius, the threshold astral uses in
 *  the pipeline). sunPosition is geometric, so applying the offset here
 *  lands within a minute of the pipeline's 20:07 for Frankfurt, 2026-09-02;
 *  a plain el <= 0 test is four minutes early. */
const SUNSET_EL = -0.833;

/** First minute after local noon at which the sun has set, stepping one
 *  minute at a time. 1439 when it never sets that day (polar summer). */
export function sunsetMinutes(day: string, obs: Observer): number {
  for (let m = 721; m < 1440; m++) {
    if (sunPosition(day, m, obs).el <= SUNSET_EL) return m;
  }
  return 1439;
}

/** First minute of the day at which the sun has risen — the same −0.833°
 *  threshold, walked forward from midnight and stopping at local noon. 0
 *  when the sun is already up at 00:00 (polar summer) and 1439 when it has
 *  not risen by noon and so never will that day (polar winter). Together
 *  with sunsetMinutes it is the daylight window the theme follows. */
export function sunriseMinutes(day: string, obs: Observer): number {
  for (let m = 0; m <= 720; m++) {
    if (sunPosition(day, m, obs).el > SUNSET_EL) return m;
  }
  return 1439;
}

const SHADE_FROM = 11 * 60; // 11:00
const SHADE_TO = 16 * 60; // 16:00 (exclusive)
const QUIET_FROM = 18 * 60; // 18:00

/** Spec §1: 11:00–15:59 shade first; 18:00 until sunset quiet first; from
 *  sunset on balanced with no shade term (nightShade — the caller zeroes
 *  wShade, since shade data after dark is meaningless); otherwise balanced.
 *  Daypart is the label shown next to the auto choice: morning before
 *  11:00, afternoon until 18:00, evening after. */
export function autoPreference(
  minuteOfDay: number,
  sunsetMin: number
): { pref: Preference; daypart: Daypart; nightShade: boolean } {
  const m = minuteOfDay;
  const daypart: Daypart = m < SHADE_FROM ? "morning" : m < QUIET_FROM ? "afternoon" : "evening";
  if (m >= sunsetMin) return { pref: "balanced", daypart, nightShade: true };
  if (m >= SHADE_FROM && m < SHADE_TO) return { pref: "shade", daypart, nightShade: false };
  if (m >= QUIET_FROM) return { pref: "quiet", daypart, nightShade: false };
  return { pref: "balanced", daypart, nightShade: false };
}

/** The hours the automatic rule owns, for the badge beside its pick
 *  ("auto · 11–16 h"). Balanced gets none: it is what the rule falls back
 *  to OUTSIDE the two windows it names, so there is no interval to show. */
export function autoWindow(pref: Preference, sunsetMin: number): { from: number; to: number } | null {
  if (pref === "shade") return { from: SHADE_FROM / 60, to: SHADE_TO / 60 };
  if (pref === "quiet") return { from: QUIET_FROM / 60, to: Math.floor(sunsetMin / 60) };
  return null;
}
