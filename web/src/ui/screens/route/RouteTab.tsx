import { useMemo } from "react";
import type { City } from "../../../cities";
import type { LngLat } from "../../../components/MapView";
import { t } from "../../../i18n/t";
import { shadeAround } from "../../../plan/hours";
import { warning } from "../../../plan/cardCopy";
import type { Settings } from "../../../plan/settings";
import { useGraph, useGraphRevision } from "../../GraphContext";
import { num1 } from "../../kit";
import { distanceM } from "../../geo";
import { noRouteReason } from "../../noRoute";
import { layersChipVisible } from "../../layers";
import type { Outside } from "../../outside";
import type { BorderGeom } from "../../../shade/ShadeLayer";
import { copyLink, pageBase, shareUrl } from "../../share";
import {
  GPS_ORIGIN,
  tripSettings,
  type Action,
  type ShellState,
} from "../../shellState";
import type { PlaceSearch } from "../../useLookups";
import { cityClock, cityNowClamped, km as fmtKm, leaveWindow, nowMinutes } from "../../time";
import type { Walk } from "../../useWalk";
import type { SunDay } from "../../useSunDay";
import { LayersChip } from "../layers/LayersChip";
import { OutsideBanner } from "../edge/OutsideBanner";
import { AccessSheet } from "./AccessSheet";
import { Arrived } from "./Arrived";
import { Home } from "./Home";
import { LeaveAtSheet } from "./LeaveAtSheet";
import { Navigate } from "./Navigate";
import { PinCard } from "./PinCard";
import { PlaceCard } from "./PlaceCard";
import { PreferenceSheet } from "./PreferenceSheet";
import { Routes, type AutoWindow } from "./Routes";
import { Search } from "./Search";

type RouteTabProps = {
  s: ShellState;
  dispatch: (a: Action) => void;
  settings: Settings;
  city: City;
  /** Photon's answers to the search screen's query, and how the query is
   *  going (loading / empty / failed). */
  search: PlaceSearch;
  /** Where the next walk starts — the pinned origin or the live fix. */
  from: LngLat | null;
  /** Debounced by the shell: true only once the wait is worth a skeleton. */
  computing: boolean;
  walk: Walk;
  /** The hours the clock's own pick owns, for the R5 badge. */
  autoPickWindow: AutoWindow;
  /** The recommended card's reason line, built by the shell from the copy
   *  rules (plan/cardCopy.ts, SPEC §1.1). */
  reasonLine: string;
  /** Planning after sunset: the shade figures are replaced by a word. */
  night: boolean;
  /** The city's day: sunrise, sunset and the daylight hours between them —
   *  the leave-at slider's two ends and its bars (ui/useSunDay.ts). */
  sun: SunDay;
  /** Set when the fix falls outside the city's data: Home says so. */
  outside: Outside | null;
  /** The city's data border, once loaded — the routes screen names the end
   *  of a walk that falls outside it (noRouteReason). */
  border: BorderGeom | null;
  onLocate: () => void;
  onStart: () => void;
  onRecenter: () => void;
  /** Fly the map to the city centre ("Show Frankfurt"). */
  onShowCity: () => void;
  onRetryCity: () => void;
  /** Open the city sheet. */
  onCity: () => void;
  onAllowCobbles: () => void;
  onWalkMode: () => void;
  /** Set only on the desktop, where there is no walk to start: the routes
   *  panel hands the link to a phone instead, and has the room to show the
   *  hour profile the phone hides behind the "leave at" chip (Task 15). */
  onSend?: () => void;
};

/** The Route tab, end to end: the map's own screens (home, search, place,
 *  pin), the routes sheet, the walk it starts, and the two sheets that
 *  change the question (UI redesign Task 14 — lifted out of AppShell when
 *  the settings tab arrived and the shell had no lines left to give).
 *
 *  Symmetrical with WanderTab: everything here is the route flow's own, and
 *  AppShell keeps the map, the planner and the clock the three tabs share. */
