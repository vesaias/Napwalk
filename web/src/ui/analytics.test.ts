import { afterEach, describe, expect, it, vi } from "vitest";
import type { CandidateKind, PlanResult } from "../plan/plan";
import { DEFAULT_SETTINGS, type Settings } from "../plan/settings";
import {
  bootCityEvent,
  clean,
  componentOf,
  eventsFor,
  leaveBucket,
  newSession,
  pageFor,
  pageview,
  resetSender,
  SCHEMA,
  settingsEvents,
  track,
  type Ctx,
  type Event,
  type Session,
} from "./analytics";
import { initialShell, reduce, type Action, type ShellState } from "./shellState";

const DEST: [number, number] = [8.7027, 50.1291];
const PARK = { name: "Grüneburgpark", lng: 8.665, lat: 50.125 } as const;

/** A plan of the given kinds, with the numbers the events read. */
function plan(...kinds: CandidateKind[]): PlanResult {
  const [rec, ...alts] = kinds.map((kind, i) => ({
    kind,
    stats: { minutes: 21.4 + i * 3, km: 1.46 + i * 0.2 },
  }));
  return { recommended: rec, alternatives: alts } as unknown as PlanResult;
}

const SETTINGS: Settings = { ...DEFAULT_SETTINGS, layers: { shade: true, noise: false } };

function ctx(o: { sess?: Session; now?: number; nowMin?: number; settings?: Settings } = {}): Ctx {
  return {
    settings: o.settings ?? SETTINGS,
    now: o.now ?? 1_000_000,
    nowMin: o.nowMin ?? 14 * 60,
    sess: o.sess ?? newSession(),
  };
}

/** Reduce and map in one go — what useAnalytics does per action. */
function step(s: ShellState, a: Action, c: Ctx): { next: ShellState; events: Event[] } {
  const next = reduce(s, a);
  return { next, events: eventsFor(s, next, a, c) };
}

function boot(): ShellState {
  return initialShell(14 * 60, "shade");
}

/** On the routes screen with a plan under it. */
function planned(c: Ctx, kinds: CandidateKind[] = ["recommended", "shadier"]): ShellState {
  let s = reduce(boot(), { type: "pickPlace", place: PARK });
  s = reduce(s, { type: "routeTo", dest: DEST, name: PARK.name });
  s = reduce(s, { type: "plan", plan: plan(...kinds) });
  eventsFor(s, s, { type: "plan", plan: s.plan }, c); // consume, as the shell would
  return s;
}

/** Every event's keys are in the table, and survive the guard untouched. */
function inSchema(events: Event[]): void {
  for (const e of events) {
    expect(SCHEMA[e.name], `unknown event ${e.name}`).toBeDefined();
    for (const k of Object.keys(e.data)) {
      expect(SCHEMA[e.name], `${e.name}.${k} is not in the table`).toContain(k);
    }
    expect(clean(e.data)).toEqual(e.data);
  }
}

describe("clean (the privacy guard)", () => {
  it("drops every key that could carry a place, whatever its value", () => {
    const out = clean({
      city: "frankfurt",
      lat: 50.1,
      lng: 8.6,
      lon: 8.6,
      latitude: 1,
      destName: "Grüneburgpark",
      name: "x",
      query: "park",
      text: "hello",
      address: "Bockenheimer 1",
      label: "Home",
      coord: "a",
      originLabel: "x",
      q: "fine", // `q` alone is not on the list; the value is short
    });
    expect(out).toEqual({ city: "frankfurt", q: "fine" });
  });

  it("drops strings that look like a coordinate pair or read like prose", () => {
    expect(clean({ a: "8.6821,50.1109", b: "8.68, 50.11", c: "-73.9,40.7" })).toEqual({});
    expect(clean({ a: "x".repeat(41), b: "x".repeat(40) })).toEqual({ b: "x".repeat(40) });
  });

  it("keeps enums, counts, minutes and booleans; drops NaN and objects", () => {
    expect(
      clean({ kind: "shadier", n: 3, minutes: 21, on: true, bad: NaN, obj: {} as never })
    ).toEqual({ kind: "shadier", n: 3, minutes: 21, on: true });
  });
});

