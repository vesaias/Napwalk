import { useEffect, useMemo, useReducer, useState } from "react";
import MapView from "../components/MapView";
import { getCity } from "../cities";
import { t } from "../i18n/t";
import { autoPreference, autoWindow } from "../plan/preference";
import { reasonLine } from "../plan/cardCopy";
import KitGallery from "./KitGallery";
import { TabBar, Toast } from "./kit";
import { isWeb } from "./layout/breakpoints";
import { Frame } from "./layout/Frame";
import { useLayout } from "./layout/useMediaQuery";
import { NO_FC } from "./mapData";
import { mapPins } from "./mapPins";
import { mapTaps } from "./mapTaps";
import { fitFor } from "./mapFit";
import { outsideInfo } from "./outside";
import { historyUrl } from "./history";
import { copyLink, pageBase, shareUrl } from "./share";
import { useHistory } from "./useHistory";
import { useTheme } from "./useTheme";
import { GraphProvider, useGraphStamp } from "./GraphContext";
import { useAnalytics } from "./useAnalytics";
import { useWalk } from "./useWalk";
import { useGps } from "./useGps";
import { useHeading } from "./useHeading";
import { useLinkNames, usePlaceSearch, usePinInfo } from "./useLookups";
import { useMapCentre } from "./useMapCentre";
import { useMapErrors } from "./useMapErrors";
import { originAt, usePlanner } from "./usePlanner";
import { useRouteMap } from "./useRouteMap";
import { useFakeWalk } from "./useFakeWalk";
import { useSettings } from "./useSettings";
import { useShellClock } from "./useShellClock";
import { useReroute } from "./useReroute";
import { useStartWalk } from "./useStartWalk";
import { RouteTab } from "./screens/route/RouteTab";
import { SettingsTab } from "./screens/settings/SettingsTab";
import { WanderTab } from "./screens/wander/WanderTab";
import { navigating, reduce } from "./shellState";
import { mapOverlays, scrubberVisible } from "./layers";
import { DayScrubber } from "./DayScrubber";
import { Layers } from "./screens/layers/Layers";
import { locateFor } from "./locate";
import { useFirstFix } from "./firstFix";
import { tabBarVisible } from "./tabBar";
import { useSheetSnap } from "./sheetSnapStore";
import { cityClock, nowMinutes } from "./time";
import { useSunDay } from "./useSunDay";
import { BOOT, BOOT_CITY, bootState, showKit } from "./boot";
import { useShellCity } from "./useShellCity";
import { bootCamera, useResume } from "./useResume";

/** Route screens whose own banner IS the web header, so the panel drops its
 *  head: the walk and its arrival. R4 left this set at CR-03 Q1 — without the
 *  switcher a desktop reader cannot leave it (board cr3-desktop-routes-head). */
const WEB_BARE = new Set(["navigate", "arrived"]);

export default function AppShell() {
  return showKit ? <KitGallery /> : <Shell />;
}

