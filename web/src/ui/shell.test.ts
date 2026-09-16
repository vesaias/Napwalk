import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../plan/settings";
import {
  bootShell,
  GPS_ORIGIN,
  initialShell,
  NO_TRIP,
  hasStart,
  reduce,
  tripSettings,
  type Origin,
  type Place,
  type PlanResult,
  type ShellState,
} from "./shellState";

const PARK: Place = {
  name: "Günthersburgpark",
  kind: "park",
  district: "Nordend",
  lng: 8.7027,
  lat: 50.1291,
  inCity: true,
};
const DEST: [number, number] = [8.7027, 50.1291];
const HOME_PIN: [number, number] = [8.6821, 50.1109];

function boot(): ShellState {
  return initialShell(14 * 60, "shade");
}

/** A plan with `alts` alternatives — only the shape the reducer reads. */
function fakePlan(alts: number): PlanResult {
  return {
    recommended: { stats: { minutes: 21 } },
    alternatives: Array.from({ length: alts }, () => ({ stats: { minutes: 24 } })),
  } as unknown as PlanResult;
}

const HOME_SCREEN = { k: "home" } as const;

const LINK = { startMin: 14 * 60, pref: "shade" as const, prefAuto: true, destName: PARK.name };

/** The shell after `pickPlace` → `routeTo`, i.e. sitting on the routes
 *  screen — the starting point for start/arrived/done/back. */
function onRoutes(): ShellState {
  let s = reduce(boot(), { type: "pickPlace", place: PARK });
  s = reduce(s, { type: "routeTo", dest: DEST, name: PARK.name });
  return s;
}

/** An A to B walk in progress, on the second of three candidates - the state
 *  the clock ticks under for as long as the walk lasts. */
function navigating(): ShellState {
  let s = reduce(onRoutes(), { type: "plan", plan: fakePlan(2) });
  s = reduce(s, { type: "select", i: 1 });
  return reduce(s, { type: "start" });
}

/** The Wander tab with loops on it (W1). The tab's ROOT is W0 since CR-02
 *  slice A, so getting to the loops is two steps now: the tab, and then the
 *  question — which the pill and a map tap both ask as an `origin`. */
function onLoops(): ShellState {
  const w = reduce(boot(), { type: "tab", tab: "wander" });
  return reduce(w, { type: "origin", origin: GPS_ORIGIN });
}

/** The same, on Wander - where losing the plan also loses the loop's first
 *  node, which is the only thing that can tell the walk it is over. */
function looping(): ShellState {
  let s = onLoops();
  s = reduce(s, { type: "plan", plan: fakePlan(2) });
  s = reduce(s, { type: "select", i: 2 });
  return reduce(s, { type: "start" });
}