describe("pageFor (virtual pages)", () => {
  it("names every tab and screen, and the sheet on top of it", () => {
    const s = boot();
    expect(pageFor(s)).toBe("/route");
    expect(pageFor({ ...s, tab: "settings" })).toBe("/settings");
    expect(pageFor({ ...s, tab: "wander" })).toBe("/wander");
    expect(pageFor({ ...s, tab: "wander", wander: { k: "loops" } })).toBe("/wander/loops");
    expect(pageFor({ ...s, tab: "wander", wander: { k: "navigate" } })).toBe("/wander/navigate");
    expect(pageFor({ ...s, tab: "wander", wander: { k: "arrived", atMin: 1 } })).toBe("/wander/arrived");
    const search = reduce(s, { type: "search", q: "park" });
    expect(pageFor(search)).toBe("/route/search");
    const place = reduce(s, { type: "pickPlace", place: PARK });
    expect(pageFor(place)).toBe("/route/place");
    const pin = reduce(s, { type: "longPress", at: DEST });
    expect(pageFor(pin)).toBe("/route/pin");
    const routes = reduce(place, { type: "routeTo", dest: DEST, name: PARK.name });
    expect(pageFor(routes)).toBe("/route/results");
    const nav = reduce(routes, { type: "start" });
    expect(pageFor(nav)).toBe("/route/navigate");
    expect(pageFor(reduce(nav, { type: "arrived", atMin: 900 }))).toBe("/route/arrived");
    expect(pageFor({ ...routes, overlay: "pref" })).toBe("/route/results/pref");
    expect(pageFor({ ...s, tab: "settings", overlay: "city" })).toBe("/settings/city");
  });

  it("never puts the search text or a name in the page", () => {
    const s = reduce(boot(), { type: "search", q: "Bockenheimer Warte 8.68,50.11" });
    expect(pageFor(s)).toBe("/route/search");
  });
});

