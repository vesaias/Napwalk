import { useCallback, useSyncExternalStore } from "react";
import { BREAKPOINTS, layoutFor, type Layout } from "./breakpoints";

/** One `MediaQueryList` per query, for the life of the page. `matchMedia`
 *  allocates, and `getSnapshot` runs on every render of every reader. */
const LISTS = new Map<string, MediaQueryList>();

function listFor(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  let mq = LISTS.get(query);
  if (mq === undefined) {
    mq = window.matchMedia(query);
    LISTS.set(query, mq);
  }
  return mq;
}

/** No window to measure: the phone frame is the safe answer. */
const serverSnapshot = () => false;

/** Does the viewport match this media query right now, and re-render when
 *  that changes. `useSyncExternalStore` rather than an effect: the very first
 *  render already knows the width, so a desktop never paints the phone frame
 *  for one frame on the way to the right one.
 *
 *  `subscribe` and `getSnapshot` are memoised on the query, because a fresh
 *  `subscribe` on every render is a listener detached and re-attached on
 *  every render — which is the cost the external store exists to avoid. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = listFor(query);
      if (mq === null) return () => {};
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query]
  );
  const getSnapshot = useCallback(() => listFor(query)?.matches ?? false, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
}

const WEB = `(min-width: ${BREAKPOINTS.web}px)`;
const DESKTOP = `(min-width: ${BREAKPOINTS.desktop}px)`;
/** The phone on its side (SPEC §3b, CR-03 Q4). The only HEIGHT query in the
 *  app: a landscape phone is not a narrower phone, it is a shorter one, and
 *  it is the height that takes the bottom sheet away.
 *
 *  `orientation: landscape` is the other half, and it is not decoration —
 *  Android Chrome resizes the LAYOUT viewport for the soft keyboard, so a
 *  390 × 844 phone typing into the report sheet is 390 × 444, short and
 *  upright. Without the clause it was handed the landscape panel, which put
 *  Send off the screen. `sideways()` in breakpoints.ts is the same rule in
 *  numbers, for the callers that have a width and a height rather than a
 *  media query. */
const SHORT = `(max-height: ${BREAKPOINTS.short}px) and (orientation: landscape)`;

/** The frame the app should be wearing. The three queries name a width
 *  bucket and a height, and `layoutFor` — the one rule, tested on its own —
 *  turns them into a layout. Live: crossing any of the three re-renders, so
 *  a rotation is one render and no remount (the reducer, and therefore the
 *  plan and the selection, is above all of this). */
export function useLayout(wantsPanel: boolean): Layout {
  const web = useMediaQuery(WEB);
  const desktop = useMediaQuery(DESKTOP);
  const short = useMediaQuery(SHORT);
  const width = desktop ? BREAKPOINTS.desktop : web ? BREAKPOINTS.web : 0;
  return layoutFor(width, wantsPanel, short);
}
