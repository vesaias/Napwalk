import { describe, expect, it } from "vitest";
import {
  DRAG_MIN,
  dragGesture,
  follow,
  keyGesture,
  landing,
  openRungFor,
  tapGesture,
  type SheetKind,
  type Snap,
} from "./sheetSnap";

/** The routes sheet: it IS the screen, so it never leaves. */
const SCREEN: SheetKind = { modal: false, dismissible: false };
/** The place card: pulling it off the bottom goes back to Home. */
const CARD: SheetKind = { modal: false, dismissible: true };
/** The preference sheet: dimmed, and with no peek to rest at. */
const MODAL: SheetKind = { modal: true, dismissible: true };

const SLOW = 400; // ms — a deliberate drag, well under the flick threshold

describe("dragGesture", () => {
  it("walks up the ladder and stops at tall", () => {
    expect(dragGesture("peek", { dy: -60, ms: SLOW }, SCREEN)).toEqual({
      do: "snap",
      snap: "default",
    });
    expect(dragGesture("default", { dy: -60, ms: SLOW }, SCREEN)).toEqual({
      do: "snap",
      snap: "tall",
    });
    expect(dragGesture("tall", { dy: -60, ms: SLOW }, SCREEN)).toEqual({ do: "none" });
  });

  it("walks down the ladder and stops at peek", () => {
    expect(dragGesture("tall", { dy: 60, ms: SLOW }, SCREEN)).toEqual({
      do: "snap",
      snap: "default",
    });
    expect(dragGesture("default", { dy: 60, ms: SLOW }, SCREEN)).toEqual({
      do: "snap",
      snap: "peek",
    });
    expect(dragGesture("peek", { dy: 60, ms: SLOW }, SCREEN)).toEqual({ do: "none" });
  });

  it("ignores a gesture too small to be a drag", () => {
    expect(dragGesture("default", { dy: DRAG_MIN - 1, ms: 80 }, SCREEN)).toEqual({ do: "none" });
    expect(dragGesture("default", { dy: -(DRAG_MIN - 1), ms: 80 }, SCREEN)).toEqual({ do: "none" });
  });

  it("puts a card away with a second pull at peek", () => {
    expect(dragGesture("peek", { dy: 60, ms: SLOW }, CARD)).toEqual({ do: "dismiss" });
  });

  it("puts a card away on a flick, from any snap", () => {
    // 200 px in 100 ms is 2 px/ms, four times the threshold
    expect(dragGesture("tall", { dy: 200, ms: 100 }, CARD)).toEqual({ do: "dismiss" });
    expect(dragGesture("default", { dy: 200, ms: 100 }, CARD)).toEqual({ do: "dismiss" });
    // …but a slow drag of the same length is one rung, not the exit
    expect(dragGesture("default", { dy: 200, ms: 800 }, CARD)).toEqual({
      do: "snap",
      snap: "peek",
    });
  });

  it("does not flick a sheet that has nowhere to go", () => {
    expect(dragGesture("default", { dy: 200, ms: 100 }, SCREEN)).toEqual({
      do: "snap",
      snap: "peek",
    });
  });

  it("closes a modal sheet instead of peeking it", () => {
    expect(dragGesture("default", { dy: 60, ms: SLOW }, MODAL)).toEqual({ do: "dismiss" });
    expect(dragGesture("tall", { dy: 60, ms: SLOW }, MODAL)).toEqual({
      do: "snap",
      snap: "default",
    });
  });
});

describe("tapGesture", () => {
  it("toggles peek and default", () => {
    expect(tapGesture("default", SCREEN)).toEqual({ do: "snap", snap: "peek" });
    expect(tapGesture("peek", SCREEN)).toEqual({ do: "snap", snap: "default" });
  });

  it("brings a tall sheet back to default", () => {
    expect(tapGesture("tall", SCREEN)).toEqual({ do: "snap", snap: "default" });
  });

  it("closes a modal sheet, which has no peek", () => {
    expect(tapGesture("default", MODAL)).toEqual({ do: "dismiss" });
  });
});

