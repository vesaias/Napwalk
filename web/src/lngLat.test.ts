import { describe, expect, it } from "vitest";
import { isLngLat } from "./lngLat";

describe("isLngLat", () => {
  it("accepts a point MapLibre accepts", () => {
    expect(isLngLat([8.6821, 50.1109])).toBe(true);
    expect(isLngLat([-180, -90])).toBe(true);
    expect(isLngLat([180, 90])).toBe(true);
    expect(isLngLat([0, 0])).toBe(true);
  });

  it("rejects the out-of-range record that crashed the shell (F6-01)", () => {
    expect(isLngLat([999, -999])).toBe(false);
    expect(isLngLat([50.1109, 8.6821] as [number, number])).toBe(true); // a swap inside range is undetectable — by design
    expect(isLngLat([8.68, 91])).toBe(false);
    expect(isLngLat([181, 50])).toBe(false);
  });

  it("rejects non-finite and non-numeric coordinates", () => {
    expect(isLngLat([NaN, 50])).toBe(false);
    expect(isLngLat([8.68, Infinity])).toBe(false);
    expect(isLngLat(["8.68", 50])).toBe(false);
    expect(isLngLat([8.68])).toBe(false);
    expect(isLngLat([])).toBe(false);
    expect(isLngLat(null)).toBe(false);
    expect(isLngLat(undefined)).toBe(false);
    expect(isLngLat({ lng: 8.68, lat: 50 })).toBe(false);
  });
});
