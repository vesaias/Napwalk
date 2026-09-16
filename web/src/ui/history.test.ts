// The pure half of browser back (ui/history.ts): which transitions push an
// entry, what a `popstate` maps to, and what the pushed URL says. No DOM —
// the hook that touches window.history is ui/useHistory.ts, and everything
// it decides is decided here.
import { describe, expect, it } from "vitest";
import {
  entryFor,
  entryStamp,
  historyPlan,
  historyUrl,
  tripOf,
  isEntry,
  popFor,
  pushes,
  originOn,
  routeOf,
  screenKey,
  tabOf,
  wanderOf,
  type HistoryEntry,
  type Written,
} from "./history";
import { DEFAULT_SETTINGS } from "../plan/settings";
import { GPS_ORIGIN, initialShell, NO_TRIP, reduce, type ShellState } from "./shellState";
import type { Place } from "../plan/geocode";
import { decodeState } from "../urlState";
import { shareUrl } from "./share";

const HOME = initialShell(600, "shade");
const PARK: Place = {
  name: "Günthersburgpark",
  kind: "park",
  district: "Nordend",
  lng: 8.7,
  lat: 50.13,
  inCity: true,
};
const DEST: [number, number] = [8.68, 50.12];

/** The state after a run of actions from Home. */
function after(...actions: Parameters<typeof reduce>[1][]): ShellState {
  return actions.reduce(reduce, HOME);
}

describe("screenKey", () => {
  it("names the tab and the screen inside it", () => {
    expect(screenKey(HOME)).toBe("route:home");
    // the Wander tab's root is W0 since CR-02 slice A; W1 is a screen of
    // its own and pushes an entry over it
    expect(screenKey(after({ type: "tab", tab: "wander" }))).toBe("wander:idle");
    expect(
      screenKey(
        after({ type: "tab", tab: "wander" }, { type: "origin", origin: GPS_ORIGIN, scope: "wander" })
      )
    ).toBe("wander:loops");
    expect(screenKey(after({ type: "tab", tab: "settings" }))).toBe("settings");
  });

  it("is the same for two queries on the same search page", () => {
    const a = after({ type: "search", q: "gün", end: "to" });
    const b = reduce(a, { type: "search", q: "günt" });
    expect(screenKey(a)).toBe(screenKey(b));
    expect(pushes(a, b)).toBe(false);
  });

  it("separates the From field from the To field", () => {
    const to = after({ type: "search", q: "", end: "to" });
    const from = after({ type: "search", q: "", end: "from" });
    expect(screenKey(to)).not.toBe(screenKey(from));
  });

  it("distinguishes one place card from the next", () => {
    const a = after({ type: "pickPlace", place: PARK });
    const b = reduce(a, { type: "pickPlace", place: { ...PARK, name: "Ostpark", lng: 8.72 } });
    expect(pushes(a, b)).toBe(true);
  });

  it("distinguishes one destination from the next", () => {
    const a = after({ type: "routeTo", dest: DEST, name: "A" });
    const b = reduce(a, { type: "routeTo", dest: [8.71, 50.14], name: "B" });
    expect(pushes(a, b)).toBe(true);
  });
});

