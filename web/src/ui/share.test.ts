import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../plan/settings";
import { decodeState } from "../urlState";
import { bootShell, initialShell, reduce, type ShellState } from "./shellState";
import { loopShareUrl, shareUrl } from "./share";
import { bootSettings } from "./useSettings";

// The boot options AppShell hands bootShell; only `startMin` and `pref` come
// from outside the link, and the round trip below re-applies them the way the
// shell does (`BOOT.minutes ?? nowClamped()`).
const BOOT = { startMin: 14 * 60, pref: "shade" as const, prefAuto: true, destName: "Dropped pin" };
const OPTS = {
  city: "frankfurt" as const,
  access: "stroller" as const,
  pref: "shade" as const,
  startMin: 14 * 60,
  durationMin: 90,
  start: [8.678, 50.121] as [number, number],
  selected: 1,
};

const qs = (url: string) => url.slice(url.indexOf("?"));
/** What the app really does at boot: the link's `t=` becomes the start
 *  minute, everything else is bootShell's. */
function reopen(url: string): ShellState {
  const link = decodeState(qs(url));
  return bootShell(link, { ...BOOT, startMin: link.minutes ?? BOOT.startMin });
}

describe("loopShareUrl", () => {
  it("round-trips through the boot the app opens on", () => {
    const s = reopen(loopShareUrl("https://shadewalk.app/", OPTS));
    expect(s.tab).toBe("wander");
    expect(s.wander).toEqual({ k: "loops" });
    expect(s.origin).toEqual({ kind: "point", at: [8.678, 50.121], label: null });
    expect(s.durationMin).toBe(90);
    expect(s.leaveNow).toBe(false); // t= pinned the clock
    expect(s.bootSelected).toBe(1);
  });

  it("carries the preference as the preset a link speaks in", () => {
    expect(loopShareUrl("https://x/", { ...OPTS, pref: "quiet" })).toContain("p=maxQuiet");
    expect(loopShareUrl("https://x/", { ...OPTS, pref: "balanced" })).toContain("p=balanced");
    expect(loopShareUrl("https://x/", OPTS)).toContain("p=maxShade");
  });

  it("keeps a start-less link openable, and names its city (S7 review F1)", () => {
    const url = loopShareUrl("https://x/", { ...OPTS, start: null, selected: 0 });
    expect(url).not.toContain("s=");
    expect(url).not.toContain("r=");
    // the default city is written like any other since the S7 review: a
    // link that says nothing about its city is a link a foreign time zone
    // opens in the wrong one
    expect(url).toContain("c=frankfurt");
    expect(decodeState(qs(url)).mode).toBe("loop");
  });

  it("survives a duration the old fixed list never had", () => {
    // ?d= used to be checked against [30, 45, 60]; the "be back by" slider
    // lands anywhere on the five-minute grid
    const url = loopShareUrl("https://x/", { ...OPTS, durationMin: 85 });
    expect(decodeState(qs(url)).duration).toBe(85);
  });
});

describe("shareUrl", () => {
  const settings = { ...DEFAULT_SETTINGS, city: "frankfurt" as const, access: "stroller" as const };
  const start: [number, number] = [8.6821, 50.1109];
  const dest: [number, number] = [8.7027, 50.1291];

  /** The routes screen, as the shell holds it. */
  function routes(): ShellState {
    const s = initialShell(14 * 60, "shade");
    s.leaveNow = false;
    s.startMin = 14 * 60;
    s.selected = 2;
    s.route = { k: "routes", origin: { kind: "gps" }, dest, destName: "Günthersburgpark" };
    return s;
  }

  it("round-trips an A→B walk back onto the routes screen", () => {
    const s = reopen(shareUrl("https://shadewalk.app/", routes(), settings, start));
    expect(s.tab).toBe("route");
    expect(s.route).toEqual({
      k: "routes",
      origin: { kind: "point", at: start, label: null },
      dest,
      destName: "Dropped pin", // a link carries coordinates, never a name
    });
    expect(s.bootSelected).toBe(2);
    expect(s.leaveNow).toBe(false);
  });

  it("writes the destination, the clock and the preset the walk was planned with", () => {
    const url = shareUrl("https://x/", routes(), settings, start);
    expect(url).toContain("m=ab");
    expect(url).toContain("t=840");
    expect(url).toContain("p=maxShade");
    expect(url).toContain("e=8.70270%2C50.12910");
    expect(url).not.toContain("d="); // a loop length means nothing to an A→B link
  });

  it("carries the link-only settings a reader may not share", () => {
    const url = shareUrl("https://x/", routes(), { ...settings, city: "nyc", access: "wheelchair" }, null);
    // nyc's box rejects a Frankfurt pin, so a shared city link drops the start
    expect(url).toContain("c=nyc");
    expect(url).toContain("a=wheelchair");
  });

  it("is the loop link on the Wander tab", () => {
    const s = initialShell(14 * 60, "shade");
    s.tab = "wander";
    // W1: W0 has no loop to hand over and takes the plain branch instead
    s.wander = { k: "loops", origin: { kind: "gps" } };
    s.durationMin = 60;
    const url = shareUrl("https://x/", s, settings, start);
    expect(url).toContain("m=loop");
    expect(url).toContain("d=60");
    expect(url).not.toContain("e=");
    expect(url).toBe(
      loopShareUrl("https://x/", {
        city: "frankfurt",
        access: "stroller",
        avoidCobbles: false,
        pref: "shade",
        startMin: 14 * 60,
        durationMin: 60,
        start,
        selected: 0,
      })
    );
  });

  // CR-02 slice A review, F1: the address bar IS the only link off W0 (there
  // is no Share button there), and DECISIONS promises "the LENGTH survives".
  // It did so in-session and not across the refresh the sentence is about.
  it("keeps the loop length on W0, which has no loop", () => {
    const s = initialShell(14 * 60, "shade");
    s.tab = "wander";
    s.wander = { k: "idle" };
    s.durationMin = 90;
    const url = shareUrl("https://x/", s, settings, start);
    expect(url).toContain("sc=wander");
    expect(url).toContain("m=ab"); // no walk on this screen; `m` cannot name it
    expect(url).toContain("d=90");
    expect(url).not.toContain("e=");
    // and it comes back on W0, at 90, not at the 45 the shell boots with
    const back = reopen(url);
    expect(back.tab).toBe("wander");
    expect(back.wander).toEqual({ k: "idle" });
    expect(back.durationMin).toBe(90);
  });

  it("still writes no length for an A→B walk, which has no loop either", () => {
    expect(shareUrl("https://x/", routes(), settings, start)).not.toContain("d=");
  });

  it("has no destination to write from home, a place card or a walk that ended", () => {
    const s = initialShell(14 * 60, "shade");
    expect(shareUrl("https://x/", s, settings, start)).not.toContain("e=");
    s.route = { k: "arrived", destName: "Park", atMin: 900 };
    expect(shareUrl("https://x/", s, settings, start)).not.toContain("e=");
  });
});

