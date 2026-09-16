// Keyboard containment for a modal sheet (Task 16).
//
// A dialog that a reader can Tab out of is a dialog only to the eye: the
// focus ring walks off into the map behind it and every subsequent key goes
// somewhere invisible. Two halves live here. `nextIndex` is the pure one —
// given how many focusable things a dialog holds and which one has focus,
// where Tab goes next — and it is the half with a test. The other two read
// the DOM, which this project has no environment to test in (no jsdom), and
// are asserted end to end by the Playwright driver instead.

/** What counts as focusable inside a dialog. Deliberately narrow: the set of
 *  things the app actually renders, not every element that could be. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
  ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Where Tab goes, wrapping at both ends.
 *
 *  `current` is the index of the element that has focus, or -1 when focus is
 *  on the dialog panel itself — the panel takes focus on open and is not in
 *  the list, so the first Tab from it lands on the first control and
 *  Shift+Tab on the last. Returns -1 when there is nothing to focus at all,
 *  which means: leave the key alone. */
export function nextIndex(len: number, current: number, back: boolean): number {
  if (len <= 0) return -1;
  if (current < 0 || current >= len) return back ? len - 1 : 0;
  return back ? (current - 1 + len) % len : (current + 1) % len;
}

/** The focusable elements inside `root`, in document order, skipping the
 *  ones that are not rendered (a sheet that is closed but still mounted) and
 *  the ones a roving tabindex has taken out of the tab order.
 *
 *  `tabIndex >= 0` is the second half: `FOCUSABLE` matches every enabled
 *  button, and since slice 9 the segmented control inside a sheet is a radio
 *  group whose unselected options carry `tabindex="-1"` (kit/Segment.tsx).
 *  Without this the dialog's own Tab would walk through all three of them
 *  and undo the one tab stop the group is meant to be. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (e) => e.tabIndex >= 0 && e.getClientRects().length > 0
  );
}

/** Make everything outside `node` inert, and return the undo.
 *
 *  `inert` is one attribute that does what `aria-hidden` plus `tabindex=-1`
 *  plus a pointer-events guard used to take: the subtree leaves the
 *  accessibility tree, the tab order and the click path together. Walking up
 *  from the panel and marking each ancestor's *siblings* is what keeps the
 *  panel itself reachable — it is inside every subtree we skip.
 *
 *  `keep` stays reachable. The scrim is a sibling of the panel and closing
 *  on a tap outside is its whole job. */
export function inertOutside(node: Element, keep: readonly Element[] = []): () => void {
  const touched: HTMLElement[] = [];
  for (let el: Element | null = node; el && el.parentElement && el !== document.body; el = el.parentElement) {
    for (const sib of Array.from(el.parentElement.children)) {
      if (sib === el || keep.includes(sib) || !(sib instanceof HTMLElement)) continue;
      if (sib.inert) continue; // already inert under an outer dialog — not ours to undo
      sib.inert = true;
      touched.push(sib);
    }
  }
  return () => {
    for (const e of touched) e.inert = false;
  };
}

/** Where an arrow key moves inside a roving-tabindex group (slice 9 fix
 *  round), or -1 for a key the group does not own.
 *
 *  Both axes, because a segmented control is a row and the duration tiles
 *  wrap onto two: a reader who presses Down on a grid of four should not
 *  have to know which of the two the author had in mind. It wraps at both
 *  ends, which is what the WAI radio-group pattern asks for and what makes a
 *  single tab stop enough — there is no way to fall out of the group.
 *
 *  Pure, and here rather than in either component, because two controls now
 *  implement the same pattern and a second copy of `(i + n + len) % len` is
 *  a second place for it to be wrong. */
export function rovingStep(key: string, from: number, len: number): number {
  if (len <= 0) return -1;
  const by =
    key === "ArrowRight" || key === "ArrowDown"
      ? 1
      : key === "ArrowLeft" || key === "ArrowUp"
        ? -1
        : 0;
  if (by === 0) return -1;
  const at = from < 0 || from >= len ? 0 : from;
  return (at + by + len) % len;
}
