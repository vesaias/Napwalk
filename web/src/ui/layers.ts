// The map layers: which screens offer the button that changes them
// (CR-02 edit 2, board `screens-cr02/hb-home-layers`).
//
// A pure rule, next to ui/tabBar.ts, for the same reason that one is pure:
// the answer must not depend on anything the DOM happens to be showing, and
// it has to be readable in a test rather than in a screenshot.
//
// The button is offered wherever the MAP is the screen — Home, W0, the place
// and pin cards, and the outside-city banner that sits on Home. It is not
// offered where a header owns the top of the phone and the map is the
// backdrop to a walk that is already chosen: the routes list (R4), the loops
// list (W1), a walk in progress and its arrival. Settings has no map to put
// it on at all. Since CR-03 A1 those screens reach the layers through the
// header's own 30 px chip instead (S3, board Q2) — the overlay is the
// reader's on every screen now, so the button being absent must not mean
// the question cannot be asked.
import type { Layers } from "../plan/settings";
import { navigating, type ShellState } from "./shellState";

/** Route screens with a map to put a button on: everything before a trip
 *  exists. `search` is out because its page covers the map entirely. */
const MAP_SCREENS = new Set(["home", "place", "pin"]);

/** Is the layers button on this screen? */
export function layersButtonVisible(s: ShellState): boolean {
  if (s.tab === "settings") return false;
  if (s.tab === "wander") return s.wander.k === "idle";
  return MAP_SCREENS.has(s.route.k);
}

/** …and is the 30 px CHIP on it instead (CR-03 Q2, board `c-q2`)?
 *
 *  The two screens with a walk drawn and a header of their own: the routes
 *  list (R4) and the loops list (W1, and W3 with a via, which is the same
 *  screen). They have no map corner to float a button over — the header owns
 *  the top and the sheet the bottom — so the layers ride at the right edge
 *  of the chip row the header already carries. Never both: the two rules are
 *  exclusive by construction, which `layers.test.ts` pins.
 *
 *  Not the walk itself or its arrival: a walker following a line is not
 *  being offered a legend, and their banner has no chip row to put one in. */
export function layersChipVisible(s: ShellState): boolean {
  if (s.tab === "wander") return s.wander.k === "loops";
  return s.tab === "route" && s.route.k === "routes";
}

/** Which box on the phone the button hangs under, 12 px below it: the
 *  52 px search bar on the Route tab's three screens, W0's 44 px pill on
 *  the Wander tab (index.css, `.shell-layers--float[data-under]`). */
export function layersButtonUnder(s: ShellState): "search" | "pill" {
  return s.tab === "wander" ? "pill" : "search";
}

/** What the map paints, and when: the two overlay switches MapView takes and
 *  the minute the sun is drawn at. */
export type MapOverlays = { shadeOn: boolean; noiseOn: boolean; shadeMin: number };

/**
 * The overlays, from the reader's settings — and from nothing else.
 *
 * Shade is on when `layers.shade` is on. It used to be on ALSO whenever a
 * walk was drawn under it (CR-01 edit 1, CR-02 edit 4, SPEC §6.2/§6.6), on
 * the argument that shade is what the app is for; Viktor's ruling of
 * 2026-09-09 reverses that (backlog B6, CR-03 A1): "shade should not auto
 * appear on planning, should be on if user selected it in layer". A reader
 * who left the overlay off means it off, and an overlay that switched itself
 * on under every plan made the Shade row a switch that did not switch.
 *
 * Rule 4 (CLAUDE.md) is untouched, and was never what this said: the ROUTER
 * costs every edge at its own arrival time whether or not the wash is
 * painted, and the cards' shade percentages come from the same numbers. The
 * overlay is ONE snapshot of the sun, at the minute the walk starts, over
 * the whole city — "what it will look like when I leave" — and once the walk
 * is under way that minute is the wall clock, the same one the navigate
 * screen's ETA reads (screens/route/RouteTab.tsx).
 */
export function mapOverlays(s: ShellState, layers: Layers, now: number): MapOverlays {
  return {
    shadeOn: layers.shade,
    noiseOn: layers.noise,
    shadeMin: shadeMinute(s, now),
  };
}

/**
 * The minute the sun is drawn at, decided in ONE place (CR-02 slice B's note
 * to slice C).
 *
 * Three answers, in the order the reader would give them: the scrubber, if
 * they are holding one (CR-02 edit 5); the wall clock, if they are walking;
 * and otherwise the minute the walk leaves at. Everything downstream reads
 * this — MapView's `minutes`, the Shade row's "Building and tree shadows for
 * HH:MM", the scrubber's own clock — so a scrubbed minute reaches all three
 * without any of them knowing the scrubber exists.
 *
 * Rule 4 (CLAUDE.md) is untouched: this is the OVERLAY's single snapshot of
 * the sun over the whole city, never an edge cost. The router still charges
 * every edge at its own arrival time, and the scrubber cannot even be on
 * screen while a walk is drawn.
 */
export function shadeMinute(s: ShellState, now: number): number {
  return s.scrub ?? (navigating(s) ? now : s.startMin);
}

/**
 * Is the day scrubber on screen? (CR-02 edit 5.)
 *
 * The caller has already decided this is a web frame — the phone has no
 * scrubber at any width (SPEC §6.7), and `layoutFor` is AppShell's answer,
 * not a rule about state. What is left is a rule:
 *
 *   - the reader asked for shade. The scrubber holds a minute the overlay
 *     is painted at, and a control that owns a minute nothing is drawing
 *     with would be worse than no control.
 *   - nothing is drawn, and nothing is being computed. `drawn` covers the
 *     ghost of the last walk, which is what stands there through a replan;
 *     `computing` covers the first plan of a session, which has no ghost.
 *   - **the map is the screen**, which is the same question
 *     `layersButtonVisible` already answers: a tab root with no trip on it
 *     (Home, W0, the place and pin cards) and nothing else. It shipped
 *     without this clause and the card therefore stood over Settings, and
 *     over the no-route card — `route.k === "routes"` is both the results
 *     list and the "no route here" screen, and on the second of those
 *     nothing is drawn, so the rule as written said yes. A reader being told
 *     their location is off does not want a sun toy under it (CR-02 slice C
 *     review, F2, deviation 6).
 *   - nothing modal is over it. The layers popover is the exception the
 *     board itself draws (`w-layers-day` shows both at once) — it dims
 *     nothing, and its Shade row is where the scrubbed minute is written
 *     out in words.
 */
export function scrubberVisible(s: ShellState, layers: Layers, drawn: boolean): boolean {
  if (!layers.shade || drawn || s.computing || !layersButtonVisible(s)) return false;
  return s.overlay === null || s.overlay === "layers";
}