describe("shell reducer", () => {
  it("boots on the route tab's home screen", () => {
    const s = boot();
    expect(s.tab).toBe("route");
    expect(s.route.k).toBe("home");
    expect(s.startMin).toBe(840);
    expect(s.pref).toBe("shade");
    expect(s.plan).toBeNull();
    expect(s.computing).toBe(false);
  });

  it("search carries the query and pickPlace opens the place card", () => {
    let s = reduce(boot(), { type: "search", q: "günth" });
    // opened from Home: the destination end, and home behind it (R4)
    expect(s.route).toEqual({ k: "search", q: "günth", end: "to", back: { k: "home" } });
    s = reduce(s, { type: "pickPlace", place: PARK });
    expect(s.route.k).toBe("place");
    if (s.route.k !== "place") throw new Error("not the place screen");
    expect(s.route.place.name).toBe(PARK.name);
  });

  it("routeTo opens the routes screen with no plan yet and computing on", () => {
    const s = onRoutes();
    expect(s.route.k).toBe("routes");
    if (s.route.k !== "routes") throw new Error("not the routes screen");
    expect(s.route.dest).toEqual(DEST);
    expect(s.route.destName).toBe(PARK.name);
    expect(s.route.origin).toEqual({ kind: "gps" });
    expect(s.plan).toBeNull();
    expect(s.computing).toBe(true);
    expect(s.selected).toBe(0);
  });

  it("start → navigate, arrived → arrived, done → home", () => {
    let s = reduce(onRoutes(), { type: "start" });
    // `from` rides along: this walk was started from a place card, and End
    // has to be able to put that card back (final review I2)
    expect(s.route).toEqual({ k: "navigate", dest: DEST, destName: PARK.name, from: PARK });
    s = reduce(s, { type: "arrived", atMin: 14 * 60 + 21 });
    expect(s.route).toEqual({ k: "arrived", destName: PARK.name, atMin: 861 });
    s = reduce(s, { type: "done" });
    expect(s.route).toEqual({ k: "home" });
    expect(s.plan).toBeNull();
  });

  it("end returns from navigating to the route cards", () => {
    let s = reduce(onRoutes(), { type: "start" });
    s = reduce(s, { type: "end" });
    expect(s.route.k).toBe("routes");
    if (s.route.k !== "routes") throw new Error("not the routes screen");
    expect(s.route.destName).toBe(PARK.name);
  });

  // R5, slice 4: the segmented control has no Apply. One tap has to do both
  // halves of the job — take the preference, and get out of the way.
  it("a tap on a preference applies it and closes the sheet", () => {
    let s = reduce(onRoutes(), { type: "plan", plan: fakePlan(2) });
    s = reduce(s, { type: "overlay", overlay: "pref" });
    expect(s.overlay).toBe("pref");
    const picked = reduce(s, { type: "pref", pref: "quiet", auto: false });
    expect(picked.overlay).toBeNull();
    expect(picked.pref).toBe("quiet");
    expect(picked.prefAuto).toBe(false);
    // and the answer on screen belonged to the old question
    expect(picked.plan).toBeNull();
    expect(picked.computing).toBe(true);
  });

  it("back closes an overlay before it leaves the routes screen", () => {
    let s = reduce(onRoutes(), { type: "overlay", overlay: "pref" });
    s = reduce(s, { type: "back" });
    expect(s.overlay).toBeNull();
    expect(s.route.k).toBe("routes");
    s = reduce(s, { type: "back" });
    expect(s.route.k).not.toBe("routes");
  });

  // R4: the ✕ on the From row undoes the step that got here.
  it("closes the routes screen back to the place card the walk came from", () => {
    const s = reduce(onRoutes(), { type: "back" });
    expect(s.route).toEqual({ k: "place", place: PARK });
  });

  it("closes to home when no card is behind the walk", () => {
    // a dropped pin, a share link and a search result for the To field all
    // reach the routes screen without a place card behind them
    let s = reduce(boot(), { type: "longPress", at: HOME_PIN });
    s = reduce(s, { type: "routeTo", dest: HOME_PIN, name: "" });
    expect(s.route.k === "routes" && s.route.from).toBeUndefined();
    s = reduce(s, { type: "back" });
    expect(s.route).toEqual({ k: "home" });
  });

  it("keeps the card behind the walk when the ends are swapped", () => {
    let s = reduce(onRoutes(), { type: "origin", origin: { kind: "point", at: DEST, label: PARK.name } });
    s = reduce(s, { type: "routeTo", dest: HOME_PIN, name: "Dropped pin" });
    expect(s.route.k === "routes" && s.route.from).toEqual(PARK);
    expect(reduce(s, { type: "back" }).route).toEqual({ k: "place", place: PARK });
  });

  it("a long press drops a pin, and pinInfo fills in what the lookups found", () => {
    let s = reduce(boot(), { type: "longPress", at: HOME_PIN });
    expect(s.route).toEqual({ k: "pin", at: HOME_PIN, address: null, shadePct: null });
    s = reduce(s, { type: "pinInfo", address: "Wielandstraße 18 · Nordend", shadePct: 61 });
    if (s.route.k !== "pin") throw new Error("not the pin screen");
    expect(s.route.address).toBe("Wielandstraße 18 · Nordend");
    expect(s.route.shadePct).toBe(61);
    // a stale lookup landing after the pin is gone must not resurrect it
    s = reduce(reduce(s, { type: "back" }), { type: "pinInfo", address: "late" });
    expect(s.route).toEqual({ k: "home" });
  });

  it("a pin's Start here becomes the origin of the next route", () => {
    const origin: Origin = { kind: "point", at: HOME_PIN, label: "Wielandstraße 18" };
    let s = reduce(boot(), { type: "longPress", at: HOME_PIN });
    s = reduce(s, { type: "origin", origin });
    expect(s.origin).toEqual(origin);
    expect(s.route).toEqual({ k: "home" });
    s = reduce(reduce(s, { type: "pickPlace", place: PARK }), { type: "routeTo", dest: DEST, name: PARK.name });
    if (s.route.k !== "routes") throw new Error("not the routes screen");
    expect(s.route.origin).toEqual(origin);
  });

  it("plan delivery clears computing; a new preference or start time invalidates it", () => {
    const plan = fakePlan(2);
    let s = reduce(onRoutes(), { type: "plan", plan });
    expect(s.plan).toBe(plan);
    expect(s.computing).toBe(false);

    s = reduce(s, { type: "select", i: 1 });
    expect(s.selected).toBe(1);

    s = reduce(s, { type: "pref", pref: "quiet", auto: false });
    expect(s.pref).toBe("quiet");
    expect(s.prefAuto).toBe(false);
    expect(s.plan).toBeNull();
    expect(s.selected).toBe(0);
    expect(s.computing).toBe(true);

    s = reduce(reduce(s, { type: "plan", plan }), { type: "leave", startMin: 16 * 60, now: false });
    expect(s.startMin).toBe(960);
    expect(s.leaveNow).toBe(false);
    expect(s.plan).toBeNull();
    expect(s.computing).toBe(true);
  });

  it("planning stays idle on a screen that has nothing to plan", () => {
    // home has neither a destination nor a loop: nothing to compute
    expect(reduce(boot(), { type: "pref", pref: "quiet", auto: false }).computing).toBe(false);
    // the place card previews the walk, so it does compute
    const place = reduce(boot(), { type: "pickPlace", place: PARK });
    expect(reduce(place, { type: "leave", startMin: 900, now: false }).computing).toBe(true);
    expect(reduce(place, { type: "computing", on: false }).computing).toBe(false);
  });

  it("a share link's ?r= survives until the first plan lands", () => {
    const booted = bootShell({ mode: "ab", dest: DEST, selected: 2 }, LINK);
    expect(booted.route.k).toBe("routes");
    expect(booted.computing).toBe(true);
    expect(booted.selected).toBe(0); // nothing to index into yet
    expect(booted.bootSelected).toBe(2);

    let s = reduce(booted, { type: "plan", plan: fakePlan(2) });
    expect(s.selected).toBe(2);
    expect(s.bootSelected).toBeNull();
    // every later plan is a fresh answer: back to the recommended route
    s = reduce(s, { type: "plan", plan: fakePlan(2) });
    expect(s.selected).toBe(0);
  });

  it("?r= is clamped to the candidates this plan actually has", () => {
    const booted = bootShell({ mode: "ab", dest: DEST, selected: 2 }, LINK);
    expect(reduce(booted, { type: "plan", plan: fakePlan(0) }).selected).toBe(0);
    expect(reduce(booted, { type: "plan", plan: fakePlan(1) }).selected).toBe(1);
    expect(reduce(booted, { type: "plan", plan: null }).selected).toBe(0);
  });

  it("m=loop opens on the Wander tab with the link's start and duration", () => {
    const s = bootShell({ mode: "loop", duration: 60, start: HOME_PIN, minutes: 900 }, LINK);
    const origin: Origin = { kind: "point", at: HOME_PIN, label: null };
    expect(s.tab).toBe("wander");
    expect(s.wander).toEqual({ k: "loops" });
    expect(s.durationMin).toBe(60);
    expect(s.origin).toEqual(origin);
    expect(s.route).toEqual({ k: "home" });
    expect(s.computing).toBe(true);
    expect(s.leaveNow).toBe(false); // t= pinned the clock
  });

  it("a shared loop names one of its three walks, like a shared A→B link", () => {
    const booted = bootShell({ mode: "loop", duration: 60, start: HOME_PIN, selected: 2 }, LINK);
    expect(booted.bootSelected).toBe(2);
    expect(booted.selected).toBe(0); // nothing to index into yet
    expect(reduce(booted, { type: "plan", plan: fakePlan(2) }).selected).toBe(2);
    // and a loop link with no ?r= opens on the recommended walk
    expect(bootShell({ mode: "loop", duration: 60 }, LINK).bootSelected).toBeNull();
  });

  it("bootShell opens the routes screen for a destination outside the city", () => {
    // QA F1-01/F2-03: ~30 km south-west of Frankfurt, and no c= in the link.
    // urlState keeps the pins now, so the shell has a walk to open — the
    // planner refuses it and the routes screen says "outside the city",
    // which is the whole point: Home with no message was the bug.
    const FAR_START: [number, number] = [8.2, 49.9];
    const FAR_DEST: [number, number] = [8.21, 49.91];
    const s = bootShell({ start: FAR_START, dest: FAR_DEST }, LINK);
    expect(s.tab).toBe("route");
    expect(s.route).toEqual({
      k: "routes",
      origin: { kind: "point", at: FAR_START, label: null },
      dest: FAR_DEST,
      destName: PARK.name,
    });
    expect(s.computing).toBe(true);
  });

  it("a bare link boots on home, leaving now, with nothing to compute", () => {
    const s = bootShell({}, LINK);
    expect(s.tab).toBe("route");
    expect(s.route).toEqual({ k: "home" });
    // no `m=loop`: the Wander tab is on its root, with nothing planned
    expect(s.wander).toEqual({ k: "idle" });
    expect(s.durationMin).toBe(45);
    expect(s.leaveNow).toBe(true);
    expect(s.computing).toBe(false);
    expect(s.bootSelected).toBeNull();
  });

  it("the clock's own tick moves the start minute without closing a sheet", () => {
    let s = reduce(onRoutes(), { type: "overlay", overlay: "leave" });
    s = reduce(s, { type: "leave", startMin: 845, now: true, silent: true });
    expect(s.startMin).toBe(845);
    expect(s.overlay).toBe("leave");
    // a tap on the sheet's own button is not silent, and closes it
    s = reduce(s, { type: "leave", startMin: 900, now: false });
    expect(s.startMin).toBe(900);
    expect(s.overlay).toBeNull();
  });

  it("gps carries a denial, and the toast says so", () => {
    let s = reduce(boot(), { type: "gps", pos: [8.68, 50.11] });
    expect(s.gps).toEqual([8.68, 50.11]);
    expect(s.gpsDenied).toBe(false);
    s = reduce(s, { type: "gps", pos: null, denied: true });
    expect(s.gpsDenied).toBe(true);
    s = reduce(s, { type: "toast", text: "Location is off" });
    expect(s.toast).toBe("Location is off");
    expect(reduce(s, { type: "toast", text: null }).toast).toBeNull();
  });

  // P2, 2026-09-10 — the ruling on backlog-R's "a refused geolocation clears
  // a resumed walker's position". A refusal says the WATCH stopped, not that
  // the reader moved, so the last known fix survives it.
  describe("a refusal and the last known fix", () => {
    it("keeps a fix the reader already had", () => {
      const had = reduce(boot(), { type: "gps", pos: [8.68, 50.11] });
      const denied = reduce(had, { type: "gps", pos: null, denied: true });
      expect(denied.gps).toEqual([8.68, 50.11]);
      expect(denied.gpsDenied).toBe(true);
    });

    it("...including the one a resumed walk was restored with", () => {
      // exactly what ui/useResume.ts dispatches on the way back
      let s = reduce(boot(), { type: "gps", pos: [8.678, 50.121] });
      s = reduce(s, { type: "gps", pos: null, denied: true });
      expect(s.gps).toEqual([8.678, 50.121]);
    });

    it("lets the first real fix replace it, and clears the denial", () => {
      let s = reduce(boot(), { type: "gps", pos: [8.678, 50.121] });
      s = reduce(s, { type: "gps", pos: null, denied: true });
      s = reduce(s, { type: "gps", pos: [8.69, 50.13] });
      expect(s.gps).toEqual([8.69, 50.13]);
      expect(s.gpsDenied).toBe(false);
    });

    it("adds no fix it never had — a boot-time refusal is still nothing", () => {
      const s = reduce(boot(), { type: "gps", pos: null, denied: true });
      expect(s.gps).toBeNull();
      expect(s.gpsDenied).toBe(true);
    });

    it("is the same state object when the denial is already recorded", () => {
      const s = reduce(boot(), { type: "gps", pos: null, denied: true });
      expect(reduce(s, { type: "gps", pos: null, denied: true })).toBe(s);
    });
  });

  it("switching tab closes the overlay and drops the other tab's plan", () => {
    let s = reduce(reduce(onRoutes(), { type: "plan", plan: fakePlan(1) }), { type: "overlay", overlay: "leave" });
    s = reduce(s, { type: "tab", tab: "wander" });
    expect(s.tab).toBe("wander");
    expect(s.overlay).toBeNull();
    expect(s.plan).toBeNull();
    // ...and Wander's own root, which is where the tab has always been left
    expect(s.wander.k).toBe("idle");
    // the route tab is where it was left
    expect(s.route.k).toBe("routes");
    expect(reduce(s, { type: "tab", tab: "wander" })).toBe(s);
  });

  // Round 3, item 1. "Route → Wander shows a prelim screen; I expect the
  // planning screen immediately." W0 is the question not yet asked — and
  // when the app already knows where "here" is, the tab tap asks it.
  describe("the Wander tab opens on its loops when a start is known", () => {
    const fixed = () => reduce(boot(), { type: "gps", pos: HOME_PIN });

    it("goes straight to W1 on a live fix", () => {
      const s = reduce(fixed(), { type: "tab", tab: "wander" });
      expect(s.wander).toEqual({ k: "loops" });
      expect(s.computing, "and asks the planner for them").toBe(true);
    });

    it("goes straight to W1 on a pin, with no fix at all", () => {
      const pinned = reduce(boot(), { type: "origin", origin: { kind: "point", at: HOME_PIN, label: null } });
      expect(pinned.gps).toBeNull();
      expect(reduce(pinned, { type: "tab", tab: "wander" }).wander).toEqual({ k: "loops" });
    });

    it("stays on W0 when there is no start at all", () => {
      const s = reduce(boot(), { type: "tab", tab: "wander" });
      expect(s.wander).toEqual({ k: "idle" });
      // …and a refusal is not a start either (ui/useGps.ts)
      const denied = reduce(boot(), { type: "gps", pos: null, denied: true });
      expect(reduce(denied, { type: "tab", tab: "wander" }).wander).toEqual({ k: "idle" });
    });

    it("leaves the ✕ pointing at W0, which is still the root", () => {
      const s = reduce(fixed(), { type: "tab", tab: "wander" });
      expect(reduce(s, { type: "end" }).wander).toEqual({ k: "idle" });
      // and going back to Route and returning asks it again, because the ✕
      // put the tab back on its root
      const back = reduce(reduce(s, { type: "end" }), { type: "tab", tab: "route" });
      expect(reduce(back, { type: "tab", tab: "wander" }).wander).toEqual({ k: "loops" });
    });

    it("does not move a Wander screen that is already past W0", () => {
      let s = reduce(fixed(), { type: "tab", tab: "wander" });
      s = reduce(s, { type: "plan", plan: fakePlan(2) });
      s = reduce(s, { type: "tab", tab: "route" });
      // the loops the reader left are the loops they come back to
      expect(reduce(s, { type: "tab", tab: "wander" }).wander).toEqual({ k: "loops" });
    });

    it("hasStart is a pin or a fix, and nothing else", () => {
      expect(hasStart(boot())).toBe(false);
      expect(hasStart(fixed())).toBe(true);
      expect(hasStart(reduce(boot(), { type: "origin", origin: { kind: "point", at: HOME_PIN, label: null } }))).toBe(true);
    });
  });

  it("wander: duration, start, arrived and loop-home", () => {
    let s = onLoops();
    s = reduce(s, { type: "duration", min: 60 });
    expect(s.wander).toEqual({ k: "loops" });
    expect(s.durationMin).toBe(60);
    s = reduce(s, { type: "start" });
    expect(s.wander).toEqual({ k: "navigate" });
    s = reduce(s, { type: "arrived", atMin: 900 });
    expect(s.wander).toEqual({ k: "arrived", atMin: 900 });
    s = reduce(s, { type: "done" });
    // Done lands on the tab ROOT, the way Route's does (CR-02 slice A review,
    // F2) — not on a fresh set of loops nobody asked for
    expect(s.wander).toEqual({ k: "idle" });
    expect(s.computing).toBe(false);
    expect(s.plan).toBeNull();
    // the length is the QUESTION, not part of the answer: it survives the walk
    expect(s.durationMin).toBe(60);

    // "loop back home" from the end of an A→B walk hands over to Wander
    let ab = reduce(reduce(onRoutes(), { type: "start" }), { type: "arrived", atMin: 861 });
    ab = reduce(ab, { type: "loopHome" });
    expect(ab.tab).toBe("wander");
    expect(ab.wander.k).toBe("loops");
    expect(ab.route).toEqual({ k: "home" });
  });

  it("Apply closes the duration sheet even when the length did not move", () => {
    let s = onLoops();
    s = reduce(s, { type: "duration", min: 90 });
    s = reduce(reduce(s, { type: "plan", plan: fakePlan(2) }), { type: "overlay", overlay: "duration" });
    // Apply on the value that is already set: nothing to replan, but the
    // sheet must still go — otherwise only the ✕ gets out of it
    const same = reduce(s, { type: "duration", min: 90 });
    expect(same.overlay).toBeNull();
    expect(same.durationMin).toBe(90);
    expect(same.plan).not.toBeNull(); // no replan: the question did not change
    expect(same.computing).toBe(false);
    // and a real change closes it AND throws the answer away
    const moved = reduce(s, { type: "duration", min: 30 });
    expect(moved.overlay).toBeNull();
    expect(moved.durationMin).toBe(30);
    expect(moved.plan).toBeNull();
    expect(moved.computing).toBe(true);
  });

  it("the loop length survives End, Done and Loop back home", () => {
    let s = onLoops();
    s = reduce(s, { type: "duration", min: 90 });
    const walking = reduce(s, { type: "start" });
    expect(reduce(walking, { type: "end" }).durationMin).toBe(90);
    const arrived = reduce(walking, { type: "arrived", atMin: 900 });
    expect(reduce(arrived, { type: "done" }).durationMin).toBe(90);
    expect(reduce(arrived, { type: "loopHome" }).durationMin).toBe(90);
    // Done returns to W0, where the pill shows that 90 again; "Loop back
    // home" is the one that asks for loops, so it still gets them
    expect(reduce(arrived, { type: "done" }).wander).toEqual({ k: "idle" });
    expect(reduce(arrived, { type: "loopHome" }).wander).toEqual({ k: "loops" });
  });

  // S6 review, finding 5. `plan` and `reroute` both clamp; `select` did not,
  // and a restored snapshot carries the LINK's 0…2 cap rather than this
  // plan's count — reachable, because the address bar drops `t=` while
  // "leave now" and a reload can re-plan at a different minute with fewer
  // candidates.
  it("clamps a pick to the candidates this plan actually has", () => {
    let s = reduce(onRoutes(), { type: "plan", plan: fakePlan(0) }); // one candidate
    s = reduce(s, { type: "select", i: 2 });
    expect(s.selected).toBe(0);
    s = reduce(s, { type: "plan", plan: fakePlan(1) }); // two
    s = reduce(s, { type: "select", i: 2 });
    expect(s.selected).toBe(1);
    s = reduce(s, { type: "plan", plan: fakePlan(2) }); // three
    s = reduce(s, { type: "select", i: 2 });
    expect(s.selected).toBe(2);
    // ...and a negative index is still no pick at all
    expect(reduce(s, { type: "select", i: -1 }).selected).toBe(2);
  });

  it("the Start rebase keeps the walk that was tapped (the two dispatches)", () => {
    // useStartWalk's silent leave replans, which resets `selected` to the
    // recommendation. On Wander that changes WHICH walk you are on, so the
    // hook re-selects the candidate by kind once the new plan lands.
    let s = onLoops();
    s = reduce(s, { type: "plan", plan: fakePlan(2) });
    s = reduce(s, { type: "select", i: 2 });
    s = reduce(s, { type: "leave", startMin: 845, now: true, silent: true });
    expect(s.selected).toBe(0); // the replan dropped it
    s = reduce(s, { type: "plan", plan: fakePlan(2) });
    s = reduce(s, { type: "select", i: 2 });
    s = reduce(s, { type: "start" });
    expect(s.selected).toBe(2);
    expect(s.wander).toEqual({ k: "navigate" });
  });
});

