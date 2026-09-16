import { describe, expect, it } from "vitest";
import { getCity } from "../cities";
import {
  DAY_END_MIN,
  DAY_START_MIN,
  STEP_MIN,
  SUNSET_MARGIN_MIN,
  cityClock,
  cityNowClamped,
  leaveWindow,
  noShadeAt,
  nowClamped,
  nowMinutes,
  sunriseFor,
  sunsetFor,
} from "./time";

// The window has been three things. The whole 00:00–23:55 day, whose left
// end was fourteen hours in the past and whose right end was hours after the
// sun had gone (UX sweep U4); then [now, sunset−5], too tight the other way;
// and now the daylight day, sunrise↑5 to sunset↓5 (CR-03 A3, backlog B7).
describe("leaveWindow (SPEC §3 R6, CR-03 A3)", () => {
  const SUNRISE = 6 * 60 + 51; // Frankfurt, early September
  const SUNSET = 20 * 60 + 7;
  const JUNE = { rise: 5 * 60 + 15, set: 21 * 60 + 38 };
  const NOON = 12 * 60;

  it("opens five minutes after sunrise, rounded UP to the five-minute grid", () => {
    expect(SUNSET_MARGIN_MIN).toBe(5);
    // 06:51 + 5 = 06:56, up to 07:00
    expect(leaveWindow(SUNRISE, SUNSET, NOON).min).toBe(7 * 60);
    expect(leaveWindow(6 * 60, SUNSET, NOON).min).toBe(6 * 60 + 5);
  });

  it("closes five minutes before sunset, on the grid", () => {
    // 20:07 − 5 = 20:02, floored to the five-minute grid
    expect(leaveWindow(SUNRISE, SUNSET, NOON).max).toBe(20 * 60);
  });

  it("is a window, not the day: neither end is the clock's own", () => {
    const w = leaveWindow(SUNRISE, SUNSET, NOON);
    expect(w.min).toBeGreaterThan(DAY_START_MIN);
    expect(w.max).toBeLessThan(DAY_END_MIN);
    expect((w.max - w.min) % STEP_MIN).toBe(0);
  });

  // B7's ruling: a time before now is a what-if for TODAY, and the sheet
  // offers it. The window does not move with the clock at all.
  it("offers the morning to a reader standing in the afternoon", () => {
    const w = leaveWindow(SUNRISE, SUNSET, 18 * 60);
    expect(w.min).toBe(7 * 60);
    expect(w.min).toBeLessThan(18 * 60);
    expect(w).toEqual(leaveWindow(SUNRISE, SUNSET, 8 * 60));
  });

  it("keeps the whole day on offer after sunset, and still says the sun is down", () => {
    const w = leaveWindow(SUNRISE, SUNSET, 21 * 60);
    expect(w.afterSunset).toBe(true);
    expect(w.min).toBe(7 * 60);
    expect(w.max).toBe(20 * 60); // the slider still has the day
  });

  it("calls the last five minutes of daylight 'after sunset' too", () => {
    expect(leaveWindow(SUNRISE, SUNSET, 20 * 60 + 4).afterSunset).toBe(true);
    expect(leaveWindow(SUNRISE, SUNSET, 20 * 60 + 1).afterSunset).toBe(false);
  });

  it("is wider in June than in September", () => {
    const june = leaveWindow(JUNE.rise, JUNE.set, NOON);
    const sept = leaveWindow(SUNRISE, SUNSET, NOON);
    expect(june.min).toBeLessThan(sept.min);
    expect(june.max).toBeGreaterThan(sept.max);
    expect(june.min).toBeLessThanOrEqual(5 * 60 + 30); // "05:30 is selectable"
  });

  it("collapses only where there is no daylight to offer", () => {
    const w = leaveWindow(1439, 1439, NOON);
    expect(w.max).toBe(w.min);
  });

  it("never leaves the day it is measured in", () => {
    expect(leaveWindow(23 * 60 + 58, 24 * 60, NOON).min).toBe(DAY_END_MIN);
    expect(leaveWindow(-30, SUNSET, NOON).min).toBe(DAY_START_MIN);
  });
});