function Shell() {
  // `c` (city) and `a` (access) are settings a link may override for the
  // SESSION, never for good (useSettings.ts). A one-off loosening is not one
  // of these any more: "Allow cobbles" / "Walk mode" and the access chip
  // write the shell's per-trip override instead (shellState.Trip), which
  // resets on the next destination. The Settings tab is the only thing that
  // writes through `patch`: the access sheet's "Make default" was the other
  // one until round 3 item 9b took it off a per-trip sheet.
  //
  // `BOOT_CITY` is the second argument: the city the record falls back to
  // when the reader has never chosen one — the device's time zone, offline
  // and unprompted (backlog B1, ui/where.ts). A stored city always wins.
  const store = useSettings(BOOT, BOOT_CITY);
  const settings = store.settings;
  const city = getCity(settings.city);
  const day = cityClock(city).day; // the CITY's day, not the browser's (S2, 2)

  // What the link asked for, resolved against the city and the sun (boot.ts).
  const [s, raw] = useReducer(reduce, undefined, () => bootState(city, day, settings.autoPref));
  // ...and the counter behind every action (ui/useAnalytics.ts, 2026-09-16)
  const dispatch = useAnalytics(s, raw, store);

  const [following, setFollowing] = useState(false);

  // --- the city: its graph, its bands, its border, its theme, its loader --
  // One hook now (ui/useShellCity.ts), because round 3 item 12 made them one
  // question: what is downloaded, in what order, and what the reader is told
  // while it happens.
  const theme = useTheme(settings, city);
  const cityState = useShellCity(s, dispatch, store, city);
  const { graph, bands, border } = cityState;
  const graphStamp = useGraphStamp(graph, bands);

  // --- location ------------------------------------------------------------
  const gps = useGps(dispatch, s.gpsDenied, () => setFollowing(true));
  /** The Locate button, per tab (ui/locate.ts). */
  const locate = locateFor(s, dispatch, gps.ask);
  /** Where the walker stands relative to the city's data — the outside-city
   *  banner on Home and the city sheet's context line read the same answer. */
  const outside = useMemo(() => outsideInfo(border, s.gps), [border, s.gps]);

  // --- the clock, and the toast (ui/useShellClock.ts) ----------------------
  useShellClock({ leaveNow: s.leaveNow, startMin: s.startMin, toast: s.toast, city }, dispatch);

  // The day's sun and the leave-at bars it decides (ui/useSunDay.ts); past
  // sunset (`night`) there is no shade term, and the cards say so.
  const sun = useSunDay(day, city, graph);
  const night = s.startMin >= sun.sunset;
  useEffect(() => {
    if (!settings.autoPref || !s.prefAuto) return;
    const pick = autoPreference(s.startMin, sun.sunset).pref;
    if (pick !== s.pref) dispatch({ type: "pref", pref: pick, auto: true });
  }, [settings.autoPref, s.prefAuto, s.startMin, s.pref, sun.sunset, dispatch]);

  // --- what the screens look up -------------------------------------------
  const from = originAt(s.origin, s.gps);

  // --- the browser's back button ------------------------------------------
  // Every screen change pushes an entry carrying the shell's own shareable
  // URL, so back walks the screens and a refresh lands on the tab, the
  // destination and the preference it left off with (ui/history.ts,
  // ui/useHistory.ts — the only place window.history is touched). The LIVE
  // GPS fix is deliberately not in that URL; only a pinned start is.
  useHistory(s, dispatch, historyUrl(pageBase(), s, settings, store.persisted));

  const search = usePlaceSearch(s.route.k === "search" ? s.route.q.trim() : "", city, from);
  usePinInfo(s, dispatch, graph, bands);
  // A map whose basemap never arrives says so, once (QA F2-08).
  const onMapError = useMapErrors(dispatch);
  useLinkNames(s, dispatch);

  // --- planning ------------------------------------------------------------
  const { jobKey, showSkeleton } = usePlanner(
    s, dispatch, graph, settings, border, night, sun.daylight, cityState.retry, bands
  );

  // --- the map's data ------------------------------------------------------
  const plan = s.plan;
  // `s.computing`, not `showSkeleton`: the ghost covers the whole replan,
  // not only the shimmering half of it (CR-R).
  const { routeLines, connectorLines, ghostLines } =
    useRouteMap(s, graph, plan, jobKey, s.computing);
  useFakeWalk(s, dispatch, routeLines); // `?debug=1&fix=lng,lat[&walk=N]` only

  /** Which marker each tab draws, and where (ui/mapPins.ts). */
  const { start: startPin, dest: destPin } = mapPins(s);

  // --- the walk ------------------------------------------------------------
  const walk = useWalk(s, dispatch, graph, plan, jobKey, sun.hours, sun.daylight, bands);
  // ...and the one thing that may change it while it is being walked: a
  // walker who has been off the line for ten seconds gets a new one, with no
  // toast and no screen change (useReroute.ts, HANDOVER §6.2).
  useReroute(s, dispatch, graph, settings, sun.sunset, walk);

  /** The camera a walk in progress wears: on the walker, at z17, turned the
   *  way the route runs (HANDOVER §4.3). Only while the map is following —
   *  a drag hands the map back to the reader, and ▴ takes it back. */
  const navCam =
    navigating(s) && walk.onPath ? { bearing: walk.onPath.bearing } : null;
  /** ...and the arrow the dot becomes on it (ui/useHeading.ts). `follow` is
   *  the tap that arms the compass — Start and ▴ — as well as recentring. */
  const heading = useHeading(s, navigating(s));
  const follow = () => { setFollowing(true); heading.arm(); };

  const sunAuto = autoPreference(s.startMin, sun.sunset);
  /** The muted line beside *Recommended* on both tabs' cards: the active
   *  preference and why it is active (SPEC §1.1, plan/cardCopy.ts). Built
   *  here because only the shell knows whether the clock or the reader
   *  chose, and when the walk leaves. */
  const cardReason = reasonLine({
    pref: s.pref,
    auto: s.prefAuto && settings.autoPref,
    startMin: s.startMin,
    sunsetMin: sun.sunset,
    leaveNow: s.leaveNow,
  });

  const startWalk = useStartWalk(s, dispatch, plan, follow);
  const openCity = () => dispatch({ type: "overlay", overlay: "city" });
  /** "Show <city>": the map flies to the centre and stops following. */
  const showCity = () => {
    setFollowing(false);
    dispatch({ type: "focus", at: city.center });
    dispatch({ type: "outsideSeen", seen: true });
  };
  // the banner returns when the fix crosses back in and out again
  const outsideNow = outside !== null;
  useEffect(() => {
    if (!outsideNow) dispatch({ type: "outsideSeen", seen: false });
  }, [outsideNow, dispatch]);

  // --- which frame ---------------------------------------------------------
  // A list of walks (routes, loops) earns the full-height panel on a wide
  // desktop; everything else — a card, a place, the walk itself, and
  // Settings since the compact rework — keeps the floating card
  // (breakpoints.ts).
  const showsList =
    s.tab === "wander" ? s.wander.k === "loops" : s.tab === "route" && s.route.k === "routes";
  // The walk was in this set for one round (slice 8) on the strength of
  // SPEC §7's `left: 428` for the navigate banner. That number is the
  // panel's 408 plus a gutter, but the board computes it for a panel with
  // the STEPS LIST in it — and Steps is out (2026-09-06). Without a list the
  // panel is 780 px of empty white, so the walk keeps the floating card and
  // the banner is offset from that instead (slice 8 review, F2). SPEC §7's
  // geometry returns whole the day Steps does.
  const layout = useLayout(showsList);
  const web = isWeb(layout);

  // How much of the phone the screen's sheet is covering. Since slice 4 the
  // sheet is draggable, so this is a measurement rather than a constant: the
  // map's bottom fit padding and the locate button both follow it, snap by
  // snap. 0 on the web, where a card is not a floor, and on a screen with no
  // sheet at all. It is measured from the BOTTOM of the viewport, so when the
  // sheet peeks above the tab bar the bar is already in it — which is how the
  // map's fit and the locate button follow the bar when it slides away
  // (CR-01 edit 5, ui/tabBar.ts).
  const [sheetH, setSheetH] = useState(0);
  const snap = useSheetSnap();
  // Landscape counts as the phone here and gets the same answer: no bar
  // while a trip exists, a 56 px rail under the panel on the tab roots. It
  // has no sheet, so `snap` is null there and only the screen half of the
  // rule applies (ui/tabBar.ts, SPEC §3b).
  const barShown = !web && tabBarVisible(s, snap);

  // The routes and loops screens show the whole walk; a walk in progress
  // follows the walker instead, and a card recentres on its subject.
  const fit = useMemo(
    () =>
      showsList && routeLines !== NO_FC
        ? fitFor(
            routeLines,
            layout,
            { width: window.innerWidth, height: window.innerHeight },
            s.tab === "wander" ? "loops" : "routes",
            // landscape has no sheet either, so no stale portrait height (F9)
            isWeb(layout) || layout === "phone-landscape" ? 0 : sheetH
          )
        : null,
    [showsList, routeLines, layout, s.tab, sheetH]
  );

  /** Desktop only: there is no walk to start at a desk, so the panel puts
   *  the link on the clipboard for the phone that will do the walking. */
  const sendToPhone = () => copyLink(dispatch, shareUrl(pageBase(), s, settings, from));
  /** …which is the trade both walking tabs make on the two desktop frames,
   *  and neither makes on a phone or a tablet (boards W-routes, W-wander). */
  const onSend =
    layout === "desktop-panel" || layout === "desktop-card" ? sendToPhone : undefined;

  /** Where the map is looking — a ref behind a getter, so a pan re-renders
   *  nothing (the report sheet's attach switch, and the B4 snapshot). */
  const mapCentre = useMapCentre();

  // What the URL cannot say, kept beside it for one session: the camera, the
  // rung, the scrubbed minute, the city and a walk in progress. A discarded
  // tab comes back to a reload; the two stores land it where it was (B4).
  useResume(s, dispatch, {
    camera: mapCentre.camera,
    onCameraMove: mapCentre.onMove,
    snap,
    city: city.id,
    following,
    setFollowing,
  });

  /** What a tap, a POI tap and a long press mean on each tab (ui/mapTaps.ts). */
  const taps = mapTaps(s, dispatch, city);

  // --- the shade and noise overlays (ui/layers.ts) --------------------------
  /** Is a walk on the map? Routes, loops, the walk itself, and the GHOST of
   *  the last one. It hides the day scrubber; since CR-03 A1, nothing else. */
  const drawn = routeLines.features.length > 0 || ghostLines.features.length > 0;
  const { shadeOn, noiseOn, shadeMin } = mapOverlays(s, settings.layers, nowMinutes());

  /** ...and the first fix of the page load takes the map with it, unless a
   *  walk, a resume or the reader's own gesture owns the camera already
   *  (round 4 item 1, ui/firstFix.ts). */
  const firstFix = useFirstFix(s.gps, dispatch, {
    city,
    trip: drawn || showsList || navigating(s),
    resumed: bootCamera() !== null,
    guessing: cityState.cityGuessPending,
  });

  /** The layers button, and the sheet (phone) or popover (web) it opens.
   *  Mounted by the LAYOUT, not by a screen: it belongs to the map rather
   *  than to the card in front of it (CR-02 edits 2 and 3). */
  const layersUi = (
    <Layers
      s={s}
      dispatch={dispatch}
      layers={settings.layers}
      shadeMin={shadeMin}
      onChange={(layers) => store.patch({ layers })}
      web={web}
    />
  );

  // Shade across the day (CR-02 edit 5): web only, map free to be read.
  const scrubber = web && scrubberVisible(s, settings.layers, drawn)
    ? <DayScrubber minute={shadeMin} city={city} dispatch={dispatch} />
    : undefined;

  const map = (
    <MapView
      city={city}
      basemap="vector"
      theme={theme}
      shadeOn={shadeOn}
      noiseOn={noiseOn}
      waysOn={false}
      minutes={shadeMin}
      day={day}
      start={startPin}
      dest={destPin}
      focus={destPin ?? s.focus}
      focusSeq={s.focusSeq}
      focusZoom={destPin ? null : s.focusZoom}
      fit={fit}
      routeLines={routeLines}
      routeRaw={NO_FC}
      connectorLines={connectorLines}
      ghostLines={ghostLines}
      onMapClick={taps.onMapClick}
      onFeatureTap={taps.onFeatureTap}
      onLongPress={taps.onLongPress}
      gpsPos={s.gps}
      heading={heading.deg}
      following={following && s.gps !== null}
      navCam={navCam}
      onUserPan={() => { setFollowing(false); firstFix.onPan(); }}
      onCamera={mapCentre.onCamera}
      initialCamera={bootCamera()}
      onMapError={onMapError}
      onPainted={cityState.onPainted}
    />
  );

  // The bar is MOUNTED on every phone screen and slides out of the ones that
  // do not want it (ui/tabBar.ts decides which, CR-01 edit 5): a bar that
  // unmounted could not slide, and the map's padding could not follow it in
  // the same frame. The web has no tab bar at all — the card's Segment is
  // the switcher.
  const tabBar = (
    <TabBar
      active={s.tab}
      labels={{ route: t("tab.route"), wander: t("tab.wander"), settings: t("tab.settings") }}
      onChange={(tab) => dispatch({ type: "tab", tab })}
    />
  );

  const toast = s.toast === null ? undefined : <Toast text={s.toast} />;

  const screens = (
    <>
      {s.tab !== "route" ? null : (
        <RouteTab
          s={s}
          dispatch={dispatch}
          settings={settings}
          city={city}
          search={search}
          from={from}
          computing={showSkeleton}
          walk={walk}
          autoPickWindow={autoWindow(sunAuto.pref, sun.sunset)}
          reasonLine={cardReason}
          night={night}
          sun={sun}
          outside={s.outsideSeen ? null : outside}
          border={border}
          onLocate={locate("route")}
          onStart={startWalk}
          onRecenter={follow}
          onShowCity={showCity}
          onCity={openCity}
          onRetryCity={cityState.retry}
          onAllowCobbles={() => dispatch({ type: "trip", avoidCobbles: false })}
          onWalkMode={() => dispatch({ type: "trip", access: "walk" })}
          onSend={onSend}
        />
      )}
      {s.tab !== "wander" ? null : (
        <WanderTab
          s={s}
          dispatch={dispatch}
          settings={settings}
          city={city}
          computing={showSkeleton}
          walk={walk}
          from={originAt(s.origin, s.gps)}
          autoPickWindow={autoWindow(sunAuto.pref, sun.sunset)}
          reasonLine={cardReason}
          night={night}
          sun={sun}
          onLocate={locate("wander")}
          onStart={startWalk}
          onSend={onSend}
          onRecenter={follow}
          onShowCity={showCity}
          onCity={openCity}
          onRetryCity={cityState.retry}
          border={border}
          onAllowCobbles={() => dispatch({ type: "trip", avoidCobbles: false })}
          onWalkMode={() => dispatch({ type: "trip", access: "walk" })}
        />
      )}
      {/* the settings page, and the city and report sheets — which belong to
          no tab: the banner on Home opens the one, Settings the other */}
      <SettingsTab
        s={s}
        dispatch={dispatch}
        store={store}
        outside={outside}
        mapCenter={mapCentre.centre}
        onPickCity={cityState.pickCity}
      />
    </>
  );

  const frame = (
    <Frame
      layout={layout}
      map={map}
      screens={screens}
      chrome={
        s.tab === "route"
          ? !WEB_BARE.has(s.route.k)
          : s.tab === "wander"
            ? s.wander.k === "idle" || s.wander.k === "loops"
            : true
      }
      tab={s.tab}
      cityName={t(`city.${city.id}`)}
      onTab={(tab) => dispatch({ type: "tab", tab })}
      onCity={openCity}
      onLocate={locate(s.tab === "wander" ? "wander" : "route")}
      layers={layersUi}
      scrubber={scrubber}
      toast={toast}
      tabBar={tabBar}
      tabBarShown={barShown}
      sheetH={sheetH}
      onSheetH={setSheetH}
    />
  );

  return <GraphProvider stamp={graphStamp}>{frame}</GraphProvider>;
}
