import { useEffect, useRef, useState } from "react";
import {
  AttributionControl,
  Map as LibreMap,
  Marker,
  NavigationControl,
  addProtocol,
  setWorkerUrl,
  type GeoJSONSource,
  type RasterTileSource,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection } from "geojson";
import { Protocol } from "pmtiles";
import { layersWithPartialCustomTheme } from "protomaps-themes-base";
import { applyMeadowOverrides, MEADOW, MEADOW_DARK } from "../mapTheme";

const NOISE_TILE_VERSION = 4;
/** The city's data border (pipeline/common.export_border, 2026-09-02): drawn
 *  as a light line, and the shade overlay is clipped to it. */
export const borderUrl = (cityId: string) => tileUrl(`${cityId}/border.json?v=${NOISE_TILE_VERSION}`);
/** Per-city noise overlay tiles (pipeline/17_render_noise, 2026-09-01). */
const noiseTiles = (c: City) => {
  const u = tileUrl(`${c.id}/noise/{z}/{x}/{y}.${c.tileExt ?? "webp"}?v=${NOISE_TILE_VERSION}`);
  return u.startsWith("http") ? u : `${location.origin}${u}`; // keep the {z}/{x}/{y} braces literal (URL() would encode them)
};
import { t, getLocale } from "../i18n/t";
import { debugLog } from "../debug";
import { ShadeLayer, type BorderGeom } from "../shade/ShadeLayer";
import { edgeLatLngs } from "../router/graph";
import { useGraph } from "../ui/GraphContext";
import { mapErrorKind, type MapErrorKind } from "../ui/useMapErrors";
import { washFeature } from "./wash";


// the worker URL is built dynamically inside maplibre, which the bundler
// cannot see — ?worker&url bundles the worker with its import graph
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { basemapUrl, tileUrl, type City } from "../cities";
import { liveMinute, subscribeLive } from "../ui/scrubLive";
import { isLngLat } from "../lngLat";
import { easeHeading, normDeg } from "../ui/heading";

setWorkerUrl(workerUrl);

// Centre and bounds come from the city registry (src/cities.ts) since
// 2026-08-30 — see DECISIONS.md.

/** Glyphs and sprites are self-hosted since 2026-09-05 (Task 8): the map
 *  must render with no third-party request. */
const ASSETS = "/basemap-assets";

export type LngLat = [number, number];

/** Where the map is looking, whole. The centre alone is not a camera: a
 *  reader who zoomed in to read a street name and came back to z13 has lost
 *  as much as one who came back to the wrong place (B4, ui/resume.ts). */
export type Camera = { center: LngLat; zoom: number; bearing: number; pitch: number };

/** What a tap on a basemap feature answers with: the POI's name, its OSM
 *  kind, and where it is. Exported because the shell's tap rules take it
 *  (ui/mapTaps.ts) and a restated copy would drift silently. */
export type MapFeature = { name: string; kind: string; lng: number; lat: number };
export type MapFit = {
  bounds: [LngLat, LngLat];
  padding: { top: number; right: number; bottom: number; left: number };
};
export type Basemap = "osm" | "vector";
export type MapTheme = "light" | "dark";

/** Everything on the map that is not the basemap, keyed by theme. Paint
 *  values cannot read a CSS custom property, so the token values from
 *  src/tokens.css are repeated here — and only here. */
const INK = {
  light: {
    route: "#2f62d8",
    routeAlt: "#8fa8e0",
    routeCasing: "#ffffff",
    // the alternative's own casing (CR-05 edit 7, tokens overlay.route
    // .altCasing): the same white, but a layer of its own, because what it
    // has to survive is a park and not a street
    routeAltCasing: "#ffffff",
    borderWash: "rgba(125,130,125,0.24)",
    page: "#eef1e9", // the Meadow v3 ground; the border label's halo wears it
  },
  dark: {
    route: "#6f9cff",
    routeAlt: "#4d6aa8",
    routeCasing: "#24292a",
    routeAltCasing: "#24292a",
    borderWash: "rgba(0,0,0,0.40)",
    page: "#24292a", // Meadow dark v2's ground (mapTheme.ts), and --c-page
  },
} as const;
const GHOST = "rgba(122,127,135,0.6)";
const BORDER_INK = "#5b6270";

/** How close the map sits to a walk in progress (HANDOVER §4.3). */
const NAV_ZOOM = 17;

/** How long after a resume's first fit the SAME fit is still the page load
 *  settling rather than the reader asking. The sheet publishes its measured
 *  height a frame or two after it mounts, and the plan is re-fitted with the
 *  new padding; both land inside a few hundred milliseconds of the first
 *  plan, and nothing a finger can do arrives that fast (B4, S6 review
 *  finding 3). */
const RESUME_SETTLE_MS = 1200;

const LONG_PRESS_MS = 350;
const LONG_PRESS_SLOP = 6; // px of finger travel that cancels it

/** Has the reader asked for less motion? Read at the moment of the move, not
 *  once at boot: the setting can change while the page is open, and this is
 *  the one place in the app where motion is not CSS's to switch off. */
