import { describe, expect, it } from "vitest";
import { GPS_ORIGIN, initialShell, type Place, type ShellState } from "./shellState";
import type { Layers } from "../plan/settings";
import {
  layersButtonUnder,
  layersButtonVisible,
  layersChipVisible,
  mapOverlays,
  scrubberVisible,
  shadeMinute,
} from "./layers";

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

describe("layersButtonVisible", () => {
  it("offers the layers on Home, where the map IS the screen", () => {
    expect(layersButtonVisible(boot())).toBe(true);
  });

  it("offers them on the place and pin cards, which are a map with a card", () => {
    expect(layersButtonVisible(on({ route: { k: "place", place: PARK } }))).toBe(true);
    expect(
      layersButtonVisible(on({ route: { k: "pin", at: DEST, address: null, shadePct: null } })),
    ).toBe(true);
  });

  it("offers them on W0, the Wander root, and on no other Wander screen", () => {
    expect(layersButtonVisible(on({ tab: "wander" }))).toBe(true);
    expect(layersButtonVisible(on({ tab: "wander", wander: { k: "loops", origin: GPS_ORIGIN } }))).toBe(
      false,
    );
    expect(
      layersButtonVisible(on({ tab: "wander", wander: { k: "navigate", origin: GPS_ORIGIN } })),
    ).toBe(false);
    expect(
      layersButtonVisible(on({ tab: "wander", wander: { k: "arrived", atMin: 900, origin: GPS_ORIGIN } })),
    ).toBe(false);
  });

  it("hides it wherever a header owns the top of the phone", () => {
    const routes = on({
      route: { k: "routes", origin: GPS_ORIGIN, dest: DEST, destName: "Park" },
    });
    expect(layersButtonVisible(routes)).toBe(false);
    expect(
      layersButtonVisible(on({ route: { k: "navigate", dest: DEST, destName: "Park" } })),
    ).toBe(false);
    expect(layersButtonVisible(on({ route: { k: "arrived", destName: "Park", atMin: 900 } }))).toBe(
      false,
    );
  });

  it("hides it on the search page, which covers the map, and in Settings", () => {
    expect(
      layersButtonVisible(on({ route: { k: "search", q: "park", end: "to", back: { k: "home" } } })),
    ).toBe(false);
    expect(layersButtonVisible(on({ tab: "settings" }))).toBe(false);
  });
});

describe("layersChipVisible (CR-03 Q2)", () => {
  const ROUTES = on({
    route: { k: "routes", origin: GPS_ORIGIN, dest: DEST, destName: "Park" },
  });
  const LOOPS = on({ tab: "wander", wander: { k: "loops", origin: GPS_ORIGIN } });

  it("puts the chip on the two screens with a walk and a chip row: R4 and W1", () => {
    expect(layersChipVisible(ROUTES)).toBe(true);
    expect(layersChipVisible(LOOPS)).toBe(true);
  });

  it("keeps it off the tab roots, the cards and the search page — they have the button", () => {
    expect(layersChipVisible(boot())).toBe(false);
    expect(layersChipVisible(on({ route: { k: "place", place: PARK } }))).toBe(false);
    expect(
      layersChipVisible(on({ route: { k: "pin", at: DEST, address: null, shadePct: null } })),
    ).toBe(false);
    expect(layersChipVisible(on({ tab: "wander" }))).toBe(false);
    expect(
      layersChipVisible(on({ route: { k: "search", q: "park", end: "to", back: { k: "home" } } })),
    ).toBe(false);
    expect(layersChipVisible(on({ tab: "settings" }))).toBe(false);
  });

  it("keeps it off a walk in progress and its arrival, which have no chip row", () => {
    expect(layersChipVisible(on({ route: { k: "navigate", dest: DEST, destName: "Park" } }))).toBe(
      false,
    );
    expect(layersChipVisible(on({ route: { k: "arrived", destName: "Park", atMin: 900 } }))).toBe(
      false,
    );
    expect(
      layersChipVisible(on({ tab: "wander", wander: { k: "navigate", origin: GPS_ORIGIN } })),
    ).toBe(false);
    expect(
      layersChipVisible(
        on({ tab: "wander", wander: { k: "arrived", atMin: 900, origin: GPS_ORIGIN } }),
      ),
    ).toBe(false);
  });

  it("is never both: exactly one of the two controls is offered on every screen", () => {
    const screens: ShellState[] = [
      boot(),
      on({ route: { k: "place", place: PARK } }),
      on({ route: { k: "pin", at: DEST, address: null, shadePct: null } }),
      on({ route: { k: "search", q: "p", end: "to", back: { k: "home" } } }),
      ROUTES,
      on({ route: { k: "navigate", dest: DEST, destName: "Park" } }),
      on({ route: { k: "arrived", destName: "Park", atMin: 900 } }),
      on({ tab: "wander" }),
      LOOPS,
      on({ tab: "wander", wander: { k: "navigate", origin: GPS_ORIGIN } }),
      on({ tab: "settings" }),
    ];
    for (const s of screens) {
      expect(layersButtonVisible(s) && layersChipVisible(s)).toBe(false);
    }
  });
});