describe("pushes", () => {
  it("pushes on every screen change the flow makes", () => {
    const search = after({ type: "search", q: "gün", end: "to" });
    const place = reduce(search, { type: "pickPlace", place: PARK });
    const routes = reduce(place, { type: "routeTo", dest: DEST, name: "Park" });
    const navigate = reduce(routes, { type: "start" });
    const arrived = reduce(navigate, { type: "arrived", atMin: 630 });
    expect(pushes(HOME, search)).toBe(true);
    expect(pushes(search, place)).toBe(true);
    expect(pushes(place, routes)).toBe(true);
    expect(pushes(routes, navigate)).toBe(true);
    expect(pushes(navigate, arrived)).toBe(true);
  });

  it("pushes on a tab switch and on the wander screens", () => {
    const wander = after({ type: "tab", tab: "wander" });
    expect(pushes(HOME, wander)).toBe(true);
    // W0 → W1 is a screen change too, which is what browser back walks
    const loops = reduce(wander, { type: "origin", origin: GPS_ORIGIN, scope: "wander" });
    expect(pushes(wander, loops)).toBe(true);
    expect(pushes(loops, reduce(loops, { type: "start" }))).toBe(true);
    expect(pushes(HOME, after({ type: "tab", tab: "settings" }))).toBe(true);
  });

  it("does NOT push when a sheet opens or closes", () => {
    const open = after({ type: "overlay", overlay: "pref" });
    expect(pushes(HOME, open)).toBe(false);
    expect(pushes(open, reduce(open, { type: "overlay", overlay: null }))).toBe(false);
  });

  it("does NOT push when only the plan, the clock or the fix moved", () => {
    expect(pushes(HOME, reduce(HOME, { type: "computing", on: true }))).toBe(false);
    expect(pushes(HOME, reduce(HOME, { type: "leave", startMin: 605, now: true }))).toBe(false);
    expect(pushes(HOME, reduce(HOME, { type: "gps", pos: DEST }))).toBe(false);
    expect(pushes(HOME, reduce(HOME, { type: "select", i: 1 }))).toBe(false);
  });
});

describe("popFor", () => {
  const entry = entryFor(HOME);

  it("closes an open sheet first, and leaves the screen alone", () => {
    const open = after({ type: "overlay", overlay: "leave" });
    expect(popFor(open, entry)).toEqual({ do: "closeOverlay" });
  });

  it("refuses to leave a walk in progress", () => {
    const nav = after(
      { type: "routeTo", dest: DEST, name: "Park" },
      { type: "start" }
    );
    expect(popFor(nav, entry)).toEqual({ do: "stay" });
  });

  it("restores the screen an entry names", () => {
    expect(popFor(after({ type: "tab", tab: "settings" }), entry)).toEqual({
      do: "restore",
      entry,
    });
  });

  it("lets the browser have an entry that is not ours", () => {
    expect(popFor(HOME, null).do).toBe("leave");
    expect(popFor(HOME, { some: "other script" }).do).toBe("leave");
    expect(isEntry(entry)).toBe(true);
    expect(isEntry({})).toBe(false);
  });

  // SPEC §3b: back walks the sheet's ladder before it walks the screens.
  it("puts a sheet down to peek before it leaves the screen", () => {
    const routes = after({ type: "routeTo", dest: DEST, name: "Park" });
    expect(popFor(routes, entry, "default", true)).toEqual({ do: "snapPeek" });
    expect(popFor(routes, entry, "tall", true)).toEqual({ do: "snapPeek" });
    expect(popFor(routes, entry, "peek", true)).toEqual({ do: "restore", entry });
    // a screen with no sheet — Home, search, every web frame — has no rung
    expect(popFor(routes, entry, null, false)).toEqual({ do: "restore", entry });
  });

  // CR-01 review F1: the place and pin cards, no-route and the arrival open
  // at `default` and have nothing under it. Back must leave them WHOLE and
  // go to the screen underneath — stepping them to a peek height they were
  // never drawn for clipped their tag row and cost a second back.
  it("leaves a sheet with no peek rung alone, at every snap it can reach", () => {
    const place = after({ type: "longPress", at: DEST });
    expect(popFor(place, entry, "default", false)).toEqual({ do: "restore", entry });
    expect(popFor(place, entry, "tall", false)).toEqual({ do: "restore", entry });
    expect(popFor(place, entry, "peek", false)).toEqual({ do: "restore", entry });
  });

  // B13: the no-route card is the whole screen, and on a share link the
  // entry under it is the seed — a COPY of that same screen — so a restore
  // left the reader exactly where they were. Back there means what the ✕
  // means: the place card the walk came from, or Home.
  it("dismisses the no-route card instead of restoring a copy of it", () => {
    const planning = after({ type: "routeTo", dest: DEST, name: "Park" });
    // still computing: the card is not up yet, and back is the ordinary one
    expect(popFor(planning, entry, null, false)).toEqual({ do: "restore", entry });
    const empty = reduce(planning, { type: "computing", on: false });
    expect(popFor(empty, entry, null, false)).toEqual({ do: "dismiss" });
    // …and the overlay and the walk still come first
    expect(popFor(reduce(empty, { type: "overlay", overlay: "leave" }), entry).do).toBe(
      "closeOverlay",
    );
  });

  it("still closes an overlay, and still refuses a walk, over an open sheet", () => {
    const open = after({ type: "overlay", overlay: "leave" });
    expect(popFor(open, entry, "default", true)).toEqual({ do: "closeOverlay" });
    const nav = after({ type: "routeTo", dest: DEST, name: "Park" }, { type: "start" });
    expect(popFor(nav, entry, "default", true)).toEqual({ do: "stay" });
  });
});

