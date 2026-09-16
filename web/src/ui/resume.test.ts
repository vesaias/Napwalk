// The pure half of the resume snapshot (ui/resume.ts): what a page load
// leaves behind, and what a stored snapshot is worth on the next one. No
// DOM — the hook that touches sessionStorage is ui/useResume.ts, and
// everything it decides is decided here.
import { describe, expect, it } from "vitest";
import {
  restore,
  screenId,
  snapshot,
  RESUME_MAX_AGE_MS,
  RESUME_VERSION,
  type Camera,
} from "./resume";
import { initialShell, reduce, type ShellState } from "./shellState";

const NOW = 1_757_073_600_000; // 2026-09-05T12:00:00Z, the suite's own day
const CAM: Camera = { center: [8.6821, 50.1109], zoom: 15.5, bearing: 40, pitch: 0 };
const URL_R4 = "m=ab&s=8.678,50.121&e=8.6948,50.13&t=840";
const CITY = "frankfurt";

function walkState(): ShellState {
  let s = initialShell(840, "shade");
  s = reduce(s, { type: "routeTo", dest: [8.6948, 50.13], name: "Park" });
  s = reduce(s, { type: "gps", pos: [8.678, 50.121] });
  s = reduce(s, { type: "start" });
  return s;
}

describe("screenId", () => {
  it("names a screen by the six parameters that identify it", () => {
    expect(screenId("?m=ab&s=8.678,50.121&e=8.6948,50.13&t=840&p=maxShade&a=walk&r=2")).toBe(
      "m=ab&s=8.678,50.121&e=8.6948,50.13&t=840",
    );
  });

  it("is blind to the order they were written in", () => {
    expect(screenId("?t=840&m=ab&e=1,2")).toBe(screenId("?m=ab&e=1,2&t=840"));
  });

  it("treats an empty parameter as a missing one", () => {
    expect(screenId("?m=ab&t=")).toBe(screenId("?m=ab"));
  });

  it("separates the two walking tabs, and Settings from both", () => {
    expect(screenId("?m=loop&d=45")).not.toBe(screenId("?sc=wander&d=45"));
    expect(screenId("?sc=settings")).not.toBe(screenId(""));
  });

  // A promoted candidate, a preference tap and an access override are all
  // the same screen with the same camera on it.
  it("survives a preference, an access override and a promotion", () => {
    expect(screenId("?m=ab&e=1,2&p=maxQuiet&a=stroller&ac=1&r=2")).toBe(
      screenId("?m=ab&e=1,2&p=balanced"),
    );
  });
});

describe("snapshot", () => {
  it("carries the view the URL cannot: camera, rung, pick and scrub", () => {
    let s = initialShell(840, "shade");
    s = reduce(s, { type: "routeTo", dest: [8.6948, 50.13], name: "Park" });
    s = reduce(s, { type: "select", i: 1 });
    s = reduce(s, { type: "scrub", min: 1_020 });
    const snap = snapshot(s, CAM, "tall", { url: URL_R4, city: CITY, now: NOW, startedAt: 0, following: false });
    expect(snap).toMatchObject({
      v: RESUME_VERSION,
      url: URL_R4,
      ts: NOW,
      selected: 1,
      snap: "tall",
      camera: CAM,
      scrub: 1_020,
      nav: null,
    });
  });

  it("is well under the 2 kB the backlog asks for", () => {
    const s = walkState();
    const bytes = new TextEncoder().encode(
      JSON.stringify(snapshot(s, CAM, "tall", { url: URL_R4, city: CITY, now: NOW, startedAt: NOW, following: false })),
    ).length;
    expect(bytes).toBeLessThan(2048);
  });

  it("records a walk in progress, with the last fix under it", () => {
    const snap = snapshot(walkState(), CAM, "peek", { url: URL_R4, city: CITY, now: NOW, startedAt: NOW - 60_000, following: true });
    expect(snap.nav).toEqual({ walking: true, startedAt: NOW - 60_000, lastFix: [8.678, 50.121] });
  });

  it("says nothing about a walk on a screen that is not being walked", () => {
    const s = reduce(walkState(), { type: "end" });
    expect(snapshot(s, CAM, "peek", { url: URL_R4, city: CITY, now: NOW, startedAt: NOW, following: false }).nav).toBe(null);
  });

  it("drops a camera whose centre is not a point MapLibre would take", () => {
    const bad = { ...CAM, center: [999, -999] as [number, number] };
    expect(snapshot(initialShell(840, "shade"), bad, null, { url: "", city: CITY, now: NOW, startedAt: 0, following: false }).camera).toBe(null);
  });
});

