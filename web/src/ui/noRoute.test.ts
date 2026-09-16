import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../plan/settings";
import type { BorderGeom } from "../shade/ShadeLayer";
import { hasOrigin, noRouteReason } from "./noRoute";
import { planJob } from "./usePlanner";
import { initialShell, reduce, type ShellState } from "./shellState";

const DEST: [number, number] = [8.7027, 50.1291];
const PIN: [number, number] = [8.6821, 50.1109];
const FIX: [number, number] = [8.678, 50.121];

/** The routes screen, reached the way the app reaches it. */
function onRoutes(): ShellState {
  return reduce(initialShell(14 * 60, "shade"), { type: "routeTo", dest: DEST, name: "Park" });
}

describe("hasOrigin", () => {
  it("is false while the walk starts at a location nobody knows", () => {
    expect(hasOrigin(onRoutes())).toBe(false);
  });

  it("is true once a fix arrives", () => {
    expect(hasOrigin(reduce(onRoutes(), { type: "gps", pos: FIX }))).toBe(true);
  });

  it("is true for a pinned origin with no fix at all", () => {
    const s = reduce(onRoutes(), { type: "origin", origin: { kind: "point", at: PIN, label: null } });
    expect(s.gps).toBeNull();
    expect(hasOrigin(s)).toBe(true);
  });

  it("reads the ROUTES screen's own origin, not the shell's", () => {
    // the shell's origin moves on; the screen keeps the one it was built with
    let s = reduce(onRoutes(), { type: "origin", origin: { kind: "point", at: PIN, label: null } });
    s = { ...s, origin: { kind: "gps" } };
    expect(hasOrigin(s)).toBe(true);
  });
});

describe("noRouteReason", () => {
  it("blames the missing start point, not the cobbles", () => {
    expect(noRouteReason(onRoutes(), DEFAULT_SETTINGS)).toEqual({ k: "noOrigin" });
  });

  it("offers only the settings that could change the answer", () => {
    const s = reduce(onRoutes(), { type: "gps", pos: FIX });
    // the defaults already allow cobbles: offering to allow them is a lie
    expect(noRouteReason(s, DEFAULT_SETTINGS)).toEqual({
      k: "noRoute",
      access: "stroller",
      canAllowCobbles: false,
      canWalkMode: true,
    });
    expect(noRouteReason(s, { ...DEFAULT_SETTINGS, avoidCobbles: true })).toMatchObject({
      canAllowCobbles: true,
    });
    expect(noRouteReason(s, { ...DEFAULT_SETTINGS, access: "walk" })).toMatchObject({
      canWalkMode: false,
    });
  });

  // review B-4: the card names the mode it refused, so the E3 title cannot
  // say "stroller" under a Wheelchair chip.
  it("names the access the walk was actually refused for", () => {
    const s = reduce(onRoutes(), { type: "gps", pos: FIX });
    expect(noRouteReason(s, { ...DEFAULT_SETTINGS, access: "wheelchair" })).toMatchObject({
      access: "wheelchair",
    });
    // ...including the routes header's one-off chip, over the settings
    const chair = reduce(s, { type: "trip", access: "wheelchair" });
    expect(noRouteReason(chair, DEFAULT_SETTINGS)).toMatchObject({ access: "wheelchair" });
    // and the trip override that "Walk mode" itself writes
    const walking = reduce(s, { type: "trip", access: "walk" });
    expect(noRouteReason(walking, DEFAULT_SETTINGS)).toMatchObject({
      access: "walk",
      canWalkMode: false,
    });
  });

  it("has no offers left for a walker who already allows everything", () => {
    const s = reduce(onRoutes(), { type: "gps", pos: FIX });
    expect(noRouteReason(s, { ...DEFAULT_SETTINGS, access: "walk" })).toEqual({
      k: "noRoute",
      access: "walk",
      canAllowCobbles: false,
      canWalkMode: false,
    });
  });

  it("blames the city before anything else when its graph never loaded", () => {
    const s = reduce(reduce(onRoutes(), { type: "gps", pos: FIX }), {
      type: "graph",
      failed: true,
    });
    // a fix, a destination and a loose setting — and still nothing to plan
    expect(noRouteReason(s, DEFAULT_SETTINGS)).toEqual({
      k: "cityFailed",
      city: DEFAULT_SETTINGS.city,
    });
  });
});

describe("outside the city's data", () => {
  // a 1 km square around FIX; DEST is north-east of it
  const SQUARE: BorderGeom = {
    type: "Polygon",
    coordinates: [[[8.67, 50.115], [8.69, 50.115], [8.69, 50.13], [8.67, 50.13], [8.67, 50.115]]],
  };
  const INSIDE: [number, number] = [8.68, 50.12];

  it("names the destination when it lies outside", () => {
    const s = reduce(onRoutes(), { type: "gps", pos: FIX });
    expect(noRouteReason(s, DEFAULT_SETTINGS, SQUARE)).toEqual({ k: "outside", end: "dest", city: DEFAULT_SETTINGS.city });
  });

  it("names the origin when the fix lies outside", () => {
    const far: [number, number] = [11.57, 48.14]; // Munich
    let s = reduce(initialShell(14 * 60, "shade"), { type: "routeTo", dest: INSIDE, name: "x" });
    s = reduce(s, { type: "gps", pos: far });
    expect(noRouteReason(s, DEFAULT_SETTINGS, SQUARE).k).toBe("outside");
    expect(planJob(s, SQUARE)).toBeNull();
    // and without the border known, the point passes (it is still loading)
    expect(planJob(s, null)).not.toBeNull();
  });

  it("is a normal dead end with both ends inside", () => {
    let s = reduce(initialShell(14 * 60, "shade"), { type: "routeTo", dest: INSIDE, name: "x" });
    s = reduce(s, { type: "gps", pos: [8.675, 50.125] });
    expect(noRouteReason(s, DEFAULT_SETTINGS, SQUARE).k).toBe("noRoute");
    expect(planJob(s, SQUARE)).not.toBeNull();
  });

  it("applies to Wander's start too", () => {
    let s = reduce(initialShell(14 * 60, "shade"), { type: "tab", tab: "wander" });
    // W1: the Wander tab's root has no start of its own to be outside with
    s = reduce(s, { type: "origin", origin: { kind: "gps" }, scope: "wander" });
    s = reduce(s, { type: "gps", pos: [11.57, 48.14] });
    expect(noRouteReason(s, DEFAULT_SETTINGS, SQUARE).k).toBe("outside");
    expect(planJob(s, SQUARE)).toBeNull();
  });
});