describe("swapping the ends of a walk (Task 12's ⇅)", () => {
  // The header's ⇅ is two dispatches, not an action of its own: the old
  // destination becomes the origin, then routeTo reads that origin and puts
  // the old origin at the far end.
  const swap = (s: ShellState): ShellState => {
    if (s.route.k !== "routes") throw new Error("not the routes screen");
    const o = s.route.origin;
    if (o.kind !== "point") throw new Error("nothing to swap");
    const { dest, destName } = s.route;
    const next = reduce(s, { type: "origin", origin: { kind: "point", at: dest, label: destName } });
    return reduce(next, { type: "routeTo", dest: o.at, name: o.label ?? "pin" });
  };

  it("exchanges a pinned origin with the destination", () => {
    let s = reduce(onRoutes(), {
      type: "origin",
      origin: { kind: "point", at: HOME_PIN, label: "Schlinkenweg" },
    });
    s = swap(s);
    if (s.route.k !== "routes") throw new Error("not the routes screen");
    expect(s.route.dest).toEqual(HOME_PIN);
    expect(s.route.destName).toBe("Schlinkenweg");
    expect(s.route.origin).toEqual({ kind: "point", at: DEST, label: PARK.name });
    expect(s.origin).toEqual({ kind: "point", at: DEST, label: PARK.name });
    // a different walk is a different answer
    expect(s.plan).toBeNull();
    expect(s.computing).toBe(true);
  });

  it("swaps back to where it started", () => {
    const start = reduce(onRoutes(), {
      type: "origin",
      origin: { kind: "point", at: HOME_PIN, label: "Schlinkenweg" },
    });
    const back = swap(swap(start));
    expect(back.route).toEqual(start.route);
  });
});

describe("the routes sheet's inputs", () => {
  it("select survives until the next plan lands", () => {
    let s = reduce(onRoutes(), { type: "plan", plan: fakePlan(2) });
    s = reduce(s, { type: "select", i: 2 });
    expect(s.selected).toBe(2);
    // changing the preference asks a new question: the old pick is void
    s = reduce(s, { type: "pref", pref: "quiet", auto: false });
    expect(s.selected).toBe(0);
    expect(s.plan).toBeNull();
    expect(s.computing).toBe(true);
    expect(s.prefAuto).toBe(false);
  });

  it("applying a preference closes the sheet it was picked in", () => {
    let s = reduce(onRoutes(), { type: "overlay", overlay: "pref" });
    expect(s.overlay).toBe("pref");
    s = reduce(s, { type: "pref", pref: "quiet", auto: false });
    expect(s.overlay).toBeNull();
  });

  it("setting a departure time pins the clock and replans", () => {
    let s = reduce(onRoutes(), { type: "overlay", overlay: "leave" });
    s = reduce(s, { type: "leave", startMin: 17 * 60, now: false });
    expect(s.startMin).toBe(1020);
    expect(s.leaveNow).toBe(false);
    expect(s.overlay).toBeNull();
    expect(s.computing).toBe(true);
    s = reduce(s, { type: "leave", startMin: 14 * 60, now: true });
    expect(s.leaveNow).toBe(true);
  });
});

describe("the sheets Settings opens", () => {
  it("carries the city and report overlays on any tab", () => {
    for (const overlay of ["city", "report"] as const) {
      let s = reduce(boot(), { type: "tab", tab: "settings" });
      s = reduce(s, { type: "overlay", overlay });
      expect(s.overlay).toBe(overlay);
      // the sheet swallows the back gesture before the screen does
      expect(reduce(s, { type: "back" }).overlay).toBeNull();
    }
  });

  // Slice 7 (SPEC §2): reporting is a Settings flow and nothing else. The
  // long-press card used to open its own variant of the sheet over the pin;
  // that overlay is gone, and the type it would have taken is not in the
  // reducer's vocabulary any more.
  it("has no map-report overlay to open from a dropped pin", () => {
    // The `Overlay` union and tsc forbid the value itself; what is worth
    // asserting here is that a long press opens the pin card and nothing
    // over it.
    const s = reduce(boot(), { type: "longPress", at: HOME_PIN });
    expect(s.route.k).toBe("pin");
    expect(s.overlay).toBeNull();
  });
});

