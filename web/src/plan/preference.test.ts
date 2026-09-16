import { describe, expect, it } from "vitest";
import { PRESETS } from "../router/astar";
import { FRANKFURT } from "../shade/sun";
import { DEFAULT_SETTINGS } from "./settings";
import { autoPreference, autoWindow, FASTEST, presetFor, sunriseMinutes, sunsetMinutes } from "./preference";

describe("autoPreference", () => {
  it("11:00–15:59 is shade first (afternoon)", () => {
    expect(autoPreference(840, 1207)).toEqual({ pref: "shade", daypart: "afternoon", nightShade: false });
    expect(autoPreference(660, 1207).pref).toBe("shade");
    expect(autoPreference(959, 1207).pref).toBe("shade");
  });

  it("18:00 until sunset is quiet first (evening)", () => {
    expect(autoPreference(1110, 1207)).toEqual({ pref: "quiet", daypart: "evening", nightShade: false });
    expect(autoPreference(1080, 1207).pref).toBe("quiet");
    expect(autoPreference(1206, 1207).pref).toBe("quiet");
  });

  it("before 11:00 is balanced (morning)", () => {
    expect(autoPreference(540, 1207)).toEqual({ pref: "balanced", daypart: "morning", nightShade: false });
    expect(autoPreference(0, 1207).daypart).toBe("morning");
  });

  it("16:00–17:59 is balanced, still afternoon", () => {
    expect(autoPreference(960, 1207)).toEqual({ pref: "balanced", daypart: "afternoon", nightShade: false });
    expect(autoPreference(1079, 1207).pref).toBe("balanced");
  });

  it("after sunset is balanced with nightShade (caller zeroes wShade)", () => {
    expect(autoPreference(1260, 1207)).toEqual({ pref: "balanced", daypart: "evening", nightShade: true });
    expect(autoPreference(1207, 1207).nightShade).toBe(true);
  });

  it("a winter sunset before 18:00 skips the quiet window", () => {
    // sunset 16:30: 16:00–16:29 balanced/afternoon, 16:30+ balanced night
    expect(autoPreference(975, 990)).toEqual({ pref: "balanced", daypart: "afternoon", nightShade: false });
    expect(autoPreference(1110, 990)).toEqual({ pref: "balanced", daypart: "evening", nightShade: true });
  });
});

describe("sunsetMinutes", () => {
  it("Frankfurt, 2026-09-02: about 20:07", () => {
    const m = sunsetMinutes("2026-09-02", FRANKFURT);
    expect(Math.abs(m - 1207)).toBeLessThanOrEqual(3);
  });

  it("returns 1439 when the sun never sets", () => {
    const tromso = { lat: 69.65, lng: 18.96, timeZone: "Europe/Oslo" };
    expect(sunsetMinutes("2026-06-21", tromso)).toBe(1439);
  });
});

describe("sunriseMinutes", () => {
  it("Frankfurt, 2026-09-05: about 06:50", () => {
    // The almanac says 06:50; this geometric model with the same −0.833°
    // offset lands on 06:46. Sunset is the end that was matched against
    // astral (20:07 for 2026-09-02, three minutes' tolerance); sunrise is
    // allowed five, and nothing downstream can tell the difference — the
    // theme flips a palette, not a shadow.
    const m = sunriseMinutes("2026-09-05", FRANKFURT);
    expect(Math.abs(m - 410)).toBeLessThanOrEqual(5);
  });

  it("is the other end of the same day the sunset test measures", () => {
    // 2026-09-05 in Frankfurt: up at 06:50, down at 20:00 — a touch over
    // thirteen hours, and every minute between them is on the light side.
    const rise = sunriseMinutes("2026-09-05", FRANKFURT);
    const set = sunsetMinutes("2026-09-05", FRANKFURT);
    expect(Math.abs(set - 1200)).toBeLessThanOrEqual(3);
    expect(set - rise).toBeGreaterThan(13 * 60);
    expect(set - rise).toBeLessThan(13 * 60 + 30);
  });

  it("returns 0 when the sun is already up at midnight", () => {
    const tromso = { lat: 69.65, lng: 18.96, timeZone: "Europe/Oslo" };
    expect(sunriseMinutes("2026-06-21", tromso)).toBe(0);
  });

  it("returns 1439 when the sun does not rise at all", () => {
    const tromso = { lat: 69.65, lng: 18.96, timeZone: "Europe/Oslo" };
    expect(sunriseMinutes("2026-12-21", tromso)).toBe(1439);
  });
});

describe("presetFor", () => {
  it("shade → maxShade weights with the user's access", () => {
    const p = presetFor("shade", DEFAULT_SETTINGS);
    expect(p.wShade).toBe(3.5);
    expect(p.access).toBe("stroller");
    expect(p).toMatchObject(PRESETS.maxShade);
  });

  it("quiet and balanced map to their presets, carrying access", () => {
    expect(presetFor("quiet", DEFAULT_SETTINGS)).toEqual({ ...PRESETS.maxQuiet, access: "stroller" });
    expect(presetFor("balanced", { ...DEFAULT_SETTINGS, access: "wheelchair" })).toEqual({
      ...PRESETS.balanced,
      access: "wheelchair",
    });
  });

  it("FASTEST weighs nothing but surface", () => {
    expect(FASTEST).toEqual({ wShade: 0, wNoise: 0, wSurface: 2.0, wGreen: 0 });
  });
});

describe("autoWindow", () => {
  const SUNSET = 20 * 60 + 7; // Frankfurt, 2026-09-02

  it("names the shade window as 11–16 h", () => {
    expect(autoWindow("shade", SUNSET)).toEqual({ from: 11, to: 16 });
  });

  it("runs the quiet window from 18 h to the hour the sun sets", () => {
    expect(autoWindow("quiet", SUNSET)).toEqual({ from: 18, to: 20 });
    expect(autoWindow("quiet", 21 * 60 + 40)).toEqual({ from: 18, to: 21 });
  });

  it("gives balanced no window — it is the fallback, not an interval", () => {
    expect(autoWindow("balanced", SUNSET)).toBeNull();
  });
});

describe("presetFor after sunset", () => {
  it("drops the shade term at night and keeps everything else", () => {
    const day = presetFor("shade", DEFAULT_SETTINGS);
    const night = presetFor("shade", DEFAULT_SETTINGS, true);
    expect(day.wShade).toBeGreaterThan(0);
    expect(night.wShade).toBe(0);
    expect(night.wNoise).toBe(day.wNoise);
    expect(night.access).toBe(DEFAULT_SETTINGS.access);
  });
});
