import type { ReactNode } from "react";
import { t } from "../../i18n/t";
import { LocateIcon, SheetSurfaceProvider, type Tab } from "../kit";

type LandscapeShellProps = {
  /** The map. First child of a box that never unmounts within a layout, so
   *  the WebGL context survives every screen change. */
  map: ReactNode;
  /** The screens, unchanged from the phone: their own bars, sheets and
   *  cards, flattened into the panel by the `web layout` CSS block. */
  children?: ReactNode;
  /** Which tab is showing — the panel orders its children by it, the same
   *  way the web card does. */
  tab: Tab;
  /** The tab bar, re-laid as a 56 px rail under the panel. Mounted on every
   *  screen and slid out of the ones that do not want it, exactly as on an
   *  upright phone: a rail that unmounted could not slide. */
  tabBar?: ReactNode;
  tabBarShown?: boolean;
  /** The layers control and the sheet it opens. Rendered OUTSIDE the panel,
   *  because on the screens that have one it is a button floating over the
   *  map (ui/layers.ts); on R4 and W1 it is the header's 30 px chip, which
   *  travels inside the panel with the header it belongs to. */
  layers?: ReactNode;
  /** The map's own wait, until the basemap paints (ui/bootPhase.ts). */
  spinner?: ReactNode;
  toast?: ReactNode;
  onLocate: () => void;
};

/** The phone on its side (CR-03 Q4, SPEC §3b, board `c-q4-landscape-phone`).
 *
 *  390 css px of height has no room for a bottom sheet: the peek budget
 *  (header + peek ≤ 46 % of the viewport) left the UX sweep's landscape
 *  reader about 145 px of map and a compact card with its meters dropped
 *  (sweep U18). So the answer moves through 90°: a 300 px panel down the
 *  left edge holding the header block, the results and the buttons, and the
 *  map keeps everything to the right of it.
 *
 *  The panel IS the tablet card, flush left and floor to ceiling — same
 *  `.web-card` element, same un-pinning rules, `--web-card-w` at 300 — and
 *  the screens inside it are composed unmodified, which is the whole reason
 *  this file is 60 lines and not 400. What it does NOT reuse is the card's
 *  head: there is no wordmark row and no segment here, because the tab bar
 *  is still the switcher — as a rail under the panel on the tab roots, and
 *  gone entirely once a trip exists (SPEC §3b).
 *
 *  There is no sheet, so nothing publishes a snap (`ui/sheetSnapStore.ts`
 *  stays at `null`) and there is no peek budget to measure — which is why
 *  this shell, unlike `PhoneLayout`, has no layout effect at all. */
export function LandscapeShell({
  map,
  children,
  tab,
  tabBar,
  tabBarShown = true,
  layers,
  spinner,
  toast,
  onLocate,
}: LandscapeShellProps) {
  return (
    <div
      className="shell shell--web shell--landscape"
      data-layout="phone-landscape"
      data-rail={tabBarShown ? "true" : "false"}
    >
      <div className="shell-map">{map}</div>

      {/* `panel`, not `web`: the container behaves like the card in every
          way that matters to `kit/Sheet.tsx`, but the two screens that draw
          a walk read it back and keep the compact card (Routes.tsx). */}
      <SheetSurfaceProvider surface="panel">
        <div className="web-card" data-tab={tab}>
          {children}
        </div>
        {layers}
      </SheetSurfaceProvider>

      {tabBar === undefined ? null : <div className="shell-rail">{tabBar}</div>}

      {/* the map's own corner, on its right edge: the screens' locate
          buttons are inside the panel and hidden there, the same trade the
          web frame makes */}
      <div className="web-controls">
        <button
          type="button"
          className="shell-locate"
          aria-label={t("start.gps")}
          onClick={onLocate}
        >
          <LocateIcon size={22} />
        </button>
      </div>

      {spinner}
      {toast}
    </div>
  );
}