function stillPlease(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Recentre — gliding for most readers, instantly for the one who asked.
 *  A point MapLibre would refuse is ignored: `easeTo` throws synchronously,
 *  and every caller here is inside an effect, where a throw unmounts the
 *  tree (QA F6-01). */
function goTo(m: LibreMap, center: [number, number], zoom?: number | null): void {
  if (!isLngLat(center)) return;
  // `zoom` is the first GPS fix's (ui/firstFix.ts) and nothing else's: every
  // other recentre keeps the map at whatever scale the reader left it.
  const at = zoom == null ? { center } : { center, zoom };
  if (stillPlease()) m.jumpTo(at);
  else m.easeTo({ ...at, duration: 600 });
}

/** maplibre's own control labels, from the catalog. Its buttons are built by
 *  the library, not by us, so this is the only way they speak German — and
 *  the zoom pill's aria-labels were the last English on a German page. */
function mapLocale(): Record<string, string> {
  return {
    "NavigationControl.ZoomIn": t("map.zoomIn"),
    "NavigationControl.ZoomOut": t("map.zoomOut"),
    "AttributionControl.ToggleAttribution": t("map.attributionToggle"),
    "Map.Title": t("map.title"),
    "Marker.Title": t("map.marker"),
  };
}

/** maxBounds a little wider than the city box, so the edge is reachable. */
function pad(b: [number, number, number, number]): [[number, number], [number, number]] {
  return [[b[0] - 0.05, b[1] - 0.03], [b[2] + 0.05, b[3] + 0.03]];
}

/** The basemap half of the style. Our own sources and layers are added on
 *  top in installLayers, because switching theme or city calls setStyle,
 *  which throws every source and layer away — including the custom WebGL
 *  shade layer. One install path, used at boot and after every switch. */
function buildStyle(city: City, basemap: Basemap, theme: MapTheme): StyleSpecification {
  // Per city since Task 14: the app can now switch city without a reload,
  // and the generic key credits Frankfurt's HVBG DOM1 under every map.
  const attribution = t(`map.attribution.${city.id}`);
  return {
    version: 8,
    glyphs: `${ASSETS}/fonts/{fontstack}/{range}.pbf`,
    // maplibre 5 refuses a relative sprite URL — and silently, unless you
    // call setSprite by hand: the POI icons just never arrive (2026-09-05)
    sprite: `${location.origin}${ASSETS}/sprites/v4/${theme === "dark" ? "dark" : "light"}`,
    sources:
      basemap === "osm"
        ? {
            // the debug page stays on plain OSM raster: it is the reference
            // picture the router is checked against
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              maxzoom: 19,
              attribution,
            },
          }
        : {
            protomaps: { type: "vector", url: `pmtiles://${basemapUrl(city)}`, attribution },
          },
    layers:
      basemap === "osm"
        ? [{ id: "osm", type: "raster", source: "osm" }]
        : // the colours come from the theme, the widths, minzooms and text
          // sizes from the override pass beside it (mapTheme.ts, CR-01 e11)
          applyMeadowOverrides(
            layersWithPartialCustomTheme(
              "protomaps",
              theme === "dark" ? "dark" : "light",
              theme === "dark" ? MEADOW_DARK : MEADOW,
              getLocale()
            ),
            theme === "dark" ? "dark" : "light"
          ),
  };
}

type Props = {
  city: City;
  basemap: Basemap; // "vector" = the per-city Meadow pmtiles; "osm" = raster reference
  theme: MapTheme;
  shadeOn: boolean;
  noiseOn: boolean;
  waysOn: boolean; // ?debug "Ways": draw the graph edges in view, coloured by class.
                   // The graph itself comes from the context, never from a prop
                   // (ui/GraphContext.tsx explains what a prop would cost).
  minutes: number; // shadows are computed for exactly this time (W7)
  day: string; // yyyy-mm-dd
  start: LngLat | null;
  dest: LngLat | null;
  routeLines: FeatureCollection;
  routeRaw: FeatureCollection; // debug: undecorated router edges of the selected route
  connectorLines: FeatureCollection; // pin -> nearest walkable point, grey dashes
  ghostLines?: FeatureCollection; // the route being replaced, dashed and grey
  onMapClick: (p: LngLat) => void;
  onFeatureTap?: (f: MapFeature) => void;
  onLongPress?: (p: LngLat) => void;
  /** Bring this point into view when it changes — the place and pin cards
   *  recentre the map on their subject (Task 11, 2026-09-05). */
  focus?: LngLat | null;
  /** Bumped by the shell on every focus request: the same point asked for
   *  twice is still two recentres (a "Show Frankfurt" tapped while the map
   *  already sits there must still visibly answer). */
  focusSeq?: number;
  /** The zoom `focus` asks for, when it asks for one — only the first GPS
   *  fix of a page load does (ui/firstFix.ts). Null keeps the map's own,
   *  which is what every other recentre wants. The shell sends null whenever
   *  `focus` is the DESTINATION pin rather than the point it asked for: the
   *  zoom belongs to the request, not to the prop it rides in on. */
  focusZoom?: number | null;
  /** Fit this box into the part of the map the sheet or panel leaves free —
   *  the routes and loops screens show the whole walk. Wins over `focus`
   *  while set; keyed on the box, so a new selection on the same plan does
   *  not move the map. */
  fit?: MapFit | null;
  gpsPos: LngLat | null;
  walkPos?: LngLat | null; // legacy alias of gpsPos (the debug page's walk simulator)
  /** Which way the walker faces, degrees clockwise from north, while a walk
   *  is navigated (ui/useHeading.ts) — the dot becomes an arrow pointing that
   *  way. Null, and it is the dot: every other screen, and a walker whose
   *  phone cannot say. The marker is MAP-aligned, so this is a true heading
   *  and MapLibre takes the camera's bearing off it on every move. */
  heading?: number | null;
  following: boolean;
  /** The walk's camera (HANDOVER §4.3): while navigating and following, the
   *  map sits on the walker at z17, turned the way the route runs and flat.
   *  Null on every other screen, where `following` alone recentres and the
   *  reader keeps their own zoom and bearing. */
  navCam?: { bearing: number } | null;
  onUserPan: () => void;
  /** Where the map is looking, after every move it settles from. Two
   *  readers, neither of which draws it: the report sheet's "attach my map
   *  position" toggle (slice 7) and the resume snapshot (B4). Both are
   *  handed a getter, so nothing re-renders on a pan. */
  onCamera?: (c: Camera) => void;
  /** The camera a reload comes back on (ui/resume.ts). Read ONCE, in the
   *  map's constructor: a camera applied a frame later is a jump the reader
   *  can see. It also stands the plan's first `fit` down — the whole point
   *  is to come back to the map the reader left, not to the box the walk
   *  fits in — and the first `bearing` reset with it. Every later fit, focus
   *  and city switch behaves exactly as it does on a fresh visit. */
  initialCamera?: Camera | null;
  /** One of the map's sources could not load (QA F2-08). Called at most once
   *  per kind per map: MapLibre raises this per tile and per retry, and the
   *  walker needs telling once. `message` is for the log, `kind` for the
   *  decision — see ui/useMapErrors.ts. */
  onMapError?: (kind: MapErrorKind, message: string) => void;
  /** The basemap has DRAWN — the style is in and the tiles for the opening
   *  view have landed. Called at most once per map.
   *
   *  The shell holds the 4–34 MB graph core back until this fires (round 3,
   *  item 12: "make the map load ASAP, the tiles themselves. Rest can be
   *  post-loaded"), so a reader gets a map to look at rather than a spinner
   *  over a blank one. `idle` is "everything the current view needs has
   *  landed"; `load` is the style's own end. On a style whose last glyph
   *  range never arrives it is `idle` that comes first, and on a map with
   *  nothing left to fetch it is `load` — so both are listened for and the
   *  first of them wins. The shell caps the wait anyway (ui/bootPhase.ts):
   *  a basemap that never paints must not starve routing for ever. */
  onPainted?: () => void;
};

