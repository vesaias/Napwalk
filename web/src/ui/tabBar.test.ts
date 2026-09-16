import { describe, expect, it } from "vitest";
import { initialShell, type Place, type ShellState } from "./shellState";
import { tabBarVisible } from "./tabBar";

const PARK: Place = {
  name: "Günthersburgpark",
  kind: "park",
  district: "Nordend",
  lng: 8.7027,
  lat: 50.1291,
  inCity: true,
};
const DEST: [number, number] = [8.7027, 50.1291];

function boot(): ShellState {
  return initialShell(14 * 60, "shade");
}

/** A shell parked on one screen, without walking the reducer there. */
function on(patch: Partial<ShellState>): ShellState {
  return { ...boot(), ...patch };
}

describe("tabBarVisible", () => {
  it("shows the bar on Home at every snap a card can reach", () => {
    expect(tabBarVisible(boot(), null)).toBe(true);
    expect(tabBarVisible(boot(), "default")).toBe(true);
  });

  it("shows it under the place and pin cards, which open at default", () => {
    const place = on({ route: { k: "place", place: PARK } });
    const pin = on({ route: { k: "pin", at: DEST, address: null, shadePct: null } });
    expect(tabBarVisible(place, "default")).toBe(true);
    expect(tabBarVisible(pin, "default")).toBe(true);
  });

  it("takes it away when a card is dragged to the top of the phone", () => {
    expect(tabBarVisible(on({ route: { k: "place", place: PARK } }), "tall")).toBe(false);
  });

  it("hides it for the whole A→B flow, at any snap", () => {
    const routes = on({ route: { k: "routes", dest: DEST, destName: "", from: null } });
    expect(tabBarVisible(routes, "peek")).toBe(false);
    expect(tabBarVisible(routes, null)).toBe(false);
    const nav = on({ route: { k: "navigate", dest: DEST, destName: "", from: null } });
    expect(tabBarVisible(nav, "peek")).toBe(false);
    const arrived = on({ route: { k: "arrived", dest: DEST, destName: "", atMin: 900 } });
    expect(tabBarVisible(arrived, "peek")).toBe(false);
  });

  it("hides it on the search page", () => {
    const search = on({ route: { k: "search", q: "park", back: { k: "home" }, end: "to" } });
    expect(tabBarVisible(search, null)).toBe(false);
  });

  it("shows it on W0, the Wander root, which has no sheet to raise", () => {
    const idle = on({ tab: "wander" });
    expect(idle.wander.k).toBe("idle");
    expect(tabBarVisible(idle, null)).toBe(true);
    // W0 draws no sheet, so no snap of its own can take the bar away
    expect(tabBarVisible(idle, "peek")).toBe(true);
    expect(tabBarVisible(idle, "default")).toBe(true);
  });

  it("never shows it on W1, at any snap: the ✕ is always there instead", () => {
    const loops = on({ tab: "wander", wander: { k: "loops", origin: { kind: "gps" } } });
    expect(tabBarVisible(loops, "peek")).toBe(false);
    expect(tabBarVisible(loops, null)).toBe(false);
    expect(tabBarVisible(loops, "default")).toBe(false);
    expect(tabBarVisible(loops, "tall")).toBe(false);
  });

  it("hides it once a loop is being walked", () => {
    const walking = on({
      tab: "wander",
      wander: { k: "navigate", origin: { kind: "gps" } },
    } as Partial<ShellState>);
    expect(tabBarVisible(walking, "peek")).toBe(false);
  });

  it("keeps it on Settings, which has no sheet of its own", () => {
    expect(tabBarVisible(on({ tab: "settings" }), null)).toBe(true);
  });
});