describe("switching city", () => {
  it("drops every pin, screen and plan the old city owned", () => {
    let s = reduce(onRoutes(), { type: "plan", plan: fakePlan(2) });
    s = reduce(s, { type: "origin", origin: { kind: "point", at: HOME_PIN, label: "Schlinkenweg" } });
    s = reduce(s, { type: "overlay", overlay: "city" });
    s = reduce(s, { type: "city", changed: true });
    expect(s.overlay).toBeNull();
    expect(s.route).toEqual({ k: "home" });
    expect(s.origin).toEqual({ kind: "gps" });
    // ...and Wander back on its root: loops from a fix still in the old city
    // are no answer to any question (CR-02 slice A)
    expect(s.wander).toEqual({ k: "idle" });
    expect(s.plan).toBeNull();
    // nothing to plan on the home screen, so nothing is waited for either
    expect(s.computing).toBe(false);
  });

  it("a walk asked for while the new city downloads is a WAIT", () => {
    // The tap switches at once and the graph follows (2026-09-15), so a
    // reader can ask for a walk in a city the app has not read an edge of.
    // The reducer's half: the destination sets `computing`, because nothing
    // has failed — it is on its way. The planner's half is `planPhase`
    // (usePlanner.test/planner.test), which keeps it there until the core
    // and the departure's bands are in rather than answering "no route".
    let s = reduce(boot(), { type: "city", changed: true });
    expect(s.computing, "nothing to plan on the tab root").toBe(false);
    s = reduce(s, { type: "pickPlace", place: PARK });
    s = reduce(s, { type: "routeTo", dest: DEST, name: PARK.name });
    expect(s.computing).toBe(true);
    expect(s.graphFailed).toBe(false);
  });

  it("gives the next city a clean slate after a failed load", () => {
    let s = reduce(boot(), { type: "graph", failed: true });
    expect(s.graphFailed).toBe(true);
    s = reduce(s, { type: "city", changed: true });
    expect(s.graphFailed).toBe(false);
  });
});

describe("a city whose graph will not load", () => {
  it("ends the wait instead of shimmering for ever", () => {
    let s = reduce(onRoutes(), { type: "computing", on: true });
    expect(s.computing).toBe(true);
    s = reduce(s, { type: "graph", failed: true });
    expect(s.graphFailed).toBe(true);
    expect(s.computing).toBe(false);
  });

  it("keeps the wait off through every later replan", () => {
    let s = reduce(onRoutes(), { type: "graph", failed: true });
    s = reduce(s, { type: "pref", pref: "quiet", auto: false });
    expect(s.plan).toBeNull();
    expect(s.computing).toBe(false);
    // and a graph that does arrive puts the shell back to work
    s = reduce(s, { type: "graph", failed: false });
    expect(s.graphFailed).toBe(false);
    s = reduce(s, { type: "pref", pref: "shade", auto: false });
    expect(s.computing).toBe(true);
  });

  it("boots without the flag", () => {
    expect(boot().graphFailed).toBe(false);
    expect(bootShell({}, LINK).graphFailed).toBe(false);
  });
});

describe("the map's one-off camera target", () => {
  it("is set by Show-city and is null to begin with", () => {
    expect(boot().focus).toBeNull();
    const s = reduce(boot(), { type: "focus", at: [8.6821, 50.1109] });
    expect(s.focus).toEqual([8.6821, 50.1109]);
  });

  // review B2: Frankfurt's centre survived into Hamburg, and the next time
  // the map had nothing else to point at it eased to the edge of Hamburg's
  // maxBounds — which reads as a random jump.
  it("does not survive a city switch", () => {
    let s = reduce(boot(), { type: "focus", at: [8.6821, 50.1109] });
    s = reduce(s, { type: "city", changed: true });
    expect(s.focus).toBeNull();
  });

  // round 4 item 1: the first GPS fix asks for a zoom with its point, and
  // it is the only thing that does — "Show <city>" frames the centre at
  // whatever scale the reader left the map at.
  it("carries the zoom the first fix asks for, and only then", () => {
    expect(boot().focusZoom).toBeNull();
    const withZoom = reduce(boot(), { type: "focus", at: [8.678, 50.121], zoom: 15 });
    expect(withZoom.focusZoom).toBe(15);
    const showCity = reduce(withZoom, { type: "focus", at: [8.6821, 50.1109] });
    expect(showCity.focusZoom).toBeNull();
    expect(showCity.focusSeq).toBe(withZoom.focusSeq + 1);
  });

  it("drops the zoom with the point on a city switch", () => {
    let s = reduce(boot(), { type: "focus", at: [8.678, 50.121], zoom: 15 });
    s = reduce(s, { type: "city", changed: true });
    expect(s.focusZoom).toBeNull();
  });
});

describe("tapping the city you are already on", () => {
  // review B3: the reducer was right and the call site was not — the guard
  // belongs here, where it is testable.
  it("closes the sheet and changes nothing else", () => {
    let s = reduce(onRoutes(), { type: "plan", plan: fakePlan(2) });
    s = reduce(s, { type: "origin", origin: { kind: "point", at: HOME_PIN, label: "Schlinkenweg" } });
    s = reduce(s, { type: "plan", plan: fakePlan(2) });
    s = reduce(s, { type: "focus", at: [8.6821, 50.1109] });
    const before = reduce(s, { type: "overlay", overlay: "city" });
    const after = reduce(before, { type: "city", changed: false });
    expect(after.overlay).toBeNull();
    expect(after.route).toEqual(before.route);
    expect(after.origin).toEqual(before.origin);
    expect(after.plan).toBe(before.plan);
    expect(after.focus).toEqual(before.focus);
    expect(after.computing).toBe(false);
  });

  it("is the identity with no sheet open", () => {
    const s = onRoutes();
    expect(reduce(s, { type: "city", changed: false })).toBe(s);
  });
});

// --- final review C1, I1, I2 ---------------------------------------------

describe("a walk on screen survives the clock", () => {
  // C1: Start at 14:01 and within five minutes the 30 s tick crosses a step
  // and dispatches a silent `leave`. That used to null `plan`, and nothing
  // recomputed it - `planJob` asks for nothing while navigating, so the
  // route line left the map, the ETA fell to "0 min" and a loop could never
  // arrive.
  it("keeps the plan and the pick through the silent leave", () => {
    const s = navigating();
    const tick = reduce(s, { type: "leave", startMin: 845, now: true, silent: true });
    expect(tick.route.k).toBe("navigate");
    expect(tick.plan).toBe(s.plan);
    expect(tick.selected).toBe(1);
    expect(tick.computing).toBe(false);
    expect(tick.startMin).toBe(845); // the clock still moves on
  });

  it("keeps them through the automatic preference flip", () => {
    const s = navigating();
    const auto = reduce(s, { type: "pref", pref: "quiet", auto: true });
    expect(auto.plan).toBe(s.plan);
    expect(auto.selected).toBe(1);
    expect(auto.pref).toBe("quiet");
  });

  it("keeps them on the arrived screen, whose tags read the candidate", () => {
    const s = reduce(navigating(), { type: "arrived", atMin: 861 });
    const tick = reduce(s, { type: "leave", startMin: 870, now: true, silent: true });
    expect(tick.route.k).toBe("arrived");
    expect(tick.plan).toBe(s.plan);
    expect(tick.selected).toBe(1);
  });

  it("does the same on Wander, which cannot arrive without the plan", () => {
    const s = looping();
    const tick = reduce(s, { type: "leave", startMin: 845, now: true, silent: true });
    expect(tick.wander.k).toBe("navigate");
    expect(tick.plan).toBe(s.plan);
    expect(tick.selected).toBe(2);
    expect(reduce(tick, { type: "pref", pref: "quiet", auto: true }).plan).toBe(s.plan);
  });

  it("and replans again the moment the walk is over", () => {
    const ended = reduce(navigating(), { type: "end" });
    expect(ended.route.k).toBe("routes");
    expect(ended.plan).toBeNull();
    expect(ended.computing).toBe(true);
    const done = reduce(reduce(navigating(), { type: "arrived", atMin: 861 }), { type: "done" });
    expect(done.plan).toBeNull();
  });
});

describe("taps on the live map during a walk", () => {
  // I1: the map is live under the navigate sheet, and a tap on any named POI
  // label used to swap the screen for a place card - ending the walk with no
  // confirmation and no End.
  const walks = () => [
    navigating(),
    reduce(navigating(), { type: "arrived", atMin: 861 }),
    looping(),
    reduce(looping(), { type: "arrived", atMin: 861 }),
  ];

  it("pickPlace, search, longPress and origin are all no-ops", () => {
    for (const s of walks()) {
      expect(reduce(s, { type: "pickPlace", place: PARK })).toBe(s);
      expect(reduce(s, { type: "search", q: "guenth" })).toBe(s);
      expect(reduce(s, { type: "longPress", at: HOME_PIN })).toBe(s);
      expect(
        reduce(s, { type: "origin", origin: { kind: "point", at: HOME_PIN, label: null } })
      ).toBe(s);
      expect(reduce(s, { type: "origin", origin: GPS_ORIGIN })).toBe(s);
    }
  });

  it("but the same taps still work on the screens that offer a walk", () => {
    const s = reduce(onRoutes(), { type: "plan", plan: fakePlan(2) });
    expect(reduce(s, { type: "pickPlace", place: PARK }).route.k).toBe("place");
    expect(reduce(s, { type: "search", q: "guenth" }).route.k).toBe("search");
    expect(reduce(s, { type: "longPress", at: HOME_PIN }).route.k).toBe("pin");
  });
});

