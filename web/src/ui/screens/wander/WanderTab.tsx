import { useEffect, useMemo } from "react";
import type { City } from "../../../cities";
import { t } from "../../../i18n/t";
import type { LngLat } from "../../../components/MapView";
import { warning } from "../../../plan/cardCopy";
import type { Settings } from "../../../plan/settings";
import type { SunDay } from "../../useSunDay";
import { useGraph } from "../../GraphContext";
import { layersChipVisible } from "../../layers";
import { noRouteReason } from "../../noRoute";
import type { BorderGeom } from "../../../shade/ShadeLayer";
import {
  GPS_ORIGIN,
  tripSettings,
  type Action,
  type ShellState,
} from "../../shellState";
import { cityClock, cityNowClamped, nowMinutes } from "../../time";
import { useLabels, pointKey } from "../../useWander";
import type { Walk } from "../../useWalk";
import { copyLink, pageBase, shareUrl } from "../../share";
import { candKey, loopName, namePoint, splitLabel, type LoopName } from "../../wander";
import { takeWanderHint } from "../../wanderHint";
import type { AutoWindow } from "../route/Routes";
import { AccessSheet } from "../route/AccessSheet";
import { Arrived } from "../route/Arrived";
import { LeaveAtSheet } from "../route/LeaveAtSheet";
import { Navigate } from "../route/Navigate";
import { PreferenceSheet } from "../route/PreferenceSheet";
import { LayersChip } from "../layers/LayersChip";
import { DurationSheet } from "./DurationSheet";
import { Wander } from "./Wander";
import { WanderIdle } from "./WanderIdle";

type WanderTabProps = {
  s: ShellState;
  dispatch: (a: Action) => void;
  settings: Settings;
  /** The selected city — its clock is what "now" means for a departure
   *  planned here (ui/time.ts cityClock). Symmetrical with RouteTab. */
  city: City;
  /** Debounced by the shell: true only once the wait is worth a skeleton. */
  computing: boolean;
  walk: Walk;
  /** Where the loops start — a pinned point, or the live fix. */
  from: LngLat | null;
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
  onLocate: () => void;
  onStart: () => void;
  /** The desktop's "Send to phone", or undefined on a phone and a tablet,
   *  which can be walked with (board W-wander). */
  onSend?: () => void;
  onRecenter: () => void;
  onAllowCobbles: () => void;
  onWalkMode: () => void;
  onShowCity: () => void;
  onRetryCity: () => void;
  onCity: () => void;
  border: BorderGeom | null;
};

/** The Wander tab, end to end: the loops screen, the walk it starts, and
 *  the three sheets that change the question (UI redesign Task 13).
 *
 *  It sits between AppShell and the screens because everything here is
 *  Wander's own: which point names a loop, what Share hands over, and which
 *  overlay belongs to this tab. AppShell keeps the map, the planner and the
 *  clock, which all three tabs share. */