describe("restore", () => {
  const good = () => snapshot(walkState(), CAM, "tall", { url: URL_R4, city: CITY, now: NOW, startedAt: NOW, following: false });

  it("comes back on the URL it was taken on", () => {
    expect(restore(good(), URL_R4, CITY, NOW + 5_000)).toMatchObject({ snap: "tall", camera: CAM });
  });

  it("survives a round trip through JSON, which is how it is stored", () => {
    expect(restore(JSON.parse(JSON.stringify(good())), URL_R4, CITY, NOW)).toEqual(good());
  });

  it("never crosses to a different URL", () => {
    expect(restore(good(), "m=ab&e=9.9,50.0", CITY, NOW)).toBe(null);
    expect(restore(good(), "", CITY, NOW)).toBe(null);
  });

  it("expires", () => {
    expect(restore(good(), URL_R4, CITY, NOW + RESUME_MAX_AGE_MS - 1)).not.toBe(null);
    expect(restore(good(), URL_R4, CITY, NOW + RESUME_MAX_AGE_MS + 1)).toBe(null);
  });

  it("refuses a snapshot from the future — a clock put back is not a fresh one", () => {
    expect(restore(good(), URL_R4, CITY, NOW - 1)).toBe(null);
  });

  it("refuses another version of the shape", () => {
    expect(restore({ ...good(), v: RESUME_VERSION + 1 }, URL_R4, CITY, NOW)).toBe(null);
    expect(restore({ ...good(), v: undefined }, URL_R4, CITY, NOW)).toBe(null);
  });

  it("refuses what is not a snapshot at all", () => {
    for (const junk of [null, undefined, 7, "sw.resume", [], { url: URL_R4 }]) {
      expect(restore(junk, URL_R4, CITY, NOW)).toBe(null);
    }
  });

  // sessionStorage is same-origin, but it is still not the app's own memory:
  // a coordinate off it reaches MapLibre, and one bad centre is a thrown
  // "Invalid LngLat" inside a render.
  it("validates every field rather than trusting it", () => {
    const hostile = {
      ...good(),
      selected: 99,
      snap: "enormous",
      camera: { center: [999, -999], zoom: 15, bearing: 0, pitch: 0 },
      scrub: "noon",
      nav: { walking: true, startedAt: "soon", lastFix: [0, 200] },
    };
    expect(restore(hostile, URL_R4, CITY, NOW)).toEqual({
      v: RESUME_VERSION,
      url: URL_R4,
      city: CITY,
      ts: NOW,
      selected: 0,
      snap: null,
      camera: null,
      scrub: null,
      following: false,
      nav: { walking: true, startedAt: 0, lastFix: null },
    });
  });

  it("drops a camera with an angle no map has", () => {
    const tipped = { ...good(), camera: { ...CAM, pitch: 400 } };
    expect(restore(tipped, URL_R4, CITY, NOW)!.camera).toBe(null);
  });

  it("reads a walk that was not walking as no walk", () => {
    expect(restore({ ...good(), nav: { walking: false } }, URL_R4, CITY, NOW)!.nav).toBe(null);
  });
});

// S6 review, finding 1. `screenId` cannot answer this: a city picked in the
// Settings sheet never reaches the URL, so `?m=ab` in Frankfurt and `?m=ab`
// in Paris are the same six parameters — and the Frankfurt camera landed in
// the far north-east corner of Paris's bounds, turned 44°.
describe("restore across cities", () => {
  const good = () =>
    snapshot(walkState(), CAM, "tall", {
      url: URL_R4,
      city: CITY,
      now: NOW,
      startedAt: NOW,
      following: false,
    });

  it("comes back in the city it was taken in", () => {
    expect(restore(good(), URL_R4, "frankfurt", NOW)).not.toBe(null);
  });

  it("never crosses to another one, however recent, however bare the URL", () => {
    expect(restore(good(), URL_R4, "paris", NOW)).toBe(null);
    const bare = snapshot(initialShell(840, "shade"), CAM, null, {
      url: "m=ab",
      city: "frankfurt",
      now: NOW,
      startedAt: 0,
      following: false,
    });
    expect(restore(bare, "m=ab", "frankfurt", NOW)).not.toBe(null);
    expect(restore(bare, "m=ab", "paris", NOW)).toBe(null);
  });

  it("refuses a snapshot that names no city, or one the registry does not", () => {
    expect(restore({ ...good(), city: undefined }, URL_R4, CITY, NOW)).toBe(null);
    expect(restore({ ...good(), city: "atlantis" }, URL_R4, CITY, NOW)).toBe(null);
    expect(restore({ ...good(), city: 7 }, URL_R4, CITY, NOW)).toBe(null);
  });
});

// S6 review, finding 2, and the ruling on deviation 9.
describe("restore of following", () => {
  const withFollowing = (following: boolean) =>
    snapshot(walkState(), CAM, "peek", {
      url: URL_R4,
      city: CITY,
      now: NOW,
      startedAt: NOW,
      following,
    });

  it("carries whether the map was following the walker", () => {
    expect(withFollowing(true).following).toBe(true);
    expect(restore(withFollowing(true), URL_R4, CITY, NOW)!.following).toBe(true);
    expect(restore(withFollowing(false), URL_R4, CITY, NOW)!.following).toBe(false);
  });

  it("reads anything that is not true as false — a v1 snapshot included", () => {
    for (const v of [undefined, null, 1, "yes", {}]) {
      expect(restore({ ...withFollowing(true), following: v }, URL_R4, CITY, NOW)!.following).toBe(
        false,
      );
    }
  });
});