describe("the way back to your location", () => {
  const PIN: Origin = { kind: "point", at: HOME_PIN, label: "Wielandstrasse 18" };

  // I2: before this there was none - once "Start here", a share link's `s=`
  // or a Wander map tap had pinned the origin, only a city switch or a
  // reload could get "Your location" back.
  it("Locate puts the route tab's origin back on the fix", () => {
    let s = reduce(boot(), { type: "origin", origin: PIN });
    s = reduce(reduce(s, { type: "pickPlace", place: PARK }), {
      type: "routeTo",
      dest: DEST,
      name: PARK.name,
    });
    if (s.route.k !== "routes") throw new Error("not the routes screen");
    expect(s.route.origin).toEqual(PIN);
    s = reduce(s, { type: "origin", origin: GPS_ORIGIN });
    expect(s.origin).toEqual({ kind: "gps" });
    if (s.route.k !== "routes") throw new Error("not the routes screen");
    expect(s.route.origin).toEqual({ kind: "gps" });
    expect(s.plan).toBeNull(); // a different start is a different walk
  });

  // CR-03 A8 / backlog B3: one "here". A Wander tap IS the route's FROM, and
  // a planned route re-plans from it. Viktor: "Route and wander should reuse
  // the same pin … switch to wander — pin disappears. Same vice versa."
  it("a Wander map tap moves the ONE start point, and re-plans a planned route", () => {
    const tapped: Origin = { kind: "point", at: HOME_PIN, label: null };
    // a route is already planned on the other tab
    let s = reduce(reduce(boot(), { type: "pickPlace", place: PARK }), {
      type: "routeTo",
      dest: DEST,
      name: PARK.name,
    });
    s = reduce(s, { type: "tab", tab: "wander" });
    s = reduce(s, { type: "origin", origin: GPS_ORIGIN }); // the W0 pill
    s = reduce(s, { type: "origin", origin: tapped });

    expect(s.wander).toEqual({ k: "loops" });
    expect(s.origin).toEqual(tapped);
    // …and the route's own copy moved with it: its FROM is the tap
    expect(s.route.k === "routes" && s.route.origin).toEqual(tapped);
    expect(s.plan).toBeNull(); // a different start is a different walk

    // it rides the walk, so End asks the same question over again
    const back = reduce(reduce(s, { type: "start" }), { type: "end" });
    expect(back.wander).toEqual({ k: "loops" });
    expect(back.origin).toEqual(tapped);
    // ...and an origin change is refused for the whole of a walk, on either
    // tab, which is why End can rely on `s.origin` still being the point
    const walking = reduce(s, { type: "start" });
    expect(reduce(walking, { type: "origin", origin: GPS_ORIGIN })).toBe(walking);

    expect(reduce(s, { type: "origin", origin: GPS_ORIGIN }).origin).toEqual({ kind: "gps" });
  });

  it("the route tab's Start here moves Wander's start too, but does not ask its question", () => {
    let s = reduce(boot(), { type: "longPress", at: HOME_PIN });
    s = reduce(s, { type: "origin", origin: PIN });
    expect(s.origin).toEqual(PIN);
    // W0 stays the root: the pin is standing on its map, but nobody has
    // asked for loops yet (SPEC §3 W0)
    expect(s.wander).toEqual({ k: "idle" });
    // ...and loops already on screen move to it, because it is their start
    const loops = reduce(onLoops(), { type: "origin", origin: PIN });
    expect(loops.wander).toEqual({ k: "loops" });
    expect(loops.origin).toEqual(PIN);
  });

  // CR-03 A8: the whole of the `origin` action, one case per way in. There
  // is no `scope` any more, so what the action does depends only on WHICH
  // TAB is asking and which screen that tab is on.
  describe("the one start point (CR-03 A8, backlog B3)", () => {
    const TAP: Origin = { kind: "point", at: HOME_PIN, label: null };

    it("survives a tab switch, both ways round", () => {
      // Route → Wander: the pin dropped on Route is Wander's loop start
      const dropped = reduce(reduce(boot(), { type: "longPress", at: HOME_PIN }), {
        type: "origin",
        origin: TAP,
      });
      expect(reduce(dropped, { type: "tab", tab: "wander" }).origin).toEqual(TAP);
      // Wander → Route: and the tap made on Wander is Route's FROM
      const tapped = reduce(onLoops(), { type: "origin", origin: TAP });
      expect(reduce(tapped, { type: "tab", tab: "route" }).origin).toEqual(TAP);
    });

    it("enters W1 from W0 only when the Wander tab is the one asking", () => {
      const w = reduce(boot(), { type: "tab", tab: "wander" });
      expect(reduce(w, { type: "origin", origin: TAP }).wander).toEqual({ k: "loops" });
      // …from the Route tab the pin lands, W0 stays the root
      expect(reduce(boot(), { type: "origin", origin: TAP }).wander).toEqual({ k: "idle" });
    });

    it("re-plans a planned route from a Wander tap, and only the routes screen", () => {
      let s = reduce(reduce(boot(), { type: "pickPlace", place: PARK }), {
        type: "routeTo",
        dest: DEST,
        name: PARK.name,
      });
      s = reduce(reduce(s, { type: "tab", tab: "wander" }), { type: "origin", origin: TAP });
      expect(s.route.k === "routes" && s.route.origin).toEqual(TAP);

      // a place card left on the other tab is not a walk: it is handed back
      // untouched rather than closed by something happening on Wander
      const card = reduce(reduce(boot(), { type: "pickPlace", place: PARK }), {
        type: "tab",
        tab: "wander",
      });
      expect(reduce(card, { type: "origin", origin: TAP }).route).toEqual(card.route);
    });

    it("is refused while a walk is being walked, on either tab", () => {
      const loop = reduce(reduce(onLoops(), { type: "plan", plan: fakePlan(1) }), { type: "start" });
      expect(reduce(loop, { type: "origin", origin: TAP })).toBe(loop);
      let ab = reduce(reduce(boot(), { type: "pickPlace", place: PARK }), {
        type: "routeTo",
        dest: DEST,
        name: PARK.name,
      });
      ab = reduce(reduce(ab, { type: "plan", plan: fakePlan(1) }), { type: "start" });
      expect(reduce(ab, { type: "origin", origin: TAP })).toBe(ab);
    });

    it("takes both tabs back to the fix, whichever Locate was pressed", () => {
      const pinned = reduce(onLoops(), { type: "origin", origin: TAP });
      const back = reduce(pinned, { type: "origin", origin: GPS_ORIGIN });
      expect(back.origin).toEqual(GPS_ORIGIN);
      expect(back.wander).toEqual({ k: "loops" }); // still asking, from the fix
    });

    it("clears a via wherever the move came from — 'here' has moved", () => {
      const via = reduce(boot(), { type: "loopVia", via: { at: DEST, name: PARK.name } });
      expect(reduce(via, { type: "origin", origin: TAP }).trip.via).toBeNull();
      const fromRoute = reduce(reduce(via, { type: "tab", tab: "route" }), {
        type: "origin",
        origin: TAP,
      });
      expect(fromRoute.trip.via).toBeNull();
    });

    it("is one field on the entry a restore reads back", () => {
      const tapped = reduce(onLoops(), { type: "origin", origin: TAP });
      const restored = reduce(boot(), {
        type: "restore",
        tab: tapped.tab,
        route: tapped.route,
        wander: tapped.wander,
        trip: tapped.trip,
        origin: tapped.origin,
      });
      expect(restored.origin).toEqual(TAP);
    });
  });

  it("Done and Loop back home plan the next walk from where the walker is", () => {
    let s = reduce(boot(), { type: "origin", origin: PIN });
    s = reduce(reduce(s, { type: "pickPlace", place: PARK }), {
      type: "routeTo",
      dest: DEST,
      name: PARK.name,
    });
    const arrived = reduce(reduce(s, { type: "start" }), { type: "arrived", atMin: 861 });
    expect(reduce(arrived, { type: "done" }).origin).toEqual({ kind: "gps" });
    const looped = reduce(arrived, { type: "loopHome" });
    expect(looped.origin).toEqual({ kind: "gps" });
    expect(looped.wander).toEqual({ k: "loops" });
  });
});

describe("names (the ends a share link left unnamed)", () => {
  const linked = () => bootShell({ mode: "ab", start: HOME_PIN, dest: DEST }, { ...LINK, destName: "" });

  it("fills the origin label and the destination name once each", () => {
    let s = reduce(linked(), { type: "names", originLabel: "Römerberg" });
    expect(s.origin).toEqual({ kind: "point", at: HOME_PIN, label: "Römerberg" });
    expect(s.route.k === "routes" && s.route.origin).toEqual({ kind: "point", at: HOME_PIN, label: "Römerberg" });
    s = reduce(s, { type: "names", destName: "Günthersburgpark" });
    expect(s.route.k === "routes" && s.route.destName).toBe("Günthersburgpark");
  });

  it("never overwrites a name the reader already has", () => {
    const named = bootShell({ mode: "ab", start: HOME_PIN, dest: DEST }, LINK);
    const s = reduce(named, { type: "names", destName: "elsewhere" });
    expect(s.route.k === "routes" && s.route.destName).toBe(PARK.name);
    const labelled = reduce(linked(), { type: "names", originLabel: "first" });
    expect(reduce(labelled, { type: "names", originLabel: "second" })).toBe(labelled);
  });

  it("is a no-op with nothing to name", () => {
    const s = boot();
    expect(reduce(s, { type: "names", originLabel: "x", destName: "y" })).toBe(s);
  });
});