describe("keyGesture", () => {
  it("is the same ladder", () => {
    expect(keyGesture("default", "ArrowUp", SCREEN)).toEqual({ do: "snap", snap: "tall" });
    expect(keyGesture("default", "ArrowDown", SCREEN)).toEqual({ do: "snap", snap: "peek" });
  });

  it("leaves every other key alone", () => {
    expect(keyGesture("default", "Enter", SCREEN)).toBeNull();
    expect(keyGesture("default", "ArrowLeft", SCREEN)).toBeNull();
  });
});

describe("landing", () => {
  it("never dismisses a sheet that is the screen", () => {
    expect(landing("peek", "peek", SCREEN)).toEqual({ do: "none" });
    expect(landing("peek", "default", SCREEN)).toEqual({ do: "snap", snap: "peek" });
  });
});

describe("follow", () => {
  it("gives way downwards and resists upwards", () => {
    expect(follow(120)).toBe(120);
    expect(follow(-120)).toBe(-40);
    expect(follow(-30)).toBe(-10);
  });
});

// The rung a sheet comes up at when it REPLACES one — the results sheet
// swapping in for the skeleton, and back again on every replan. Three
// facts have to hold at once, and until the S2 review (finding 6) nothing
// tested any of them (CR-01 edit 2 / review F3, backlog B12, and Viktor's
// 2026-09-09 ruling).
describe("openRungFor", () => {
  const skeleton = { snap: "peek", hasPeek: true, moved: false } as const;

  it("opens at its own rung when there is no sheet to replace", () => {
    expect(openRungFor("peek", true, null)).toEqual({ rung: "peek", moved: false });
    expect(openRungFor("default", true, null)).toEqual({ rung: "default", moved: false });
  });

  it("lifts the SKELETON's peek for a single-candidate answer (B12)", () => {
    // the skeleton cannot know how many candidates are coming, so its peek
    // was chosen by nobody; the answer opens whole. A 54 px jump, by design.
    expect(openRungFor("default", true, skeleton)).toEqual({ rung: "default", moved: false });
  });

  it("leaves the skeleton's peek alone for two or more (CR-01 edit 2)", () => {
    expect(openRungFor("peek", true, skeleton)).toEqual({ rung: "peek", moved: false });
  });

  it("keeps a rung the reader RAISED, through a replan (CR-01 review F3)", () => {
    for (const snap of ["default", "tall"] as const) {
      expect(openRungFor("peek", true, { snap, hasPeek: true, moved: true })).toEqual({
        rung: snap,
        moved: true,
      });
    }
  });

  it("keeps a peek the reader chose, even for a single candidate", () => {
    // The half the ruling turns over: "open at default" is about a plan's
    // FIRST sheet, not about every sheet of that plan. A reader who pulled
    // the single-candidate sheet down and then changed a chip was lifted
    // back to default on the parent — the same override F3 exists to stop.
    expect(openRungFor("default", true, { snap: "peek", hasPeek: true, moved: true })).toEqual({
      rung: "peek",
      moved: true,
    });
  });

  it("carries the reader's claim forward, so the NEXT swap keeps it too", () => {
    // the skeleton comes back between the two answers, and it is what the
    // second answer inherits from: the flag has to survive that hop
    const out = (r: { rung: Snap; moved: boolean }) => ({ ...r, snap: r.rung, hasPeek: true });
    const first = openRungFor("default", true, { snap: "peek", hasPeek: true, moved: true });
    const mid = openRungFor("peek", true, out(first));
    expect(mid).toEqual({ rung: "peek", moved: true });
    expect(openRungFor("default", true, out(mid))).toEqual({ rung: "peek", moved: true });
  });

  it("inherits nothing from a sheet with no rung under it, or without one itself", () => {
    // a place card, Home or the search page: `default` and no ladder
    const card = { snap: "default", hasPeek: false, moved: true } as const;
    expect(openRungFor("peek", true, card)).toEqual({ rung: "peek", moved: false });
    // ...and a sheet that has no peek of its own opens whole, whatever the
    // screen it is replacing was doing
    expect(openRungFor("default", false, { snap: "peek", hasPeek: true, moved: true })).toEqual({
      rung: "default",
      moved: false,
    });
  });
});