describe("eventsFor — plan and pick", () => {
  it("reports an A→B plan with the numbers rounded and the settings it used", () => {
    const c = ctx();
    let s = reduce(boot(), { type: "pickPlace", place: PARK });
    s = reduce(s, { type: "routeTo", dest: DEST, name: PARK.name });
    const { events } = step(s, { type: "plan", plan: plan("recommended", "faster", "shadier") }, c);
    inSchema(events);
    expect(events).toEqual([
      {
        name: "plan",
        data: {
          city: "frankfurt",
          screen: "results",
          pref: "shade",
          auto: true,
          access: "stroller",
          cobbles: false,
          now: true,
          leave: 0,
          ok: true,
          n: 3,
          minutes: 21,
          km: 1.5,
        },
      },
    ]);
  });

  it("buckets a picked departure as minutes from now, and says when nothing routed", () => {
    const c = ctx({ nowMin: 14 * 60 });
    let s = reduce(boot(), { type: "longPress", at: DEST });
    s = reduce(s, { type: "leave", startMin: 14 * 60 + 50, now: false });
    const { events } = step(s, { type: "plan", plan: null }, c);
    inSchema(events);
    expect(events[0].data).toMatchObject({ screen: "pin", now: false, leave: 45, ok: false, n: 0, minutes: 0 });
  });

  it("stays quiet for the clock's own replans and the auto-preference rule", () => {
    const c = ctx();
    let s = planned(c);
    // a silent five-minute tick, then its answer
    let r = step(s, { type: "leave", startMin: 14 * 60 + 5, now: true, silent: true }, c);
    expect(r.events).toEqual([]);
    s = r.next;
    r = step(s, { type: "plan", plan: plan("recommended") }, c);
    expect(r.events).toEqual([]);
    s = r.next;
    // the reader's own tap on the preference sheet is worth a plan event
    r = step(s, { type: "pref", pref: "quiet", auto: false }, c);
    s = r.next;
    r = step(s, { type: "plan", plan: plan("recommended") }, c);
    expect(r.events.map((e) => e.name)).toEqual(["plan"]);
    expect(r.events[0].data).toMatchObject({ pref: "quiet", auto: false });
    s = r.next;
    // the hour turned and the rule picked for them: quiet again
    r = step(s, { type: "pref", pref: "shade", auto: true }, c);
    s = r.next;
    r = step(s, { type: "plan", plan: plan("recommended") }, c);
    expect(r.events).toEqual([]);
  });

  it("reports loops on the Wander tab with the length asked for", () => {
    const c = ctx();
    let s = reduce(boot(), { type: "gps", pos: DEST });
    eventsFor(boot(), s, { type: "gps", pos: DEST }, c);
    s = reduce(s, { type: "tab", tab: "wander" });
    s = reduce(s, { type: "duration", min: 60 });
    const { events } = step(s, { type: "plan", plan: plan("recommended", "parkLoop") }, c);
    inSchema(events);
    expect(events).toEqual([
      { name: "wander", data: { city: "frankfurt", minutes: 60, via: false, ok: true, loops: 2 } },
    ]);
  });

  it("names the card the reader picked, and not a re-pick of the same one", () => {
    const c = ctx();
    const s = planned(c, ["recommended", "faster", "shadier"]);
    const r = step(s, { type: "select", i: 2 }, c);
    inSchema(r.events);
    expect(r.events).toEqual([{ name: "pick", data: { city: "frankfurt", tab: "route", kind: "shadier" } }]);
    expect(step(r.next, { type: "select", i: 2 }, c).events).toEqual([]);
  });

  it("Start's rebase restoring the same kind is not a second pick; a new screen is", () => {
    const c = ctx();
    let s = planned(c, ["recommended", "faster"]);
    let r = step(s, { type: "select", i: 1 }, c);
    expect(r.events.map((e) => e.name)).toEqual(["pick"]);
    s = r.next;
    // useStartWalk: a silent leave, the plan lands, the kind is re-selected
    s = step(s, { type: "leave", startMin: 15 * 60, now: true, silent: true }, c).next;
    r = step(s, { type: "plan", plan: plan("recommended", "faster") }, c);
    expect(r.events).toEqual([]);
    s = r.next;
    expect(s.selected).toBe(0);
    r = step(s, { type: "select", i: 1 }, c);
    expect(r.events).toEqual([]);
    // ...but the same kind picked on a NEW walk counts again
    s = step(r.next, { type: "back" }, c).next;
    s = step(s, { type: "routeTo", dest: DEST, name: PARK.name }, c).next;
    s = reduce(s, { type: "plan", plan: plan("recommended", "faster") });
    expect(step(s, { type: "select", i: 1 }, c).events.map((e) => e.name)).toEqual(["pick"]);
  });
});

describe("eventsFor — the walk", () => {
  it("navigate, then arrived with the minutes it took", () => {
    const sess = newSession();
    const c = ctx({ sess, now: 1_000_000 });
    const s = planned(c, ["recommended", "shadier"]);
    const picked = reduce(s, { type: "select", i: 1 });
    const r = step(picked, { type: "start" }, c);
    inSchema(r.events);
    expect(r.events).toEqual([
      { name: "navigate", data: { city: "frankfurt", tab: "route", kind: "shadier", minutes: 24, km: 1.7 } },
    ]);
    const later = ctx({ sess, now: 1_000_000 + 17.4 * 60_000 });
    const a = step(r.next, { type: "arrived", atMin: 900 }, later);
    inSchema(a.events);
    expect(a.events).toEqual([{ name: "arrived", data: { city: "frankfurt", tab: "route", elapsed: 17 } }]);
    expect(sess.walkStartedAt).toBe(0);
  });

  it("end mid-walk carries the share of the planned minutes that had passed", () => {
    const sess = newSession();
    const T0 = 1_000_000;
    const c = ctx({ sess, now: T0 });
    const s = reduce(planned(c, ["recommended"]), { type: "start" });
    eventsFor(planned(c, ["recommended"]), s, { type: "start" }, c);
    // 21.4 planned, 8 walked: 37 % → 35
    const e = step(s, { type: "end" }, ctx({ sess, now: T0 + 8 * 60_000 }));
    inSchema(e.events);
    expect(e.events).toEqual([{ name: "end", data: { city: "frankfurt", tab: "route", elapsed: 8, pct: 35 } }]);
    // ...and never more than 100
    const s2 = reduce(planned(c, ["recommended"]), { type: "start" });
    eventsFor(planned(c, ["recommended"]), s2, { type: "start" }, ctx({ sess, now: T0 }));
    const late = step(s2, { type: "end" }, ctx({ sess, now: T0 + 60 * 60_000 }));
    expect(late.events[0].data.pct).toBe(100);
  });

  it("a resumed walk is not a new navigation, and keeps its old clock", () => {
    const sess = newSession();
    sess.resumeWalkAt = 500_000;
    const c = ctx({ sess, now: 1_000_000 });
    const s = planned(c, ["recommended"]);
    const r = step(s, { type: "start" }, c);
    expect(r.events).toEqual([]);
    expect(sess.walkStartedAt).toBe(500_000);
    expect(sess.resumeWalkAt).toBe(0);
    const a = step(r.next, { type: "arrived", atMin: 900 }, ctx({ sess, now: 1_000_000 + 60_000 }));
    expect(a.events[0].data.elapsed).toBe(9); // (1_060_000 − 500_000) / 60 000 ≈ 9.3
  });

  it("end on the loops screen is not the end of a walk", () => {
    const c = ctx();
    let s = reduce(boot(), { type: "gps", pos: DEST });
    s = reduce(s, { type: "tab", tab: "wander" });
    expect(step(s, { type: "end" }, c).events).toEqual([]);
  });
});