// S2 review, finding 2. `useSunDay` has always asked the CITY for its sun —
// `observerOf` is the city's centre and the city's IANA zone — but the
// minute that sun was compared against came off the browser. With New York
// selected from a Berlin browser at 23:00 on 21 June, the leave-at sheet
// read "After sunset — no shade to plan for" and opened clamped to 20:25,
// in broad New York daylight (measured on the parent).
describe("the clock the leave-at sheet reasons with is the city's", () => {
  const NYC = getCity("nyc");
  const FFM = getCity("frankfurt");
  // 21 June, 23:00 in Berlin — 17:00 in New York, five hours of daylight left
  const BERLIN_23 = new Date("2026-06-21T23:00:00+02:00");
  // New York's own sun that day, from the same source the shell uses
  const day = cityClock(NYC, BERLIN_23).day;
  const rise = sunriseFor(day, NYC);
  const set = sunsetFor(day, NYC);

  it("reads 17:00 in New York while the browser reads 23:00", () => {
    expect(nowMinutes(BERLIN_23)).toBe(23 * 60);
    expect(cityClock(NYC, BERLIN_23).minute).toBeGreaterThanOrEqual(16 * 60 + 55);
    expect(cityClock(NYC, BERLIN_23).minute).toBeLessThanOrEqual(17 * 60 + 5);
    expect(cityNowClamped(NYC, BERLIN_23)).toBe(17 * 60);
  });

  it("...and the sun is still up there, so the sheet must not say otherwise", () => {
    expect(leaveWindow(rise, set, cityNowClamped(NYC, BERLIN_23)).afterSunset).toBe(false);
    // the browser's minute is what said it had gone
    expect(leaveWindow(rise, set, nowClamped(BERLIN_23)).afterSunset).toBe(true);
  });

  it("...and the city's now is inside the window, so nothing is clamped away", () => {
    const win = leaveWindow(rise, set, cityNowClamped(NYC, BERLIN_23));
    const now = cityNowClamped(NYC, BERLIN_23);
    expect(now).toBeGreaterThanOrEqual(win.min);
    expect(now).toBeLessThanOrEqual(win.max);
  });

  it("agrees with the browser where the two zones do", () => {
    // the ordinary case, and the one every e2e runs in: Frankfurt from a
    // Europe/Berlin browser
    expect(cityNowClamped(FFM, BERLIN_23)).toBe(nowClamped(BERLIN_23));
    expect(cityClock(FFM, BERLIN_23).day).toBe("2026-06-21");
  });

  it("stays on the planner's five-minute grid, inside the day", () => {
    for (const iso of ["2026-06-21T00:01:00Z", "2026-06-21T12:32:00Z", "2026-06-21T23:58:00Z"]) {
      const m = cityNowClamped(NYC, new Date(iso));
      expect(m % STEP_MIN).toBe(0);
      expect(m).toBeGreaterThanOrEqual(DAY_START_MIN);
      expect(m).toBeLessThanOrEqual(DAY_END_MIN);
    }
  });
});

describe("noShadeAt", () => {
  const SUNRISE = 6 * 60 + 51; // Frankfurt, early September
  const SUNSET = 20 * 60 + 7;
  // The sheet clamps its pick into the window, so these are the minutes a
  // reader can actually be looking at (screens/route/LeaveAtSheet.tsx).
  const win = leaveWindow(SUNRISE, SUNSET, 21 * 60);

  it("is false for a departure in daylight, whatever the clock says", () => {
    // the bug, from the phone: the sheet opened at 21:00 and dragged to 11:00
    expect(win.afterSunset).toBe(true);
    expect(noShadeAt(11 * 60, SUNSET, win)).toBe(false);
    expect(noShadeAt(win.min, SUNSET, win)).toBe(false);
  });

  it("is true for a departure at or past sunset, margin included", () => {
    expect(noShadeAt(SUNSET, SUNSET, win)).toBe(true);
    expect(noShadeAt(SUNSET - SUNSET_MARGIN_MIN, SUNSET, win)).toBe(true);
    expect(noShadeAt(SUNSET - SUNSET_MARGIN_MIN - 1, SUNSET, win)).toBe(false);
  });

  it("is true when the whole window lies past sunset", () => {
    // a window the artifact prices to the very end of a short day: every
    // minute it offers is after the sun, so the note is about the sheet
    const late = { min: SUNSET, max: SUNSET + 30 };
    expect(noShadeAt(late.min, SUNSET, late)).toBe(true);
    expect(noShadeAt(0, SUNSET, late)).toBe(true);
  });
});