describe("the reducer's restore", () => {
  it("puts the screen the entry names back on", () => {
    const settings = after({ type: "tab", tab: "settings" });
    const back = reduce(settings, { type: "restore", ...entryFor(HOME) });
    expect(back.tab).toBe("route");
    expect(back.route.k).toBe("home");
  });

  it("never restores INTO a walk: a navigate entry lands on Routes", () => {
    const nav = after({ type: "routeTo", dest: DEST, name: "Park" }, { type: "start" });
    const arrived = reduce(nav, { type: "arrived", atMin: 630 });
    const back = reduce(arrived, { type: "restore", ...entryFor(nav) });
    expect(back.route.k).toBe("routes");
  });

  it("is refused while the walk is being walked", () => {
    const nav = after({ type: "routeTo", dest: DEST, name: "Park" }, { type: "start" });
    expect(reduce(nav, { type: "restore", ...entryFor(HOME) })).toBe(nav);
  });

  it("closes whatever sheet was open", () => {
    const open = after({ type: "tab", tab: "settings" }, { type: "overlay", overlay: "city" });
    expect(reduce(open, { type: "restore", ...entryFor(HOME) }).overlay).toBeNull();
  });
});

describe("historyUrl", () => {
  const base = "https://example.test/";

  it("does not pin the clock while the walk leaves now", () => {
    expect(historyUrl(base, HOME, DEFAULT_SETTINGS, DEFAULT_SETTINGS)).not.toContain("t=");
  });

  it("pins it once the reader picked a departure time", () => {
    const at = reduce(HOME, { type: "leave", startMin: 1020, now: false });
    expect(historyUrl(base, at, DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toContain("t=1020");
  });

  it("names the Settings tab, which `m` cannot", () => {
    const set = after({ type: "tab", tab: "settings" });
    expect(historyUrl(base, set, DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toContain("sc=settings");
    expect(historyUrl(base, HOME, DEFAULT_SETTINGS, DEFAULT_SETTINGS)).not.toContain("sc=");
  });

  it("carries the destination, so a refresh on Routes keeps the plan", () => {
    const routes = after({ type: "routeTo", dest: DEST, name: "Park" });
    const url = historyUrl(base, routes, DEFAULT_SETTINGS, DEFAULT_SETTINGS);
    expect(url).toContain("e=8.68000%2C50.12000");
    // and it round-trips: the same encoder the share link uses
    expect(decodeState(url.split("?")[1]).dest).toEqual(DEST);
  });

  // --- the ruling of 2026-09-06: the fix never reaches the address bar ----
  it("never writes the live GPS fix, however the shell learned it", () => {
    const located = after({ type: "gps", pos: [8.6821, 50.1109] });
    expect(historyUrl(base, located, DEFAULT_SETTINGS, DEFAULT_SETTINGS)).not.toContain("s=");
    // ...not on Routes either, where the walk is planned from it
    const walking = reduce(located, { type: "routeTo", dest: DEST, name: "Park" });
    expect(historyUrl(base, walking, DEFAULT_SETTINGS, DEFAULT_SETTINGS)).not.toContain("s=");
    // ...nor on Wander, whose origin is its own
    const loops = reduce(located, { type: "tab", tab: "wander" });
    expect(historyUrl(base, loops, DEFAULT_SETTINGS, DEFAULT_SETTINGS)).not.toContain("s=");
    // and the share link, which the reader chose to hand over, still does
    expect(shareUrl(base, walking, DEFAULT_SETTINGS, [8.6821, 50.1109])).toContain("s=");
  });

  it("writes a PINNED start, which a refresh cannot get back on its own", () => {
    const pinned = after({
      type: "gps",
      pos: [8.6821, 50.1109],
    });
    const dropped = reduce(pinned, {
      type: "origin",
      origin: { kind: "point", at: [8.7, 50.13], label: null },
    });
    expect(historyUrl(base, dropped, DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toContain("s=8.70000%2C50.13000");
  });

  it("writes Wander's own pinned start, not the route tab's", () => {
    const wander = after(
      { type: "tab", tab: "wander" },
      { type: "origin", origin: { kind: "point", at: [8.75, 50.14], label: null }, scope: "wander" }
    );
    expect(historyUrl(base, wander, DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toContain("s=8.75000%2C50.14000");
  });
});

// The hook (ui/useHistory.ts) decides nothing: it asks `historyPlan` what to
// do to window.history and `popFor` what a popstate means. Both are here, so
// the riskiest logic in the slice is covered without a DOM — including the
// two cases a browser is needed to SEE but not to decide: a sheet closing on
// back, and the one-shot that stops a pop turning into a push.
describe("historyPlan", () => {
  const home: Written = { key: "route:home", url: "/?m=ab", entry: "{}" };

  it("seeds a base entry on the first write: the browser's, then a copy", () => {
    // the copy is the rung back-from-a-sheet spends. Without it a link that
    // boots straight onto Routes owns ONE entry, and the first back leaves
    // the app with the sheet still open — the reverse of handover §3.2.
    expect(historyPlan(null, home)).toEqual({ op: "seed", url: home.url });
  });

  it("pushes when the screen changed", () => {
    const routes = { key: "route:routes:8.68,50.12", url: "/?m=ab&e=8.68,50.12", entry: "{r}" };
    expect(historyPlan(home, routes)).toEqual({ op: "push", url: routes.url });
  });

  it("replaces when only the URL changed — a preference, a departure, a city", () => {
    expect(historyPlan(home, { ...home, url: "/?m=ab&p=maxQuiet" })).toEqual({
      op: "replace",
      url: "/?m=ab&p=maxQuiet",
    });
  });

  it("replaces when the entry changed but the URL could not say so", () => {
    // a query typed on the search page, an address a reverse geocode filled in
    expect(historyPlan(home, { ...home, entry: '{"q":"günth"}' })).toEqual({
      op: "replace",
      url: home.url,
    });
  });

  it("does NOTHING when neither moved — the GPS tick and the clock tick", () => {
    // this is the case that runs every few metres of a walk, and the one
    // Safari throws on past ~100 history calls in 30 s
    expect(historyPlan(home, { ...home })).toEqual({ op: "none" });
  });

  it("replaces rather than pushes on the render that follows a pop", () => {
    const routes = { key: "route:routes:8.68,50.12", url: "/?e=8.68,50.12", entry: "{r}" };
    expect(historyPlan(home, routes, true)).toEqual({ op: "replace", url: routes.url });
  });
});

describe("the hook's loop, driven by the pure pieces", () => {
  /** A stand-in for window.history: an array of entries and a cursor. It runs
   *  the same three lines useHistory.ts runs, so the sequence it produces is
   *  the sequence a browser would. */
  function session(initial: ShellState) {
    const stack: { entry: HistoryEntry; url: string }[] = [];
    let at = -1;
    let s = initial;
    let written: Written | null = null;
    let popped = false;

    const url = (x: ShellState) => historyUrl("/", x, DEFAULT_SETTINGS, DEFAULT_SETTINGS);

    /** The push/replace effect. */
    function settle() {
      const next: Written = { key: screenKey(s), url: url(s), entry: entryStamp(s) };
      const plan = historyPlan(written, next, popped);
      popped = false;
      if (plan.op === "none") return plan.op;
      written = next;
      const record = { entry: entryFor(s), url: plan.url };
      if (plan.op === "push") {
        stack.length = at + 1;
        stack.push(record);
        at = stack.length - 1;
      } else {
        if (at < 0) {
          stack.push(record);
          at = 0;
        } else stack[at] = record;
        // the seed is a replace AND a push of the same entry
        if (plan.op === "seed") {
          stack.push({ ...record });
          at = stack.length - 1;
        }
      }
      return plan.op;
    }

    settle();
    return {
      get depth() {
        return stack.length;
      },
      get state() {
        return s;
      },
      get url() {
        return stack[at]?.url;
      },
      act(a: Parameters<typeof reduce>[1]) {
        s = reduce(s, a);
        return settle();
      },
      /** The back button. */
      back() {
        if (at === 0) return "left the app";
        const target = stack[at - 1];
        const action = popFor(s, target.entry);
        switch (action.do) {
          case "leave":
            return "left the app";
          case "closeOverlay":
          case "stay": {
            // the browser has already moved; the hook pushes the entry back
            s = action.do === "closeOverlay" ? reduce(s, { type: "overlay", overlay: null }) : s;
            const record = { entry: entryFor(s), url: url(s) };
            stack.length = at; // the pop dropped us to at - 1
            at -= 1;
            stack.length = at + 1;
            stack.push(record);
            at = stack.length - 1;
            written = { key: screenKey(s), url: record.url, entry: entryStamp(s) };
            return action.do;
          }
          case "restore": {
            at -= 1;
            const { tab, route, wander } = action.entry;
            s = reduce(s, {
              type: "restore",
              tab,
              route,
              wander,
              trip: tripOf(action.entry),
              origin: originOn(action.entry),
            });
            popped = true;
            settle();
            return "restore";
          }
        }
      },
    };
  }

  it("pushes one entry per screen and walks back down them", () => {
    const run = session(HOME);
    // the browser's own entry, adopted, plus the base copy pushed under it
    expect(run.depth).toBe(2);
    expect(run.act({ type: "search", q: "gün", end: "to" })).toBe("push");
    // a keystroke is not a screen: it refreshes the entry it is on (so back
    // brings the query back with the page) and pushes nothing
    expect(run.act({ type: "search", q: "günth" })).toBe("replace");
    expect(run.act({ type: "pickPlace", place: PARK })).toBe("push");
    expect(run.act({ type: "routeTo", dest: DEST, name: "Park" })).toBe("push");
    expect(run.depth).toBe(5);

    expect(run.back()).toBe("restore");
    expect(run.state.route.k).toBe("place");
    expect(run.back()).toBe("restore");
    expect(run.state.route.k).toBe("search");
    // ...with the query the reader typed, not the empty field it opened on
    expect(run.state.route.k === "search" && run.state.route.q).toBe("günth");
    expect(run.back()).toBe("restore");
    expect(run.state.route.k).toBe("home");
    // still inside the app, on the entry the page was opened on
    expect(run.depth).toBe(5);
    // …and one back below Home is the base entry, which is Home again: the
    // price of the seed (DECISIONS, fix round 1) is one extra back out of a
    // session that never left its first screen
    expect(run.back()).toBe("restore");
    expect(run.state.route.k).toBe("home");
    expect(run.back()).toBe("left the app");
  });

  it("makes no history call for a GPS fix or a clock tick", () => {
    const run = session(HOME);
    expect(run.act({ type: "gps", pos: [8.6821, 50.1109] })).toBe("none");
    expect(run.act({ type: "gps", pos: [8.6822, 50.111] })).toBe("none");
    expect(run.act({ type: "leave", startMin: 605, now: true, silent: true })).toBe("none");
    expect(run.depth).toBe(2);
  });

  it("replaces — never pushes — when a preference changes the URL", () => {
    const run = session(HOME);
    expect(run.act({ type: "pref", pref: "quiet", auto: false })).toBe("replace");
    expect(run.depth).toBe(2);
    expect(run.url).toContain("p=maxQuiet");
  });

  // The case the seed exists for (fix round 1, Part 2 of the slice 4 review):
  // a link that opens the app straight onto a screen, with a sheet over it.
  it("a link that boots onto Routes closes its sheet on back, then walks out", () => {
    const run = session(after({ type: "routeTo", dest: DEST, name: "Park" }));
    expect(run.depth).toBe(2); // the browser's entry, and the base copy
    expect(run.act({ type: "overlay", overlay: "pref" })).toBe("none");

    expect(run.back()).toBe("closeOverlay");
    expect(run.state.overlay).toBeNull();
    expect(run.state.route.k).toBe("routes"); // …and Routes is still on screen
    // only then the screen, and only then the app: handover §3.2's order
    expect(run.back()).toBe("restore");
    expect(run.back()).toBe("left the app");
  });

  it("closes a sheet on back without spending an entry", () => {
    const run = session(HOME);
    run.act({ type: "routeTo", dest: DEST, name: "Park" });
    const deep = run.depth;
    expect(run.act({ type: "overlay", overlay: "pref" })).toBe("none");
    expect(run.depth).toBe(deep);

    expect(run.back()).toBe("closeOverlay");
    expect(run.state.overlay).toBeNull();
    expect(run.state.route.k).toBe("routes"); // the screen under it is untouched
    expect(run.depth).toBe(deep); // and the entry the pop took is given back
  });

  it("refuses to leave a walk, and gives the entry back", () => {
    const run = session(HOME);
    run.act({ type: "routeTo", dest: DEST, name: "Park" });
    run.act({ type: "start" });
    const deep = run.depth;
    expect(run.back()).toBe("stay");
    expect(run.state.route.k).toBe("navigate");
    expect(run.depth).toBe(deep);
  });
});

// review B-3: the address bar and a shared link are NOT the same document.
// A link pins the walk; the address bar must not pin a per-trip override,
// because `a=` boots as a SESSION override and would outlive the trip.
describe("historyUrl — a trip override never reaches the address bar", () => {
  const base = "https://example.test/";
  const routes = after({ type: "routeTo", dest: DEST, name: "Park" });

  it("writes neither a= nor ac= for the reader's own settings", () => {
    const url = historyUrl(base, routes, DEFAULT_SETTINGS, DEFAULT_SETTINGS);
    expect(url).not.toContain("a=");
    expect(url).not.toContain("ac=");
    // ...while the link for the same screen pins both
    const link = shareUrl(base, routes, DEFAULT_SETTINGS, null);
    expect(link).toContain("a=stroller");
    expect(link).toContain("ac=0");
  });

  it("writes neither for a stored setting that is not the app default", () => {
    const chair = { ...DEFAULT_SETTINGS, access: "wheelchair" as const, avoidCobbles: true };
    const url = historyUrl(base, routes, chair, chair);
    expect(url).not.toContain("a=");
    expect(url).not.toContain("ac=");
  });

  it("writes neither for a per-trip override", () => {
    const over = reduce(routes, { type: "trip", access: "walk", avoidCobbles: true });
    const url = historyUrl(base, over, DEFAULT_SETTINGS, DEFAULT_SETTINGS);
    expect(url).not.toContain("a=");
    expect(url).not.toContain("ac=");
  });

  it("keeps a boot link's OWN access override, which a refresh cannot recover", () => {
    const session = { ...DEFAULT_SETTINGS, access: "wheelchair" as const };
    const url = historyUrl(base, routes, session, DEFAULT_SETTINGS);
    expect(url).toContain("a=wheelchair");
    // still not the cobble wall: `historyUrl` never pins one
    expect(url).not.toContain("ac=");
  });

  it("does not let a trip override masquerade as that boot override", () => {
    const session = { ...DEFAULT_SETTINGS, access: "wheelchair" as const };
    const over = reduce(routes, { type: "trip", access: "walk" });
    expect(historyUrl(base, over, session, DEFAULT_SETTINGS)).toContain("a=wheelchair");
  });
});

describe("the trip override rides on the history entry", () => {
  const routes = after({ type: "routeTo", dest: DEST, name: "Park" });

  it("is carried by entryFor and restored as a TRIP override", () => {
    const over = reduce(routes, { type: "trip", access: "walk", avoidCobbles: true });
    const entry = entryFor(over);
    expect(entry.trip).toEqual({ access: "walk", avoidCobbles: true, via: null, backBy: null });
    // ...onto a state that has none
    const back = reduce(routes, {
      type: "restore",
      tab: entry.tab,
      route: entry.route,
      wander: entry.wander,
      trip: tripOf(entry),
    });
    expect(back.trip).toEqual({ access: "walk", avoidCobbles: true, via: null, backBy: null });
  });

  it("comes back empty from an entry written before it existed", () => {
    const old = { ...entryFor(routes) } as Record<string, unknown>;
    delete old.trip;
    expect(tripOf(old as never)).toEqual(NO_TRIP);
  });

  it("refuses a hand-edited entry, the way a URL parameter is refused", () => {
    const bad = {
      ...entryFor(routes),
      // a via that is not a coordinate, and a "be back by" that is not a
      // number, are refused exactly as a bad access mode is
      trip: { access: "hovercraft", avoidCobbles: "yes", via: { at: [999, -999] }, backBy: "soon" },
    };
    expect(tripOf(bad as never)).toEqual(NO_TRIP);
    expect(tripOf({ ...entryFor(routes), trip: null } as never)).toEqual(NO_TRIP);
  });

  it("carries a loop via, and names it when the entry does", () => {
    const via = { at: [8.7027, 50.1291] as [number, number], name: "Günthersburgpark" };
    const w = reduce(routes, { type: "loopVia", via });
    const entry = entryFor(w);
    expect(entry.tab).toBe("wander");
    expect(tripOf(entry).via).toEqual(via);
    // a link's via has no name yet; it survives the round trip as null
    const unnamed = { ...entry, trip: { ...entry.trip, via: { at: via.at, name: null } } };
    expect(tripOf(unnamed).via).toEqual({ at: via.at, name: null });
  });

  it("changes the entry, so back restores it — but only replaces, never pushes", () => {
    const over = reduce(routes, { type: "trip", access: "walk" });
    expect(entryStamp(over)).not.toBe(entryStamp(routes));
    expect(screenKey(over)).toBe(screenKey(routes));
    expect(pushes(routes, over)).toBe(false);
  });
});

describe("what a restored entry is allowed to say (final review M3)", () => {
  // `trip` has been validated since review B-3; the two SCREENS were taken
  // as read, and they are the half that carries coordinates into MapLibre
  // and names into the DOM. Same-origin only, so the reach is small — but a
  // bogus `dest` is a thrown "Invalid LngLat" inside a render, which is the
  // white page lngLat.ts exists to prevent.
  it("passes a real entry through unchanged", () => {
    const nav = after({ type: "pickPlace", place: PARK }, { type: "routeTo", dest: DEST, name: "Park" }, { type: "start" });
    const e = entryFor(nav);
    expect(routeOf(e.route)).toEqual(nav.route);
    expect(wanderOf(e.wander)).toEqual(nav.wander);
    expect(tabOf(e.tab)).toBe("route");
  });

  it("drops a destination that is not a coordinate", () => {
    expect(routeOf({ k: "routes", dest: [999, -999], destName: "x" })).toEqual({ k: "home" });
    expect(routeOf({ k: "routes", dest: "8.68,50.12" })).toEqual({ k: "home" });
    expect(routeOf({ k: "navigate", dest: [NaN, 50] })).toEqual({ k: "home" });
    expect(routeOf({ k: "pin", at: null })).toEqual({ k: "home" });
  });

  it("drops a place card whose place is not one", () => {
    expect(routeOf({ k: "place", place: { name: "x" } })).toEqual({ k: "home" });
    expect(routeOf({ k: "place", place: { name: "x", kind: "park", lng: 999, lat: 0 } })).toEqual({
      k: "home",
    });
    // ...and keeps a real one, with its own fields normalised
    const ok = routeOf({ k: "place", place: { ...PARK, district: 7, inCity: "yes" } });
    expect(ok).toEqual({ k: "place", place: { ...PARK, district: null, inCity: false } });
  });

  it("keeps the place card a walk was started from, when it is a real one", () => {
    const from = routeOf({ k: "navigate", dest: DEST, destName: "Park", from: PARK });
    expect(from).toEqual({ k: "navigate", dest: DEST, destName: "Park", from: PARK });
    // a bogus one is simply not there: the ✕ falls to Home, it does not throw
    expect(routeOf({ k: "navigate", dest: DEST, destName: "Park", from: 42 })).toEqual({
      k: "navigate",
      dest: DEST,
      destName: "Park",
    });
  });

  it("falls back to Home, the Wander root and the route tab", () => {
    expect(routeOf(undefined)).toEqual({ k: "home" });
    expect(routeOf({ k: "somewhere-else" })).toEqual({ k: "home" });
    // W0 is Wander's Home: an entry that says nothing recognisable lands on
    // the root, which is where a reload lands anyway
    expect(wanderOf(undefined)).toEqual({ k: "idle" });
    expect(wanderOf({ k: "nope" })).toEqual({ k: "idle" });
    // The start point left these screens with CR-03 A8: it is the entry's
    // own field now, validated the same way, and one an entry written before
    // the change simply does not have.
    expect(wanderOf({ k: "loops", origin: { kind: "point", at: [8.68, 50.11], label: null } })).toEqual({
      k: "loops",
    });
    expect(wanderOf({ k: "navigate" })).toEqual({ k: "navigate" });
    expect(originOn({ origin: { kind: "point", at: [8.68, 50.11], label: null } } as never)).toEqual({
      kind: "point",
      at: [8.68, 50.11],
      label: null,
    });
    expect(originOn({ origin: { kind: "point", at: [999, 0] } } as never)).toEqual({ kind: "gps" });
    expect(originOn({} as never)).toEqual({ kind: "gps" });
    expect(tabOf("nope")).toBe("route");
    expect(tabOf("wander")).toBe("wander");
  });

  it("keeps a search's own end and the screen behind it, recursively", () => {
    const r = routeOf({
      k: "search",
      q: "gün",
      end: "from",
      back: { k: "routes", dest: DEST, destName: "Park", origin: { kind: "gps" } },
    });
    expect(r).toEqual({
      k: "search",
      q: "gün",
      end: "from",
      back: { k: "routes", dest: DEST, destName: "Park", origin: { kind: "gps" } },
    });
    // an unrecognised end is the destination end, which is what opens by default
    expect(routeOf({ k: "search", q: 3, end: "sideways", back: 1 })).toEqual({
      k: "search",
      q: "",
      end: "to",
      back: { k: "home" },
    });
  });
});