// R4 (2026-09-06): the routes header's two fields. Both ends are editable,
// so a search now says WHICH end it is filling in and what it is a detour
// from — and coming back from one must leave the walk exactly as it was.
describe("editing an end of the walk", () => {
  const routes = () => reduce(onRoutes(), { type: "plan", plan: fakePlan(2) });
  const RÖMER: Place = {
    name: "Römerberg",
    kind: "square",
    district: "Altstadt",
    lng: HOME_PIN[0],
    lat: HOME_PIN[1],
    inCity: true,
  };

  it("the From field opens a search for that end, over the routes screen", () => {
    const s = reduce(routes(), { type: "search", q: "", end: "from" });
    expect(s.route.k).toBe("search");
    if (s.route.k !== "search") throw new Error("not the search screen");
    expect(s.route.end).toBe("from");
    expect(s.route.back.k).toBe("routes");
    // the plan behind it is untouched: this is a detour, not a new question
    expect(s.plan).not.toBeNull();
  });

  it("a keystroke keeps the end and the screen behind it", () => {
    let s = reduce(routes(), { type: "search", q: "", end: "from" });
    s = reduce(s, { type: "search", q: "röm" }); // no `end`: the bar typing
    if (s.route.k !== "search") throw new Error("not the search screen");
    expect(s.route.end).toBe("from");
    expect(s.route.q).toBe("röm");
    expect(s.route.back.k).toBe("routes");
  });

  it("picking a result for From moves the start and comes back replanned", () => {
    let s = reduce(routes(), { type: "search", q: "röm", end: "from" });
    s = reduce(s, { type: "pickPlace", place: RÖMER });
    const origin: Origin = { kind: "point", at: HOME_PIN, label: RÖMER.name };
    expect(s.origin).toEqual(origin);
    expect(s.route.k).toBe("routes");
    if (s.route.k !== "routes") throw new Error("not the routes screen");
    expect(s.route.origin).toEqual(origin); // the header's own copy
    expect(s.route.dest).toEqual(DEST); // the destination is untouched
    expect(s.plan).toBeNull(); // a different start is a different walk
    expect(s.computing).toBe(true);
  });

  it("picking a result for To is still a place card", () => {
    let s = reduce(routes(), { type: "search", q: "günth", end: "to" });
    s = reduce(s, { type: "pickPlace", place: PARK });
    expect(s.route.k).toBe("place");
    expect(s.origin).toEqual({ kind: "gps" });
  });

  it("Your location at the top of a From search puts the start back on the fix", () => {
    const pinned: Origin = { kind: "point", at: HOME_PIN, label: "Römerberg" };
    let s = reduce(routes(), { type: "origin", origin: pinned });
    s = reduce(s, { type: "search", q: "", end: "from" });
    s = reduce(s, { type: "origin", origin: GPS_ORIGIN });
    expect(s.origin).toEqual({ kind: "gps" });
    expect(s.route.k).toBe("routes");
    if (s.route.k !== "routes") throw new Error("not the routes screen");
    expect(s.route.origin).toEqual({ kind: "gps" });
  });

  it("back from a From search returns to the routes screen with the plan", () => {
    const before = routes();
    let s = reduce(before, { type: "search", q: "röm", end: "from" });
    s = reduce(s, { type: "back" });
    expect(s.route).toEqual(before.route);
    expect(s.plan).toBe(before.plan); // the same answer, not a fresh wait
    expect(s.computing).toBe(false);
  });

  it("back from a search opened on Home still lands on Home", () => {
    const s = reduce(reduce(boot(), { type: "search", q: "günth" }), { type: "back" });
    expect(s.route).toEqual({ k: "home" });
  });
});

