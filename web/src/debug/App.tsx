import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";
import MapView, { emptyFC, type LngLat } from "../components/MapView";
import { todayKey } from "../shade/sun";
import ControlBar, {
  DAY_END_MIN,
  DAY_START_MIN,
  STEP_MIN,
  type Mode,
  type AccessKey, type PresetKey,
} from "./components/ControlBar";
import FormulaPanel from "./components/FormulaPanel";
import RouteCards from "./components/RouteCards";
import WalkBar from "./components/WalkBar";
import { t } from "../i18n/t";
import { debugLog } from "../debug";
import {
  bandLoaded,
  edgeLatLngs,
  loadGraph,
  loadShadeBand,
  snapToEdge,
  snapEnds,
  type Graph,
} from "../router/graph";
import { GraphProvider, useGraphStamp } from "../ui/GraphContext";
import { PRESETS, route, type Preset, edgeCost, SPEED_M_PER_MIN } from "../router/astar";
import { routeLine } from "../router/draw";
import { COMPOSER_DEFAULTS, KNOBS, type ComposerKnobs } from "../router/composer";
import { loops, type Loop } from "../router/loops";
import { routeStats, type RouteStats } from "../router/stats";
import { decodeState, encodeState } from "../urlState";
import { DEFAULT_CITY, coreUrls, getCity, shadeBandUrl, type CityId } from "../cities";
import CitySelector from "./components/CitySelector";

function nowClamped() {
  const d = new Date();
  const m = d.getHours() * 60 + d.getMinutes();
  const snapped = Math.round(m / STEP_MIN) * STEP_MIN;
  return Math.min(DAY_END_MIN, Math.max(DAY_START_MIN, snapped));
}

const BOOT = decodeState(location.search);
// Always on: this page is the dev-only debug build (Task 3, 2026-09-05).
const DEBUG_MODE = true;

// The debug page stays on the OSM raster reference picture by default.
// ?vector switches it to the city's Meadow basemap and ?dark to the dark
// theme, so both can be eyeballed before the app shell uses them
// (Task 9, 2026-09-05). Dev-only switches, hence plain URL flags.
const DEBUG_Q = new URLSearchParams(location.search);
const MAP_BASEMAP = DEBUG_Q.has("vector") ? "vector" : "osm";
const MAP_THEME = DEBUG_Q.has("dark") ? "dark" : "light";
if (DEBUG_Q.has("dark")) document.documentElement.setAttribute("data-theme", "dark");

