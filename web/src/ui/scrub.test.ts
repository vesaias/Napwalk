import { describe, expect, it } from "vitest";
import {
  NUDGE_MIN,
  PLAY_MIN_PER_MS,
  TICKS,
  TRACK_END,
  TRACK_SPAN,
  TRACK_START,
  clampMinute,
  minuteAt,
  nudge,
  stepPlay,
  trackPos,
} from "./scrub";

/** Frankfurt on 8 September, the day the board draws. */
const SUN = { sunrise: 6 * 60 + 52, sunset: 19 * 60 + 48 };
/** ...and Frankfurt at midsummer, where the sun is up outside the track at
 *  both ends (CR-02 slice C review, F4). */
const JUNE = { sunrise: 5 * 60 + 15, sunset: 21 * 60 + 30 };

describe("the track", () => {
  it("is 06:00 to 21:00, the window the board draws", () => {
    expect(TRACK_START).toBe(360);
    expect(TRACK_END).toBe(1260);
    expect(TRACK_SPAN).toBe(900);
  });

  it("labels every third hour, both ends included", () => {
    expect(TICKS).toEqual([360, 540, 720, 900, 1080, 1260]);
  });

  it("clamps a minute outside the window to the end it fell off", () => {
    expect(clampMinute(14 * 60)).toBe(840);
    expect(clampMinute(4 * 60)).toBe(TRACK_START);
    expect(clampMinute(23 * 60)).toBe(TRACK_END);
  });

  it("puts a thumb somewhere readable when the minute is not a number", () => {
    expect(clampMinute(Number.NaN)).toBe(TRACK_START);
  });
});

describe("trackPos / minuteAt", () => {
  it("puts the ends at 0 and 1 and noon a little past halfway", () => {
    expect(trackPos(TRACK_START)).toBe(0);
    expect(trackPos(TRACK_END)).toBe(1);
    expect(trackPos(12 * 60)).toBeCloseTo(0.4, 6);
    expect(trackPos(14 * 60)).toBeCloseTo(0.5333, 4);
  });

  it("round-trips a minute through a position", () => {
    for (const m of [360, 500, 840, 1000, 1260]) {
      expect(minuteAt(trackPos(m))).toBe(m);
    }
  });

  it("clamps a position outside the track, and survives nonsense", () => {
    expect(minuteAt(-1)).toBe(TRACK_START);
    expect(minuteAt(2)).toBe(TRACK_END);
    expect(minuteAt(Number.NaN)).toBe(TRACK_START);
  });
});

describe("stepPlay", () => {
  it("advances an hour of the day per real second", () => {
    expect(stepPlay(600, 1000, SUN)).toBe(660);
    expect(stepPlay(600, 500, SUN)).toBe(630);
    expect(stepPlay(600, 16, SUN)).toBeCloseTo(600.96, 6);
  });

  it("loops back to sunrise the moment it passes sunset", () => {
    expect(stepPlay(SUN.sunset - 1, 1000, SUN)).toBe(SUN.sunrise);
    // ...and from anywhere past it, including the track's own end
    expect(stepPlay(TRACK_END, 1000, SUN)).toBe(SUN.sunrise);
  });

  it("runs sunrise to sunset inside the CR's fourteen seconds", () => {
    let m = SUN.sunrise;
    let ms = 0;
    let looped = false;
    // 60 fps, the frame rate a desktop actually gives it
    for (let i = 0; i < 5_000 && !looped; i += 1) {
      const next = stepPlay(m, 16, SUN);
      ms += 16;
      looped = next < m;
      m = next;
    }
    expect(looped, "play comes back round").toBe(true);
    expect(ms).toBeLessThanOrEqual(14_000);
    expect(ms).toBeGreaterThan(12_000);
    expect(m).toBe(SUN.sunrise);
  });

  it("plays the whole track when the sun window is unusable", () => {
    const flat = { sunrise: 12 * 60, sunset: 12 * 60 };
    expect(stepPlay(TRACK_END, 1000, flat)).toBe(TRACK_START);
    expect(stepPlay(600, 1000, flat)).toBe(660);
  });

  it("treats a frame with no time in it, or a backwards one, as no time", () => {
    expect(stepPlay(600, 0, SUN)).toBe(600);
    expect(stepPlay(600, -50, SUN)).toBe(600);
    expect(stepPlay(600, Number.NaN, SUN)).toBe(600);
  });

  it("loops rather than lurching when the tab was away for a minute", () => {
    expect(stepPlay(600, 60_000, SUN)).toBe(SUN.sunrise);
  });

  // F4. The play window is the sun's, CLAMPED into the track: in September
  // that is 06:52 -> 19:48, about 12.9 s at an hour a second, which is the
  // CR's "under fourteen seconds". On a midsummer day the sun is up before
  // 06:00 and down after 21:00, so the window IS the track and a play takes
  // the full fifteen. The track is deliberately not widened for it — 06:00
  // to 21:00 is the span the board draws and the span whose shadows are
  // worth looking at — so the ≤ 14 s claim is an August-to-April one, and
  // this is where that is written down (DECISIONS 2026-09-09).
  it("runs the WHOLE track on a midsummer day, so the day takes 15 s", () => {
    // the window is the track: play starts at 06:00 and loops at 21:00
    expect(stepPlay(TRACK_END, 1000, JUNE)).toBe(TRACK_START);
    expect(stepPlay(TRACK_END - 1, 1000, JUNE)).toBe(TRACK_START);
    // ...and nothing short of the end loops
    expect(stepPlay(TRACK_END - 61, 1000, JUNE)).toBeCloseTo(TRACK_END - 1, 6);

    // ...and the run itself, at PLAY_MIN_PER_MS: the window play covers is
    // the sun's own, clamped into the track, so its length in seconds is its
    // length in hours.
    const seconds = (sun: { sunrise: number; sunset: number }) =>
      (clampMinute(sun.sunset) - clampMinute(sun.sunrise)) / (PLAY_MIN_PER_MS * 1000);
    expect(seconds(SUN)).toBeCloseTo(12.93, 2); // the CR's "under fourteen"
    expect(seconds(JUNE)).toBe(15); // the whole track, over the CR's number
  });
});

describe("nudge", () => {
  it("moves a quarter hour either way", () => {
    expect(nudge(840, NUDGE_MIN)).toBe(855);
    expect(nudge(840, -NUDGE_MIN)).toBe(825);
  });

  it("stops at the track's ends rather than walking off them", () => {
    expect(nudge(TRACK_END, NUDGE_MIN)).toBe(TRACK_END);
    expect(nudge(TRACK_START, -NUDGE_MIN)).toBe(TRACK_START);
  });

  it("lands on whole minutes, whatever a play frame left behind", () => {
    expect(nudge(600.96, NUDGE_MIN)).toBe(616);
  });
});