describe("layersButtonUnder", () => {
  it("hangs under the search bar on the Route tab and under W0's pill on Wander", () => {
    expect(layersButtonUnder(boot())).toBe("search");
    expect(layersButtonUnder(on({ route: { k: "place", place: PARK } }))).toBe("search");
    expect(layersButtonUnder(on({ tab: "wander" }))).toBe("pill");
  });
});

describe("mapOverlays", () => {
  const OFF: Layers = { shade: false, noise: false };
  const ON: Layers = { shade: true, noise: false };
  const NOW = 15 * 60;

  it("shows shade because the reader asked, and only then", () => {
    expect(mapOverlays(boot(), ON, NOW).shadeOn).toBe(true);
    expect(mapOverlays(boot(), OFF, NOW).shadeOn).toBe(false);
  });

  // CR-03 A1 (backlog B6, Viktor's ruling): a drawn walk used to force the
  // overlay on whatever the switch said. The switch is now the whole rule,
  // on the routes screen as much as on Home.
  it("leaves a drawn walk out of it, both ways round", () => {
    const routes = on({ route: { k: "routes", origin: GPS_ORIGIN, dest: DEST, destName: "Park" } });
    expect(mapOverlays(routes, OFF, NOW).shadeOn).toBe(false);
    expect(mapOverlays(routes, ON, NOW).shadeOn).toBe(true);
    const loops = on({ tab: "wander", wander: { k: "loops", origin: GPS_ORIGIN } });
    expect(mapOverlays(loops, OFF, NOW).shadeOn).toBe(false);
    const walking = on({ route: { k: "navigate", dest: DEST, destName: "Park" } });
    expect(mapOverlays(walking, OFF, NOW).shadeOn).toBe(false);
  });

  it("gives noise no exception either — it is the setting, and only that", () => {
    expect(mapOverlays(boot(), OFF, NOW).noiseOn).toBe(false);
    expect(mapOverlays(boot(), { shade: false, noise: true }, NOW).noiseOn).toBe(true);
  });

  it("draws the sun at the departure, and at the wall clock while walking", () => {
    const s = boot();
    expect(mapOverlays(s, ON, NOW).shadeMin).toBe(s.startMin);
    const walking = on({ route: { k: "navigate", dest: DEST, destName: "Park" } });
    expect(mapOverlays(walking, ON, NOW).shadeMin).toBe(NOW);
  });
});

describe("shadeMinute", () => {
  const NOW = 15 * 60;

  it("is the departure with nothing scrubbing and nothing walking", () => {
    const s = boot();
    expect(shadeMinute(s, NOW)).toBe(s.startMin);
  });

  it("is the wall clock while a walk is being walked", () => {
    const s = on({ route: { k: "navigate", dest: DEST, destName: "Park" } });
    expect(shadeMinute(s, NOW)).toBe(NOW);
  });

  it("is the scrubbed minute the moment there is one, over both of those", () => {
    expect(shadeMinute(on({ scrub: 8 * 60 }), NOW)).toBe(480);
    const walking = on({ route: { k: "navigate", dest: DEST, destName: "Park" }, scrub: 480 });
    expect(shadeMinute(walking, NOW)).toBe(480);
  });

  it("...and 06:00 is a minute, not a missing one", () => {
    expect(shadeMinute(on({ scrub: 0 }), NOW)).toBe(0);
  });

  it("is the one answer mapOverlays gives the map", () => {
    const s = on({ scrub: 9 * 60 });
    expect(mapOverlays(s, { shade: true, noise: false }, NOW).shadeMin).toBe(540);
  });
});