function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua);
  const standalone = (navigator as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export default function App() {
  const [city, setCity] = useState<CityId>(BOOT.city ?? DEFAULT_CITY);
  const [minutes, setMinutes] = useState(BOOT.minutes ?? nowClamped());
  const [shadeOn, setShadeOn] = useState(false); // off by default (2026-08-17)
  const [noiseOn, setNoiseOn] = useState(false);
  const [waysOn, setWaysOn] = useState(false); // ?debug graph overlay
  const [mode, setMode] = useState<Mode>(BOOT.mode ?? "loop");
  const [duration, setDuration] = useState(BOOT.duration ?? 45);
  const [preset, setPreset] = useState<PresetKey>(BOOT.preset ?? "balanced");
  const [access, setAccess] = useState<AccessKey>(BOOT.access ?? "stroller");
  const [start, setStart] = useState<LngLat | null>(BOOT.start ?? null);
  const [dest, setDest] = useState<LngLat | null>(BOOT.dest ?? null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const graphStamp = useGraphStamp(graph);
  const [graphFailed, setGraphFailed] = useState(false);
  const [results, setResults] = useState<Loop[]>([]);
  // drawn tails from the clicked points to the routing nodes (snap-to-edge)
  const [tails, setTails] = useState<{ head: [number, number][]; tail: [number, number][] }>({ head: [], tail: [] });
  // pin -> network connectors (Google-style grey dashes): drawn when a pin
  // stands off the walk network — inside a courtyard, across a street —
  // so the jump to the nearest walkable point never reads as route (2026-08-27)
  const [connectors, setConnectors] = useState<[number, number][][]>([]);
  const [selected, setSelected] = useState(BOOT.selected ?? 0);
  const [noRoute, setNoRoute] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [walking, setWalking] = useState(false);
  const [customW, setCustomW] = useState<Preset | null>(null);
  const [knobs, setKnobs] = useState<ComposerKnobs>({ ...COMPOSER_DEFAULTS });
  const [walkPos, setWalkPos] = useState<LngLat | null>(null);
  const [following, setFollowing] = useState(true);
  const [showInstall, setShowInstall] = useState(
    () => isIOSSafari() && localStorage.getItem("sw-install-dismissed") !== "1"
  );
  const debounce = useRef<number>(0);
  const bootSelected = useRef(BOOT.selected ?? 0);
  const wakeLock = useRef<{ release(): Promise<void> } | null>(null);
  const watchId = useRef<number | null>(null);

  // Load the selected city's artifact, and reload when the city changes.
  // The path comes from the registry, so bringing a city online is one flag
  // in cities.ts plus its artifact in web/public — no change here.
  useEffect(() => {
    const c = getCity(city);
    if (!c.available) {
      setGraph(null);
      setGraphFailed(false);
      return;
    }
    let cancelled = false;
    setGraph(null);
    setGraphFailed(false);
    // build stamp busts any cached artifact (it changed six times on 2026-08-17)
    loadGraph(coreUrls(c, __BUILD__))
      .then(async (g) => {
        // ...and EVERY shade band before the graph is handed over (artifact
        // v8, B11). The shell downloads the departure's bands first and the
        // rest in the background; this page has no such scheduler, it is
        // here to expose the router's internals, and a core with no shade in
        // it made every Frankfurt route raise `ShadePendingError` and draw
        // nothing (S8 review F1). All eight is 4.3 MB on a page that is DEV
        // only, and it means every minute of the day is priceable the moment
        // the graph appears — which is what a debug page is for.
        await Promise.all(
          g.shade.bands
            .filter((b) => !bandLoaded(g.shade, b.k))
            .map((b) => loadShadeBand(g, b.k, shadeBandUrl(c, b.k, __BUILD__, g.shade.hash)))
        );
        if (cancelled) return;   // a second city was picked while this loaded
        setGraph(g);
        debugLog.current?.(
          `graph ${c.id}: ${g.nNodes} nodes ${g.nEdges} edges, ` +
            `${g.shade.bands.length} shade band(s)`
        );
      })
      .catch((e) => {
        if (cancelled) return;
        setGraphFailed(true);
        debugLog.current?.(`graph load failed (${c.id}): ${e}`);
      });
    return () => {
      cancelled = true;
    };
  }, [city]);

  // A pin dropped in one city is meaningless in the next, and urlState would
  // reject it anyway once `c=` changes (its sanity box is the city's).
  const firstCity = useRef(true);
  useEffect(() => {
    if (firstCity.current) {
      firstCity.current = false;
      return;
    }
    setStart(null);
    setDest(null);
  }, [city]);

  // recompute routes
  useEffect(() => {
    if (!graph || !start) return;
    if (mode === "ab" && !dest) return;
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      const t0 = performance.now();
      const weights = { ...(customW ?? PRESETS[preset]), access };
      Object.assign(KNOBS, knobs); // debug tuner writes the composer weights
      const snapS = snapToEdge(graph, start[0], start[1]);
      const s = snapS.node;
      let found: Loop[] = [];
      let tails: { head: [number, number][]; tail: [number, number][] } = { head: snapS.tail, tail: [] };
      if (mode === "loop") {
        found = loops(graph, s, duration, minutes, weights);
        tails = { head: snapS.tail, tail: [...snapS.tail].reverse() };
      } else if (dest) {
        const snapD = snapToEdge(graph, dest[0], dest[1]);
        // Route to whichever END of the snapped edge is cheaper once the
        // walk back along the edge to the pin is counted. snapToEdge picks
        // by geometric midpoint, which sent the router past the pin and back
        // on 38.6 % of pins (avg 17.2 m, worst 162 m) — Ammelburgstraße,
        // 2026-08-28.
        let best: { leg: Loop; tail: [number, number][] } | null = null;
        let bestTotal = Infinity;
        for (const end of snapEnds(graph, snapD)) {
          const leg = route(graph, s, end.node, minutes, weights);
          if (!leg) continue;
          const eLen = graph.lenDm[snapD.eid] / 10;
          const full = snapD.eid >= 0
            ? edgeCost(graph, snapD.eid, minutes + leg.meters / SPEED_M_PER_MIN, weights, 0)
            : 0;
          const partial = isFinite(full) && eLen > 0 ? full * (end.alongM / eLen) : 0;
          const total = leg.cost + partial;
          if (total < bestTotal) {
            bestTotal = total;
            best = { leg: leg as Loop, tail: [...end.tail].reverse() };
          }
        }
        if (best) found = [best.leg];
        tails = { head: snapS.tail, tail: best ? best.tail : [...snapD.tail].reverse() };
      }
      setTails(tails);
      const conn: [number, number][][] = [];
      const farM = (a: [number, number], b: [number, number]) =>
        Math.hypot((a[0] - b[0]) * 71_500, (a[1] - b[1]) * 111_320);
      if (farM(start, snapS.point) > 4) conn.push([start, snapS.point]);
      if (mode === "ab" && dest) {
        const snapD2 = snapToEdge(graph, dest[0], dest[1]);
        if (farM(dest, snapD2.point) > 4) conn.push([dest, snapD2.point]);
      }
      setConnectors(conn);
      const ms = Math.round(performance.now() - t0);
      debugLog.current?.(`routing: ${found.length} results in ${ms} ms`);
      setResults(found);
      // a shared link's route choice survives exactly one computation
      setSelected(Math.min(bootSelected.current, Math.max(0, found.length - 1)));
      bootSelected.current = 0;
      setNoRoute(found.length === 0);
    }, 250);
  }, [graph, start, dest, mode, duration, preset, access, minutes, customW, knobs]);

  // F6: state -> URL (replaceState keeps history clean)
  useEffect(() => {
    const qs = encodeState({ city, mode, minutes, preset, access, duration, start, dest, selected });
    const debugFlag = new URLSearchParams(location.search).has("debug")
      ? "&debug"
      : "";
    const url = `${location.pathname}?${qs}${debugFlag}${location.hash}`;
    window.history.replaceState(null, "", url);
  }, [mode, minutes, preset, access, duration, start, dest, selected]);

  // F7: geolocation watch + wake lock while walking
  useEffect(() => {
    if (!walking) return;
    setFollowing(true);
    setWalkPos(null);
    watchId.current = navigator.geolocation?.watchPosition(
      (pos) => setWalkPos([pos.coords.longitude, pos.coords.latitude]),
      () => debugLog.current?.(t("gps.error")),
      { enableHighAccuracy: true }
    ) ?? null;
    const acquire = () => {
      type WL = { request(type: "screen"): Promise<{ release(): Promise<void> }> };
      const wl = (navigator as { wakeLock?: WL }).wakeLock;
      wl?.request("screen")
        .then((s) => (wakeLock.current = s))
        .catch((e) => debugLog.current?.(`wakelock: ${e}`));
    };
    acquire();
    const onVis = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
      wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = null;
      setWalkPos(null);
    };
  }, [walking]);

  const stats: RouteStats[] = useMemo(
    () => (graph ? results.map((r) => routeStats(graph, r.eids, minutes)) : []),
    [graph, results, minutes]
  );

  // streets are drawn offset onto the sidewalk the walker takes (the
  // shadier side, smoothed: you do not cross the street for 20 m of shade);
  // consecutive edges on the same side form one feature so joins are proper
  const connectorLines = useMemo(() => {
    if (results.length === 0 || connectors.length === 0) return emptyFC();
    return {
      type: "FeatureCollection",
      features: connectors.map((c) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: c } })),
    } as FeatureCollection;
  }, [results, connectors]);

  const routeLines = useMemo(() => {
    if (!graph || results.length === 0) return emptyFC();
    const shown = walking ? [results[selected]] : results;
    const features = shown.map((r, i) => ({
      type: "Feature" as const,
      properties: { i, selected: walking || i === selected },
      geometry: {
        type: "LineString" as const,
        coordinates: routeLine(graph, r.eids, minutes, tails.head, tails.tail),
      },
    }));
    return { type: "FeatureCollection", features } as FeatureCollection;
  }, [graph, results, selected, walking, minutes, tails]);

  // debug: the selected route's raw edges, one feature per edge
  const routeRaw = useMemo(() => {
    if (!graph || !DEBUG_MODE || results.length === 0) return emptyFC();
    const r = results[selected];
    return {
      type: "FeatureCollection",
      features: r.eids.map((eid) => ({
        type: "Feature",
        properties: { eid },
        geometry: { type: "LineString", coordinates: edgeLatLngs(graph, eid) },
      })),
    } as FeatureCollection;
  }, [graph, results, selected]);

  // debug: auto-save every dump to the dev server (vite middleware writes
  // data/work/frankfurt/osm/_browser_dump.json) so replays never need manual copy-paste
  useEffect(() => {
    if (!DEBUG_MODE || !graph || results.length === 0) return;
    const dump = {
      url: location.href, build: __BUILD__, edges: graph.nEdges,
      selected, results: results.map((r) => ({ kind: (r as { kind?: string }).kind, laps: (r as { laps?: number }).laps, meters: Math.round(r.meters), eids: r.eids })),
      routeLines, routeRaw,
    };
    fetch("/__dump", { method: "POST", body: JSON.stringify(dump) }).catch(() => {});
  }, [graph, results, selected, routeLines, routeRaw]);

  const hint = !getCity(city).available
    ? t("city.nodata", { city: t(`city.${city}`) })
    : graphFailed
      ? t("routes.none")
      : !graph
        ? t("routes.loading")
        : noRoute
          ? t("routes.none")
          : !start
            ? t(mode === "loop" ? "start.hint.loop" : "start.hint.ab")
            : mode === "ab" && !dest
              ? t("start.hint.ab")
              : null;

  const onMapClick = (p: LngLat) => {
    if (walking) return;
    setNoRoute(false);
    if (mode === "ab" && start && !dest) setDest(p);
    else {
      setStart(p);
      setDest(null);
      setResults([]);
    }
  };

  const onGps = () => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => onMapClick([pos.coords.longitude, pos.coords.latitude]),
      () => showToast(t("gps.error"))
    );
  };

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  };

  const onShare = async () => {
    const url = location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: t("app.name"), url });
        return;
      } catch {
        /* user cancelled */
      }
    } else {
      await navigator.clipboard?.writeText(url);
      showToast(t("share.copied"));
    }
  };

  // The graph reaches MapView through the context, never as a prop — see
  // ui/GraphContext.tsx. Turning Ways on with a big city loaded used to hand
  // React's dev instrumentation 56 MB of typed arrays to walk.
  return (
    <GraphProvider stamp={graphStamp}>
    <div className="app">
      <MapView
        city={getCity(city)}
        shadeOn={shadeOn}
        noiseOn={noiseOn}
        waysOn={DEBUG_MODE && waysOn}
        minutes={minutes}
        day={todayKey()}
        start={start}
        dest={dest}
        routeLines={routeLines}
        routeRaw={routeRaw}
        connectorLines={connectorLines}
        onMapClick={onMapClick}
        basemap={MAP_BASEMAP}
        theme={MAP_THEME}
        onFeatureTap={(f) => {
          debugLog.current?.(`poi tap: ${f.name} (${f.kind}) @ ${f.lng.toFixed(5)},${f.lat.toFixed(5)}`);
          (window as unknown as { __swTap?: unknown }).__swTap = f;
        }}
        onLongPress={(p) => {
          debugLog.current?.(`long press: ${p[0].toFixed(5)},${p[1].toFixed(5)}`);
          (window as unknown as { __swPress?: unknown }).__swPress = p;
        }}
        gpsPos={walkPos}
        walkPos={walkPos}
        following={walking && following}
        onUserPan={() => setFollowing(false)}
      />
      <div className="wordmark">{t("app.name")}</div>
      <CitySelector city={city} onCity={setCity} />
      {showInstall && !walking && (
        <div className="install-hint">
          <span>{t("install.hint")}</span>
          <button
            aria-label={t("install.close")}
            onClick={() => {
              localStorage.setItem("sw-install-dismissed", "1");
              setShowInstall(false);
            }}
          >
            ✕
          </button>
        </div>
      )}
      {walking ? (
        <WalkBar
          hasFix={walkPos !== null}
          following={following}
          onRecenter={() => setFollowing(true)}
          onExit={() => setWalking(false)}
        />
      ) : (
        <div className="panel">
          <RouteCards
            stats={stats}
            laps={results.map((r) => ("laps" in r ? (r as { laps: number }).laps : null))}
            kinds={results.map((r) => ("kind" in r ? (r as { kind: string }).kind : null))}
            selected={selected}
            onSelect={setSelected}
          />
          {results.length > 0 && (
            <div className="action-row">
              <button className="action-btn primary" onClick={() => setWalking(true)}>
                {t("actions.walk")}
              </button>
              <button className="action-btn" onClick={onShare}>
                {t("actions.share")}
              </button>
            </div>
          )}
          <ControlBar
            minutes={minutes}
            onMinutes={setMinutes}
            shadeOn={shadeOn}
            onToggle={() => setShadeOn((v) => !v)}
            noiseOn={noiseOn}
            onToggleNoise={() => setNoiseOn((v) => !v)}
            mode={mode}
            onMode={(m) => {
              setMode(m);
              setDest(null);
              setResults([]);
            }}
            duration={duration}
            onDuration={setDuration}
            access={access}
            onAccess={setAccess}
            preset={preset}
            onPreset={(k) => {
              setPreset(k);
              setCustomW(null);
            }}
            onGps={onGps}
            hint={hint}
          />
          {DEBUG_MODE && (
            <FormulaPanel
              weights={customW ?? PRESETS[preset]}
              isCustom={customW !== null}
              presetName={preset}
              onChange={setCustomW}
              onReset={() => setCustomW(null)}
              knobs={knobs}
              onKnobs={setKnobs}
              waysOn={waysOn}
              onWays={() => setWaysOn((v) => !v)}
              onDump={() => {
                const dump = {
                  url: location.href, build: __BUILD__, edges: graph?.nEdges,
                  selected, results: results.map((r) => ({ kind: (r as { kind?: string }).kind, laps: (r as { laps?: number }).laps, meters: Math.round(r.meters), eids: r.eids })),
                  routeLines, routeRaw,
                };
                navigator.clipboard?.writeText(JSON.stringify(dump)).then(() => showToast("dump copied"));
              }}
            />
          )}
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
    </GraphProvider>
  );
}
