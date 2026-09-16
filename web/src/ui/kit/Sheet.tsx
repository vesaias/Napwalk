import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  closeSheet,
  currentHasPeek,
  currentMoved,
  currentSnap,
  noSnap,
  openSheet,
  setSnap,
  subscribeSnap,
} from "../sheetSnapStore";
import { focusables, inertOutside, nextIndex } from "./focus";
import { SurfaceCtx, type SheetSurface } from "./sheetSurface";
import {
  dragGesture,
  follow,
  keyGesture,
  openRungFor,
  tapGesture,
  DRAG_MIN,
  TALL_TOP,
  type Gesture,
  type SheetKind,
  type Snap,
} from "./sheetSnap";

export type { Snap } from "./sheetSnap";
export type { SheetSurface } from "./sheetSurface";

/** Tell every sheet below which container it is in (kit/sheetSurface.ts). */
export function SheetSurfaceProvider({
  surface,
  children,
}: {
  surface: SheetSurface;
  children: ReactNode;
}) {
  return <SurfaceCtx.Provider value={surface}>{children}</SurfaceCtx.Provider>;
}

/** How the shell learns how much of the phone the sheet is covering — the
 *  map's bottom fit padding and the locate button both hang off it, and both
 *  have to follow the snap (compact UI slice 4). Only the phone's own
 *  non-modal sheet reports: a modal one is a temporary lid, not a floor. */
const HeightCtx = createContext<((px: number) => void) | null>(null);

export function SheetHeightProvider({
  onHeight,
  children,
}: {
  onHeight: (px: number) => void;
  children: ReactNode;
}) {
  return <HeightCtx.Provider value={onHeight}>{children}</HeightCtx.Provider>;
}

type SheetProps = {
  open: boolean;
  /** Dim the map behind, close on a tap outside or Escape, and behave as a
   *  dialog: focus moves in on open, cycles inside while it is up, and goes
   *  back to the opener on close or unmount. Everything behind it is inert
   *  meanwhile. A modal sheet has no peek snap: the rung below `default` is
   *  the way out (SPEC §4). */
  modal?: boolean;
  onClose?: () => void;
  /** A drag or a flick off the bottom of the screen leaves this sheet
   *  altogether: the place card and the dropped pin go back to Home, the
   *  arrival to Done (SPEC §4). Without it the sheet rests at peek instead —
   *  the routes and loops sheets ARE their screen and have nowhere to go.
   *  A modal sheet falls back to `onClose`. */
  onDismiss?: () => void;
  /** Accessible name for the dialog — required in spirit whenever `modal`
   *  is set, since the sheet's own title is just one of its children. */
  label?: string;
  /** Accessible name for the drag handle, from the catalog ("Resize"). */
  handleLabel?: string;
  /** What the sheet shows at the peek snap, in place of `children`: the
   *  compact recommended card and the one button row worth keeping (SPEC
   *  §3b). Without it the children are simply clipped to the peek ceiling. */
  peek?: ReactNode;
  /** What the sheet has room for once it is dragged up — added after the
   *  children rather than replacing them (SPEC §4: the routes sheet's tall
   *  snap is its cards AND the hour profile). Without it the tall snap only
   *  raises the ceiling, which is all a sheet whose content already fits
   *  needs. */
  tall?: ReactNode;
  /** Where the tall snap stops — the height of the chrome above the sheet.
   *  Defaults to the R4 header plus the app's top inset. */
  headerH?: number;
  /** Drive the snap from outside; without it the sheet owns its own. */
  snap?: Snap;
  onSnap?: (snap: Snap) => void;
  /** Which snap the sheet OPENS at (CR-01 edit 2). The results sheets and
   *  the computing skeleton open at `peek`, so the map keeps the top two
   *  thirds of the phone and the answer is one line and one button until
   *  the reader asks for more; everything else opens at `default`. */
  openAt?: Snap;
  /** A tab bar sits under this sheet: pad the bottom to 90 px so the last
   *  row clears it. */
  tabBar?: boolean;
  /** Web only, and only for a modal sheet: draw it as a second card beside
   *  the first one rather than as a centred dialog over the page
   *  (board W-settings — the City list sits to the right of the Settings
   *  card). It is still a dialog: labelled, Escape closes it, focus moves
   *  in and back out, everything behind it is inert. Only the scrim
   *  changes, from a dim to a plain click-catcher, because the card it
   *  belongs to has to stay readable next to it. On the phone the flag does
   *  nothing: there is no room for a second card, so it is a bottom sheet. */
  side?: boolean;
  children: ReactNode;
};

