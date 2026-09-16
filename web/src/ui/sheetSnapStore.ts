// What the phone's one non-modal sheet is doing right now (CR-01 edits 2
// and 10) — the two facts about it that the parts of the shell OUTSIDE it
// have to know: which snap it is resting at, and how much the compact card
// in it is allowed to show.
//
// The snap is the sheet's own business right up until it isn't. Three
// things OUTSIDE the sheet depend on it:
//
//   - the browser's back gesture, which walks the LADDER before it walks
//     the screens — at `default` back puts the sheet down to `peek`, and
//     only from `peek` does it leave the screen (SPEC §3b). It asks
//     `currentHasPeek()` first: a sheet with no peek rung has no ladder to
//     walk and back leaves the screen straight away (CR-01 review, F1);
//   - the tab bar, which shows only under a sheet at `peek` (CR-01 edit 5);
//   - the budget guard, which sizes the compact card against the peek
//     height it measures (CR-01 edit 10).
//
// None of those is inside the sheet's subtree, and the first is not inside
// React at all — `popstate` fires on `window`. So the snap lives here: one
// value, because the phone shows exactly one non-modal sheet at a time (the
// tabs are exclusive, and Home and the search page have none), a set of
// subscribers for the components that render off it, and a plain getter for
// `useHistory`, which reads it from an event handler.
//
// `null` is "no sheet on screen" — Home, search, and the whole web surface,
// where a card is not a sheet and does not snap. It is what tells the back
// ladder that there is nothing to step down.
import { useSyncExternalStore } from "react";
import type { Snap } from "./kit/sheetSnap";
import type { Density } from "./sheetBudget";

let snap: Snap | null = null;
/** Does the sheet on screen HAVE a peek rung? The place and pin cards, the
 *  no-route card and the arrival open at `default` and have nothing under
 *  it — the back gesture must leave them whole rather than squeeze them
 *  into a peek height they were never drawn for (CR-01 review, F1). */
let hasPeek = false;
/** Has the reader MOVED the sheet on screen off the rung it came up at?
 *  A drag, a tap on the handle, an arrow key, "N more", or the back gesture
 *  putting the sheet down — every one of those goes through `setSnap`, and
 *  nothing else does. It travels from sheet to sheet with the rung
 *  (`openSheet`'s third argument) because a replan swaps one sheet for
 *  another and the reader's choice has to survive the swap; it is what
 *  tells the single-candidate answer's `default` from a peek the reader
 *  asked for (kit/sheetSnap.ts `openRungFor`; S2 review, finding 6). */
let moved = false;
let density: Density = "full";
const listeners = new Set<() => void>();

function announce(): void {
  for (const fn of listeners) fn();
}

/** For `useSyncExternalStore`. Returns the unsubscribe. */
export function subscribeSnap(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The snap on screen, or null when no sheet is. */
export function currentSnap(): Snap | null {
  return snap;
}

/** Server / first-render snapshot: there is no sheet before one mounts. */
export function noSnap(): Snap | null {
  return null;
}

/** Was the rung on screen chosen by the reader, rather than the one the
 *  sheet opened at? False when there is no sheet. */
export function currentMoved(): boolean {
  return moved;
}

/** Is there a rung under the sheet on screen? False when there is no sheet.
 *  Only the back ladder asks — the tab bar and the budget care about the
 *  snap itself, whatever kind of sheet published it. */
export function currentHasPeek(): boolean {
  return hasPeek;
}

/** A sheet comes up: the rung it opens at, and whether it has a peek rung
 *  to be put back down to (kit/Sheet.tsx, on mount).
 *
 *  One value serves the whole shell because the phone shows exactly one
 *  non-modal sheet at a time — the tabs are exclusive, Home and the search
 *  page have none, and a modal sheet keeps its own snap. That was an
 *  assumption the design rests on and nothing checked (CR-01 review, F10);
 *  in DEV a second one now says so, rather than silently overwriting the
 *  first one's rung. */
export function openSheet(at: Snap, peek: boolean, readers = false): void {
  if (import.meta.env.DEV && snap !== null) {
    console.warn(
      "[sheet snap] a second non-modal sheet opened while one was already on " +
        "screen. The store holds one snap for the whole shell (ui/sheetSnapStore.ts), " +
        "so the back ladder and the tab bar will now follow whichever mounted last."
    );
  }
  if (snap === at && hasPeek === peek && moved === readers) return;
  snap = at;
  hasPeek = peek;
  moved = readers;
  announce();
}

/** ...and goes away again. `null` is what tells the tab bar and the back
 *  ladder that there is no sheet on screen at all. */
export function closeSheet(): void {
  if (snap === null && !hasPeek && !moved) return;
  snap = null;
  hasPeek = false;
  moved = false;
  announce();
}

/** Publish a snap the sheet has moved to — a gesture, one of the two
 *  buttons that walk the ladder, or the back gesture putting the sheet
 *  down. The sheet itself does not change, so `hasPeek` does not either. */
export function setSnap(next: Snap | null): void {
  if (snap === next) return;
  snap = next;
  // every caller is a reader's own gesture: the handle, an arrow key,
  // "N more", or the back gesture putting the sheet down
  moved = next !== null;
  if (next === null) hasPeek = false;
  announce();
}

/** How much the compact card may show, from the budget the phone layout
 *  measures (ui/sheetBudget.ts). "full" everywhere the guard has not had to
 *  intervene — which is every phone the CR is written against. */
export function currentDensity(): Density {
  return density;
}

/** The first-render snapshot: nothing has been measured yet, so assume the
 *  card the boards draw. */
export function fullDensity(): Density {
  return "full";
}

export function setDensity(next: Density): void {
  if (density === next) return;
  density = next;
  announce();
}

/** For the two result screens, which pass it to their compact card. */
export function useSheetDensity(): Density {
  return useSyncExternalStore(subscribeSnap, currentDensity, fullDensity);
}

/** For the tab bar, the Wander header's ✕ and anything else outside the
 *  sheet that has to follow the ladder (CR-01 edit 5). `null` is "no sheet
 *  on screen". */
export function useSheetSnap(): Snap | null {
  return useSyncExternalStore(subscribeSnap, currentSnap, noSnap);
}
