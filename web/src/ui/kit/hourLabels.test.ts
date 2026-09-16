// The one rule the redesigned strip has (2026-09-16): the bars always fill
// the row, and only the LABELS thin out — by measured column width, never by
// a bar count. Pure arithmetic, so it is tested here rather than screenshot.
import { describe, it, expect } from "vitest";
import { BAR_GAP, BAR_MIN, columnWidth, labelEvery } from "./hourLabels";

/** The two strips this app actually draws: the phone sheet (390 − 2 × 16)
 *  and the 1440 desktop panel (408 − 2 × 20). */
const PHONE = 358;
const PANEL = 368;

describe("columnWidth", () => {
  it("shares the row, gaps counted out first", () => {
    // 13 bars on a phone: (358 − 12 × 4) / 13
    expect(columnWidth(13, PHONE)).toBeCloseTo((PHONE - 12 * BAR_GAP) / 13, 5);
    expect(columnWidth(0, PHONE)).toBe(0);
  });

  it("never goes below the floor a bar needs to be a bar", () => {
    expect(columnWidth(60, 100)).toBe(BAR_MIN);
  });
});

describe("labelEvery", () => {
  it("labels every hour for the days this app draws", () => {
    // London's 14 and Frankfurt's 13 are the case the redesign exists for:
    // one chart, one label rule, on both surfaces.
    for (const w of [PHONE, PANEL]) {
      expect(columnWidth(13, w)).toBeGreaterThanOrEqual(20);
      expect(columnWidth(14, w)).toBeGreaterThanOrEqual(20);
      expect(labelEvery(13, w)).toBe(1);
      expect(labelEvery(14, w)).toBe(1);
    }
  });

  it("thins to every second hour on a June day", () => {
    // 17 bars — Frankfurt on 21 June — is 17.3 px a column on a phone: the
    // bars still fit (they are wider than the 6 px floor), the labels do not.
    expect(columnWidth(17, PHONE)).toBeGreaterThan(BAR_MIN);
    expect(columnWidth(17, PHONE)).toBeLessThan(20);
    expect(labelEvery(17, PHONE)).toBe(2);
    expect(labelEvery(17, PANEL)).toBe(2);
  });

  it("thins to every third only where even that would collide", () => {
    // the thresholds themselves, at the exact column width each names
    const at = (col: number, count: number) => count * col + BAR_GAP * (count - 1);
    expect(labelEvery(10, at(20, 10))).toBe(1);
    expect(labelEvery(10, at(19.9, 10))).toBe(2);
    expect(labelEvery(10, at(12, 10))).toBe(2);
    expect(labelEvery(10, at(11.9, 10))).toBe(3);
    // a 13-bar day crushed into a 200 px column — the narrow landscape rail
    expect(labelEvery(13, 200)).toBe(3);
  });

  it("assumes the roomy case until the strip has been measured", () => {
    // the first render, before the layout effect reads a width: labels under
    // every hour, corrected in the same frame rather than flashed at the
    // reader the other way round.
    expect(labelEvery(17, 0)).toBe(1);
    expect(labelEvery(17, -1)).toBe(1);
  });
});
