import type { ReactNode } from "react";
import { t } from "../../i18n/t";
import {
  LocateIcon,
  RouteIcon,
  Segment,
  SettingsIcon,
  SheetSurfaceProvider,
  WanderIcon,
  type Tab,
} from "../kit";
import type { WebFrame } from "./breakpoints";

/** The ▾ after a value that has more behind it — punctuation, not copy, and
 *  the same glyph in both catalogs (as on the Settings rows). */
const MORE = " ▾";

const TAB_ICONS: Record<Tab, ReactNode> = {
  route: <RouteIcon size={18} />,
  wander: <WanderIcon size={18} />,
  settings: <SettingsIcon size={18} />,
};

type WebLayoutProps = {
  /** "tablet", "desktop-card" or "desktop-panel" — the card's width and
   *  whether it is a card at all (breakpoints.ts). */
  layout: WebFrame;
  /** The map. First child of a box that never unmounts within a layout, so
   *  the WebGL context survives every screen change. */
  map: ReactNode;
  /** The screens, unchanged from the phone: their own bars, sheets and
   *  cards, flattened into the card by the `web layout` CSS block. */
  children?: ReactNode;
  /** The wordmark row and the tab switcher. The routes panel and a walk in
   *  progress bring their own header and turn this off. */
  chrome: boolean;
  tab: Tab;
  cityName: string;
  onTab: (tab: Tab) => void;
  /** Open the city sheet — the ▾ beside the wordmark. */
  onCity: () => void;
  onLocate: () => void;
  /** The layers button and its popover: the FIRST item of the bottom-right
   *  stack, above Locate and above maplibre's zoom pill (CR-02 edit 2). */
  layers?: ReactNode;
  /** The day scrubber (CR-02 edit 5): bottom-centre of the MAP, between the
   *  card and the control stack — never centred on the viewport, which at
   *  1024 would put it half under a 360 px card. AppShell decides whether
   *  there is one (`scrubberVisible`, ui/layers.ts). */
  scrubber?: ReactNode;
  /** The map's own wait, until the basemap paints (ui/bootPhase.ts). */
  spinner?: ReactNode;
  toast?: ReactNode;
};

/** The tablet and desktop frame (UI redesign Task 15, 2026-09-05).
 *
 *  A full-bleed map with one floating card over it — 360 px on a tablet,
 *  408 px from 1440 up, and a full-height left panel once the card holds a
 *  list (routes, loops, settings). The screens inside it are the phone's,
 *  composed unmodified: what changes is where their boxes sit, which is
 *  CSS, and which surface their sheets are drawn on, which is one context.
 *
 *  The map controls live outside the card, bottom right: the locate button
 *  here and maplibre's own zoom buttons moved under it by the stylesheet —
 *  the phone hides those, the web shows them. */
export function WebLayout({
  layout,
  map,
  children,
  chrome,
  tab,
  cityName,
  onTab,
  onCity,
  onLocate,
  layers,
  scrubber,
  spinner,
  toast,
}: WebLayoutProps) {
  return (
    <div className="shell shell--web" data-layout={layout}>
      <div className="shell-map">{map}</div>

      <div className="web-card" data-tab={tab}>
        {chrome ? (
          <>
            <div className="web-brand">
              <span className="web-wordmark">{t("app.name")}</span>
              <button type="button" className="web-city" onClick={onCity}>
                {cityName + MORE}
              </button>
            </div>
            <div className="web-tabs">
              <Segment
                value={tab}
                // the group's accessible name. The catalog has no word for
                // "the three things this app does" — `nav.*` is the walking
                // banner's — so the product name stands in until the copy
                // pass has one (flagged for Task 16 with the tablist question).
                label={t("app.name")}
                options={[
                  { value: "route" as Tab, label: t("tab.route"), icon: TAB_ICONS.route },
                  { value: "wander" as Tab, label: t("tab.wander"), icon: TAB_ICONS.wander },
                  { value: "settings" as Tab, label: t("tab.settings"), icon: TAB_ICONS.settings },
                ]}
                onChange={onTab}
              />
            </div>
          </>
        ) : null}
        <SheetSurfaceProvider surface="web">{children}</SheetSurfaceProvider>
      </div>

      {scrubber === undefined ? null : <div className="web-scrub">{scrubber}</div>}

      <div className="web-controls">
        {layers}
        <button type="button" className="shell-locate" aria-label={t("start.gps")} onClick={onLocate}>
          <LocateIcon size={22} />
        </button>
      </div>

      {spinner}
      {toast}
    </div>
  );
}
