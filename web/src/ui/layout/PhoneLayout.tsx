import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { CARD_H, peekBudget } from "../sheetBudget";
import { setDensity } from "../sheetSnapStore";

type PhoneLayoutProps = {
  /** The map. It is the first child of a box that never unmounts, so the
   *  WebGL context survives every screen change — screens are `children`
   *  around it, never a wrapper of it. */
  map: ReactNode;
  /** The screen: its own floating bar, sheet and buttons, positioned by
   *  the `shell-*` classes in index.css. */
  children?: ReactNode;
  tabBar?: ReactNode;
  /** Is the bar on screen? It stays MOUNTED either way since CR-01 edit 5 —
   *  hiding it is a 200 ms slide, and a bar that unmounted could not slide.
   *  Hidden, it is worth 0 px to the peek budget. */
  tabBarShown?: boolean;
  /** The layers button, and the modal sheet it opens (CR-02 edit 2). It is
   *  the layout's rather than a screen's because it belongs to the MAP: it
   *  floats over it, under whatever box the screen hangs from the top, and
   *  ui/layers.ts decides which screens have one at all. */
  layers?: ReactNode;
  /** The map's own wait, until the basemap paints (ui/bootPhase.ts). */
  spinner?: ReactNode;
  toast?: ReactNode;
  /** How tall the screen's own sheet is right now, measured at its current
   *  snap (kit/Sheet.tsx). Published as --sheet-h so the locate button can
   *  ride above the sheet at every snap; 0 means there is no sheet. */
  sheetH?: number;
};

/** The phone frame: full-bleed map, one screen's worth of chrome over it,
 *  and the tab bar pinned to the bottom (UI redesign Task 11, 2026-09-05).
 *
 *  Since CR-01 edit 10 it also holds the peek budget. This is the one
 *  component that can see all three boxes the rule is written about — the
 *  screen's header, the sheet and the tab bar — so it measures what the
 *  browser laid out, asks ui/sheetBudget.ts what fits, and publishes the
 *  answer twice over: as --sheet-peek and --peek-card for the CSS, and as
 *  a density on the sheet store for the compact card that has to draw
 *  itself smaller. */
export function PhoneLayout({
  map,
  children,
  tabBar,
  tabBarShown = true,
  layers,
  spinner,
  toast,
  sheetH = 0,
}: PhoneLayoutProps) {
  const ref = useRef<HTMLDivElement>(null);
  /** The last viewport the guard complained about, so a tripped budget is
   *  one line in the console rather than one per render. */
  const warned = useRef("");

  // Measured on every render rather than through a ResizeObserver: the
  // boxes being measured are a different DOM node on every screen (the R4
  // panel, the Wander bar, the search page's pill), so there is nothing
  // stable to observe. The layout effect runs after the browser has laid
  // out and before it paints, and it sets no state of its own — the two
  // lengths go straight onto the element as custom properties, and the
  // density onto the store, which only the screens that draw a card are
  // subscribed to. Nothing here can re-enter this effect.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let headerH = 0;
    for (const box of el.querySelectorAll(".shell-top, .route-chips")) {
      headerH = Math.max(headerH, box.getBoundingClientRect().bottom);
    }
    // The bar is in the DOM even when it is hidden (it slides out since
    // CR-01 edit 5), so its measured height counts only while it is shown.
    const bar = el.querySelector(".shell-tabbar");
    const next = peekBudget({
      innerHeight: window.innerHeight,
      headerH: Math.round(headerH),
      tabBarH:
        bar === null || !tabBarShown ? 0 : Math.round(bar.getBoundingClientRect().height),
    });
    // The sheet's top edge, measured from the bottom of the viewport — so a
    // sheet peeking ABOVE the bar already has the bar's height in it, and
    // the locate button and the map's fit follow the bar for free when it
    // goes (index.css .shell-float, ui/mapFit.ts).
    if (sheetH > 0) el.style.setProperty("--sheet-h", `${sheetH}px`);
    else el.style.removeProperty("--sheet-h");
    el.style.setProperty("--sheet-peek", `${next.peekH}px`);
    el.style.setProperty("--peek-card", `${CARD_H[next.density]}px`);
    setDensity(next.density);
    if (import.meta.env.DEV) {
      const key = next.over ? `${window.innerWidth}x${window.innerHeight}:${headerH}` : "";
      if (key !== "" && key !== warned.current) {
        warned.current = key;
        console.warn(
          `[sheet budget] header ${Math.round(headerH)} + peek ${next.peekH} does not fit the ` +
            `${next.allowed} px SPEC §3b allows on a ${window.innerHeight} px viewport — ` +
            `the compact card is down to its last row (SPEC §3b, ui/sheetBudget.ts).`
        );
      } else if (key === "") {
        warned.current = "";
      }
    }
  });

  return (
    // data-tabbar lifts the map's attribution control clear of the bar
    // (index.css, QA F2-01): the bar is opaque and swallowed every tap on it.
    <div ref={ref} className="shell" data-tabbar={tabBarShown ? "true" : "false"}>
      <div className="shell-map">{map}</div>
      {layers}
      {children}
      {spinner}
      {toast}
      {tabBar === undefined ? null : <div className="shell-tabbar">{tabBar}</div>}
    </div>
  );
}
