import { describe, expect, it } from "vitest";
import { getCity } from "../cities";
import { FIRST_FIX_ZOOM, focusFirstFix, type FirstFixInput } from "./firstFix";

const FRANKFURT = getCity("frankfurt");
/** In the Nordend street grid, 1.2 km north-east of the centre. */
const FIX: [number, number] = [8.678, 50.121];
/** Mannheim-ish: a real fix, and nowhere near Frankfurt's data. */
const AWAY: [number, number] = [8.2, 49.9];

/** A boot that qualifies: a fix inside the city, nothing else going on. */
function boot(over: Partial<FirstFixInput> = {}): FirstFixInput {
  return {
    fix: FIX,
    city: FRANKFURT,
    trip: false,
    panned: false,
    resumed: false,
    done: false,
    guessing: false,
    ...over,
  };
}

describe("focusFirstFix", () => {
  it("takes the camera to the first fix of a granted boot", () => {
    expect(focusFirstFix(boot())).toBe(true);
  });

  it("says nothing while there is no fix — a refusal never moves the map", () => {
    expect(focusFirstFix(boot({ fix: null }))).toBe(false);
  });

  it("leaves the map alone for a fix outside the city's box", () => {
    expect(focusFirstFix(boot({ fix: AWAY }))).toBe(false);
  });

  it("is a one-shot: the second fix of a page load keeps the camera", () => {
    expect(focusFirstFix(boot({ done: true }))).toBe(false);
  });

  it("stands down for a trip on the map", () => {
    expect(focusFirstFix(boot({ trip: true }))).toBe(false);
  });

  it("stands down for a restored camera — resume wins", () => {
    expect(focusFirstFix(boot({ resumed: true }))).toBe(false);
  });

  it("stands down once the reader has panned", () => {
    expect(focusFirstFix(boot({ panned: true }))).toBe(false);
  });

  it("stands down while the boot city is still the edge's to answer", () => {
    // B1: the zone named no city, so the shell opened on the default and
    // asked the edge. A fix inside THAT city's box is not a reason to take
    // a camera the answer is about to move (2026-09-16).
    expect(focusFirstFix(boot({ guessing: true }))).toBe(false);
    // ...and the moment the answer lands, the ordinary rule decides again
    expect(focusFirstFix(boot({ guessing: false }))).toBe(true);
  });

  it("frames the dot between the city's zoom and the walk's", () => {
    expect(FIRST_FIX_ZOOM).toBeGreaterThan(13);
    expect(FIRST_FIX_ZOOM).toBeLessThan(17);
  });
});
