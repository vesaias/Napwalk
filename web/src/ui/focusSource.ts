// Which device moved the focus (phone round 3, item 10).
//
// "Search field has now a green border on click; should be just no border,
// like Google Maps." — Viktor. He is right about the browser, not about the
// app: `:focus-visible` does NOT exclude a pointer click on a text field.
// The heuristic every engine implements says a text input that takes focus
// deserves a visible ring whatever put it there, because a caret without a
// ring is hard to find. That is true of a form; it is not true of a 52 px
// floating pill whose whole shape IS the control, and whose reader has just
// touched it.
//
// So the app has to say which it was. One attribute on `<body>`: set by the
// first Tab, cleared by the next pointer press, and read by exactly three
// selectors in index.css — the search pill, its read-only twin, and the
// input inside it. Everything else in the app keeps the ring on every
// `:focus-visible`, because nothing else is a text field: a button that a
// tap rings is a button the browser never rings in the first place.
//
// `:focus-visible:not(:hover)` is the trick this replaces. It is not
// reliable — a touch leaves a sticky hover on the pill it tapped, a stylus
// leaves none, and a keyboard reader whose pointer happens to rest over the
// field loses the ring they need.

/** The attribute this module owns. */
export const KBD_ATTR = "data-kbd";

/** Does this key mean "I am moving around with the keyboard"?
 *
 *  Tab, and Tab alone. Shift+Tab is the same key; the arrows are not — they
 *  move within a control (the segmented group's roving tabindex, a slider's
 *  value) rather than between them, and a reader who has never left the
 *  pointer behind should not have a ring appear under their thumb. Typing
 *  into the field the tap opened is not navigation either. */
export function isKeyboardNav(key: string): boolean {
  return key === "Tab";
}

/** Start watching. Returns the undo, so a test (or a future teardown) can
 *  put the document back. Both listeners are CAPTURING: a keydown the app
 *  stops (the sheet's own Tab trap, kit/focus.ts) must still be seen here. */
export function watchFocusSource(doc: Document = document): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (isKeyboardNav(e.key)) doc.body.setAttribute(KBD_ATTR, "");
  };
  const onPointer = () => doc.body.removeAttribute(KBD_ATTR);
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("pointerdown", onPointer, true);
  return () => {
    doc.removeEventListener("keydown", onKey, true);
    doc.removeEventListener("pointerdown", onPointer, true);
    doc.body.removeAttribute(KBD_ATTR);
  };
}