/** The bottom sheet every screen hangs its content in. Rounded 20 px at the
 *  top, a 36×4 grab handle, and it slides in over --m-sheet (instantly when
 *  the reader asked for reduced motion).
 *
 *  Since slice 4 the handle is the sheet's control rather than an ornament:
 *  it drags between the three snaps of SPEC §3b (peek / default / tall),
 *  taps between peek and default, takes ArrowUp and ArrowDown from a
 *  keyboard, and flicks a card off the bottom of the screen. What each
 *  gesture MEANS is decided in sheetSnap.ts; what is left here is the
 *  pointer bookkeeping.
 *
 *  On the web surface it is neither: an inline sheet is a block in the card,
 *  always visible — `open` is the phone's way of getting out from under a
 *  modal, and in a card there is nothing to get out of the way of. Cards and
 *  panels are fixed, so no handle is drawn and no snap applies. */
export function Sheet({
  open,
  modal,
  onClose,
  onDismiss,
  label,
  handleLabel,
  peek,
  tall,
  headerH = TALL_TOP,
  snap: snapProp,
  onSnap,
  openAt = "default",
  tabBar,
  side,
  children,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  // A sheet in the landscape rail is laid out exactly like one in a card.
  const web = useContext(SurfaceCtx) !== "sheet";
  const report = useContext(HeightCtx);
  const inline = web && !modal;
  const shown = inline ? true : open;

  const [ownSnap, setOwnSnap] = useState<Snap>(openAt);
  /** The phone's one non-modal sheet publishes its snap outside React's
   *  tree (ui/sheetSnapStore.ts): the back gesture and the tab bar need it,
   *  and neither is under this component. A modal sheet, a web card and a
   *  sheet driven by an explicit `snap` prop keep their own. */
  const shared = useSyncExternalStore(subscribeSnap, currentSnap, noSnap);
  const held = !web && !modal && snapProp === undefined;
  /** A sheet with a `peek` of its own has a rung under `default`; one
   *  without it — the place and pin cards, no-route, the arrival — does
   *  not, and the back gesture must not try to put it down (CR-01 review,
   *  F1). The store carries this beside the snap. */
  const hasPeek = peek !== undefined;
  /** Which rung this sheet OPENS at, and whether that rung is the reader's
   *  own — the whole rule lives in `kit/sheetSnap.ts` (`openRungFor`), so
   *  what is left here is reading the store. Read during the first render,
   *  which is before the outgoing sheet's cleanup clears it; a card, Home
   *  or the search page publishes no rung to inherit, so the results still
   *  open at their own `openAt` when a walk is planned from one. */
  const [opened] = useState(() => {
    const cur = currentSnap();
    const out =
      held && cur !== null
        ? { snap: cur, hasPeek: currentHasPeek(), moved: currentMoved() }
        : null;
    return openRungFor(openAt, hasPeek, out);
  });
  const openRung = opened.rung;
  const snap = web ? "default" : (snapProp ?? (held ? (shared ?? openRung) : ownSnap));
  const kind: SheetKind = {
    modal: Boolean(modal),
    dismissible: Boolean(onDismiss) || Boolean(modal),
  };

  /** Live pointer offset while a drag is in flight, 0 the rest of the time. */
  const [dy, setDy] = useState(0);
  const drag = useRef<{ id: number; y: number; t: number; moved: boolean } | null>(null);
  /** A drag ends with a click event the browser owes the button; the handle
   *  must not read it as a tap on top of the drag it just finished. */
  const dragged = useRef(false);
  /** Where the sheet's top edge was on the last settled render, and how far
   *  the finger had carried it when it let go — the two numbers the snap
   *  animation below is made of. */
  const wasTop = useRef<number | null>(null);
  const lastDy = useRef(0);
  const wasSnap = useRef<Snap>(snap);

  const leave = onDismiss ?? onClose;

  const act = (g: Gesture) => {
    if (g.do === "snap") {
      if (held) setSnap(g.snap);
      else if (snapProp === undefined) setOwnSnap(g.snap);
      onSnap?.(g.snap);
    } else if (g.do === "dismiss") {
      leave?.();
    }
  };

  // Opening AT a snap, and saying so. The sheet announces the rung it came
  // up at — and whether it has one under that — and takes both back off the
  // shell when it goes: a screen with no sheet reports `null`, which is what
  // tells the tab bar and the back ladder there is nothing to step down.
  useEffect(() => {
    if (!held) return;
    openSheet(opened.rung, hasPeek, opened.moved);
    return () => closeSheet();
  }, [held, opened, hasPeek]);

  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // A modal sheet takes focus so the keyboard lands inside it, makes
  // everything behind it inert so neither Tab nor a screen reader can reach
  // it, and hands focus back to whatever opened it when it goes away.
  //
  // The undo lives in the effect's cleanup rather than in a "was open"
  // branch, which is what makes it fire on UNMOUNT too: the sheets added
  // since Task 12 are rendered conditionally and never see `open` go false
  // (Task 15 left this open). The scrim is exempt from `inert` — a tap on it
  // is the other way out of the dialog.
  useEffect(() => {
    if (!modal || !open) return;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement ? active : null;
    const panel = panelRef.current;
    panel?.focus();
    const undo = panel && inertOutside(panel, scrimRef.current ? [scrimRef.current] : []);
    return () => {
      if (undo) undo();
      opener?.focus();
    };
  }, [open, modal]);

  // How much of the bottom of the phone this sheet owns — its top edge, not
  // its height: a peeking sheet rests ON the tab bar rather than over it, and
  // the floor the map has to clear is everything below that edge. Measured
  // rather than computed, because the default snap is whatever the content
  // came out at. A layout effect gets the first value into the shell in the
  // same frame the sheet appears, so the map fits once instead of twice; the
  // observer catches every change after that.
  const measures = !web && !modal && report !== null;
  /** The sheet's LAID-OUT top edge, not its painted one: `offsetTop` is what
   *  the CSS resolved, and unlike `getBoundingClientRect()` it does not
   *  include the `transform` the snap animation and the drag put on the
   *  panel. Reading the rect published the edge the sheet was travelling
   *  FROM, one snap stale for the whole transition and never corrected —
   *  which at the tall snap left the locate button 125 px under the sheet it
   *  was meant to ride 12 px above (slice 8 review, F1). Everything here is
   *  laid out against the shell, which is the viewport, so the offset parent
   *  and `window` agree; the fallback is for a panel not yet in a positioned
   *  ancestor. */
  const measure = useCallback(() => {
    const panel = panelRef.current;
    if (!panel || !report) return;
    const parent = panel.offsetParent;
    const floor = parent instanceof HTMLElement ? parent.clientHeight : window.innerHeight;
    report(Math.round(floor - panel.offsetTop));
  }, [report]);

  useLayoutEffect(() => {
    if (!measures) return;
    measure();
    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === "undefined") return () => report?.(0);
    const ro = new ResizeObserver(measure);
    ro.observe(panel);
    // A snap can change the sheet's edge without changing its box — `tall`
    // is a ceiling, `peek` a height — and the transition means the browser
    // is still moving it when the observer fires. Re-read when the slide
    // ends, so the published height is the one the sheet came to rest at.
    const settled = (e: TransitionEvent) => {
      if (e.propertyName === "transform") measure();
    };
    panel.addEventListener("transitionend", settled);
    return () => {
      panel.removeEventListener("transitionend", settled);
      ro.disconnect();
      report?.(0);
    };
  }, [measures, measure, report]);

  // ...and the snap itself publishes its target in the frame it changes in,
  // rather than waiting for the observer's next delivery: `offsetTop` is
  // already the new edge here, because the FLIP transform below is a paint,
  // not a layout.
  useLayoutEffect(() => {
    if (measures) measure();
  }, [snap, measures, measure]);

  // Walking the ladder is a MOVE, and a move has to be seen (SPEC §4:
  // "animate with motion.sheet, respect reduced motion"). The three snaps are
  // heights, and a height cannot be transitioned from `auto`, so the sheet is
  // animated the way a layout change always is: measure the edge it was at,
  // put it back there with a transform, and let the CSS transition on
  // `transform` carry it to the edge it is at now. Nothing is animated while
  // a finger is down — the sheet is following it — and nothing is animated
  // under `prefers-reduced-motion`, because clearing the inline transition
  // hands the property back to the stylesheet, where that query has already
  // turned it off. (Fix round 1, F2.)
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || web) return;
    if (!shown) {
      wasTop.current = null; // a closed sheet is parked off-screen
      return;
    }
    if (dy !== 0) return; // mid-drag: the transform belongs to the finger
    const top = panel.getBoundingClientRect().top;
    const from = wasTop.current === null ? null : wasTop.current + follow(lastDy.current);
    const climbed = wasSnap.current !== snap;
    wasTop.current = top;
    wasSnap.current = snap;
    lastDy.current = 0;
    // only the ladder is animated. The sheet's edge also moves when its
    // CONTENT changes height — a plan landing, a warning appearing — and
    // sliding the whole sheet for that would animate the wrong thing.
    if (!climbed || from === null || Math.abs(from - top) < 1) return;
    panel.style.transition = "none";
    panel.style.transform = `translateY(${from - top}px)`;
    void panel.offsetHeight; // let the browser see the old edge…
    panel.style.transition = "";
    panel.style.transform = ""; // …and then travel from it
  });

  /** Tab and Shift+Tab cycle inside the dialog instead of walking out of it.
   *  Keys bubble from the controls to the panel, so one handler covers all
   *  of them; `nextIndex` (kit/focus.ts) decides where they go. */
  const trap = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const list = focusables(panel);
    const i = nextIndex(
      list.length,
      list.indexOf(document.activeElement as HTMLElement),
      e.shiftKey
    );
    if (i < 0) return; // nothing to focus: leave the key alone
    e.preventDefault();
    list[i].focus();
  };

  /** A gesture is timed on `performance.now()` rather than on the events'
   *  own `timeStamp`. The two agree on any machine with a steady clock, and
   *  where they do not, `timeStamp` is the one that lies: the container the
   *  e2e suite runs in hands out timestamps that go BACKWARDS between one
   *  pointer event and the next (a move at 2183 followed by a move at 2167,
   *  observed 2026-09-07), and a negative elapsed clamped to 1 ms turns a
   *  slow pull into a flick — which silently dismisses a card the reader was
   *  only shuffling. `performance.now()` is monotonic by definition. It reads
   *  when the app SAW the event rather than when the browser made it, so a
   *  janky frame can make a real flick read as a drag; that way round the
   *  sheet merely stays put. */
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    drag.current = { id: e.pointerId, y: e.clientY, t: performance.now(), moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const delta = e.clientY - d.y;
    if (Math.abs(delta) >= DRAG_MIN) d.moved = true;
    lastDy.current = delta;
    setDy(delta);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDy(0);
    const delta = e.clientY - d.y;
    dragged.current = d.moved;
    if (!d.moved) return; // a tap: the click event that follows handles it
    act(dragGesture(snap, { dy: delta, ms: Math.max(1, performance.now() - d.t) }, kind));
  };

  /** The browser took the gesture away — the pointer left the screen, the
   *  page went to the background, a second finger cancelled the first. A
   *  cancelled gesture is not a finished one: the sheet goes back to where it
   *  was and nothing is acted on. And no `click` follows a `pointercancel`,
   *  so the tap-suppression flag has to be cleared here or the NEXT genuine
   *  tap on the handle would be swallowed by it. (Fix round 1, F3.) */
  const onPointerCancel = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    dragged.current = false;
    lastDy.current = 0;
    setDy(0);
  };

  const onHandleClick = () => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    act(tapGesture(snap, kind));
  };

  const onHandleKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const g = keyGesture(snap, e.key, kind);
    if (!g) return;
    e.preventDefault();
    e.stopPropagation();
    act(g);
  };

  const aside = Boolean(web && modal && side);
  const cls = [
    "kit-sheet",
    modal ? "kit-sheet--modal" : "",
    tabBar && !web ? "kit-sheet--tabbar" : "",
    inline ? "kit-sheet--inline" : "",
    web && modal && !aside ? "kit-sheet--dialog" : "",
    aside ? "kit-sheet--side" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const style = web
    ? undefined
    : ({
        "--sheet-top": `${headerH}px`,
        ...(dy === 0 ? null : { transform: `translateY(${follow(dy)}px)` }),
      } as React.CSSProperties);

  return (
    <>
      {modal ? (
        <div
          ref={scrimRef}
          className={aside ? "kit-scrim kit-scrim--clear" : "kit-scrim"}
          data-open={open}
          role="presentation"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}
      <div
        ref={panelRef}
        className={cls}
        data-open={shown}
        data-snap={web ? undefined : snap}
        data-dragging={dy === 0 ? undefined : true}
        aria-hidden={!shown}
        role={modal ? "dialog" : undefined}
        aria-modal={modal ? true : undefined}
        aria-label={modal ? label : undefined}
        tabIndex={modal ? -1 : undefined}
        onKeyDown={modal ? trap : undefined}
        style={style}
      >
        {/* the handle is the sheet's drag control: a block in a card cannot
            be dragged, and neither can a centred dialog */}
        {web ? null : (
          <button
            type="button"
            className="kit-sheet-handle"
            aria-label={handleLabel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onClick={onHandleClick}
            onKeyDown={onHandleKey}
          >
            <span className="kit-sheet-grip" aria-hidden="true" />
          </button>
        )}
        {snap === "peek" && peek !== undefined ? (
          peek
        ) : (
          <>
            {children}
            {snap === "tall" ? tall : null}
          </>
        )}
      </div>
    </>
  );
}