/** Was the page opened with `?debug`? Read once, at import time, because it
 *  is no longer true by the time this component's second mount runs: the
 *  history hook replaces the address bar with the share URL on the first
 *  render, and `?debug` is not part of that. Under StrictMode the map is
 *  built, torn down and built again — so a re-read left `window.__swMap`
 *  pointing at the REMOVED first map, whose `loaded()` is false for ever.
 *  That is what the screenshot suite waits on (e2e/snapshots.spec.ts). */
const DEBUG_HANDLE =
  typeof location !== "undefined" && new URLSearchParams(location.search).has("debug");

export default function MapView({
  city,
  basemap,
  theme,
  shadeOn,
  noiseOn,
  waysOn,
  minutes,
  day,
  start,
  dest,
  routeLines,
  routeRaw,
  connectorLines,
  ghostLines,
  onMapClick,
  onFeatureTap,
  onLongPress,
  focus,
  focusSeq = 0,
  focusZoom = null,
  fit,
  gpsPos,
  walkPos = null,
  heading = null,
  following,
  navCam,
  onUserPan,
  onCamera,
  initialCamera,
  onMapError,
  onPainted,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const shadeLayer = useRef<ShadeLayer | null>(null);
  const [mapReady, setMapReady] = useState(false); // effects that need the map on first mount key on this
  const borderRef = useRef<BorderGeom | null>(null); // the shade layer is created lazily; it takes this then
  /** Guards for a restored camera (B4, ui/resume.ts). The three moves the
   *  app makes on its own as a screen comes up — the plan's fit, the card's
   *  focus and the "back to north" a walk's end leaves behind — would each
   *  undo it, so on a resumed page load each is stood down once. `fitDone`
   *  holds the BOX rather than a flag: the sheet's height lands a frame
   *  after the plan and re-fits the same walk with new padding, and the
   *  reader's camera has to survive that too. `focusHeld` holds the card's
   *  subject for the same reason: `mapReady` re-runs both effects once the
   *  map is built. A fit for a different box, or a focus on a different
   *  subject, is a different question, and takes the map. */
  const resumed = useRef(initialCamera != null);
  const fitDone = useRef<string | null>(null);
  /** `performance.now()` past which a repeat of the boot's own fit is the
   *  reader asking rather than the sheet settling (finding 3). */
  const fitSettled = useRef(0);
  const focusHeld = useRef<string | null>(null);
  const northed = useRef(initialCamera != null);
  const startMarker = useRef<Marker | null>(null);
  const destMarker = useRef<Marker | null>(null);
  const gpsMarker = useRef<Marker | null>(null);
  const dot = gpsPos ?? walkPos;

  // The map's text is imperative, not React's: the attribution control is
  // built from the style's `attribution` and the border label from a
  // setLayoutProperty. Reading the locale HERE, during render, is what makes
  // it a dependency of both — without it a language tap re-rendered the
  // whole shell and left the map speaking the old one (review B6). setLocale
  // has already run by the time this renders (useSettings patches
  // synchronously before setState).
  const locale = getLocale();

  // ?debug Ways only. Read here rather than taken as a prop — see
  // ui/GraphContext.tsx for the 150-second reason.
  const contextGraph = useGraph();

  // Handlers and data the style-reinstall path needs, always current: the
  // "style.load" listener is registered once, so it may only read refs.
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const panRef = useRef(onUserPan);
  panRef.current = onUserPan;
  const cameraRef = useRef(onCamera);
  cameraRef.current = onCamera;
  const tapRef = useRef(onFeatureTap);
  tapRef.current = onFeatureTap;
  const errorRef = useRef(onMapError);
  errorRef.current = onMapError;
  const paintedRef = useRef(onPainted);
  paintedRef.current = onPainted;
  const pressRef = useRef(onLongPress);
  pressRef.current = onLongPress;
  const waysRefresh = useRef<(() => void) | null>(null); // set by the ways effect, called after a style rebuild
  const waysGraph = waysOn ? contextGraph : null;
  const st = useRef({ city, theme, shadeOn, noiseOn, minutes, day, routeLines, routeRaw, connectorLines, ghostLines, waysGraph });
  st.current = { city, theme, shadeOn, noiseOn, minutes, day, routeLines, routeRaw, connectorLines, ghostLines, waysGraph };

  /** Add our sources and layers to a freshly loaded style, then push the
   *  current data into them. Runs at boot and after every setStyle. */
  const installLayers = (m: LibreMap) => {
    const s = st.current;
    const ink = INK[s.theme];
    // Additive, so this is safe on any style — including one that already
    // carries some of ours. The shade layer is the exception: it is always
    // rebuilt, because setStyle frees its GL resources.
    const addSource = (id: string, spec: Parameters<LibreMap["addSource"]>[1]) => {
      if (!m.getSource(id)) m.addSource(id, spec);
    };
    const addLayer = (spec: Parameters<LibreMap["addLayer"]>[0], before?: string) => {
      if (!m.getLayer(spec.id)) m.addLayer(spec, before);
    };
    addSource("routes", { type: "geojson", data: emptyFC() });
    addSource("routes-ghost", { type: "geojson", data: emptyFC() });
    addSource("ways", { type: "geojson", data: emptyFC() });
    addSource("route-raw", { type: "geojson", data: emptyFC() }); // debug: router's edges, undecorated
    addSource("connectors", { type: "geojson", data: emptyFC() });
    addSource("border", { type: "geojson", data: emptyFC() });
    addSource("border-wash", { type: "geojson", data: emptyFC() });
    addSource("noise", {
      type: "raster",
      tiles: [noiseTiles(s.city)],
      tileSize: 256,
      minzoom: 11,
      maxzoom: 16,
    });

    addLayer({
      id: "noise",
      type: "raster",
      source: "noise",
      layout: { visibility: "none" },
      paint: { "raster-opacity": 1, "raster-fade-duration": 0, "raster-resampling": "linear" },
    });
    addLayer({
      // outside the city's data there is no shade and no routing: wash it
      // back so the covered area reads as the map (2026-09-05)
      id: "border-wash",
      type: "fill",
      source: "border-wash",
      paint: { "fill-color": ink.borderWash },
    });
    addLayer({
      // debug: graph edges by class (see waysClass)
      id: "ways",
      type: "line",
      source: "ways",
      layout: { visibility: "none" },
      paint: {
        "line-color": [
          "match", ["get", "cls"],
          "sw2", "#d7191c", // strong sidewalk (footway <= 12 m / tagged)
          "sw1", "#f28e7c", // weak sidewalk (path beside street / 12-18 m)
          "road_sw", "#2c7bb6", // carriageway with a sidewalk (penalised)
          "road", "#a0a0a0", // street without mapped sidewalk (walkable, drawn offset)
          "xing", "#7b3294", // crossing (fixed cost)
          "cycx", "#1a9850", // cycle crossing (4x crossing cost)
          "ctr", "#8c510a", // walk centred: car-free road / sidewalk=no
          "major_sw", "#08306b", // major road carriageway with a sidewalk (20/m)
          "#f6b26b", // other pedestrian paths
        ] as never,
        "line-width": 2,
        "line-opacity": 0.9,
      },
    });
    addLayer({
      // the route that is being replaced, so the change reads as a change
      id: "routes-ghost",
      type: "line",
      source: "routes-ghost",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": GHOST, "line-width": 4, "line-dasharray": [3, 8] as never },
    });
    addLayer({
      // The alternatives' casing, in a layer of its own (CR-05 edit 7).
      //
      // It used to be one `case` inside route-casing, which drew the right
      // pixels and said the wrong thing: the selected route's casing
      // separates it from a street, the alternative's has to survive a park.
      // The two are already a different colour on the dark theme's terms
      // (tokens overlay.route.altCasing / overlay.routeDark.altCasing) and
      // will go on being tuned for different reasons. It sits BELOW
      // route-casing, which is where the sort-key used to put it: where the
      // two routes run together, the selected one still wins.
      id: "route-alt-casing",
      type: "line",
      source: "routes",
      filter: ["!", ["get", "selected"]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ink.routeAltCasing, "line-width": 7 },
    });
    addLayer({
      id: "route-casing",
      type: "line",
      source: "routes",
      filter: ["get", "selected"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ink.routeCasing, "line-width": 10 },
    });
    addLayer({
      id: "route-line",
      type: "line",
      source: "routes",
      layout: {
        "line-cap": "round",
        "line-join": "round",
        "line-sort-key": ["case", ["get", "selected"], 1, 0] as never,
      },
      paint: {
        "line-color": ["case", ["get", "selected"], ink.route, ink.routeAlt] as never,
        "line-width": ["case", ["get", "selected"], 7, 5] as never,
        "line-opacity": ["case", ["get", "selected"], 1, 0.9] as never,
      },
    });
    addLayer({
      id: "connector-line",
      type: "line",
      source: "connectors",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#7a7f87", "line-width": 3, "line-opacity": 0.85, "line-dasharray": [0.8, 1.6] as never },
    });
    addLayer({
      id: "route-raw",
      type: "line",
      source: "route-raw",
      layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#e91e8c", "line-width": 2, "line-dasharray": [2, 1] as never },
    });
    addLayer({
      // where the data ends: a light line on the city's border
      id: "border",
      type: "line",
      source: "border",
      paint: { "line-color": BORDER_INK, "line-width": 1.5, "line-opacity": 0.55, "line-dasharray": [3, 2] as never },
    });
    addLayer({
      // …and it says so, along the line itself
      id: "border-label",
      type: "symbol",
      source: "border",
      layout: {
        "text-field": t("map.borderLabel", { city: t(`city.${s.city.id}`) }),
        "text-font": ["Noto Sans Medium"],
        "text-size": 11,
        "symbol-placement": "line",
        "symbol-spacing": 400,
        // 20 was the drawing's value; a real administrative outline is too
        // jagged for it and the label then never places at all (measured
        // 2026-09-05). 30 is still well under maplibre's 45 default.
        "text-max-angle": 30,
      },
      paint: {
        "text-color": BORDER_INK,
        "text-opacity": 0.8,
        "text-halo-color": ink.page,
        "text-halo-width": 1.2,
      },
    });

    // the shade overlay sits under the routes and over the basemap. A
    // custom layer can outlive its style (it did, when setStyle still
    // diffed), and addLayer over a live id throws — so clear it first.
    if (m.getLayer("shade-live")) m.removeLayer("shade-live");
    shadeLayer.current = new ShadeLayer(s.minutes, s.day, s.city);
    shadeLayer.current.setBorder(borderRef.current);
    m.addLayer(shadeLayer.current, "route-alt-casing");
    shadeLayer.current.setVisible(s.shadeOn);
    // the layer is rebuilt by every setStyle, so the handle is re-hung here
    // rather than once at boot (?debug only, like __swMap)
    if (DEBUG_HANDLE) {
      (window as unknown as { __swShade: ShadeLayer }).__swShade = shadeLayer.current;
    }

    // push whatever the app is holding right now
    (m.getSource("routes") as GeoJSONSource).setData(s.routeLines);
    (m.getSource("routes-ghost") as GeoJSONSource).setData(s.ghostLines ?? emptyFC());
    (m.getSource("route-raw") as GeoJSONSource).setData(s.routeRaw);
    (m.getSource("connectors") as GeoJSONSource).setData(s.connectorLines);
    pushBorder(m);
    m.setLayoutProperty("noise", "visibility", s.noiseOn ? "visible" : "none");
    m.setLayoutProperty("ways", "visibility", s.waysGraph ? "visible" : "none");
    m.setLayoutProperty("route-raw", "visibility", s.waysGraph ? "visible" : "none");
    if (s.waysGraph) waysRefresh.current?.(); // the edges in view, redrawn into the new source
  };

  /** The border line, the wash around it, and the shade layer's clip. */
  const pushBorder = (m: LibreMap) => {
    const g = borderRef.current;
    const line = g ? ({ type: "Feature", properties: {}, geometry: g } as Feature) : null;
    (m.getSource("border") as GeoJSONSource | undefined)?.setData(line ?? emptyFC());
    (m.getSource("border-wash") as GeoJSONSource | undefined)?.setData(washFeature(g) ?? emptyFC());
    shadeLayer.current?.setBorder(g);
  };

  // Move to the selected city. maxBounds has to widen BEFORE the move, or
  // maplibre clamps the target back into the old city's box and nothing
  // appears to happen (2026-08-30).
  //
  // A jump, not a fly: a city switch is a reset, not a journey, and 800 ms
  // of Europe sliding past read as the map drifting off (slice 9 review F1
  // for reduced motion; Viktor 2026-09-08 for everyone).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    m.setMaxBounds(pad(city.bounds));
    m.jumpTo({ center: city.center, zoom: 13, bearing: 0, pitch: 0 });
    // per-city overlays follow the selection (2026-09-01)
    (m.getSource("noise") as RasterTileSource | undefined)?.setTiles([noiseTiles(city)]);
    // the label names the city, and on the raster basemap no style rebuild
    // follows a city switch to re-create it
    if (m.getLayer("border-label")) {
      m.setLayoutProperty("border-label", "text-field", t("map.borderLabel", { city: t(`city.${city.id}`) }));
    }
    shadeLayer.current?.setCity(city);
    // `locale`: the border label is set here, and a language change does not
    // otherwise reach it (review B6)
  }, [city, locale]);

  // the city's border: line layer + wash + shade clip (2026-09-02)
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    let cancelled = false;
    fetch(borderUrl(city.id))
      .then((r) => (r.ok ? (r.json() as Promise<GeoJSON.Feature>) : null))
      .then((f) => {
        if (cancelled) return;
        borderRef.current = (f?.geometry as BorderGeom | undefined) ?? null;
        pushBorder(m);
      })
      .catch(() => {
        if (cancelled) return;
        borderRef.current = null;
        pushBorder(m);
      });
    return () => {
      cancelled = true;
    };
  }, [city, mapReady]);

  useEffect(() => {
    if (!el.current || map.current) return;
    const protocol = new Protocol();
    addProtocol("pmtiles", protocol.tile);
    const m = new LibreMap({
      container: el.current,
      center: initialCamera?.center ?? city.center,
      zoom: initialCamera?.zoom ?? 13,
      bearing: initialCamera?.bearing ?? 0,
      pitch: initialCamera?.pitch ?? 0,
      minZoom: 10,
      maxBounds: pad(city.bounds),
      attributionControl: false,
      locale: mapLocale(),
      style: buildStyle(city, basemap, theme),
    });
    const credit = new AttributionControl({ compact: true });
    m.addControl(credit);
    // maplibre opens the compact credit the first time the attribution is
    // non-empty and leaves it open until tapped; on a phone that is a
    // permanent strip over the map (Viktor, 2026-09-07). It is folded here
    // so the (i) stays a tap away and the full text lives in Settings →
    // Data & sources.
    //
    // The fold used to be `m.once("load", …)`, which is a RACE the phone
    // loses (B2). `load` fires only once the whole style has landed —
    // glyphs, sprite and the first tiles — while the credit is opened as
    // soon as the pmtiles source reports its attribution, which is far
    // earlier. Any asset that is merely slow, or never arrives at all,
    // leaves `load` unfired and the credit open for good: with the glyph
    // range hung, a 390 px phone shows a 370 px "© OpenStreetMap
    // contributors · Protomaps" strip over the map, exactly what Viktor
    // photographed. And a phone is where that happens — the app is pulling
    // a 7-36 MB graph down the same pipe.
    //
    // So the timing is taken out of it. The one branch of maplibre's
    // `_updateCompact` that OPENS the control is guarded on the container
    // not already carrying `maplibregl-compact`, and with `compact: true`
    // nothing ever removes that class again. Wearing it from the start
    // means maplibre can no longer open the credit on its own, at any
    // moment, on any style — only the reader's tap on the (i) can.
    credit._container?.classList.add("maplibregl-compact");
    // …and the fold itself stays, once per style: `style.load` fires on the
    // first one and again after every setStyle (theme, city, language), so
    // a credit left open — by a tap, or by a maplibre that ever changes its
    // mind — is folded back with the map it belongs to.
    const foldCredit = () => credit._container?.classList.remove("maplibregl-compact-show");
    foldCredit();
    m.on("style.load", foldCredit);
    m.addControl(new NavigationControl({ showCompass: false }));
    // fires on the first style and again after every setStyle
    m.on("style.load", () => installLayers(m));
    // Any gesture the READER made hands the map back to them — a drag, a
    // pinch or wheel zoom, a two-finger rotate. `dragstart` alone was enough
    // while following only re-centred; now that it also forces zoom 17 and a
    // bearing, a pinch that was not answered snapped straight back on the
    // next fix (fix round 1, B-4). `originalEvent` is what separates the
    // reader's gesture from the app's own easeTo, which raises the same
    // events with none.
    for (const ev of ["movestart", "zoomstart", "rotatestart"] as const) {
      m.on(ev, (e: { originalEvent?: unknown }) => {
        if (e.originalEvent) panRef.current();
      });
    }
    // ...and the wheel separately, because MapLibre's scroll zoom is
    // animated: it raises `movestart`/`zoomstart` from its own frame loop,
    // with no `originalEvent` to recognise the reader by. The raw `wheel`
    // it re-emits does carry one (verified in host Chromium — a pinch comes
    // through the guarded pair above, a wheel only through this).
    m.on("wheel", () => panRef.current());
    // The centre, published on every settled move — and once on load, so a
    // map nobody has touched still has one.
    const publishCamera = () => {
      const c = m.getCenter();
      cameraRef.current?.({
        center: [c.lng, c.lat],
        zoom: m.getZoom(),
        bearing: m.getBearing(),
        pitch: m.getPitch(),
      });
    };
    m.on("moveend", publishCamera);
    m.on("load", publishCamera);
    // …and the first paint, once (round 3, item 12). Whichever of the two
    // arrives first is the one the shell hears about.
    let painted = false;
    const paint = () => {
      if (painted) return;
      painted = true;
      debugLog.current?.("map: first paint");
      paintedRef.current?.();
    };
    m.on("idle", paint);
    m.on("load", paint);
    // One failing source raises this once per tile, per frame, per retry;
    // the shell hears about each kind exactly once per map (QA F2-08).
    const told = new Set<MapErrorKind>();
    m.on("error", (e) => {
      const message = String(e.error?.message ?? e);
      debugLog.current?.(`map error: ${message}`);
      const kind = mapErrorKind((e as { sourceId?: string }).sourceId, message);
      if (told.has(kind)) return;
      told.add(kind);
      errorRef.current?.(kind, message);
    });

    // A tap on a named POI is a place, not a coordinate (2026-09-05).
    const suppressClick = { v: false };
    m.on("click", (e) => {
      if (suppressClick.v) {
        suppressClick.v = false; // the click that closes a long press
        return;
      }
      const tap = tapRef.current;
      // BOTH POI layers: since CR-03 table C the landmark kinds are a clone
      // of `pois` drawn from z14 (mapTheme.ts, `EARLY_POIS`), and a park
      // name a reader can see at z15 has to be a park name they can tap.
      // Filtered by what the style actually has, because the raster basemap
      // has neither.
      const poiLayers = ["pois", "pois-landmarks"].filter((id) => m.getLayer(id));
      if (tap && poiLayers.length > 0) {
        const hit = m
          .queryRenderedFeatures(e.point, { layers: poiLayers })
          .find((f) => typeof f.properties?.name === "string" && f.properties.name && f.geometry.type === "Point");
        if (hit && hit.geometry.type === "Point") {
          const [lng, lat] = hit.geometry.coordinates as [number, number];
          tap({ name: String(hit.properties.name), kind: String(hit.properties.kind ?? ""), lng, lat });
          return;
        }
      }
      clickRef.current([e.lngLat.lng, e.lngLat.lat]);
    });

    // Long press = "do something with this spot". 350 ms (500 felt slow on
    // the phone, Viktor 2026-09-08), cancelled by a
    // drag of more than a few pixels so panning never triggers it.
    const canvas = m.getCanvasContainer();
    let timer = 0;
    let from: { x: number; y: number } | null = null;
    const cancel = () => {
      window.clearTimeout(timer);
      timer = 0;
      from = null;
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return; // right-click is contextmenu
      cancel();
      suppressClick.v = false;
      from = { x: e.clientX, y: e.clientY };
      const r = canvas.getBoundingClientRect();
      const pt: [number, number] = [e.clientX - r.left, e.clientY - r.top];
      timer = window.setTimeout(() => {
        timer = 0;
        from = null;
        suppressClick.v = true;
        const ll = m.unproject(pt);
        pressRef.current?.([ll.lng, ll.lat]);
      }, LONG_PRESS_MS);
    };
    const onMove = (e: PointerEvent) => {
      if (!from) return;
      if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > LONG_PRESS_SLOP) cancel();
    };
    canvas.addEventListener("pointerdown", onDown);
    // on window, not the canvas: a finger lifted over a panel (or off the
    // map entirely) must still cancel the timer
    window.addEventListener("pointerup", cancel);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("pointermove", onMove);
    m.on("contextmenu", (e) => {
      if (suppressClick.v) return; // the touch long press already fired
      cancel();
      pressRef.current?.([e.lngLat.lng, e.lngLat.lat]);
    });

    if (DEBUG_HANDLE) {
      (window as unknown as { __swMap: LibreMap }).__swMap = m;
    }
    map.current = m;
    // The restore guards belong to THIS map: React's dev StrictMode builds
    // the map, tears it down and builds it again, and a guard spent by the
    // first one would leave the second's camera to be overwritten by the
    // very fit it is there to stand down (B4).
    resumed.current = initialCamera != null;
    fitDone.current = null;
    fitSettled.current = 0;
    focusHeld.current = null;
    northed.current = initialCamera != null;
    styleOnMap.current = styleKey; // a remount rebuilds the map with this style
    setMapReady(true);
    return () => {
      cancel();
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", cancel);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("pointermove", onMove);
      m.remove();
      map.current = null;
      shadeLayer.current = null;
      setMapReady(false);
    };
  }, []);

  // Theme, basemap, city basemap or LOCALE change: the style is rebuilt,
  // which drops every source, layer and the custom shade layer —
  // "style.load" puts them all back.
  //
  // The locale is in the key for the reason given where it is read.
  const styleKey = `${basemap}|${theme}|${city.basemap}|${locale}`;
  const styleOnMap = useRef(styleKey); // the style the map was BUILT with
  useEffect(() => {
    const m = map.current;
    if (!m || styleOnMap.current === styleKey) return;
    styleOnMap.current = styleKey;
    shadeLayer.current = null; // the old layer goes with the old style
    // diff: false is required, not a preference: a diffed setStyle keeps
    // the custom shade layer alive on the new style, and installLayers
    // then throws adding its replacement (2026-09-05)
    m.setStyle(buildStyle(city, basemap, theme), { diff: false });
  }, [styleKey]);

  // The `locale` option above labels the controls when the map is BUILT, and
  // the map is built once. A language tap has to relabel the buttons the
  // library already made — there is no setLocale on Map, and reaching into
  // its private `_locale` to re-add the controls would cost more than three
  // attribute writes.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const root = m.getContainer();
    const label = (sel: string, text: string) => {
      const el = root.querySelector(sel);
      if (!el) return;
      el.setAttribute("aria-label", text);
      el.setAttribute("title", text);
    };
    label(".maplibregl-ctrl-zoom-in", t("map.zoomIn"));
    label(".maplibregl-ctrl-zoom-out", t("map.zoomOut"));
    label(".maplibregl-ctrl-attrib-button", t("map.attributionToggle"));
    root.querySelector(".maplibregl-canvas")?.setAttribute("aria-label", t("map.title"));
  }, [locale, mapReady]);

  // NOTE: isStyleLoaded() flickers false during tile loads and "load"
  // fires exactly once — checking for the layer/source itself is the only
  // race-free readiness test (bug found via URL-boot E2E 2026-08-14)
  // W7 live shade: a custom GL layer under the routes; time + visibility
  // are pushed into it (it repaints itself)
  useEffect(() => {
    shadeLayer.current?.setTime(liveMinute() ?? minutes, day);
    shadeLayer.current?.setVisible(shadeOn);
  }, [shadeOn, minutes, day, mapReady]);
  // ...and the minute the reader is holding on the day scrubber reaches the
  // layer without a render in between (ui/scrubLive.ts): the throttled
  // `scrub` dispatch is for the rest of the shell, the overlay is per-frame.
  useEffect(() => {
    if (!mapReady) return;
    return subscribeLive((live) => {
      shadeLayer.current?.setTime(live ?? st.current.minutes, st.current.day);
    });
  }, [mapReady]);

  // ?debug ways overlay: edges whose source node is in view, refreshed at rest
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const g = waysGraph;
    const refresh = () => {
      if (!g) return;
      const b = m.getBounds();
      const feats: GeoJSON.Feature[] = [];
      for (let e = 0; e < g.nEdges; e++) {
        const u = g.edgeSource[e];
        if (g.lat[u] < b.getSouth() || g.lat[u] > b.getNorth() || g.lng[u] < b.getWest() || g.lng[u] > b.getEast()) continue;
        if (u > g.edgeTarget[e]) continue; // one direction only
        const f = g.flags[e];
        const cls = f & 128 ? "ctr" : f & 64 ? "cycx" : f & 16 ? "sw2" : (f & 8 && !(f & 1)) ? "sw1" : f & 4 ? "xing"
          : (f & 34) === 34 ? "major_sw" : f & 2 ? "road_sw" : f & 1 ? "road" : "path";
        feats.push({ type: "Feature", properties: { cls }, geometry: { type: "LineString", coordinates: edgeLatLngs(g, e) } });
      }
      (m.getSource("ways") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: feats });
    };
    waysRefresh.current = refresh;
    const apply = () => {
      if (!m.getLayer("ways")) return;
      m.setLayoutProperty("ways", "visibility", g ? "visible" : "none");
      m.setLayoutProperty("route-raw", "visibility", g ? "visible" : "none");
      if (g) refresh();
    };
    apply();
    if (!g) return;
    m.on("moveend", refresh);
    return () => {
      m.off("moveend", refresh);
      waysRefresh.current = null;
    };
  }, [waysGraph, mapReady]);

  useEffect(() => {
    const m = map.current;
    if (!m || !m.getLayer("noise")) return;
    m.setLayoutProperty("noise", "visibility", noiseOn ? "visible" : "none");
  }, [noiseOn, mapReady]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    (m.getSource("routes") as GeoJSONSource | undefined)?.setData(routeLines);
    (m.getSource("routes-ghost") as GeoJSONSource | undefined)?.setData(ghostLines ?? emptyFC());
    (m.getSource("route-raw") as GeoJSONSource | undefined)?.setData(routeRaw);
    (m.getSource("connectors") as GeoJSONSource | undefined)?.setData(connectorLines);
  }, [routeLines, routeRaw, connectorLines, ghostLines, mapReady]);

  // A destroyed map takes its markers with it; the refs must go too, or the
  // next map is handed a Marker that is no longer attached to anything.
  useEffect(() => {
    if (mapReady) return;
    startMarker.current = null;
    destMarker.current = null;
  }, [mapReady]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    startMarker.current = syncMarker(m, startMarker.current, start, "#f5b942");
    destMarker.current = syncMarker(m, destMarker.current, dest, "#3d4a6b");
    // mapReady: a share link carries its pins BEFORE the map exists and the
    // arrays never change again, so without it such a link drew no pins at
    // all (found by Task 12's E2E, 2026-09-05)
  }, [start, dest, mapReady]);

  // A hidden tab hands its DSM tiles and its atlas back (backlog B4). The
  // shade overlay is the biggest thing on this page that can be given up
  // without losing anything the reader would see: a tab that is smaller is a
  // tab the browser is less likely to discard while it is away. The noise
  // raster and the basemap are MapLibre's own, far smaller, and dropping
  // them would blank the map on the way back in.
  useEffect(() => {
    const onVisibility = () =>
      shadeLayer.current?.setPageHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Recentre on the place or pin a card is about. Keyed on the coordinates,
  // not the array: the same point in a new array is not a new focus.
  const focusKey = focus ? `${focusSeq}:${focus[0].toFixed(5)},${focus[1].toFixed(5)}` : "";
  useEffect(() => {
    const m = map.current;
    if (!m || !focus || fit || !isLngLat(focus)) return;
    // the card the reader was already looking at does not recentre a
    // restored camera; the next card they open does (B4)
    if (resumed.current) {
      if (focusHeld.current === null || focusHeld.current === focusKey) {
        focusHeld.current = focusKey;
        return;
      }
      resumed.current = false;
    }
    goTo(m, focus, focusZoom);
  }, [focusKey, mapReady]);

  // Fit the whole walk: keyed on the box, so the same plan re-selected or
  // re-rendered does not move a map the reader may have panned.
  // …and on the padding: the sheet's height arrives a frame after the plan
  // (and changes with every snap), and a fit padded for the previous sheet
  // left the walk sitting under the new one (a phone, 2026-09-08)
  const fitKey = fit
    ? `${fit.bounds.flat().map((v) => v.toFixed(5)).join(",")}|${Object.values(fit.padding).join(",")}`
    : "";
  useEffect(() => {
    const m = map.current;
    if (!m || !fit || !fit.bounds.every(isLngLat)) return;
    // A restored camera is the reader's own, and it wins over the fit for
    // the walk they were already looking at (B4) — but ONCE, and only for
    // the fits the page load itself asks for. `fitSettled` is what the boot
    // spends: the plan's own fit, and the same box again a frame later when
    // the sheet's measured height changes the padding. The moment a fit
    // arrives that the RESUME did not cause — the reader dragging the sheet
    // to another rung, promoting a candidate, a new plan — the guard is
    // spent and the map re-frames exactly as it does on a fresh visit
    // (S6 review, finding 3: it used to hold the BOX, which is invariant
    // across both of those, so the map never re-framed again for the life
    // of the plan). `RESUME_SETTLE_MS` is the boot's own settling window,
    // not a debounce: nothing the reader can do arrives inside it.
    if (resumed.current) {
      const box = fit.bounds.flat().join(",");
      const fresh = fitDone.current === null;
      if (fresh || (fitDone.current === box && performance.now() < fitSettled.current)) {
        if (fresh) fitSettled.current = performance.now() + RESUME_SETTLE_MS;
        fitDone.current = box;
        return;
      }
      resumed.current = false;
    }
    m.fitBounds(fit.bounds, {
      padding: fit.padding,
      maxZoom: 16,
      duration: stillPlease() ? 0 : 600,
    });
  }, [fitKey, mapReady]);

  // F7 blue dot: Komoot-style screen-on following, no turn instructions
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!dot || !isLngLat(dot)) {
      gpsMarker.current?.remove();
      gpsMarker.current = null;
      return;
    }
    if (!gpsMarker.current) {
      const d = document.createElement("div");
      d.className = "gps-dot";
      d.appendChild(arrowSvg());
      // map-aligned: `setRotation` takes a compass heading and MapLibre
      // draws it minus the camera's bearing (a circle does not mind).
      // Pitch stays the viewport's, or the dot would flatten on a tilt.
      gpsMarker.current = new Marker({ element: d, rotationAlignment: "map", pitchAlignment: "viewport" })
        .setLngLat(dot)
        .addTo(m);
    } else {
      gpsMarker.current.setLngLat(dot);
    }
    if (!following) return;
    if (!navCam) {
      goTo(m, dot);
      return;
    }
    // the walk's own camera: on the walker, at walking zoom, pointed along
    // the route (HANDOVER §4.3). Reduced motion gets the same frame without
    // the glide — `goTo`'s rule, applied to four properties instead of one.
    if (!isLngLat(dot)) return;
    const at = { center: dot, zoom: NAV_ZOOM, bearing: navCam.bearing, pitch: 0 };
    if (stillPlease()) m.jumpTo(at);
    else m.easeTo({ ...at, duration: 600 });
  }, [dot, following, navCam?.bearing]);

  // ...and a heading turns the dot into an arrow pointing that way
  // (2026-09-16, DECISIONS). The walk's camera turns WITH the route
  // (`navCam`), so the arrow is handed the true heading and the map-aligned
  // marker subtracts the bearing itself — the arrow points up the screen
  // exactly when the walker faces the way the map is turned. Keyed on `dot`
  // too: the marker is made by the effect above, on the first fix.
  //
  // The turn is EASED. A heading arrives with its fix, once a second, and
  // an arrow that jumped with it read as stutter on a real walk (owner,
  // same day). So `shown` is what is drawn, `target` what was asked for,
  // and a requestAnimationFrame loop walks the one onto the other
  // (ui/heading.ts `easeHeading`, the short way round) — running only while
  // they differ, and not at all until this walk's first heading, which is
  // put on rather than turned to.
  const shownRot = useRef<number | null>(null);
  const targetRot = useRef(0);
  const raf = useRef(0);
  useEffect(() => {
    const mk = gpsMarker.current;
    if (!mk) return;
    mk.getElement().classList.toggle("is-arrow", heading !== null);
    if (heading === null) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      shownRot.current = null;
      mk.setRotation(0);
      return;
    }
    targetRot.current = normDeg(heading);
    if (shownRot.current === null) shownRot.current = targetRot.current;
    if (shownRot.current === targetRot.current) {
      // nothing to turn — but a marker just (re)made needs telling
      mk.setRotation(targetRot.current);
      return;
    }
    if (raf.current) return; // the loop is running and reads the new target
    let last = performance.now();
    const tick = (now: number) => {
      const m = gpsMarker.current;
      const cur = shownRot.current;
      if (!m || cur === null) {
        raf.current = 0;
        return;
      }
      const next = easeHeading(cur, targetRot.current, now - last);
      last = now;
      shownRot.current = next;
      m.setRotation(next);
      raf.current = next === targetRot.current ? 0 : requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [dot, heading]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // ...and the walk ending puts the map back on north. Nothing else in the
  // app rotates it, so a route list drawn sideways after End would be a
  // heading nobody set.
  const navOn = navCam !== null && navCam !== undefined;
  useEffect(() => {
    const m = map.current;
    if (!m || navOn) return;
    // A map already facing north needs no putting back — but the guard has
    // to be stood down on the way past, or a resume onto a north-up camera
    // (the common case) leaves it armed and spends it on the first genuine
    // "the walk ended, go back to north" instead (S6 review, finding 7).
    if (m.getBearing() === 0 && m.getPitch() === 0) {
      northed.current = false;
      return;
    }
    // ...except on the render a restored camera arrived on: a reader who
    // left the map turned comes back to it turned (B4).
    if (northed.current) {
      northed.current = false;
      return;
    }
    if (stillPlease()) m.jumpTo({ bearing: 0, pitch: 0 });
    else m.easeTo({ bearing: 0, pitch: 0, duration: 400 });
  }, [navOn]);

  return <div ref={el} className="map" />;
}

/** The heading arrow inside the GPS marker: a chevron pointing up (north)
 *  that the marker's rotation turns. Hidden until `.is-arrow`; the ring,
 *  the blue and the size are `.gps-arrow`'s (index.css). */
function arrowSvg(): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "gps-arrow");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", "M12 3 L20 21 L12 17 L4 21 Z");
  svg.appendChild(p);
  return svg;
}

function syncMarker(
  m: LibreMap,
  marker: Marker | null,
  pos: LngLat | null,
  color: string
): Marker | null {
  if (!pos || !isLngLat(pos)) {
    marker?.remove();
    return null;
  }
  if (marker) {
    marker.setLngLat(pos);
    return marker;
  }
  return new Marker({ color }).setLngLat(pos).addTo(m);
}

export function emptyFC(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
