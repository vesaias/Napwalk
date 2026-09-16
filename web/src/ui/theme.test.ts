import { describe, expect, it } from "vitest";
import { daylightHint, resolveTheme } from "./theme";

// Frankfurt, 2026-09-05: sunrise 06:50, sunset 20:00 (plan/preference.ts).
const RISE = 6 * 60 + 50;
const SET = 20 * 60;

describe("resolveTheme", () => {
  it("passes an explicit choice through, whatever the clock says", () => {
    expect(resolveTheme("light", 0, RISE, SET)).toBe("light");
    expect(resolveTheme("light", 1439, RISE, SET)).toBe("light");
    expect(resolveTheme("dark", 720, RISE, SET)).toBe("dark");
  });

  it("daylight is light between sunrise and sunset", () => {
    expect(resolveTheme("daylight", 14 * 60, RISE, SET)).toBe("light");
    expect(resolveTheme("daylight", RISE + 1, RISE, SET)).toBe("light");
    expect(resolveTheme("daylight", SET - 1, RISE, SET)).toBe("light");
  });

  it("daylight is dark before sunrise and after sunset", () => {
    expect(resolveTheme("daylight", 22 * 60, RISE, SET)).toBe("dark");
    expect(resolveTheme("daylight", 0, RISE, SET)).toBe("dark");
    expect(resolveTheme("daylight", RISE - 1, RISE, SET)).toBe("dark");
    expect(resolveTheme("daylight", SET + 1, RISE, SET)).toBe("dark");
  });

  it("counts both boundary minutes as day", () => {
    expect(resolveTheme("daylight", RISE, RISE, SET)).toBe("light");
    expect(resolveTheme("daylight", SET, RISE, SET)).toBe("light");
  });

  it("polar summer is light all day, polar winter dark all day", () => {
    for (const m of [0, 360, 720, 1080, 1439]) {
      expect(resolveTheme("daylight", m, 0, 1439)).toBe("light");
    }
    // sunriseMinutes 1439 / sunsetMinutes 1439 is "it never came up": only
    // the very last minute of the day is inside that window.
    expect(resolveTheme("daylight", 720, 1439, 1439)).toBe("dark");
    expect(resolveTheme("daylight", 0, 1439, 1439)).toBe("dark");
  });
});

describe("daylightHint", () => {
  it("in the light, the next turn is sunset", () => {
    expect(daylightHint(14 * 60, RISE, SET)).toEqual({ mode: "light", until: SET });
  });

  it("in the dark, it is the sunrise on either side of the night", () => {
    expect(daylightHint(22 * 60, RISE, SET)).toEqual({ mode: "dark", until: RISE });
    expect(daylightHint(3 * 60, RISE, SET)).toEqual({ mode: "dark", until: RISE });
  });
});