// review B-3: the SHARE path pins the walk. Whatever the sender was planning
// with — their own setting, or the routes header's one-off chip — goes into
// the link, so the reader re-plans the same walk rather than their own.
describe("shareUrl — the walk's own access travels with it", () => {
  const start: [number, number] = [8.6821, 50.1109];
  const routes = (): ShellState =>
    reduce(initialShell(14 * 60, "shade"), { type: "routeTo", dest: [8.68, 50.12], name: "Park" });

  it("pins the settings' access and cobble wall when nothing is overridden", () => {
    const url = shareUrl("https://x/", routes(), DEFAULT_SETTINGS, start);
    expect(url).toContain("a=stroller");
    expect(url).toContain("ac=0");
  });

  it("pins a non-default setting the old rule would have written anyway", () => {
    const chair = { ...DEFAULT_SETTINGS, access: "wheelchair" as const, avoidCobbles: true };
    const url = shareUrl("https://x/", routes(), chair, start);
    expect(url).toContain("a=wheelchair");
    expect(url).toContain("ac=1");
  });

  it("pins the per-trip override, not the setting under it", () => {
    const s = reduce(routes(), { type: "trip", access: "walk", avoidCobbles: true });
    const url = shareUrl("https://x/", s, DEFAULT_SETTINGS, start);
    expect(url).toContain("a=walk");
    expect(url).toContain("ac=1");
  });

  it("re-plans the sender's walk for a reader whose own settings differ", () => {
    // the sender walks with a stroller over cobbles; the reader's stored
    // settings say wheelchair, no cobbles. Before B-3 the link carried
    // neither value and the reader silently got their own walk.
    const url = shareUrl("https://x/", routes(), DEFAULT_SETTINGS, start);
    const link = decodeState(qs(url));
    const reader: Settings = { ...DEFAULT_SETTINGS, access: "wheelchair", avoidCobbles: true };
    const pair = bootSettings(reader, link);
    expect(pair.session.access).toBe("stroller");
    expect(pair.session.avoidCobbles).toBe(false);
    // ...and none of it is written back
    expect(pair.persisted.access).toBe("wheelchair");
    expect(pair.persisted.avoidCobbles).toBe(true);
  });
});

// slice 6: W3's via and W2's "be back by" survive the round trip the way
// the rest of the walk does — a shared "loop via Günthersburgpark" has to
// open as one.
describe("shareUrl — a loop via a place, and the hour it comes back", () => {
  const VIA: [number, number] = [8.7027, 50.1291];

  function wanderState(): ShellState {
    return reduce(initialShell(14 * 60, "shade"), {
      type: "loopVia",
      via: { at: VIA, name: "Günthersburgpark" },
    });
  }

  it("writes v= and reopens on W3", () => {
    const url = shareUrl("https://shadewalk.app/", wanderState(), DEFAULT_SETTINGS, [8.678, 50.121]);
    expect(url).toContain("v=8.70270%2C50.12910");
    const back = reopen(url);
    expect(back.tab).toBe("wander");
    expect(back.wander.k).toBe("loops");
    // the link carries a coordinate and no word for it: the screen asks
    expect(back.trip.via).toEqual({ at: VIA, name: null });
  });

  it("writes bb= only when the length was picked as an hour", () => {
    const tile = reduce(wanderState(), { type: "duration", min: 60 });
    expect(shareUrl("https://x/", tile, DEFAULT_SETTINGS, null)).not.toContain("bb=");
    const hour = reduce(tile, { type: "duration", min: 75, backBy: 15 * 60 + 30 });
    const url = shareUrl("https://x/", hour, DEFAULT_SETTINGS, null);
    expect(url).toContain("bb=1530");
    expect(url).toContain("d=75");
    const back = reopen(url);
    expect(back.durationMin).toBe(75);
    expect(back.trip.backBy).toBe(15 * 60 + 30);
  });

  it("does not put a via on an A→B link", () => {
    const s: ShellState = {
      ...reduce(initialShell(14 * 60, "shade"), { type: "routeTo", dest: VIA, name: "park" }),
    };
    expect(shareUrl("https://x/", s, DEFAULT_SETTINGS, [8.678, 50.121])).not.toContain("v=");
  });
});
