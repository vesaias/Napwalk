import { describe, expect, it } from "vitest";
import { FOCUSABLE, nextIndex, rovingStep } from "./focus";

describe("nextIndex", () => {
  it("walks forward and wraps at the end", () => {
    expect(nextIndex(3, 0, false)).toBe(1);
    expect(nextIndex(3, 1, false)).toBe(2);
    expect(nextIndex(3, 2, false)).toBe(0);
  });

  it("walks backward and wraps at the start", () => {
    expect(nextIndex(3, 2, true)).toBe(1);
    expect(nextIndex(3, 1, true)).toBe(0);
    expect(nextIndex(3, 0, true)).toBe(2);
  });

  // The panel itself takes focus on open (tabIndex -1) and is not in the
  // list, so the first Tab has to land somewhere sensible from nowhere.
  it("starts at either end when focus is on the panel", () => {
    expect(nextIndex(4, -1, false)).toBe(0);
    expect(nextIndex(4, -1, true)).toBe(3);
  });

  it("treats focus that has left the dialog as focus on the panel", () => {
    expect(nextIndex(4, 9, false)).toBe(0);
    expect(nextIndex(4, 9, true)).toBe(3);
  });

  // -1 means "leave the key alone": preventing default with nothing to focus
  // would trap the reader in a dialog with no way out but Escape.
  it("gives up on an empty dialog", () => {
    expect(nextIndex(0, -1, false)).toBe(-1);
    expect(nextIndex(0, 0, true)).toBe(-1);
  });

  it("keeps the only control focused", () => {
    expect(nextIndex(1, 0, false)).toBe(0);
    expect(nextIndex(1, 0, true)).toBe(0);
  });
});

describe("FOCUSABLE", () => {
  it("is a valid selector list that skips what cannot be tabbed to", () => {
    expect(FOCUSABLE).toContain("button:not([disabled])");
    expect(FOCUSABLE).toContain('[tabindex]:not([tabindex="-1"])');
    // one selector, not an accidental newline-joined pair
    expect(FOCUSABLE).not.toMatch(/\n/);
  });
});

describe("rovingStep", () => {
  it("moves right and down forwards, left and up backwards", () => {
    expect(rovingStep("ArrowRight", 0, 3)).toBe(1);
    expect(rovingStep("ArrowDown", 0, 3)).toBe(1);
    expect(rovingStep("ArrowLeft", 2, 3)).toBe(1);
    expect(rovingStep("ArrowUp", 2, 3)).toBe(1);
  });

  it("wraps at both ends, so the group cannot be walked out of", () => {
    expect(rovingStep("ArrowRight", 2, 3)).toBe(0);
    expect(rovingStep("ArrowLeft", 0, 3)).toBe(2);
  });

  it("owns no other key", () => {
    for (const key of ["Tab", "Enter", " ", "Home", "End", "Escape", "a"]) {
      expect(rovingStep(key, 1, 3), key).toBe(-1);
    }
  });

  it("answers -1 for an empty group, and treats an unknown index as the first", () => {
    expect(rovingStep("ArrowRight", 0, 0)).toBe(-1);
    expect(rovingStep("ArrowRight", -1, 3)).toBe(1);
    expect(rovingStep("ArrowLeft", 99, 3)).toBe(2);
  });
});
