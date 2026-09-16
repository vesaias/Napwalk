// What a tap on the map means, per tab. Lifted out of AppShell (slice 8)
// because it is a rule rather than wiring: on Route a tap is "tell me about
// this place", on Wander it is "start the loop here, whatever is under it".
import { inCity, type City } from "../cities";
import type { LngLat, MapFeature } from "../components/MapView";
import type { Action, ShellState } from "./shellState";

/** A POI the basemap answered with — MapView's own payload type, imported
 *  rather than restated, so a change to it is a type error here (review F7). */
export type FeatureHit = MapFeature;

export type MapTaps = {
  onMapClick: (p: LngLat) => void;
  onFeatureTap: (f: FeatureHit) => void;
  onLongPress: (p: LngLat) => void;
};

/** The three map gestures the shell hands MapView. Pure but for `dispatch`:
 *  every branch ends in one action, so the rule can be read — and tested —
 *  without a map.
 *
 *  The two TAPS carry their whole rule here. The long press does not: it is
 *  forwarded unconditionally and the "route tab, and not mid-walk" guard
 *  lives in the reducer (`shellState.ts`, `longPress`), where it has been
 *  since before this file existed. Moving it up would split one rule across
 *  two places; this note is the other half of it (slice 8 review, F5). */
export function mapTaps(
  s: ShellState,
  dispatch: (a: Action) => void,
  city: City
): MapTaps {
  /** The reader's start point — the one both tabs share (CR-03 A8). On W0
   *  the tap STARTS the loops (SPEC §3 W0, "tap the map → W1 from that
   *  point") and on W1 it moves them; either way it is also the FROM of a
   *  route the other tab has planned, and a walk in progress is not asking a
   *  question at all. */
  const startHere = (at: LngLat, label: string | null) => {
    if (s.wander.k !== "loops" && s.wander.k !== "idle") return;
    dispatch({ type: "origin", origin: { kind: "point", at, label } });
  };

  return {
    onMapClick: (p) => {
      // on Wander a tap IS the question: loops from there instead
      if (s.tab === "wander") return startHere(p, null);
      // on Route a tap on empty map dismisses the card over it — and does
      // NOT drop a pin (HANDOVER §4.3: the Google model)
      if (s.route.k === "place" || s.route.k === "pin") dispatch({ type: "back" });
    },
    onFeatureTap: (f) => {
      // on Wander a tap is a place to start from, whatever is under it
      if (s.tab === "wander") return startHere([f.lng, f.lat], f.name);
      dispatch({
        type: "pickPlace",
        place: {
          name: f.name,
          kind: f.kind,
          district: null,
          lng: f.lng,
          lat: f.lat,
          inCity: inCity(city, f.lng, f.lat),
        },
      });
    },
    // unconditional by design — see the note above: `longPress` is the
    // reducer's to refuse, and it does, on every screen but the route tab's
    // own map
    onLongPress: (p) => dispatch({ type: "longPress", at: p }),
  };
}
