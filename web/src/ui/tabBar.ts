// Whether the bottom tab bar is on screen, and how tall it is when it is
// (CR-01 edit 5, SPEC §3b).
//
// The rule the CR writes is "visible only on tab ROOTS with the sheet at or
// below peek". Two halves, and both live here so that nothing has to be
// read off the DOM to answer the question:
//
//   - the SCREEN half: an A→B trip owns the whole phone from the routes
//     list on, and so does a walk on either tab and the search page. Those
//     screens never show the bar, at any snap.
//   - the SNAP half: a sheet raised past the rung it rests at wants the
//     bar's room. On the place and pin cards there is no peek rung at all —
//     they open at `default` and the boards draw the bar under them
//     (HB-place) — so only `tall` takes it away.
//
// Wander lost its snap half with CR-02 slice A. Its root is W0, which has no
// sheet at all, and W1 is a walk being chosen: SPEC §3 W1 reads "✕ always
// (→ W0)", and a ✕ and a tab bar are two answers to the same question. So
// the bar is on W0 and on no other Wander screen, at any snap.
//
// The bar's HEIGHT needs no plumbing of its own: `--sheet-h` is the sheet's
// top edge measured from the bottom of the viewport (kit/Sheet.tsx), and a
// sheet that peeks above the bar has the bar's height inside that number
// already. The map's fit padding and the locate button both hang off it, so
// both follow the bar in the frame the snap changes in — and both follow it
// back when the bar returns. Adding the measured bar a second time put the
// loops map 57 px out and the locate button 69 px above its own sheet
// (measured on the dev server, 2026-09-08).
import type { Snap } from "./kit/sheetSnap";
import type { ShellState } from "./shellState";

/** Route screens that take the whole phone: the search page covers the map,
 *  and from the routes list on there is a trip in progress and nowhere to
 *  put a tab bar (SPEC §3b, boards HB-routes / H-navigate / H-arrived). */
const FULL_SCREEN = new Set(["search", "routes", "navigate", "arrived"]);

/** The tab bar's visibility, from the screen and the snap alone. */
export function tabBarVisible(s: ShellState, snap: Snap | null): boolean {
  if (s.tab === "route" && FULL_SCREEN.has(s.route.k)) return false;
  if (s.tab === "wander") return s.wander.k === "idle";
  // Home, the place and pin cards, and Settings: a card is not a walk, and
  // the bar goes only when one is dragged to the top of the phone.
  return snap !== "tall";
}
