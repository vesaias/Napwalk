// Which of the two palettes the app is wearing right now (2026-09-06).
//
// The rule the user settled on: light is the default, dark is a choice, and
// the third option is not the device's `prefers-color-scheme` but the sun
// over the SELECTED CITY — light between sunrise and sunset, dark either
// side. Everything here is pure arithmetic on minutes since midnight; the
// clock, the time zone and the sun tables live in ui/useTheme.ts and
// ui/time.ts, so this file is the part a test can pin down.
import type { ThemePref } from "../plan/settings";

/** The resolved palette — the same two values MapView's `theme` prop takes
 *  and the only two `data-theme` is ever set to. */
export type Theme = "light" | "dark";

/** What the Settings row says about the daylight option: which palette it
 *  resolves to now, and the minute at which that turns over. */
export type DaylightHint = { mode: Theme; until: number };

/** `light` and `dark` pass straight through; `daylight` reads the clock.
 *  Both boundary minutes count as day — sunrise and sunset are the minutes
 *  the sun crosses the horizon, and a walker at 20:00 sharp is still in the
 *  light. Polar days and nights need no special case: sunriseMinutes and
 *  sunsetMinutes collapse to 0/1439 and the comparison still holds. */
export function resolveTheme(
  pref: ThemePref,
  minuteOfDay: number,
  sunrise: number,
  sunset: number
): Theme {
  if (pref !== "daylight") return pref;
  return minuteOfDay >= sunrise && minuteOfDay <= sunset ? "light" : "dark";
}

/** The daylight option's own subline. After sunset the next turn is
 *  tomorrow's sunrise, which is today's to within a couple of minutes —
 *  near enough for a label that only says which way the page will flip. */
export function daylightHint(minuteOfDay: number, sunrise: number, sunset: number): DaylightHint {
  const mode = resolveTheme("daylight", minuteOfDay, sunrise, sunset);
  return { mode, until: mode === "light" ? sunset : sunrise };
}