export function RouteTab({
  s,
  dispatch,
  settings,
  city,
  search,
  from,
  computing,
  walk,
  autoPickWindow,
  reasonLine,
  night,
  sun,
  outside,
  border,
  onLocate,
  onStart,
  onRecenter,
  onShowCity,
  onRetryCity,
  onCity,
  onAllowCobbles,
  onWalkMode,
  onSend,
}: RouteTabProps) {
  // never a prop: see ui/GraphContext.tsx
  const graph = useGraph();
  const graphRev = useGraphRevision();
  const plan = s.plan;
  // "no shade after 17:40", one per card: the warning names a fact about
  // the walk it is printed on, so each candidate is read against its OWN
  // departure-hour profile (useWalk measures one per candidate). An empty
  // profile — no plan has landed yet — yields null, not a guess.
  const profiles = walk.hourProfile?.perCandidate ?? [];
  const warns =
    plan === null
      ? []
      : [plan.recommended, ...plan.alternatives].map((c, k) =>
          warning(c, profiles[k] ?? [], s.startMin, sun.hours)
        );
  const rec = plan?.recommended;
  const cityName = t(`city.${city.id}`);
  /** What THIS walk is planned with: the header's access chip overrides the
   *  settings for one trip (shellState.tripSettings). */
  const eff = tripSettings(s, settings);
  /** Every search that is not the routes header's From field is asking for
   *  a destination — Home's "Where to?", and the two cards' own bars. */
  const openSearch = () => dispatch({ type: "search", q: "", end: "to" });
  const previewMin =
    rec && (s.route.k === "place" || s.route.k === "pin") ? rec.stats.minutes : null;

  // shade right here, right now — the place card's second tag
  const place = s.route.k === "place" ? s.route.place : null;
  // `graphRev` is in the deps because a shade band landing mutates the store
  // INSIDE the graph without replacing it: without the stamp this memo never
  // ran again, and a tag that came back null once stayed missing until the
  // place or the departure changed (S8 review F2).
  const placeShade = useMemo(() => {
    if (!graph || !place || !place.inCity) return null;
    return shadeAround(graph, place.lng, place.lat, s.startMin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, graphRev, place, s.startMin]);

  /** Turn the walk around. Two dispatches, in this order: the old
   *  destination becomes the origin, then routeTo reads that origin and puts
   *  the old origin at the far end. Only a pinned origin can swap — "your
   *  location" is not a place that can be a destination. */
  /** Hand the walk over: the system sheet where there is one, the clipboard
   *  everywhere else — the same trade the Wander tab makes, and the sheet's
   *  secondary button at the default snap since CR-01 edit 4. A dismissed
   *  share sheet is not a failure and must not silently copy a link. */
  const share = () => {
    const url = shareUrl(pageBase(), s, settings, from);
    if (typeof navigator.share === "function") {
      navigator.share({ url }).catch(() => {
        /* dismissed */
      });
      return;
    }
    copyLink(dispatch, url);
  };

  /** A tap on an hour bar of the routes strip is a shortcut into the
   *  leave-at window, so it must land on a minute that window offers: the
   *  bare hour is outside it at both ends of the day, and Frankfurt's 05:00
   *  bar in June stands for 05:30 (P1 review F1, the same clamp
   *  `LeaveAtSheet` applies to its own bars). */
  const barDeparture = (h: number) => {
    const win = leaveWindow(sun.sunrise, sun.sunset, cityClock(city).minute, sun.priced);
    return Math.min(win.max, Math.max(win.min, h * 60));
  };

  const swapEnds = () => {
    if (s.route.k !== "routes") return;
    const o = s.route.origin;
    if (o.kind !== "point") return;
    const { dest, destName } = s.route;
    dispatch({ type: "origin", origin: { kind: "point", at: dest, label: destName || null } });
    dispatch({ type: "routeTo", dest: o.at, name: o.label ?? t("pin.title") });
  };

  const screen = () => {
    switch (s.route.k) {
      case "home":
        return (
          <>
            <Home onSearch={openSearch} onLocate={onLocate} />
            {outside === null ? null : (
              <div className="edge-banner">
                <OutsideBanner
                  cityName={cityName}
                  onShowCity={onShowCity}
                  onSwitchCity={onCity}
                />
              </div>
            )}
          </>
        );

      case "search":
        return (
          <Search
            q={s.route.q}
            end={s.route.end}
            results={search.results}
            status={search.status}
            cityName={cityName}
            from={from}
            // "Your location" is only an answer while there is a fix to use
            // or a chance of getting one: with location refused it is a row
            // that cannot do anything (the same rule Home's banner follows).
            canUseLocation={s.gps !== null || !s.gpsDenied}
            onChange={(q) => dispatch({ type: "search", q })}
            onBack={() => dispatch({ type: "back" })}
            onClear={() => dispatch({ type: "search", q: "" })}
            onPick={(p) => dispatch({ type: "pickPlace", place: p })}
            onUseLocation={() => {
              onLocate(); // asks for the fix if there is not one yet
              dispatch({ type: "origin", origin: GPS_ORIGIN });
            }}
            onRetry={search.retry}
          />
        );

      case "place": {
        const picked = s.route.place;
        const dest: LngLat = [picked.lng, picked.lat];
        return (
          <PlaceCard
            place={picked}
            minutes={previewMin}
            km={
              rec && previewMin !== null
                ? num1(rec.stats.km)
                : from
                  ? fmtKm(distanceM(from, dest))
                  : null
            }
            shadePct={placeShade}
            quietPct={previewMin === null ? null : (rec?.stats.quietPct ?? null)}
            onSearch={openSearch}
            onRoute={() => dispatch({ type: "routeTo", dest, name: picked.name })}
            onLoopVia={() =>
              dispatch({ type: "loopVia", via: { at: dest, name: picked.name } })
            }
            onDismiss={() => dispatch({ type: "back" })}
          />
        );
      }

      case "pin": {
        const { at, address, shadePct } = s.route;
        return (
          <PinCard
            address={address}
            shadePct={shadePct}
            minutes={previewMin}
            onSearch={openSearch}
            onRoute={() => dispatch({ type: "routeTo", dest: at, name: address ?? t("pin.title") })}
            onStartHere={() =>
              dispatch({ type: "origin", origin: { kind: "point", at, label: address } })
            }
            onDismiss={() => dispatch({ type: "back" })}
          />
        );
      }

      case "routes": {
        const origin = s.route.origin;
        return (
          <Routes
            plan={plan}
            reason={noRouteReason(s, settings, border)}
            computing={computing}
            planning={s.computing}
            modalUp={s.overlay === "pref" || s.overlay === "leave" || s.overlay === "access"}
            selected={s.selected}
            startMin={s.startMin}
            leaveNow={s.leaveNow}
            pref={s.pref}
            reasonLine={reasonLine}
            warns={warns}
            night={night}
            originLabel={
              origin.kind === "gps" ? t("routes.yourLocation") : (origin.label ?? t("pin.title"))
            }
            destName={s.route.destName || t("pin.title")}
            fromIsGps={origin.kind === "gps"}
            canSwap={origin.kind === "point"}
            access={eff.access}
            hours={sun.hours}
            hourPct={walk.hourProfile?.pct ?? []}
            onHour={(h) => dispatch({ type: "leave", startMin: barDeparture(h), now: false })}
            desktop={onSend === undefined ? null : { onSend }}
            layersChip={
              layersChipVisible(s) ? (
                <LayersChip s={s} dispatch={dispatch} layers={settings.layers} />
              ) : null
            }
            onClose={() => dispatch({ type: "back" })}
            onEditFrom={() => dispatch({ type: "search", q: "", end: "from" })}
            onEditTo={() => dispatch({ type: "search", q: "", end: "to" })}
            onSwap={swapEnds}
            onLocate={onLocate}
            onLeave={() => dispatch({ type: "overlay", overlay: "leave" })}
            onPref={() => dispatch({ type: "overlay", overlay: "pref" })}
            onAccess={() => dispatch({ type: "overlay", overlay: "access" })}
            onSelect={(i) => dispatch({ type: "select", i })}
            onStart={onStart}
            onShare={share}
            onAllowCobbles={onAllowCobbles}
            onWalkMode={onWalkMode}
            onShowCity={onShowCity}
            onSwitchCity={onCity}
            onRetryCity={onRetryCity}
          />
        );
      }

      case "navigate":
        return (
          <Navigate
            destName={s.route.destName || t("pin.title")}
            toDestM={walk.toDestM}
            ahead={walk.ahead}
            nowMin={nowMinutes()}
            onRecenter={onRecenter}
            onEnd={() => dispatch({ type: "end" })}
          />
        );

      case "arrived":
        return (
          <Arrived
            destName={s.route.destName || t("pin.title")}
            atMin={s.route.atMin}
            stats={walk.selCand?.stats ?? null}
            onLoopHome={() => dispatch({ type: "loopHome" })}
            onDone={() => dispatch({ type: "done" })}
          />
        );

      default:
        return null;
    }
  };

  /** The two modal sheets the routes screen opens. Both are mounted only
   *  while they are up: each holds a draft (a preference, a departure
   *  minute) that must start from what the shell currently says. */
  const overlay = () => {
    if (s.route.k !== "routes") return null;
    if (s.overlay === "pref") {
      return (
        <PreferenceSheet
          pref={s.pref}
          auto={s.prefAuto && settings.autoPref}
          autoWindow={autoPickWindow}
          onApply={(pref) => dispatch({ type: "pref", pref, auto: false })}
          onClose={() => dispatch({ type: "back" })}
        />
      );
    }
    if (s.overlay === "access") {
      return (
        <AccessSheet
          access={eff.access}
          avoidCobbles={eff.avoidCobbles}
          /* Close FIRST, replan on the next frame (round 3, item 9a). The
             A* for two candidates is ~600 ms on the main thread, and it used
             to run with the sheet still standing open on top of the card it
             was replacing: the tap looked like it had not landed, then the
             whole page froze. Now the sheet is gone in the frame of the tap
             and the Computing sheet is what the freeze happens behind. */
          onAccess={(access) => {
            dispatch({ type: "back" });
            requestAnimationFrame(() => dispatch({ type: "trip", access }));
          }}
          onCobbles={(avoidCobbles) => dispatch({ type: "trip", avoidCobbles })}
          onClose={() => dispatch({ type: "back" })}
        />
      );
    }
    if (s.overlay === "leave") {
      return (
        <LeaveAtSheet
          startMin={s.startMin}
          /* the CITY's clock, not the browser's: the window this sheet
             offers is measured from the city's sunrise and sunset, so the
             "after sunset" note has to be asked of the same clock (S2
             review, finding 2) */
          nowMin={cityClock(city).minute}
          sunriseMin={sun.sunrise}
          sunsetMin={sun.sunset}
          priced={sun.priced}
          hours={sun.hours}
          hourPct={walk.hourProfile?.pct ?? []}
          minutes={walk.hourProfile?.minutes ?? 0}
          onSet={(startMin) => dispatch({ type: "leave", startMin, now: false })}
          onNow={() => dispatch({ type: "leave", startMin: cityNowClamped(city), now: true })}
          onClose={() => dispatch({ type: "back" })}
        />
      );
    }
    return null;
  };

  return (
    <>
      {screen()}
      {overlay()}
    </>
  );
}
