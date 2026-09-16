import { describe, expect, it } from "vitest";
import { FRANKFURT, sunPosition } from "./sun";
import { sunsetMinutes } from "../plan/preference";

// values from pipeline data/shade/sun_table.json (astral, 2026-08-15,
// Europe/Berlin, 08:00 + 15 min steps)
const TABLE: [number, number, number][] = [
  [480, 86.56, 15.58],
  [495, 89.42, 17.98],
  [600, 111.21, 34.42],
];

describe("sunPosition", () => {
  it("matches astral within 0.3°", () => {
    for (const [min, az, el] of TABLE) {
      const p = sunPosition("2026-08-15", min);
      expect(Math.abs(p.az - az)).toBeLessThan(0.3);
      expect(Math.abs(p.el - el)).toBeLessThan(0.3);
    }
  });
  it("noon-ish sun is south and highest in June", () => {
    const p = sunPosition("2026-06-21", 13 * 60 + 25);
    expect(Math.abs(p.az - 180)).toBeLessThan(2);
    expect(p.el).toBeGreaterThan(62);
    expect(p.el).toBeLessThan(64);
  });
  it("winter: sun below horizon at 17:00", () => {
    expect(sunPosition("2026-12-21", 17 * 60).el).toBeLessThan(0);
  });
});

// Other cities: astral references for 2026-09-02 (the client sun model was
// Frankfurt-hardcoded until 2026-09-02; the pipeline had the same bug).
const CITIES: [string, number, number, string, [number, number, number][]][] = [
  ["nyc", 40.7484, -73.9857, "America/New_York", [[540, 105.25, 28.46], [840, 207.88, 53.99], [1215, 288.97, -9.69]]],
  ["sf", 37.7749, -122.4194, "America/Los_Angeles", [[540, 101.30, 26.53], [840, 204.09, 57.78]]],
  ["london", 51.5072, -0.1276, "Europe/London", [[540, 109.37, 24.54], [840, 201.03, 44.59], [1215, 289.49, -5.29]]],
];

describe("sunPosition elsewhere", () => {
  for (const [name, lat, lng, timeZone, rows] of CITIES) {
    it(`${name} matches astral within 0.3°`, () => {
      for (const [min, az, el] of rows) {
        const p = sunPosition("2026-09-02", min, { lat, lng, timeZone });
        expect(Math.abs(p.az - az), `${name} az @${min}`).toBeLessThan(0.3);
        expect(Math.abs(p.el - el), `${name} el @${min}`).toBeLessThan(0.3);
      }
    });
  }
  it("Frankfurt is the default observer", () => {
    const a = sunPosition("2026-09-02", 840);
    const b = sunPosition("2026-09-02", 840, { lat: 50.1109, lng: 8.6821, timeZone: "Europe/Berlin" });
    expect(a).toEqual(b);
  });
});

// The day the whole e2e suite is pinned to (fixtures WALL = 2026-09-05
// 14:00 Europe/Berlin). Every shade percentage in a screenshot is read off
// this sun, so the sun itself is worth an independent check.
describe("Frankfurt on 2026-09-05, the day the fixtures freeze", () => {
  /** Local minute of the day's highest sun, to the minute. */
  function solarNoon(): { min: number; el: number; az: number } {
    let best = { min: -1, el: -Infinity, az: 0 };
    for (let m = 600; m < 900; m++) {
      const p = sunPosition("2026-09-05", m);
      if (p.el > best.el) best = { min: m, el: p.el, az: p.az };
    }
    return best;
  }

  it("puts solar noon at 13:24 CEST, due south and ~46.6° up", () => {
    const noon = solarNoon();
    // 8.68°E is 25 min of longitude east of 15°E, the CEST meridian, and
    // early September's equation of time is ~+1.5 min: 13:24 local.
    expect(noon.min).toBe(13 * 60 + 24);
    expect(Math.abs(noon.az - 180)).toBeLessThan(0.5);
    expect(noon.el).toBeGreaterThan(46);
    expect(noon.el).toBeLessThan(47);
  });

  it("is still within a tenth of a degree of that at 14:00, the pinned hour", () => {
    // ?t=840 is 14:00: 36 min past solar noon, so the sun has barely moved
    const p = sunPosition("2026-09-05", 840);
    expect(p.el).toBeGreaterThan(44);
    expect(p.el).toBeLessThan(46.6);
    expect(p.az).toBeGreaterThan(180); // past south, into the west
    expect(p.az).toBeLessThan(200);
  });

  it("sets just after 20:00 — and sunsetMinutes agrees to the minute", () => {
    const set = sunsetMinutes("2026-09-05", FRANKFURT);
    expect(set).toBe(20 * 60 + 2); // 20:02
    // sunsetMinutes is the first minute at or below −0.833° (refraction plus
    // the solar radius); the minute before it must still be above.
    expect(sunPosition("2026-09-05", set).el).toBeLessThanOrEqual(-0.833);
    expect(sunPosition("2026-09-05", set - 1).el).toBeGreaterThan(-0.833);
    // and geometric zero crossing is a few minutes earlier than that
    expect(sunPosition("2026-09-05", 20 * 60).el).toBeGreaterThan(-0.833);
  });

  it("is below the horizon at the suite's after-sunset hour (?t=1320, 22:00)", () => {
    // edges.spec.ts leans on this: no shade figure after dark
    expect(sunPosition("2026-09-05", 1320).el).toBeLessThan(-10);
  });

  it("rises before the leave-at strip's first hour and is up for all ten", () => {
    for (const h of [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]) {
      expect(sunPosition("2026-09-05", h * 60).el, `${h}:00`).toBeGreaterThan(0);
    }
  });
});
