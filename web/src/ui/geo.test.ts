import { describe, expect, it } from "vitest";
import { ARRIVED_M, distanceM, pointKey } from "./geo";

const HAUPTWACHE: [number, number] = [8.6785, 50.1136];

describe("distanceM", () => {
  it("is zero for the same point", () => {
    expect(distanceM(HAUPTWACHE, HAUPTWACHE)).toBe(0);
  });

  it("measures a degree of latitude as ~111.2 km", () => {
    const d = distanceM([8.6785, 50], [8.6785, 51]);
    expect(d).toBeGreaterThan(111_100);
    expect(d).toBeLessThan(111_300);
  });

  it("shrinks a degree of longitude by cos(latitude)", () => {
    // 1° of longitude at 50°N is 111.32 km × cos 50° ≈ 71.5 km
    const d = distanceM([8, 50], [9, 50]);
    expect(d).toBeGreaterThan(71_000);
    expect(d).toBeLessThan(72_000);
  });

  it("is symmetric", () => {
    const a: [number, number] = [8.6785, 50.1136];
    const b: [number, number] = [8.7027, 50.1291];
    expect(distanceM(a, b)).toBeCloseTo(distanceM(b, a), 9);
  });

  it("measures Hauptwache → Günthersburgpark as ~2.4 km", () => {
    const d = distanceM(HAUPTWACHE, [8.7027, 50.1291]);
    expect(d).toBeGreaterThan(2_300);
    expect(d).toBeLessThan(2_500);
  });

  it("reads a 30 m step as under the arrival radius", () => {
    // ~27 m north of Hauptwache
    expect(distanceM(HAUPTWACHE, [8.6785, 50.11384])).toBeLessThan(ARRIVED_M);
    // ~110 m north is well outside it
    expect(distanceM(HAUPTWACHE, [8.6785, 50.1146])).toBeGreaterThan(ARRIVED_M);
  });
});

describe("distanceM at the edges of the graticule", () => {
  // Not a case any of the eight cities can reach, but the haversine is the
  // one distance the whole shell shares: a NaN here would silently make
  // every "how far away" and the 30 m arrival test read as false.
  it("crosses the antimeridian without a discontinuity", () => {
    // 0.00018° of longitude at the equator is ~20 m, whichever side of ±180
    const d = distanceM([179.99991, 0], [-179.99991, 0]);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(19);
    expect(d).toBeLessThan(21);
  });

  it("reads +180 and −180 as the same meridian", () => {
    expect(distanceM([180, 0], [-180, 0])).toBeLessThan(1e-6);
  });

  it("never returns NaN for antipodes, where asin(√h) sits on its limit", () => {
    const halfway = Math.PI * 6_371_000;
    for (const [a, b] of [
      [[0, 0], [180, 0]],
      [[0, 90], [0, -90]],
      [[8.6821, 50.1109], [-171.3179, -50.1109]],
    ] as [[number, number], [number, number]][]) {
      const d = distanceM(a, b);
      expect(Number.isNaN(d), `${a} → ${b}`).toBe(false);
      expect(d).toBeCloseTo(halfway, -3);
    }
  });

  it("reads two points on the same pole as touching", () => {
    expect(distanceM([0, 90], [180, 90])).toBeLessThan(1e-6);
  });
});

describe("pointKey", () => {
  it("is lng,lat at four decimals — the ~11 m cell the caches key on", () => {
    expect(pointKey([8.68215, 50.11092])).toBe("8.6822,50.1109");
  });

  it("gives a fix wobbling on the spot one key, not a new one per reading", () => {
    // three readings inside the same 11 m cell
    expect(pointKey([8.68211, 50.11089])).toBe("8.6821,50.1109");
    expect(pointKey([8.682139, 50.110851])).toBe("8.6821,50.1109");
    expect(pointKey([8.6821, 50.1109])).toBe("8.6821,50.1109");
  });

  it("separates points a cell apart, so a pin that moved gets looked up again", () => {
    expect(pointKey([8.6821, 50.1109])).not.toBe(pointKey([8.6823, 50.1109]));
    expect(pointKey([8.6821, 50.1109])).not.toBe(pointKey([8.6821, 50.1111]));
  });

  it("keeps the sign of a western longitude (New York, San Francisco)", () => {
    expect(pointKey([-73.985715, 40.74844])).toBe("-73.9857,40.7484");
    expect(pointKey([-122.4194, 37.7749])).toBe("-122.4194,37.7749");
  });

  it("pads to four decimals, so every key is the same shape", () => {
    expect(pointKey([8.5, 50])).toBe("8.5000,50.0000");
  });
});