describe("eventsFor — once per session", () => {
  it("locate: the first fix, and the first refusal, and no more", () => {
    const sess = newSession();
    const c = ctx({ sess });
    let s = boot();
    let r = step(s, { type: "gps", pos: null, denied: true }, c);
    inSchema(r.events);
    expect(r.events).toEqual([{ name: "locate", data: { granted: false } }]);
    s = r.next;
    r = step(s, { type: "gps", pos: DEST }, c);
    expect(r.events).toEqual([{ name: "locate", data: { granted: true } }]);
    s = r.next;
    r = step(s, { type: "gps", pos: [DEST[0] + 0.001, DEST[1]] }, c);
    expect(r.events).toEqual([]);
    // a second refusal is the same session's same answer
    expect(step(r.next, { type: "gps", pos: null, denied: true }, c).events).toEqual([]);
  });

  it("scrub: once, in half-hour buckets", () => {
    const sess = newSession();
    const c = ctx({ sess });
    const s = boot();
    const r = step(s, { type: "scrub", min: 14 * 60 + 40 }, c);
    inSchema(r.events);
    expect(r.events).toEqual([{ name: "scrub", data: { min: 870 } }]);
    expect(step(r.next, { type: "scrub", min: 600 }, c).events).toEqual([]);
  });

  it("the per-trip access chip is a settings change with scope trip", () => {
    const c = ctx();
    const s = planned(c);
    let r = step(s, { type: "trip", access: "walk" }, c);
    inSchema(r.events);
    expect(r.events).toEqual([{ name: "settings", data: { key: "access", value: "walk", scope: "trip" } }]);
    r = step(r.next, { type: "trip", avoidCobbles: false, access: "walk" }, c);
    expect(r.events).toEqual([{ name: "settings", data: { key: "cobbles", value: "false", scope: "trip" } }]);
    r = step(r.next, { type: "trip", access: null }, c);
    expect(r.events).toEqual([{ name: "settings", data: { key: "access", value: "default", scope: "trip" } }]);
  });
});

describe("settingsEvents", () => {
  it("tells a picked city from the edge's guess", () => {
    const next = { ...SETTINGS, city: "berlin" as const };
    expect(settingsEvents(SETTINGS, next, true)).toEqual([
      { name: "city", data: { from: "frankfurt", to: "berlin", how: "picker" } },
    ]);
    expect(settingsEvents(SETTINGS, next, false)[0].data.how).toBe("where");
  });

  it("names every layer, theme, language and setting change — and only the changes", () => {
    const next: Settings = {
      ...SETTINGS,
      layers: { shade: false, noise: true },
      theme: "dark",
      locale: "de",
      access: "walk",
      avoidCobbles: true,
      pace: "brisk",
      autoPref: false,
    };
    const events = settingsEvents(SETTINGS, next, true);
    inSchema(events);
    expect(events).toEqual([
      { name: "layer", data: { layer: "shade", on: false } },
      { name: "layer", data: { layer: "noise", on: true } },
      { name: "theme", data: { theme: "dark" } },
      { name: "language", data: { locale: "de" } },
      { name: "settings", data: { key: "access", value: "walk", scope: "default" } },
      { name: "settings", data: { key: "cobbles", value: "true", scope: "default" } },
      { name: "settings", data: { key: "pace", value: "brisk", scope: "default" } },
      { name: "settings", data: { key: "autoPref", value: "false", scope: "default" } },
    ]);
    expect(settingsEvents(SETTINGS, { ...SETTINGS }, true)).toEqual([]);
  });
});

