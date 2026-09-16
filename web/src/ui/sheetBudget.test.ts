import { describe, expect, it } from "vitest";
import {
  CARD_H,
  PEEK_CHROME,
  peekBudget,
  SHARE_RESULTS,
  SHARE_ROOT,
} from "./sheetBudget";

/** The two phones the CR names, and the R4 / W1 headers this build lays
 *  out (measured 2026-09-08: 127 for the routes panel, 110 for the Wander
 *  bar and its chips, 57 for the tab bar). */
const R4_HEADER = 127;
const W1_HEADER = 110;
const TABBAR = 57;

describe("peekBudget (SPEC §3b)", () => {
  it("keeps the whole card on the phones the CR is written against", () => {
    for (const innerHeight of [700, 744, 844]) {
      const r4 = peekBudget({ innerHeight, headerH: R4_HEADER, tabBarH: 0 });
      expect(r4.density).toBe("full");
      expect(r4.over).toBe(false);
      expect(r4.peekH).toBe(PEEK_CHROME + CARD_H.full);
      const w1 = peekBudget({ innerHeight, headerH: W1_HEADER, tabBarH: TABBAR });
      expect(w1.density).toBe("full");
      expect(w1.over).toBe(false);
    }
  });

  it("holds the rule it is named for", () => {
    const r4 = peekBudget({ innerHeight: 700, headerH: R4_HEADER, tabBarH: 0 });
    expect(R4_HEADER + r4.peekH).toBeLessThanOrEqual(SHARE_RESULTS * 700);
    const w1 = peekBudget({ innerHeight: 700, headerH: W1_HEADER, tabBarH: TABBAR });
    expect(W1_HEADER + w1.peekH + TABBAR).toBeLessThanOrEqual(SHARE_ROOT * 700);
  });

  it("a tab bar buys the looser share, and pays for itself out of it", () => {
    const root = peekBudget({ innerHeight: 700, headerH: 100, tabBarH: 57 });
    // 0.46 × 700 = 322, less 100 and 57
    expect(root.allowed).toBe(165);
    const results = peekBudget({ innerHeight: 700, headerH: 100, tabBarH: 0 });
    // 0.40 × 700 = 280, less 100 — and clamped to the 168 ceiling SPEC §3b
    // puts on the peek snap however much room the rule would otherwise give
    expect(results.allowed).toBe(168);
  });

  it("drops the meters row before anything else", () => {
    // allowed 130..149 is where the full card (150) is out and the
    // bars-less one (130) fits: 0.40 × 700 = 280, less a 145 px header
    const tighter = peekBudget({ innerHeight: 700, headerH: 145, tabBarH: 0 });
    expect(tighter.allowed).toBe(135);
    expect(tighter.density).toBe("bars");
    expect(tighter.peekH).toBe(PEEK_CHROME + CARD_H.bars);
    expect(tighter.over).toBe(false);
  });

  // CR-01 review F7. `min` and `bars` are the same height — dropping the tag
  // buys width, not rows — so the fitting loop can never RETURN `min`. It
  // arrives only through the `over` path, and this is the assertion that
  // says so, so that giving `min` a real height later is a red test rather
  // than a silent change of meaning.
  it("has no fitting rung below `bars`: `min` only ever means `over`", () => {
    expect(CARD_H.min).toBe(CARD_H.bars);
    // every allowed height from absurd to negative, on both shares
    for (const headerH of [0, 60, 100, 130, 145, 160, 200, 400]) {
      for (const tabBarH of [0, 57]) {
        for (const innerHeight of [560, 620, 700, 744, 844]) {
          const b = peekBudget({ innerHeight, headerH, tabBarH });
          if (b.density === "min") expect(b.over, `${innerHeight}/${headerH}`).toBe(true);
          if (!b.over) expect(b.density === "full" || b.density === "bars").toBe(true);
        }
      }
    }
    // the case the old comment was mislabelled against: allowed 118, which
    // fits neither rung, so this is `over` and not a third fitting one
    const b = peekBudget({ innerHeight: 620, headerH: 130, tabBarH: 0 });
    expect(b.allowed).toBe(118);
    expect(b.density).toBe("min");
    expect(b.over).toBe(true);
  });

  it("gives up the tag last, and says so when even that is not enough", () => {
    // 390 × 560, the short viewport: 0.40 × 560 = 224, less the R4 header
    const short = peekBudget({ innerHeight: 560, headerH: R4_HEADER, tabBarH: 0 });
    expect(short.allowed).toBe(97);
    expect(short.density).toBe("min");
    expect(short.over).toBe(true);
    // …and the sheet is still a card and a button, never nothing
    expect(short.peekH).toBe(PEEK_CHROME + CARD_H.min);
  });
});