describe("scrubberVisible", () => {
  const ON: Layers = { shade: true, noise: false };
  const OFF: Layers = { shade: false, noise: false };

  it("shows it on a bare map with shade on", () => {
    expect(scrubberVisible(boot(), ON, false)).toBe(true);
  });

  it("hides it when the reader has turned shade off — there is nothing to scrub", () => {
    expect(scrubberVisible(boot(), OFF, false)).toBe(false);
  });

  it("hides it the moment a walk is drawn, and while one is being computed", () => {
    expect(scrubberVisible(boot(), ON, true)).toBe(false);
    expect(scrubberVisible(on({ computing: true }), ON, false)).toBe(false);
  });

  it("hides under a modal, and stays under the layers popover the board draws beside it", () => {
    expect(scrubberVisible(on({ overlay: "leave" }), ON, false)).toBe(false);
    expect(scrubberVisible(on({ overlay: "city" }), ON, false)).toBe(false);
    expect(scrubberVisible(on({ overlay: "layers" }), ON, false)).toBe(true);
  });

  it("is a rule about state, so W0 and a place card get one too", () => {
    expect(scrubberVisible(on({ tab: "wander" }), ON, false)).toBe(true);
    expect(scrubberVisible(on({ route: { k: "place", place: PARK } }), ON, false)).toBe(true);
    expect(
      scrubberVisible(on({ route: { k: "pin", at: DEST, address: null, shadePct: null } }), ON, false),
    ).toBe(true);
  });

  // CR-02 slice C review, F2 (deviation 6). "Shade on and nothing drawn" is
  // true on more screens than the card belongs on: Settings has no map, and
  // `route.k === "routes"` is BOTH the results list and the "no route here"
  // card — on the second of those nothing is drawn, so a reader being told
  // their location is off used to get a sun toy under it.
  it("is only for the screens where the map IS the screen", () => {
    expect(scrubberVisible(on({ tab: "settings" }), ON, false)).toBe(false);
    // the routes screen with nothing drawn: the no-route card
    const noRoute = on({ route: { k: "routes", origin: GPS_ORIGIN, dest: DEST, destName: "Park" } });
    expect(scrubberVisible(noRoute, ON, false)).toBe(false);
    expect(scrubberVisible(on({ route: { k: "search", q: "", end: "to", back: { k: "home" } } }), ON, false)).toBe(
      false,
    );
    expect(scrubberVisible(on({ route: { k: "navigate", dest: DEST, destName: "Park" } }), ON, false)).toBe(
      false,
    );
    expect(
      scrubberVisible(on({ route: { k: "arrived", destName: "Park", atMin: 900 } }), ON, false),
    ).toBe(false);
    // ...and on the Wander tab it follows W0, exactly as the button does
    expect(
      scrubberVisible(on({ tab: "wander", wander: { k: "loops", origin: GPS_ORIGIN } }), ON, false),
    ).toBe(false);
  });

  it("says the same thing the layers button says, on every screen", () => {
    const screens: ShellState[] = [
      boot(),
      on({ route: { k: "place", place: PARK } }),
      on({ route: { k: "pin", at: DEST, address: null, shadePct: null } }),
      on({ route: { k: "search", q: "", end: "to", back: { k: "home" } } }),
      on({ route: { k: "routes", origin: GPS_ORIGIN, dest: DEST, destName: "Park" } }),
      on({ route: { k: "navigate", dest: DEST, destName: "Park" } }),
      on({ route: { k: "arrived", destName: "Park", atMin: 900 } }),
      on({ tab: "wander" }),
      on({ tab: "wander", wander: { k: "loops", origin: GPS_ORIGIN } }),
      on({ tab: "settings" }),
    ];
    for (const s of screens) {
      expect(scrubberVisible(s, ON, false), JSON.stringify(s.route.k)).toBe(layersButtonVisible(s));
    }
  });
});
