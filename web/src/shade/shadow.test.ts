import { describe, expect, it } from "vitest";
import { shadowMask } from "./shadow";

function field(w: number, h: number, fill = 0) {
  return new Float32Array(w * h).fill(fill);
}

describe("shadowMask", () => {
  it("a 10 m wall casts a shadow of 10/tan(el) metres away from the sun", () => {
    const w = 100, h = 100, res = 1;
    const z = field(w, h);
    for (let r = 40; r <= 60; r++) z[r * w + 50] = 10; // wall along column 50
    // sun from the west (az 270) at 45°: shadow to the EAST, 10 m long
    const m = shadowMask(z, w, h, res, 270, 45);
    expect(m[50 * w + 55]).toBe(1);
    expect(m[50 * w + 59]).toBe(1);
    expect(m[50 * w + 62]).toBe(0);
    expect(m[50 * w + 45]).toBe(0); // sun side is lit
    // sun from the south (az 180) at 26.6°: shadow NORTH, ~20 m
    const m2 = shadowMask(z, w, h, res, 180, 26.57);
    expect(m2[30 * w + 50]).toBe(1);
    expect(m2[19 * w + 50]).toBe(0);
    expect(m2[70 * w + 50]).toBe(0);
  });
  it("diagonal sun (az 135) shades to the north-west", () => {
    const w = 60, h = 60;
    const z = field(w, h);
    z[30 * w + 30] = 20;
    const m = shadowMask(z, w, h, 1, 135, 30);
    expect(m[25 * w + 25]).toBe(1);
    expect(m[35 * w + 35]).toBe(0);
  });
  it("sun below horizon: everything shaded", () => {
    const m = shadowMask(field(4, 4), 4, 4, 1, 0, -3);
    expect(Array.from(m).every((v) => v === 1)).toBe(true);
  });
});

// border clip: atlas-space projection (2026-09-02)
import { tileXY } from "./ShadeLayer";
describe("tileXY", () => {
  it("maps Frankfurt's centre into the z14 tile the DSM pyramid uses", () => {
    const [x, y] = tileXY(8.6821, 50.1109, 14);
    expect(Math.floor(x)).toBe(8587);
    expect(Math.floor(y)).toBe(5548);
  });
  it("is monotone: east is +x, north is -y", () => {
    const a = tileXY(8.6, 50.1, 12), b = tileXY(8.7, 50.2, 12);
    expect(b[0]).toBeGreaterThan(a[0]);
    expect(b[1]).toBeLessThan(a[1]);
  });
});

// The atlas margin the CLOCK owns, and nothing else (perf, 2026-09-15). The
// scrubber's minute reaches ShadeLayer ten times a second; the only thing it
// can change about the atlas is which side carries the spare tile, and that
// moves three times between 06:00 and 21:00. `setTime` compares this key and
// schedules a rebuild only when it has really moved.
import { sunMargin } from "./ShadeLayer";
describe("sunMargin", () => {
  const key = (az: number) => {
    const m = sunMargin(az);
    return `${m.x0}${m.x1}${m.y0}${m.y1}`;
  };
  it("puts the spare tile on the side the sun is on", () => {
    // due east, low: the margin is east (+x) so shadows reach in westward
    expect(sunMargin(90).x1).toBe(1);
    expect(sunMargin(90).x0).toBe(0);
    // due west: the other side
    expect(sunMargin(270).x0).toBe(-1);
    expect(sunMargin(270).x1).toBe(0);
    // due south (northern-hemisphere noon): the margin is south (+y, row 0
    // is north), so shadows fall northward into the view
    expect(sunMargin(180).y1).toBe(1);
    expect(sunMargin(180).y0).toBe(0);
    // due north (a midsummer midnight sun, or the south hemisphere at noon)
    expect(sunMargin(0).y0).toBe(-1);
    expect(sunMargin(0).y1).toBe(0);
  });
  it("is one of four answers, and a Frankfurt day crosses three of them", () => {
    // every 15 minutes of azimuth from sunrise to sunset, as the scrubber
    // walks it: the key must change exactly three times (at due east, due
    // south and due west), not once per minute
    const seen: string[] = [];
    for (let az = 60; az <= 300; az += 0.5) {
      const k = key(az);
      if (seen[seen.length - 1] !== k) seen.push(k);
    }
    expect(seen).toEqual(["01-10", "0101", "-1001", "-10-10"]);
    expect(new Set(seen).size).toBe(4);
  });
  it("is stable across a whole quadrant, so a scrub inside one rebuilds nothing", () => {
    const k = key(120);
    for (let az = 91; az < 179; az += 1) expect(key(az)).toBe(k);
  });
});