// --- the per-trip access override (R4's third chip, handover §3.2) --------
describe("the access chip's per-trip override", () => {
  it("starts empty, so the walk is planned with the settings", () => {
    const s = onRoutes();
    expect(s.trip).toEqual(NO_TRIP);
    expect(tripSettings(s, DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS);
  });

  it("overrides one half at a time and leaves the settings alone", () => {
    let s = reduce(onRoutes(), { type: "trip", access: "wheelchair" });
    expect(tripSettings(s, DEFAULT_SETTINGS).access).toBe("wheelchair");
    expect(tripSettings(s, DEFAULT_SETTINGS).avoidCobbles).toBe(DEFAULT_SETTINGS.avoidCobbles);
    s = reduce(s, { type: "trip", avoidCobbles: true });
    expect(tripSettings(s, DEFAULT_SETTINGS)).toEqual({
      ...DEFAULT_SETTINGS,
      access: "wheelchair",
      avoidCobbles: true,
    });
    // and the record it was handed is untouched
    expect(DEFAULT_SETTINGS.access).toBe("stroller");
  });

  it("throws the plan away, because it is a different question", () => {
    let s = reduce(onRoutes(), { type: "plan", plan: fakePlan(2) });
    s = reduce(s, { type: "trip", access: "walk" });
    expect(s.plan).toBeNull();
    expect(s.computing).toBe(true);
  });

  it("does not replan when the tap changes nothing", () => {
    let s = reduce(onRoutes(), { type: "trip", access: "walk" });
    s = reduce(s, { type: "plan", plan: fakePlan(2) });
    const same = reduce(s, { type: "trip", access: "walk" });
    expect(same).toBe(s);
  });

  it("leaves the sheet open — tapping a segment applies, it does not close", () => {
    let s = reduce(onRoutes(), { type: "overlay", overlay: "access" });
    s = reduce(s, { type: "trip", access: "wheelchair" });
    expect(s.overlay).toBe("access");
  });

  it("is put back under the settings by null (what Make default writes)", () => {
    let s = reduce(onRoutes(), { type: "trip", access: "walk", avoidCobbles: true });
    s = reduce(s, { type: "trip", access: null, avoidCobbles: null });
    expect(s.trip).toEqual(NO_TRIP);
  });

  it("resets on a new destination", () => {
    let s = reduce(onRoutes(), { type: "trip", access: "walk" });
    s = reduce(s, { type: "routeTo", dest: HOME_PIN, name: "Dropped pin" });
    expect(s.trip).toEqual(NO_TRIP);
  });

  it("resets on a tab switch", () => {
    let s = reduce(onRoutes(), { type: "trip", avoidCobbles: true });
    s = reduce(s, { type: "tab", tab: "wander" });
    expect(s.trip).toEqual(NO_TRIP);
  });

  it("resets on a new city, and at the end of a walk", () => {
    let s = reduce(onRoutes(), { type: "trip", access: "walk" });
    expect(reduce(s, { type: "city", changed: true }).trip).toEqual(NO_TRIP);
    s = reduce(reduce(s, { type: "start" }), { type: "arrived", atMin: 861 });
    expect(reduce(s, { type: "done" }).trip).toEqual(NO_TRIP);
  });

  it("survives the walk it was set for — End puts the same question back", () => {
    let s = reduce(onRoutes(), { type: "trip", access: "wheelchair" });
    s = reduce(reduce(s, { type: "start" }), { type: "end" });
    expect(s.trip.access).toBe("wheelchair");
  });
});

// --- the silent reroute (compact rework slice 5, 2026-09-07) --------------
describe("reroute", () => {
  it("swaps the lines under a walk without moving the walker", () => {
    const s = navigating();
    expect(s.route).toEqual({ k: "navigate", dest: DEST, destName: PARK.name, from: PARK });
    const next = fakePlan(2);
    const r = reduce(s, { type: "reroute", plan: next, selected: 1 });
    expect(r.plan).toBe(next);
    expect(r.selected).toBe(1); // the pick the walker made survives
    expect(r.route).toEqual(s.route); // same screen, same destination
    expect(r.computing).toBe(false);
  });

  it("goes through `replan`'s guard rather than round it", () => {
    // The point of the action: `plan` would reset the pick, and `replan`
    // refuses to touch a walk at all (walking()), so neither could deliver
    // a new line to a walker who has left the old one.
    const s = navigating();
    expect(reduce(s, { type: "plan", plan: fakePlan(2) }).selected).toBe(0);
    expect(reduce(s, { type: "leave", startMin: 900, now: false }).plan).toBe(s.plan);
  });

  it("clamps a pick the new plan is too short for", () => {
    const s = navigating();
    const r = reduce(s, { type: "reroute", plan: fakePlan(0), selected: 2 });
    expect(r.selected).toBe(0);
  });

  it("is only ever for a walk in progress", () => {
    for (const s of [boot(), onRoutes(), reduce(navigating(), { type: "arrived", atMin: 861 })]) {
      const r = reduce(s, { type: "reroute", plan: fakePlan(1), selected: 0 });
      expect(r).toBe(s);
    }
  });

  it("reaches a Wander walk too, though nothing dispatches one there yet", () => {
    const s = looping();
    const next = fakePlan(2);
    const r = reduce(s, { type: "reroute", plan: next, selected: 2 });
    expect(r.plan).toBe(next);
    expect(r.selected).toBe(2);
    expect(r.wander.k).toBe("navigate");
  });
});

// CR-02 slice A: W0 is the Wander tab's root. Nothing is planned on it, it
// has no origin of its own, and every way into W1 names the start it plans
// from. These are those ways, and the ways back out.
describe("the Wander root (W0)", () => {
  const TAP: Origin = { kind: "point", at: DEST, label: null };

  it("is what the tab opens on, with nothing to compute", () => {
    expect(boot().wander).toEqual({ k: "idle" });
    const w = reduce(boot(), { type: "tab", tab: "wander" });
    expect(w.tab).toBe("wander");
    expect(w.wander).toEqual({ k: "idle" });
    expect(w.computing).toBe(false);
    expect(w.plan).toBeNull();
  });

  it("is where a link without m=loop leaves the tab, and sc=wander names it", () => {
    expect(bootShell({}, LINK).wander).toEqual({ k: "idle" });
    const w0 = bootShell({ screen: "wander" }, LINK);
    expect(w0.tab).toBe("wander");
    expect(w0.wander).toEqual({ k: "idle" });
    expect(w0.computing).toBe(false);
    // ...and m=loop is still the link that asks for loops
    expect(bootShell({ mode: "loop" }, LINK).wander).toEqual({ k: "loops" });
  });

  it("the pill plans from the fix; a map tap plans from the point", () => {
    const w = reduce(boot(), { type: "tab", tab: "wander" });
    const pill = reduce(w, { type: "origin", origin: GPS_ORIGIN });
    expect(pill.wander).toEqual({ k: "loops" });
    expect(pill.computing).toBe(true);
    const tap = reduce(w, { type: "origin", origin: TAP });
    expect(tap.wander).toEqual({ k: "loops" });
    expect(tap.computing).toBe(true);
    // …and the tap IS the reader's start now, on both tabs (CR-03 A8)
    expect(tap.origin).toEqual(TAP);
    expect(pill.origin).toEqual(GPS_ORIGIN);
  });

  it("takes a via straight to W1, from the fix", () => {
    const w = reduce(boot(), { type: "tab", tab: "wander" });
    const via = reduce(w, { type: "loopVia", via: { at: DEST, name: "Günthersburgpark" } });
    expect(via.tab).toBe("wander");
    expect(via.wander).toEqual({ k: "loops" });
    expect(via.trip.via).toEqual({ at: DEST, name: "Günthersburgpark" });
  });

  it("keeps the length, which is a planning input rather than a screen", () => {
    const w = reduce(boot(), { type: "tab", tab: "wander" });
    const longer = reduce(w, { type: "duration", min: 90 });
    expect(longer.wander).toEqual({ k: "idle" });
    expect(longer.durationMin).toBe(90);
    // nothing is planned on W0, so a new length has nothing to throw away
    expect(longer.computing).toBe(false);
    expect(reduce(longer, { type: "origin", origin: GPS_ORIGIN }).durationMin).toBe(90);
  });

  it("refuses a start from it: there is no loop to walk yet", () => {
    const w = reduce(boot(), { type: "tab", tab: "wander" });
    expect(reduce(w, { type: "start" })).toBe(w);
    expect(reduce(w, { type: "arrived", atMin: 900 })).toBe(w);
    expect(reduce(w, { type: "end" })).toBe(w);
  });

  // SPEC §3 W1: "✕ always (→ W0, clears loops)". The ✕, a pull below the
  // sheet's peek and Escape are one action — `end` — because they mean the
  // same thing (CR-01 edit 6).
  it("is where the ✕ on W1 lands, with the loops thrown away", () => {
    const w1 = reduce(onLoops(), { type: "plan", plan: fakePlan(2) });
    expect(w1.plan).not.toBeNull();
    const closed = reduce(w1, { type: "end" });
    expect(closed.tab).toBe("wander");
    expect(closed.wander).toEqual({ k: "idle" });
    expect(closed.plan).toBeNull();
    expect(closed.selected).toBe(0);
    // nothing is planned on W0, so nothing is waited for either
    expect(closed.computing).toBe(false);
    // the length is the question, not the answer: it survives the ✕
    expect(closed.durationMin).toBe(w1.durationMin);
  });

  it("...and W3's loops leave their via behind when they go", () => {
    const w3 = reduce(onLoops(), { type: "loopVia", via: { at: DEST, name: "park" } });
    expect(w3.trip.via).not.toBeNull();
    const closed = reduce(w3, { type: "end" });
    expect(closed.wander).toEqual({ k: "idle" });
    expect(closed.trip.via).toBeNull();
  });

  it("does not swallow the End of a walk, which is the other `end`", () => {
    const walking = reduce(onLoops(), { type: "start" });
    expect(walking.wander.k).toBe("navigate");
    // End puts the loops back, from the point the walk was planned from;
    // only the ✕ on those loops goes on to the root
    const ended = reduce(walking, { type: "end" });
    expect(ended.wander).toEqual({ k: "loops" });
    expect(reduce(ended, { type: "end" }).wander).toEqual({ k: "idle" });
  });
});

describe("loop via a place (W3)", () => {
  const VIA = { at: DEST, name: PARK.name };

  it("switches to Wander, keeps the start, and plans through the place", () => {
    const onPlace = reduce(boot(), { type: "pickPlace", place: PARK });
    const s = reduce(onPlace, { type: "loopVia", via: VIA });
    expect(s.tab).toBe("wander");
    expect(s.wander).toEqual({ k: "loops" });
    expect(s.trip.via).toEqual(VIA);
    // a via is a new question: the answer on screen is thrown away
    expect(s.plan).toBeNull();
    expect(s.computing).toBe(true);
    // and it is a TRIP thing — the access override does not survive it
    const over = reduce(onPlace, { type: "trip", access: "wheelchair" });
    expect(reduce(over, { type: "loopVia", via: VIA }).trip.access).toBeNull();
  });

  it("is cleared by the ✕, by a new start, and by a tab switch", () => {
    const w = reduce(boot(), { type: "loopVia", via: VIA });
    expect(reduce(w, { type: "loopVia", via: null }).trip.via).toBeNull();
    // the same tap twice is not a change: nothing is replanned
    const cleared = reduce(w, { type: "loopVia", via: null });
    expect(reduce(cleared, { type: "loopVia", via: null })).toBe(cleared);

    // a tap on the map moves "here", and "from here and back" with it
    const moved = reduce(w, {
      type: "origin",
      origin: { kind: "point", at: HOME_PIN, label: null },
    });
    expect(moved.trip.via).toBeNull();
    expect(moved.wander).toEqual({ k: "loops" });
    expect(moved.origin).toEqual({ kind: "point", at: HOME_PIN, label: null });

    expect(reduce(w, { type: "tab", tab: "route" }).trip).toEqual(NO_TRIP);
  });

  it("does not survive the walk it was planned for", () => {
    const w = reduce(boot(), { type: "loopVia", via: VIA });
    const walking = reduce(w, { type: "start" });
    // a via is not reset by Start — the walk being walked IS the loop
    expect(walking.trip.via).toEqual(VIA);
    const done = reduce(reduce(walking, { type: "arrived", atMin: 900 }), { type: "done" });
    expect(done.trip.via).toBeNull();
    // "Loop back home" is a walk from where you now are, not through the park
    const home = reduce(reduce(walking, { type: "arrived", atMin: 900 }), { type: "loopHome" });
    expect(home.trip.via).toBeNull();
    expect(home.wander).toEqual({ k: "loops" });
  });

  it("is refused while the loop is being walked", () => {
    const walking = reduce(onLoops(), { type: "start" });
    expect(reduce(walking, { type: "loopVia", via: VIA })).toBe(walking);
  });
});

describe("how long? (W2)", () => {
  it("remembers the hour when the length was picked as one, and forgets it on a tile", () => {
    const w = onLoops();
    const back = reduce(w, { type: "duration", min: 75, backBy: 15 * 60 + 30 });
    expect(back.durationMin).toBe(75);
    expect(back.trip.backBy).toBe(15 * 60 + 30);
    // a tile says the same thing the other way round: the hour goes
    const tile = reduce(back, { type: "duration", min: 45 });
    expect(tile.durationMin).toBe(45);
    expect(tile.trip.backBy).toBeNull();
  });

  it("closes the sheet on the length that is already set, and replans on a new one", () => {
    const w = reduce(onLoops(), { type: "plan", plan: fakePlan(2) });
    const open = reduce(w, { type: "overlay", overlay: "duration" });
    const same = reduce(open, { type: "duration", min: open.durationMin });
    expect(same.overlay).toBeNull();
    expect(same.plan).not.toBeNull(); // the same question keeps its answer
    const changed = reduce(open, { type: "duration", min: 90 });
    expect(changed.overlay).toBeNull();
    expect(changed.plan).toBeNull();
    expect(changed.computing).toBe(true);
  });
});

describe("a walk started from a place card comes back to it (final review I2)", () => {
  // DECISIONS (slice 2) and SPEC R4: "a walk started from a place card closes
  // back to that card". Before this, `end` rebuilt the routes screen WITHOUT
  // `from`, so the one gesture that most obviously belongs to the card — walk
  // it, stop, close — was the one that lost it.
  it("carries the card through Start, End and the ✕", () => {
    const nav = reduce(onRoutes(), { type: "start" });
    if (nav.route.k !== "navigate") throw new Error("not navigating");
    expect(nav.route.from).toEqual(PARK);

    const ended = reduce(nav, { type: "end" });
    if (ended.route.k !== "routes") throw new Error("not the routes screen");
    expect(ended.route.from).toEqual(PARK);

    // the ✕ on the From row, which is `back`
    const closed = reduce(ended, { type: "back" });
    expect(closed.route).toEqual({ k: "place", place: PARK });
  });

  it("carries it through Arrived and back onto the routes screen too", () => {
    const nav = reduce(onRoutes(), { type: "start" });
    const there = reduce(nav, { type: "arrived", atMin: 861 });
    // Arrived has no card behind it to go back to — Done is the way out, and
    // it lands on Home. What must NOT happen is the walk keeping a stale one.
    expect(there.route).toEqual({ k: "arrived", destName: PARK.name, atMin: 861 });
    expect(reduce(there, { type: "done" }).route).toEqual({ k: "home" });
  });

  it("has no card when the walk did not come from one", () => {
    // a dropped pin, a share link, a swap: `routeTo` from anywhere but a
    // place card leaves `from` undefined, and the ✕ falls to Home
    let s = reduce(boot(), { type: "longPress", at: HOME_PIN });
    s = reduce(s, { type: "routeTo", dest: DEST, name: "Park" });
    const nav = reduce(s, { type: "start" });
    if (nav.route.k !== "navigate") throw new Error("not navigating");
    expect(nav.route.from).toBeUndefined();
    const ended = reduce(nav, { type: "end" });
    expect(reduce(ended, { type: "back" }).route).toEqual({ k: "home" });
  });

  it("survives a browser back onto the walk's own entry", () => {
    const nav = reduce(onRoutes(), { type: "start" });
    const there = reduce(nav, { type: "arrived", atMin: 861 });
    // `restore` maps a navigate entry onto the screen it was started from —
    // with the card, exactly as End does
    const back = reduce(there, {
      type: "restore",
      tab: nav.tab,
      route: nav.route,
      wander: nav.wander,
      trip: nav.trip,
    });
    if (back.route.k !== "routes") throw new Error("not the routes screen");
    expect(back.route.from).toEqual(PARK);
  });
});

describe("the tab bar during a walk (final review M1)", () => {
  // `tab` was the one action with no `walking` guard. It is unreachable by
  // hand today (the bar is hidden on Navigate, the web chrome is off there),
  // but it `replan`s across the boundary and nulls the walk's plan on the way
  // back — the exact failure C1 was written against.
  it("refuses the switch and keeps the walk and its plan", () => {
    const walk = navigating();
    expect(walk.plan).not.toBeNull();
    expect(reduce(walk, { type: "tab", tab: "wander" })).toBe(walk);
    expect(reduce(walk, { type: "tab", tab: "settings" })).toBe(walk);
  });

  it("refuses it on the arrival screen too, and on a loop", () => {
    const there = reduce(navigating(), { type: "arrived", atMin: 861 });
    expect(reduce(there, { type: "tab", tab: "wander" })).toBe(there);
    const loop = looping();
    expect(reduce(loop, { type: "tab", tab: "route" })).toBe(loop);
  });

  it("still switches from a screen that is not a walk", () => {
    const s = reduce(onRoutes(), { type: "tab", tab: "wander" });
    expect(s.tab).toBe("wander");
  });
});

describe("restoring an arrival (final review M2)", () => {
  // Back after Done pops the `route:arrived` entry. `Arrived` is null-safe,
  // so nothing threw — the reader simply got "You’re there" over a walk with
  // no plan, no line and no numbers. An arrival is not a screen to restore.
  it("puts an arrived entry back on Home, not on a walk with no plan", () => {
    const there = reduce(navigating(), { type: "arrived", atMin: 861 });
    const done = reduce(there, { type: "done" });
    const back = reduce(done, {
      type: "restore",
      tab: there.tab,
      route: there.route,
      wander: there.wander,
      trip: there.trip,
    });
    expect(back.route).toEqual({ k: "home" });
    expect(back.plan).toBeNull();
  });

  it("puts a Wander arrival back on the loops it was planned from", () => {
    const there = reduce(looping(), { type: "arrived", atMin: 861 });
    const done = reduce(there, { type: "done" });
    const back = reduce(done, {
      type: "restore",
      tab: there.tab,
      route: there.route,
      wander: there.wander,
      trip: there.trip,
    });
    expect(back.wander.k).toBe("loops");
  });
});

describe("be back by, from the departure (final review I1)", () => {
  // W2 says one number two ways: a length, and the hour it gets you home.
  // `bb=` is the second form, and it is measured from the departure `t=`
  // pins — not from whenever the link happens to be opened.
  it("boots bb=18:00 with t=17:00 as a 60-minute loop", () => {
    const s = bootShell(
      { mode: "loop", minutes: 1020, backBy: 1080 },
      { ...LINK, startMin: 1020 }
    );
    expect(s.startMin).toBe(1020);
    expect(s.durationMin).toBe(60);
    expect(s.trip.backBy).toBe(1080);
  });

  it("lets an explicit d= win: it is the length itself", () => {
    const s = bootShell(
      { mode: "loop", minutes: 1020, duration: 90, backBy: 1080 },
      { ...LINK, startMin: 1020 }
    );
    expect(s.durationMin).toBe(90);
  });

  it("keeps the default length for a link that says neither", () => {
    expect(bootShell({ mode: "loop" }, LINK).durationMin).toBe(45);
  });
});

describe("Show <city> from outside the data", () => {
  it("every focus is a new request, even at the same point", () => {
    const a = reduce(boot(), { type: "focus", at: [8.6821, 50.1109] });
    const b = reduce(a, { type: "focus", at: [8.6821, 50.1109] });
    expect(b.focus).toEqual(a.focus);
    expect(b.focusSeq).toBe(a.focusSeq + 1);
  });

  it("steps the banner aside until told otherwise, and forgets on a city switch", () => {
    let s = reduce(boot(), { type: "outsideSeen", seen: true });
    expect(s.outsideSeen).toBe(true);
    expect(reduce(s, { type: "outsideSeen", seen: true })).toBe(s);
    s = reduce(s, { type: "outsideSeen", seen: false });
    expect(s.outsideSeen).toBe(false);
    s = reduce(reduce(s, { type: "outsideSeen", seen: true }), { type: "city", changed: true });
    expect(s.outsideSeen).toBe(false);
  });
});

// CR-02 edit 5. The scrubbed minute is shell state because three things have
// to be looking at the same moment — the map, the layers popover's "shadows
// for HH:MM", and the card itself. What it must never do is outlive a walk.
describe("the day scrubber's minute", () => {
  it("starts unset: the map draws the walk's own departure", () => {
    expect(boot().scrub).toBeNull();
  });

  it("holds what the scrubber sends, and ignores a repeat of it", () => {
    const s = reduce(boot(), { type: "scrub", min: 8 * 60 });
    expect(s.scrub).toBe(480);
    expect(reduce(s, { type: "scrub", min: 480 })).toBe(s);
  });

  it("is cleared by scrubEnd, which is a no-op when there is nothing to clear", () => {
    const s = reduce(boot(), { type: "scrub", min: 480 });
    expect(reduce(s, { type: "scrubEnd" }).scrub).toBeNull();
    const bare = boot();
    expect(reduce(bare, { type: "scrubEnd" })).toBe(bare);
  });

  it("goes with the answer whenever a walk is asked for", () => {
    let s = reduce(boot(), { type: "scrub", min: 480 });
    s = reduce(s, { type: "routeTo", dest: DEST, name: PARK.name });
    expect(s.scrub).toBeNull();
    expect(s.computing).toBe(true);
  });

  it("...and whenever the skeleton goes up with no ghost to hide behind", () => {
    let s = reduce(boot(), { type: "scrub", min: 480 });
    s = reduce(s, { type: "computing", on: true });
    expect(s.scrub).toBeNull();
  });

  it("survives the skeleton coming DOWN, which is not a new question", () => {
    let s = reduce(boot(), { type: "scrub", min: 480 });
    s = reduce(s, { type: "computing", on: false });
    expect(s.scrub).toBe(480);
  });

  it("is gone again when the walk is cleared, so the card comes back at Leave-at", () => {
    let s = reduce(boot(), { type: "routeTo", dest: DEST, name: PARK.name });
    s = reduce(s, { type: "scrub", min: 480 }); // the web keeps no scrubber here
    s = reduce(s, { type: "back" });
    expect(s.route.k).toBe("home");
    expect(s.scrub).toBeNull();
  });
});

// Round 4 item 4 (Viktor, 2026-09-16): "If I do 'finish here' and then 'start
// here', the 'finish here' dot is not saved and I need to select 'finish here'
// on the map again." The destination lives on the routes screen and nowhere
// else, so the second long press replaced it — and then "Start here" had
// nothing to go back to. The two ends are independent now, whichever order
// they are set in, and a walk plans as soon as both exist.
describe("the two ends of a walk are independent (round 4 item 4)", () => {
  const A: [number, number] = [8.7027, 50.1291];
  const B: [number, number] = [8.678, 50.121];
  const fromB: Origin = { kind: "point", at: B, label: null };
  const fromA: Origin = { kind: "point", at: A, label: null };

  /** Long-press at `at` and tap "Route here". */
  const finishAt = (s: ShellState, at: [number, number]) =>
    reduce(reduce(s, { type: "longPress", at }), { type: "routeTo", dest: at, name: "Dropped pin" });
  /** Long-press at `at` and tap "Start here". */
  const startAt = (s: ShellState, at: [number, number], origin: Origin) =>
    reduce(reduce(s, { type: "longPress", at }), { type: "origin", origin });

  it("finish → start keeps the destination, and plans A→B", () => {
    let s = finishAt(boot(), A);
    s = startAt(s, B, fromB);
    if (s.route.k !== "routes") throw new Error(`lost the destination: ${s.route.k}`);
    expect(s.route.dest).toEqual(A);
    expect(s.route.origin).toEqual(fromB);
    expect(s.origin).toEqual(fromB);
    expect(s.computing).toBe(true); // both ends exist: a walk is being planned
  });

  it("start → finish keeps the origin, and plans B→A", () => {
    let s = startAt(boot(), B, fromB);
    s = finishAt(s, A);
    if (s.route.k !== "routes") throw new Error(`not on the routes screen: ${s.route.k}`);
    expect(s.route.dest).toEqual(A);
    expect(s.route.origin).toEqual(fromB);
  });

  it("start → start moves only the start", () => {
    let s = startAt(boot(), B, fromB);
    s = startAt(s, A, fromA);
    expect(s.origin).toEqual(fromA);
    expect(s.route).toEqual(HOME_SCREEN); // no destination was ever set
  });

  it("finish → finish moves only the finish", () => {
    let s = finishAt(boot(), A);
    s = finishAt(s, B);
    if (s.route.k !== "routes") throw new Error("not on the routes screen");
    expect(s.route.dest).toEqual(B);
    expect(s.route.origin).toEqual(GPS_ORIGIN);
  });

  it("dismissing the pin puts the walk back untouched", () => {
    const planned = finishAt(boot(), A);
    const covered = reduce(planned, { type: "longPress", at: B });
    expect(covered.route.k).toBe("pin");
    const back = reduce(covered, { type: "back" });
    if (back.route.k !== "routes") throw new Error("the walk did not come back");
    expect(back.route.dest).toEqual(A);
    expect(back.route.origin).toEqual(GPS_ORIGIN);
  });

  it("two pins in a row keep the same walk behind them", () => {
    let s = finishAt(boot(), A);
    s = reduce(s, { type: "longPress", at: B });
    s = reduce(s, { type: "longPress", at: [8.69, 50.13] });
    if (s.route.k !== "pin") throw new Error("not the pin card");
    expect(s.route.back?.dest).toEqual(A);
  });

  it("a pin dropped with nothing behind it still closes to Home", () => {
    const s = reduce(boot(), { type: "longPress", at: A });
    if (s.route.k !== "pin") throw new Error("not the pin card");
    expect(s.route.back).toBeUndefined();
    expect(reduce(s, { type: "back" }).route).toEqual(HOME_SCREEN);
    expect(reduce(s, { type: "origin", origin: fromA }).route).toEqual(HOME_SCREEN);
  });
});
