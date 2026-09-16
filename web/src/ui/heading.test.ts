import { describe, expect, it } from "vitest";
import {
  compassHeading,
  deltaDeg,
  EASE_MS,
  easeHeading,
  motionHeading,
  MOVING_M_PER_S,
  normDeg,
  pickHeading,
  SNAP_DEG,
  turned,
} from "./heading";
import { initialShell, reduce } from "./shellState";

describe("normDeg", () => {
  it("wraps into [0, 360)", () => {
    expect(normDeg(0)).toBe(0);
    expect(normDeg(360)).toBe(0);
    expect(normDeg(-90)).toBe(270);
    expect(normDeg(725)).toBe(5);
  });
});

describe("motionHeading", () => {
  it("is the fix's heading while moving", () => {
    expect(motionHeading({ heading: 87, speed: 1.2 })).toBe(87);
  });

  it("is nothing while standing still — the phone's number is stale then", () => {
    expect(motionHeading({ heading: 87, speed: 0 })).toBeNull();
    expect(motionHeading({ heading: 87, speed: MOVING_M_PER_S })).toBeNull();
    expect(motionHeading({ heading: 87, speed: null })).toBeNull();
  });

  it("is nothing for the NaN a browser sends when it has no idea", () => {
    expect(motionHeading({ heading: NaN, speed: 1.2 })).toBeNull();
    expect(motionHeading({ heading: null, speed: 1.2 })).toBeNull();
    expect(motionHeading({ heading: 87, speed: NaN })).toBeNull();
  });

  it("normalises a heading a browser reports as 360", () => {
    expect(motionHeading({ heading: 360, speed: 1.2 })).toBe(0);
  });
});

describe("compassHeading", () => {
  it("takes iOS's webkitCompassHeading as it stands", () => {
    expect(compassHeading({ alpha: 200, absolute: false, webkitCompassHeading: 45 })).toBe(45);
  });

  it("turns an absolute alpha the other way round: alpha 90 is a heading of 270", () => {
    expect(compassHeading({ alpha: 90, absolute: true })).toBe(270);
    expect(compassHeading({ alpha: 0, absolute: true })).toBe(0);
    expect(compassHeading({ alpha: 360, absolute: true })).toBe(0);
  });

  it("refuses a relative alpha — measured from wherever the page loaded", () => {
    expect(compassHeading({ alpha: 90, absolute: false })).toBeNull();
    expect(compassHeading({ alpha: 90 })).toBeNull();
  });

  it("refuses an event with no alpha at all", () => {
    expect(compassHeading({ alpha: null, absolute: true })).toBeNull();
    expect(compassHeading({ alpha: NaN, absolute: true })).toBeNull();
  });
});

describe("pickHeading", () => {
  it("prefers the direction of travel to the way the phone points", () => {
    expect(pickHeading(10, 200)).toBe(10);
  });

  it("falls back to the compass, then to nothing", () => {
    expect(pickHeading(null, 200)).toBe(200);
    expect(pickHeading(null, null)).toBeNull();
  });

  it("does not mistake a heading of 0 for no heading", () => {
    expect(pickHeading(0, 200)).toBe(0);
  });
});

describe("turned", () => {
  it("counts anything as a turn from nothing", () => {
    expect(turned(null, 0, 2)).toBe(true);
  });

  it("measures the short way round", () => {
    expect(turned(359, 1, 2)).toBe(true);
    expect(turned(359, 0, 2)).toBe(false);
    expect(turned(10, 350, 25)).toBe(false);
  });
});

describe("deltaDeg", () => {
  it("is the short way round, signed", () => {
    expect(deltaDeg(359, 1)).toBe(2);
    expect(deltaDeg(1, 359)).toBe(-2);
    expect(deltaDeg(10, 100)).toBe(90);
    expect(deltaDeg(100, 10)).toBe(-90);
    expect(deltaDeg(0, 180)).toBe(180);
  });
});

describe("easeHeading", () => {
  const FRAME = 16;

  it("turns no further in no time", () => {
    expect(easeHeading(10, 100, 0)).toBe(10);
  });

  it("moves toward the target without overshooting", () => {
    const next = easeHeading(10, 100, FRAME);
    expect(next).toBeGreaterThan(10);
    expect(next).toBeLessThan(100);
  });

  it("snaps onto a target it is nearly on, so a loop can stop on equality", () => {
    expect(easeHeading(100 - SNAP_DEG / 2, 100, FRAME)).toBe(100);
    expect(easeHeading(359.95, 0, FRAME)).toBe(0);
  });

  it("goes the short way round through north and converges", () => {
    let cur = 350;
    let frames = 0;
    while (cur !== 10 && frames < 200) {
      cur = easeHeading(cur, 10, FRAME);
      frames++;
      // never the long way: always in [350, 360) or [0, 10]
      expect(cur >= 350 || cur <= 10).toBe(true);
    }
    expect(cur).toBe(10);
    // a 20° turn settles in well under a second of frames
    expect(frames).toBeLessThan(60);
  });

  it("is most of the way there after EASE_MS", () => {
    expect(easeHeading(0, 100, EASE_MS)).toBeGreaterThan(94);
    expect(easeHeading(0, 100, EASE_MS)).toBeLessThan(96);
  });

  it("converges on a target behind it too", () => {
    let cur = 200;
    for (let i = 0; i < 200 && cur !== 20; i++) cur = easeHeading(cur, 20, FRAME);
    expect(cur).toBe(20);
  });
});

describe("the gps action", () => {
  const s0 = initialShell(600, "shade");

  it("carries the fix's heading beside the fix", () => {
    const s = reduce(s0, { type: "gps", pos: [8.68, 50.11], heading: 42 });
    expect(s.gps).toEqual([8.68, 50.11]);
    expect(s.gpsHeading).toBe(42);
  });

  it("keeps the last heading on a fix that has none — a walker standing still still faces somewhere", () => {
    const s1 = reduce(s0, { type: "gps", pos: [8.68, 50.11], heading: 42 });
    const s2 = reduce(s1, { type: "gps", pos: [8.681, 50.11] });
    expect(s2.gpsHeading).toBe(42);
    const s3 = reduce(s2, { type: "gps", pos: [8.682, 50.11], heading: 50 });
    expect(s3.gpsHeading).toBe(50);
  });

  it("begins a walk with none: Start forgets the heading of the walk before", () => {
    const loops = { ...s0, tab: "wander" as const, wander: { k: "loops" as const } };
    const s1 = reduce(loops, { type: "gps", pos: [8.68, 50.11], heading: 42 });
    const s2 = reduce(s1, { type: "start" });
    expect(s2.wander.k).toBe("navigate");
    expect(s2.gpsHeading).toBeNull();
  });

  it("keeps it through a refusal, like the fix itself", () => {
    const s1 = reduce(s0, { type: "gps", pos: [8.68, 50.11], heading: 42 });
    const s2 = reduce(s1, { type: "gps", pos: null, denied: true });
    expect(s2.gps).toEqual([8.68, 50.11]);
    expect(s2.gpsHeading).toBe(42);
  });
});
