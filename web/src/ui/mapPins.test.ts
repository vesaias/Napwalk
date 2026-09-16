// The pin rule, which has been got wrong twice (mapPins.ts): the start is
// the reader's ONE "here", drawn on both tabs (CR-03 A8, backlog B3), and
// the destination belongs to the route tab alone. This file is what makes
// the extraction a seam rather than a line count (CR-02 slice A review, F3).
import { describe, expect, it } from "vitest";
import { mapPins } from "./mapPins";
import {
  GPS_ORIGIN,
  initialShell,
  type Origin,
  type Place,
  type ShellState,
} from "./shellState";

const AT: [number, number] = [8.7027, 50.1291];
const DEST: [number, number] = [8.6821, 50.1109];
const PIN: Origin = { kind: "point", at: AT, label: "Günthersburgpark" };
const PARK: Place = {
  name: "Günthersburgpark",
  kind: "park",
  district: "Nordend",
  lng: AT[0],
  lat: AT[1],
  inCity: true,
};

/** A shell parked on one screen, without walking the reducer there. */
function on(patch: Partial<ShellState>): ShellState {
  return { ...initialShell(14 * 60, "shade"), ...patch };
}

describe("mapPins — the route tab", () => {
  it("draws nothing on Home with a live fix", () => {
    expect(mapPins(on({}))).toEqual({ start: null, dest: null });
  });

  it("draws the pinned start, and only it, on Home", () => {
    expect(mapPins(on({ origin: PIN }))).toEqual({ start: AT, dest: null });
  });

  it("draws a place card's place as the destination", () => {
    expect(mapPins(on({ route: { k: "place", place: PARK } }))).toEqual({
      start: null,
      dest: AT,
    });
  });

  it("draws a dropped pin as the destination", () => {
    const s = on({ route: { k: "pin", at: AT, address: null, shadePct: null } });
    expect(mapPins(s)).toEqual({ start: null, dest: AT });
  });

  it("draws both ends on the routes screen", () => {
    const s = on({
      origin: PIN,
      route: { k: "routes", origin: PIN, dest: DEST, destName: "There" },
    });
    expect(mapPins(s)).toEqual({ start: AT, dest: DEST });
  });

  it("keeps the destination while navigating", () => {
    const s = on({ route: { k: "navigate", dest: DEST, destName: "There" } });
    expect(mapPins(s)).toEqual({ start: null, dest: DEST });
  });

  it("drops the destination on Arrived — the walk is over", () => {
    const s = on({ route: { k: "arrived", destName: "There", atMin: 900 } });
    expect(mapPins(s)).toEqual({ start: null, dest: null });
  });
});

describe("mapPins — the Wander tab", () => {
  it("draws no marker on W0 with a live fix: the GPS dot is not a pin", () => {
    expect(mapPins(on({ tab: "wander", wander: { k: "idle" } }))).toEqual({
      start: null,
      dest: null,
    });
  });

  // CR-03 A8: the pin is the reader's, not the tab's. A start dropped on
  // Route is standing on Wander's map too — that is the whole ruling
  // ("switch to wander — pin disappears. Same vice versa").
  it("draws the shared pin on W0, wherever it was dropped", () => {
    const s = on({ tab: "wander", origin: PIN, wander: { k: "idle" } });
    expect(mapPins(s)).toEqual({ start: AT, dest: null });
  });

  it("draws it on W1 too", () => {
    const s = on({ tab: "wander", origin: PIN, wander: { k: "loops" } });
    expect(mapPins(s)).toEqual({ start: AT, dest: null });
  });

  it("draws nothing on W1 planned from the fix", () => {
    const s = on({ tab: "wander", origin: GPS_ORIGIN, wander: { k: "loops" } });
    expect(mapPins(s)).toEqual({ start: null, dest: null });
  });

  it("never draws a destination: a loop comes back to where it left", () => {
    const walking = on({ tab: "wander", origin: PIN, wander: { k: "navigate" } });
    const arrived = on({ tab: "wander", origin: PIN, wander: { k: "arrived", atMin: 900 } });
    expect(mapPins(walking)).toEqual({ start: AT, dest: null });
    expect(mapPins(arrived)).toEqual({ start: AT, dest: null });
  });

  it("is the same answer on both tabs, which is the point", () => {
    const route = on({ origin: PIN });
    const wander = on({ tab: "wander", origin: PIN, wander: { k: "loops" } });
    expect(mapPins(wander).start).toEqual(mapPins(route).start);
  });
});

describe("mapPins — settings", () => {
  it("keeps the route tab's start under the settings tab, and no destination", () => {
    const s = on({ tab: "settings", origin: PIN, route: { k: "place", place: PARK } });
    expect(mapPins(s)).toEqual({ start: AT, dest: null });
  });
});
