import type { ReactNode } from "react";
import { SheetHeightProvider, type Tab } from "../kit";
import { isWeb, type Layout } from "./breakpoints";
import { LandscapeShell } from "./LandscapeShell";
import { PhoneLayout } from "./PhoneLayout";
import { WebLayout } from "./WebLayout";

type FrameProps = {
  layout: Layout;
  map: ReactNode;
  /** The three tabs, mounted once and rendered inside whichever shell wins.
   *  Not `children`, because two of the three shells wrap them in a context
   *  of their own and one does not. */
  screens: ReactNode;
  /** Web only: does the card draw its head (wordmark · city ▾ · segment)? */
  chrome: boolean;
  tab: Tab;
  cityName: string;
  onTab: (tab: Tab) => void;
  onCity: () => void;
  onLocate: () => void;
  layers?: ReactNode;
  /** Web only — the phone has no scrubber at any width (SPEC §6.7), and
   *  landscape is still the phone. */
  scrubber?: ReactNode;
  /** The one wait drawn over the map: the spinner that covers it until the
   *  basemap has painted (round 3 item 2; ui/bootPhase.ts). The graph that
   *  follows draws nothing at all (2026-09-15). Every frame mounts this in
   *  the same place its toast goes — over the map, under the screen. */
  spinner?: ReactNode;
  toast?: ReactNode;
  tabBar: ReactNode;
  tabBarShown: boolean;
  /** Phone only: how tall the screen's sheet is at its current snap, and
   *  the callback the sheet reports it through. There is no sheet in the
   *  other two frames, so neither travels there. */
  sheetH: number;
  onSheetH: (px: number) => void;
};

/** Which shell wears the screens (compact UI slice S5, 2026-09-09).
 *
 *  Three of them now — the card (tablet and both desktops), the landscape
 *  rail, and the upright phone — and the branch is here rather than at the
 *  foot of AppShell because AppShell is at its 450-line ceiling and this is
 *  the one part of it that is about the FRAME rather than about the app.
 *  Nothing is decided here: `layoutFor` (breakpoints.ts) has already said
 *  which frame this is, and every prop below was computed by the shell. */
export function Frame({
  layout,
  map,
  screens,
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
  tabBar,
  tabBarShown,
  sheetH,
  onSheetH,
}: FrameProps) {
  if (isWeb(layout)) {
    return (
      <WebLayout
        layout={layout}
        map={map}
        chrome={chrome}
        tab={tab}
        cityName={cityName}
        onTab={onTab}
        onCity={onCity}
        onLocate={onLocate}
        layers={layers}
        scrubber={scrubber}
        spinner={spinner}
        toast={toast}
      >
        {screens}
      </WebLayout>
    );
  }

  if (layout === "phone-landscape") {
    return (
      <LandscapeShell
        map={map}
        tab={tab}
        tabBar={tabBar}
        tabBarShown={tabBarShown}
        layers={layers}
        spinner={spinner}
        toast={toast}
        onLocate={onLocate}
      >
        {screens}
      </LandscapeShell>
    );
  }

  return (
    <PhoneLayout
      map={map}
      tabBar={tabBar}
      tabBarShown={tabBarShown}
      layers={layers}
      spinner={spinner}
      toast={toast}
      sheetH={sheetH}
    >
      <SheetHeightProvider onHeight={onSheetH}>{screens}</SheetHeightProvider>
    </PhoneLayout>
  );
}
