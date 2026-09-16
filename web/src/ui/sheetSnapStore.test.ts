import { describe, expect, it } from "vitest";
import {
  closeSheet,
  currentDensity,
  currentHasPeek,
  currentMoved,
  currentSnap,
  fullDensity,
  noSnap,
  openSheet,
  setDensity,
  setSnap,
  subscribeSnap,
} from "./sheetSnapStore";

describe("sheetSnapStore", () => {
  it("starts empty: no sheet, no rung for back to step down", () => {
    setSnap(null);
    expect(currentSnap()).toBe(null);
    expect(noSnap()).toBe(null);
  });

  it("publishes what the sheet on screen is resting at", () => {
    setSnap("peek");
    expect(currentSnap()).toBe("peek");
    setSnap("tall");
    expect(currentSnap()).toBe("tall");
    setSnap(null);
    expect(currentSnap()).toBe(null);
  });

  // CR-01 review F1: the back ladder has to tell a sheet with a rung under
  // it from one that is drawn whole at `default` and has none.
  it("carries whether the sheet on screen has a peek rung under it", () => {
    closeSheet();
    expect(currentHasPeek()).toBe(false);
    openSheet("peek", true);
    expect(currentSnap()).toBe("peek");
    expect(currentHasPeek()).toBe(true);
    // a gesture moves the rung, not the kind of sheet
    setSnap("default");
    expect(currentHasPeek()).toBe(true);
    closeSheet();
    expect(currentSnap()).toBe(null);
    expect(currentHasPeek()).toBe(false);
    // ...and a card publishes its snap for the tab bar without claiming one
    openSheet("default", false);
    expect(currentSnap()).toBe("default");
    expect(currentHasPeek()).toBe(false);
    closeSheet();
  });

  // S2 review, finding 6: the store has to tell the rung a sheet OPENED at
  // from one the reader moved it to, and carry that fact across the swap a
  // replan makes (kit/sheetSnap.ts `openRungFor`).
  it("carries whether the rung on screen is the reader's own", () => {
    closeSheet();
    expect(currentMoved()).toBe(false);
    openSheet("peek", true);
    expect(currentMoved(), "the rung a skeleton came up at is nobody's").toBe(false);
    setSnap("default");
    expect(currentMoved(), "a gesture is the reader's").toBe(true);
    // ...and the sheet that replaces it says whose the rung it inherited was
    closeSheet();
    expect(currentMoved()).toBe(false);
    openSheet("default", true, true);
    expect(currentMoved()).toBe(true);
    closeSheet();
    expect(currentMoved()).toBe(false);
  });

  it("forgets the rung when the last sheet goes, however it goes", () => {
    openSheet("default", true);
    setSnap(null);
    expect(currentHasPeek()).toBe(false);
    closeSheet();
  });

  it("tells its subscribers, and only when the value moves", () => {
    setSnap(null);
    let calls = 0;
    const off = subscribeSnap(() => {
      calls += 1;
    });
    setSnap("peek");
    setSnap("peek"); // the same snap twice is not a change
    expect(calls).toBe(1);
    setSnap("default");
    expect(calls).toBe(2);
    off();
    setSnap("peek");
    expect(calls).toBe(2);
    setSnap(null);
  });

  // CR-01 review F8: the density half decides whether a phone keeps the
  // meters on its compact card, and nothing tested it.
  it("publishes how much of the compact card the phone can afford", () => {
    setDensity("full");
    expect(currentDensity()).toBe("full");
    expect(fullDensity()).toBe("full");
    setDensity("bars");
    expect(currentDensity()).toBe("bars");
    setDensity("min");
    expect(currentDensity()).toBe("min");
    setDensity("full");
  });

  it("wakes the same subscribers for a density change, once per change", () => {
    setDensity("full");
    let calls = 0;
    const off = subscribeSnap(() => {
      calls += 1;
    });
    setDensity("bars");
    setDensity("bars"); // the same density twice is not a change
    expect(calls).toBe(1);
    setDensity("full");
    expect(calls).toBe(2);
    off();
    setDensity("bars");
    expect(calls).toBe(2);
    setDensity("full");
  });
});
