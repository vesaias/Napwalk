import { describe, expect, it } from "vitest";
import { isKeyboardNav } from "./focusSource";

describe("isKeyboardNav (round 3, item 10)", () => {
  it("is Tab, and Tab alone", () => {
    expect(isKeyboardNav("Tab")).toBe(true);
  });

  it("is not the keys that move inside a control, or type into one", () => {
    for (const k of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Enter", " ", "a", "Escape"]) {
      expect(isKeyboardNav(k), k).toBe(false);
    }
  });
});
