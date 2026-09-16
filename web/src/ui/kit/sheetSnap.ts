// What a drag, a flick or a tap on a sheet's handle means (compact UI slice
// 4, 2026-09-07). Pure and DOM-free: the Sheet reads pointers, this decides.
//
// SPEC §3b gives the sheet three resting places — peek (a compact card and
// a button row, at most 168 px), default (the height it is drawn at) and
// tall (the viewport minus the chrome above it) —
// and one rule per gesture: drag up goes one step up the ladder, drag down
// one step down, a tap toggles peek and default, and a flick down puts a
// non-modal sheet away. A modal sheet has no peek: the step below `default`
// is "gone", which is the same thing its ✕ and its scrim do.

/** The three resting places, bottom to top. */
export type Snap = "peek" | "default" | "tall";

/** The peek snap's CEILING (SPEC §3b, CR-01 edit 2). Peek is content-sized
 *  — the handle, one compact recommended card and one button row — and this
 *  is as tall as that content is ever allowed to get. Was 88 and a fixed
 *  height until the live phone review: one line of minutes told a reader
 *  nothing they could act on, and the sheet still ate a third of the map. */
export const PEEK_MAX = 168;

/** The chrome the tall snap stops under: the R4 header in a browser tab —
 *  8 + 36 + 3 + 36 + 6 + 30 + 8 = 127 — plus the 16 px of air SPEC §3b puts
 *  between the header's bottom edge and the top of the sheet. Installed the
 *  header grows, but so does the viewport it is measured against. */
export const TALL_TOP = 143;

/** How far a pointer must travel before it is a drag rather than a tap. */
export const DRAG_MIN = 24;

/** A flick: px per millisecond. Above this a downward gesture dismisses a
 *  sheet that can be dismissed, from whichever snap it started at. */
export const FLICK_V = 0.5;

/** One finished gesture, in pixels down (negative is up) and milliseconds. */
export type Drag = { dy: number; ms: number };

/** What the sheet should do about it. */
export type Gesture = { do: "snap"; snap: Snap } | { do: "dismiss" } | { do: "none" };

/** What kind of sheet is being dragged.
 *  - `modal` — R5, R6, W2, S2, S3: dimmed behind, and with no peek snap.
 *  - `dismissible` — the sheet has somewhere to go when it is pulled off
 *    the bottom of the screen (Place and Pin → Home, Arrived → Done). The
 *    routes and loops sheets have not: they are the screen. */
export type SheetKind = { modal: boolean; dismissible: boolean };

const UP: Record<Snap, Snap> = { peek: "default", default: "tall", tall: "tall" };
const DOWN: Record<Snap, Snap> = { tall: "default", default: "peek", peek: "peek" };
/** Tap toggles peek and default; from tall it comes back to default, which
 *  is the half of the toggle a reader at the top is asking for. */
const TAP: Record<Snap, Snap> = { peek: "default", default: "peek", tall: "default" };

export function up(snap: Snap): Snap {
  return UP[snap];
}

export function down(snap: Snap): Snap {
  return DOWN[snap];
}

/** Turn a wanted snap into what actually happens to this sheet. */
export function landing(target: Snap, from: Snap, kind: SheetKind): Gesture {
  // a modal sheet's peek is the exit (SPEC §4)
  if (target === "peek" && kind.modal) return { do: "dismiss" };
  if (target !== from) return { do: "snap", snap: target };
  // the ladder has no rung below this one: pulling down at peek is the way
  // out of a card that has one, and nothing at all for a sheet that is the
  // screen itself
  return from === "peek" && kind.dismissible ? { do: "dismiss" } : { do: "none" };
}

/** A finished drag on the handle. */
export function dragGesture(from: Snap, d: Drag, kind: SheetKind): Gesture {
  if (Math.abs(d.dy) < DRAG_MIN) return { do: "none" };
  if (d.dy > 0) {
    const v = d.ms > 0 ? d.dy / d.ms : Infinity;
    // a flick is the whole gesture at once: off the screen, if the sheet is
    // one that can leave. A modal sheet is left the way it was opened.
    if (v > FLICK_V && kind.dismissible && !kind.modal) return { do: "dismiss" };
    return landing(down(from), from, kind);
  }
  return landing(up(from), from, kind);
}

/** A tap on the handle. */
export function tapGesture(from: Snap, kind: SheetKind): Gesture {
  return landing(TAP[from], from, kind);
}

/** ArrowUp / ArrowDown on the handle — the same ladder, one rung a press.
 *  Any other key is not ours. */
export function keyGesture(from: Snap, key: string, kind: SheetKind): Gesture | null {
  if (key === "ArrowUp") return landing(up(from), from, kind);
  if (key === "ArrowDown") return landing(down(from), from, kind);
  return null;
}

/** How far the sheet follows the finger mid-drag. Down is free; up is not a
 *  place the sheet can go before it has snapped, so it resists. */
export function follow(dy: number): number {
  return dy < 0 ? Math.max(dy / 3, -40) : dy;
}

/** What the sheet a NEW sheet is replacing was doing, when there is one:
 *  the rung it was resting at, whether it had a rung under `default` at
 *  all, and whether the reader had MOVED it off the rung it came up at. */
export type OutgoingSheet = { snap: Snap; hasPeek: boolean; moved: boolean };

/** Which rung a sheet comes up at, and whether that rung is the reader's.
 *
 *  `openAt` is the answer for a sheet arriving on a screen that had none —
 *  but a replan swaps one sheet for another in the same slot (the results
 *  sheet for `Computing` and back), and a reader who raised the sheet to
 *  compare alternatives must not be dropped back to `peek` by changing one
 *  chip (CR-01 review, F3). So a sheet with a rung inherits the rung the
 *  sheet it is replacing was resting at.
 *
 *  One rung is not inherited: the SKELETON's `peek`, by a sheet that asks
 *  to open at `default`. That is the single-candidate answer (SPEC §3b's
 *  exception, backlog B12) — its peek would be a compact card with nothing
 *  to compare and no "N more" — and the rung it would inherit was never
 *  chosen by anybody. It is `Computing`'s own `openAt`, published by a
 *  skeleton that cannot know how many candidates are coming.
 *
 *  A peek the READER put the sheet at is a different fact, and it is kept
 *  (S2 review, finding 6; Viktor's ruling 2026-09-09). "Open at default"
 *  is about a plan's first sheet, not about every sheet of that plan: once
 *  a reader has pulled the single-candidate sheet down, a replan brings it
 *  back where they left it — the same rule F3 already gives two candidates.
 *  Hence `moved`, which travels with the rung from sheet to sheet
 *  (ui/sheetSnapStore.ts) rather than being reset by the swap. */
export function openRungFor(
  openAt: Snap,
  hasPeek: boolean,
  out: OutgoingSheet | null
): { rung: Snap; moved: boolean } {
  if (!hasPeek || out === null || !out.hasPeek) return { rung: openAt, moved: false };
  if (openAt === "default" && out.snap === "peek" && !out.moved) return { rung: openAt, moved: false };
  return { rung: out.snap, moved: out.moved };
}
