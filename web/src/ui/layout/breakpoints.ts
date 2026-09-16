// Which frame the app wears (UI redesign Task 15, 2026-09-05).
//
// Two widths and one height, one rule. The numbers live here AND in
// index.css — CSS custom media queries are not a thing a browser reads, so
// `@media (min-width: 768px)` is written out there and checked against this
// file by a test. The landscape height needs no query of its own: this rule
// answers it and the shell wears the answer as `data-layout`.

export const BREAKPOINTS = {
  /** Below this the app is the phone frame: a full-bleed map with sheets. */
  web: 768,
  /** At and above this the card grows and a list earns a full-height panel. */
  desktop: 1440,
  /** At or below this HEIGHT, on a viewport at least as wide as it is tall,
   *  the app is on its side (SPEC §3b): the sheet has nowhere to peek from,
   *  so the answer moves to a left panel.
   *
   *  It is not a WIDTH gate — the S5 review's F3 ruling — because every
   *  phone from the iPhone X up is ≥ 812 css px wide on its side, and a
   *  `< 768` gate meant the frame never reached them. But it is not the
   *  height alone either: a portrait phone whose soft keyboard resizes the
   *  layout viewport (Android Chrome's default) is 390 × 444 and is not on
   *  its side. Short AND landscape is the whole rule; `sideways()` below
   *  states it, and `useMediaQuery.ts` mirrors it as a media query. */
  short: 500,
} as const;

/** Is this viewport a phone on its side — short, and wider than it is tall?
 *
 *  The orientation half is what keeps a soft keyboard out: 390 × 444 is a
 *  portrait phone with the keyboard up, and it must keep its bottom sheets
 *  and its modal report card rather than being handed a 300 px left panel
 *  and 66 px of map (found by the CR-03 regression run, `report-states`). */
export function sideways(width: number, height: number): boolean {
  return height <= BREAKPOINTS.short && width >= height;
}

export type Layout =
  | "phone"
  | "phone-landscape"
  | "tablet"
  | "desktop-card"
  | "desktop-panel";

/** `wantsPanel` is "this screen asks for the whole left edge" — the two
 *  lists of walks, Routes and Loops, and (SPEC §7) Steps, when Steps exists.
 *  Everything else — Home, a place card, a dropped pin, the walk itself,
 *  Settings — stays a floating card, so the map keeps the width it does not
 *  need.
 *
 *  The walk was briefly in this set (slice 8) because SPEC §7 puts the
 *  navigate banner at `left: 428` = the panel's 408 plus a gutter. But the
 *  board computes that for a panel holding the STEPS LIST, and Steps is out
 *  by the 2026-09-06 ruling: what shipped was 780 px of empty white with a
 *  47 px ETA bar at the bottom of it. The walk is a card again and the
 *  banner is offset from the card instead (slice 8 review, F2).
 *
 *  Settings left this set in the compact rework (2026-09-06, slice 1):
 *  board W-settings draws it as a content-height card with the City list as
 *  a second card beside it, not as a full-height panel. It is a page of
 *  short rows — a panel gave it 500 px of empty white under the last one.
 *
 *  `short` is `sideways()` above — "≤ 500 css px tall AND at least as wide
 *  as it is tall", the landscape phone (SPEC §3b, board CR-03 Q4). It is
 *  asked FIRST, before either width, and that is a ruling rather than a
 *  shortcut (S5 review F3, 2026-09-10).
 *
 *  It used to be asked only below 768 px wide, which meant the only phones
 *  that ever reached this frame were the ones ≤ 767 css px wide on their
 *  side: the SE, the 6/7/8 and the 8 Plus. Everything from the iPhone X up
 *  — 812, 844, 852, 896, 926/932, Android's 800 and 851 — went to the
 *  tablet card, whose Start button then sat 121 px below a 375 px fold.
 *  A phone on its side is a SHORT viewport, not a narrow one, so the width
 *  is no part of the rule — the ORIENTATION is the other half of it.
 *
 *  The collateral is a desktop window someone has squashed below 500 px
 *  tall: it now wears the landscape frame. That is accepted — the frame it
 *  gets is a 300 px panel and a map, which is a better answer for 480 px of
 *  height than a floating card with its buttons off-screen, and a browser
 *  window that short is a rounding error against every phone made since
 *  2017. `wantsPanel` cannot change it: a short viewport has no room for a
 *  full-height list either way. */
export function layoutFor(width: number, wantsPanel: boolean, short = false): Layout {
  if (short) return "phone-landscape";
  if (width < BREAKPOINTS.web) return "phone";
  if (width < BREAKPOINTS.desktop) return "tablet";
  return wantsPanel ? "desktop-panel" : "desktop-card";
}

/** The frames that are a card over the map — what `WebLayout` accepts. */
export type WebFrame = Exclude<Layout, PhoneFrame>;

/** The two frames a phone wears: upright, and on its side. */
export type PhoneFrame = "phone" | "phone-landscape";

/** Everything but the phone gets the card. A type guard, so the branch that
 *  reads true is the branch that may render `WebLayout`. */
export function isWeb(layout: Layout): layout is WebFrame {
  return layout !== "phone" && layout !== "phone-landscape";
}

/** ...and its complement, for the rules that are about the DEVICE rather
 *  than about the card: the shade default (plan/settings.ts) is off on a
 *  phone whichever way up it is being held. */
export function isPhone(layout: Layout): layout is PhoneFrame {
  return !isWeb(layout);
}
