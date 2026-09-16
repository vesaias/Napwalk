// How much of the phone the chrome is allowed to have (SPEC §3b, CR-01
// edit 10).
//
// The live phone build lost this argument by a wide margin: on a 402 × 700
// screen the header and the sheet between them took 69 % and the map was
// left with 31 % of the thing the app is for. So the budget is a rule with
// a number in it now, checked against what the browser actually laid out
// rather than against what the boards drew.
//
//   header + peek [+ tab bar]  ≤  46 % of the viewport
//   …and, on results with no tab bar, ≤ 40 %.
//
// When the compact card cannot fit inside that, it gives things up in the
// order SPEC §3b sets: the meters row first, then the Recommended tag. The
// minutes, the arrival and Start are never negotiable — they are the answer.
//
// Pure and DOM-free: the caller measures, this decides (sheetBudget.test.ts).
import { PEEK_MAX } from "./kit/sheetSnap";

/** What the compact recommended card is showing (kit/Cards.tsx).
 *  - `full` — both rows: minutes · tag · arrival, then name and meters.
 *  - `bars` — the meters row is gone, and the name with it.
 *  - `min`  — and the tag too, which is width rather than height, and the
 *    last thing left to give.
 *
 *  A two-rung ladder with a third rung that is only ever reached on
 *  FAILURE. `min` costs the same height as `bars` (see `CARD_H`), so the
 *  fitting loop below can never choose it — it is what `peekBudget` returns
 *  with `over: true`, when there is nothing left to give and the guard says
 *  so out loud. Said here rather than left to be rediscovered (CR-01
 *  review, F7); pinned by the last two cases in sheetBudget.test.ts. */
export type Density = "full" | "bars" | "min";

/** Everything in a peeking sheet that is not the card: 10 px of top
 *  padding, the handle's 4, two 8 px gaps, a 44 px button row and 10 px of
 *  bottom padding. Measured, not guessed — index.css puts these numbers in
 *  `.kit-sheet[data-snap="peek"]` and the phone reports 150 for `full`. */
export const PEEK_CHROME = 84;

/** The compact card's height at each density (index.css: 2 + 8 + 26 + 4 +
 *  16 + 8 + 2 = 66, and 2 + 8 + 26 + 8 + 2 = 46 without row 2). Dropping
 *  the tag costs no height at all — it buys the arrival line room on a
 *  narrow phone — so `min` and `bars` measure the same. */
export const CARD_H: Record<Density, number> = { full: 66, bars: 46, min: 46 };

/** The share of the viewport the chrome may have, with a tab bar under the
 *  sheet and without one. */
export const SHARE_ROOT = 0.46;
export const SHARE_RESULTS = 0.4;

/** The order things are given up in (SPEC §3b: "drop the bars row, then the
 *  tag"). */
const LADDER: Density[] = ["full", "bars", "min"];

export type Budget = {
  density: Density;
  /** What the sheet will measure at that density. */
  peekH: number;
  /** What the rule allows the sheet, once the header and the bar are paid
   *  for. Can be negative on an absurd viewport; the caller clamps. */
  allowed: number;
  /** Even the last rung does not fit — the guard has tripped, and there is
   *  nothing further to give. DEV says so out loud. */
  over: boolean;
};

/** The densest compact card that fits the budget, and the sheet height that
 *  comes with it. */
export function peekBudget(v: {
  innerHeight: number;
  /** The bottom edge of the screen's own header — the R4 panel, or the
   *  floating bar plus its chip row. */
  headerH: number;
  /** The tab bar's height, or 0 where it is hidden. Its presence is also
   *  what picks the share: a screen with a bar is a tab ROOT (46 %), one
   *  without it is a result (40 %). */
  tabBarH: number;
}): Budget {
  const share = v.tabBarH > 0 ? SHARE_ROOT : SHARE_RESULTS;
  // never more than the ceiling SPEC §3b sets for peek, however tall the
  // phone: a sheet is not entitled to 46 % of an iPad-sized viewport
  const allowed = Math.min(
    PEEK_MAX,
    Math.round(share * v.innerHeight) - v.headerH - v.tabBarH
  );
  for (const density of LADDER) {
    const peekH = PEEK_CHROME + CARD_H[density];
    if (peekH <= allowed) return { density, peekH, allowed, over: false };
  }
  const density: Density = "min";
  return { density, peekH: PEEK_CHROME + CARD_H[density], allowed, over: true };
}