export function WanderTab({
  s,
  dispatch,
  settings,
  city,
  computing,
  walk,
  from,
  autoPickWindow,
  reasonLine,
  night,
  sun,
  onLocate,
  onStart,
  onSend,
  onRecenter,
  onAllowCobbles,
  onWalkMode,
  onShowCity,
  onRetryCity,
  onCity,
  border,
}: WanderTabProps) {
  // never a prop: see ui/GraphContext.tsx
  const graph = useGraph();

  // "Tap the map to start a loop somewhere else" was a permanent second line
  // under the title; since CR-01 edit 6 it is a toast on the first visit and
  // never again (ui/wanderHint.ts holds the "first"). It belongs to W0 since
  // CR-02 slice A: it describes the OTHER way into the loops, and on W1 the
  // loops it offers to move are already on screen. Here rather than in the
  // view because the toast is the shell's, and this is the component that
  // already talks to the shell for this tab.
  const onIdle = s.wander.k === "idle";
  useEffect(() => {
    if (!onIdle) return;
    // `takeWanderHint` SPENDS the once-flag, so it gets a line of its own
    // rather than a half of a boolean: a reader skimming the guard should
    // see the side effect, not find it (CR-02 slice A review, F7).
    const first = takeWanderHint();
    if (!first) return;
    dispatch({ type: "toast", text: t("wander.tapHint") });
  }, [onIdle, dispatch]);

  // …and the other half of B13: the pill's own tap is what triggers the
  // browser's permission prompt, so a FIRST refusal only lands after W1 is
  // already up. Loops anchored on a fix that was refused are a card and
  // nothing else, so the tab goes back to its root and says what happened —
  // the same ruling as the guard on the pill, for the case the guard cannot
  // see coming. A pinned origin is untouched: that walk has a start.
  // ...and only when there is no fix left to be anchored ON. A refusal keeps
  // the last known position now (shellState.ts, `case "gps"`), so a reader
  // who granted, planned loops and then revoked still has the fix those loops
  // were planned from; the case this guard is for is the FIRST refusal, where
  // there has never been one (P2, 2026-09-10).
  const refusedHere =
    s.wander.k === "loops" && s.origin.kind === "gps" && s.gpsDenied && s.gps === null;
  useEffect(() => {
    if (!refusedHere) return;
    dispatch({ type: "end" });
    dispatch({ type: "toast", text: t("edge.locationOffTap") });
  }, [refusedHere, dispatch]);
  // What THESE loops are planned with: the chip's per-trip override over
  // the stored settings, exactly as the routes header reads them (R4).
  const eff = tripSettings(s, settings);
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
  const cands = useMemo(
    () => (plan ? [plan.recommended, ...plan.alternatives] : []),
    [plan]
  );

  // One reverse geocode names the origin, one more names each loop — at the
  // point that says what the walk is about (wander.ts, namePoint). Memoized:
  // namePoint counts every node of every lap walk, and the loops screen
  // re-renders on each GPS fix.
  const fromKey = from ? pointKey(from) : "";
  const originTarget = useMemo(
    () => ({ key: fromKey, at: from }),
    // `from` is a fresh array each render; its KEY is what identifies it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fromKey]
  );
  const loopTargets = useMemo(
    () =>
      cands.map((c) => ({
        key: candKey(c.eids),
        at: graph && originTarget.at ? namePoint(graph, c, originTarget.at) : null,
      })),
    [cands, graph, originTarget]
  );
  // The place the loops go through, when there is one. A link's `v=` carries
  // a coordinate and no word for it, so the same reverse geocode that names
  // the origin names the via (W3).
  const via = s.trip.via;
  const viaKey = via ? pointKey(via.at) : "";
  const viaTarget = useMemo(
    () => ({ key: viaKey, at: via?.at ?? null }),
    // the KEY identifies the point; `via.at` is a fresh array each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viaKey]
  );
  const label = useLabels(
    useMemo(
      () => [originTarget, viaTarget, ...loopTargets],
      [originTarget, viaTarget, loopTargets]
    )
  );

  // A tapped POI names itself; anything else is asked about, and until the
  // answer lands the header says which kind of start this is.
  const origin = s.origin;
  const originLabel =
    (origin.kind === "point" ? origin.label : null) ??
    label(originTarget.key) ??
    (origin.kind === "gps" ? t("routes.yourLocation") : t("pin.title"));
  const names: LoopName[] = cands.map((c, i) => loopName(c, label(loopTargets[i].key)));
  // Named by the card that started it where there was one; otherwise by
  // whatever the geocoder answers, and by nothing at all until it does.
  const viaName =
    via === null ? null : (via.name ?? splitLabel(label(viaKey) ?? t("pin.title")).name);

  /** Hand the walk over: the system sheet where there is one, the clipboard
   *  everywhere else. A dismissed share sheet is not a failure and must not
   *  silently copy a link instead. */
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

  const screen = () => {
    // W0: the root, with nothing planned on it (SPEC §3 W0). The pill asks
    // for the fix and plans from it; `origin` is the one action both ways
    // into W1 take, so the map tap and the pill agree by construction
    // (ui/mapTaps.ts).
    if (s.wander.k === "idle") {
      return (
        <WanderIdle
          durationMin={s.durationMin}
          // …and the pill says which "here" it means: a pinned start is the
          // reader's own, wherever they put it, and `onPlan` below already
          // plans from it rather than asking the browser for a fix.
          fromPin={s.origin.kind === "point"}
          onPlan={() => {
            // ONE start pin (CR-03 A8). A pinned start IS the reader's own
            // "here", wherever they set it — a long press on the Route tab,
            // a tap on this one — so the pill plans from it and asks the
            // browser for nothing. It went to `GPS_ORIGIN` unconditionally
            // until the CR-03 regression run, which wiped the pin the pill
            // is named after: W0 said "Loop from Musterweg 5" and W1 came
            // back centred on the GPS dot with no pin on the map at all.
            if (s.origin.kind === "point") {
              dispatch({ type: "origin", origin: s.origin });
              return;
            }
            // A browser that has already refused has nothing to prompt, and
            // W1 planned from a fix that does not exist is a card saying so
            // with no way back to the pill. The refusal stays on W0 (B13).
            //
            // The guard comes BEFORE the ask (S1 review, F3). `onLocate()`
            // on a known denial reaches `useGps.ask()`, which dispatches the
            // Route tab's LONG-PRESS sentence — the very wording this ruling
            // exists to avoid — and clears `sw.gpsRefused`, the record that
            // says never to ask again unprompted. Both landed in one React
            // batch, so the right sentence won by statement order alone.
            if (s.gpsDenied) {
              dispatch({ type: "toast", text: t("edge.locationOffTap") });
              return;
            }
            onLocate();
            dispatch({ type: "origin", origin: GPS_ORIGIN });
          }}
          onDuration={() => dispatch({ type: "overlay", overlay: "duration" })}
          onLocate={onLocate}
        />
      );
    }
    if (s.wander.k === "navigate") {
      return (
        <Navigate
          destName={originLabel}
          toDestM={walk.toDestM}
          ahead={walk.ahead}
          nowMin={nowMinutes()}
          onRecenter={onRecenter}
          onEnd={() => dispatch({ type: "end" })}
        />
      );
    }
    if (s.wander.k === "arrived") {
      return (
        <Arrived
          destName={originLabel}
          atMin={s.wander.atMin}
          stats={walk.selCand?.stats ?? null}
          onLoopHome={() => dispatch({ type: "loopHome" })}
          onDone={() => dispatch({ type: "done" })}
        />
      );
    }
    return (
      <Wander
        plan={plan}
        reason={noRouteReason(s, settings, border)}
        computing={computing}
        planning={s.computing}
        modalUp={s.overlay !== null}
        selected={s.selected}
        startMin={s.startMin}
        leaveNow={s.leaveNow}
        durationMin={s.durationMin}
        pref={s.pref}
        access={eff.access}
        viaName={viaName}
        reasonLine={reasonLine}
        warns={warns}
        night={night}
        originLabel={originLabel}
        names={names}
        onLocate={onLocate}
        onDuration={() => dispatch({ type: "overlay", overlay: "duration" })}
        onPref={() => dispatch({ type: "overlay", overlay: "pref" })}
        onLeave={() => dispatch({ type: "overlay", overlay: "leave" })}
        onAccess={() => dispatch({ type: "overlay", overlay: "access" })}
        onClearVia={() => dispatch({ type: "loopVia", via: null })}
        onClose={() => dispatch({ type: "end" })}
        onSelect={(i) => dispatch({ type: "select", i })}
        onStart={onStart}
        onShare={share}
        desktop={onSend === undefined ? null : { onSend }}
        layersChip={
          layersChipVisible(s) ? (
            <LayersChip s={s} dispatch={dispatch} layers={settings.layers} />
          ) : null
        }
        onAllowCobbles={onAllowCobbles}
        onWalkMode={onWalkMode}
        onShowCity={onShowCity}
        onSwitchCity={onCity}
        onRetryCity={onRetryCity}
      />
    );
  };

  /** The sheets, mounted only while they are up: each holds a draft — a
   *  length, a preference, a departure minute — that must start from what
   *  the shell currently says. */
  const overlay = () => {
    // The duration sheet is W0's too — its pill's right-hand button opens
    // it — so the guard is "not mid-walk" rather than "on the loops screen".
    if (s.wander.k !== "loops" && s.wander.k !== "idle") return null;
    if (s.overlay === "duration") {
      return (
        <DurationSheet
          durationMin={s.durationMin}
          /* The DEPARTURE, not the wall clock (final review I1). "Be back
             by" is the other end of the same walk the card prints "back
             17:45" on, and that card counts from `startMin`; measuring the
             sheet from `now` made the two disagree by however long the
             reader had pinned the departure ahead — and picking an hour in
             the sheet then planned a loop of that whole gap. */
          departMin={s.startMin}
          onApply={(min, backBy) => dispatch({ type: "duration", min, backBy })}
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