describe("the small ones", () => {
  it("leaveBucket: quarter hours under two hours, hours beyond, either side of now", () => {
    expect(leaveBucket(0)).toBe(0);
    expect(leaveBucket(14)).toBe(0);
    expect(leaveBucket(50)).toBe(45);
    expect(leaveBucket(119)).toBe(105);
    expect(leaveBucket(130)).toBe(120);
    expect(leaveBucket(400)).toBe(360);
    expect(leaveBucket(-7)).toBe(-15);
  });

  it("bootCityEvent: only a time-zone guess is a switch", () => {
    const e = bootCityEvent("timezone", "frankfurt", "london");
    expect(e).toEqual({ name: "city", data: { from: "frankfurt", to: "london", how: "timezone" } });
    inSchema([e!]);
    expect(bootCityEvent("stored", "frankfurt", "london")).toBeNull();
    expect(bootCityEvent("link", "frankfurt", "london")).toBeNull();
    expect(bootCityEvent("default", "frankfurt", "frankfurt")).toBeNull();
  });

  it("componentOf reads the first frame of either stack shape", () => {
    expect(componentOf("\n    at Shell (http://x/AppShell.tsx:61:3)\n    at ErrorBoundary")).toBe("Shell");
    expect(componentOf("\n    in MapView (created by Shell)\n    in Shell")).toBe("MapView");
    expect(componentOf("")).toBe("unknown");
    expect(componentOf(undefined)).toBe("unknown");
  });

  it("the schema itself passes the guard", () => {
    for (const [name, keys] of Object.entries(SCHEMA)) {
      const data = Object.fromEntries(keys.map((k) => [k, "x"]));
      expect(clean(data), name).toEqual(data);
    }
  });
});

describe("track and pageview (the senders)", () => {
  type Win = { umami?: { track: (...a: unknown[]) => unknown } };
  const g = globalThis as unknown as { window?: Win };

  afterEach(() => {
    delete g.window;
    resetSender();
    vi.useRealTimers();
  });

  it("is a no-op without window.umami and never throws", () => {
    expect(() => track("plan", { city: "frankfurt" })).not.toThrow();
    g.window = {
      umami: {
        track: () => {
          throw new Error("boom");
        },
      },
    };
    expect(() => track("plan", { city: "frankfurt" })).not.toThrow();
    expect(() => pageview("/route")).not.toThrow();
  });

  it("sends events through the guard, and page views as { url }", () => {
    const calls: unknown[][] = [];
    g.window = { umami: { track: (...a: unknown[]) => calls.push(a) } };
    track("plan", { city: "frankfurt", lat: 50.1, destName: "Park" });
    pageview("/route/results");
    expect(calls).toEqual([["plan", { city: "frankfurt" }], [{ url: "/route/results" }]]);
  });

  it("holds what it sent before s.js landed, and lets it go when it does", () => {
    vi.useFakeTimers();
    g.window = {};
    pageview("/route");
    track("resume", { walking: false });
    const calls: unknown[][] = [];
    g.window.umami = { track: (...a: unknown[]) => calls.push(a) };
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual([[{ url: "/route" }], ["resume", { walking: false }]]);
    // ...in order, and ahead of the next live call
    track("pick", { kind: "faster" });
    expect(calls).toHaveLength(3);
  });

  it("gives up after its retries with nothing loaded", () => {
    vi.useFakeTimers();
    g.window = {};
    pageview("/route");
    vi.advanceTimersByTime(60_000);
    const calls: unknown[][] = [];
    g.window.umami = { track: (...a: unknown[]) => calls.push(a) };
    vi.advanceTimersByTime(60_000);
    expect(calls).toEqual([]);
  });
});
