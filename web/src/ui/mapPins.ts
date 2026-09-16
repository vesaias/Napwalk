// The two markers the map draws: where the walk starts, and what it is for.
//
// Lifted out of AppShell (CR-02 slice A) for the same reason mapTaps.ts was:
// it is a rule, not wiring, and it is the rule that has been got wrong twice.
// The DESTINATION belongs to the route tab alone — Wander has no subject, its
// loops come back to where they left. The START belongs to NEITHER tab: it is
// the reader's one "here" (`s.origin`, CR-03 A8), so the same pin is drawn on
// both, and switching tabs no longer makes it vanish (Viktor, 2026-09-09).
//
// A live fix draws no pin on either tab — the GPS dot is already there — so
// W0 and Home are bare until something is pinned, which is what the board
// draws (hb-wander-idle, hb-home).
import type { LngLat } from "../components/MapView";
import type { ShellState } from "./shellState";

export type MapPins = { start: LngLat | null; dest: LngLat | null };

export function mapPins(s: ShellState): MapPins {
  const start = s.origin.kind === "point" ? s.origin.at : null;
  if (s.tab !== "route") return { start, dest: null };
  const r = s.route;
  const dest =
    r.k === "place"
      ? ([r.place.lng, r.place.lat] as LngLat)
      : r.k === "pin"
        ? r.at
        : r.k === "routes" || r.k === "navigate"
          ? r.dest
          : null;
  return { start, dest };
}
