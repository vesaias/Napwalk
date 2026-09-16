// Where the map is still visible once the sheet, card or panel is on it —
// the box a plan's lines must fit into, and the padding that keeps them
// clear of the chrome. Pure, so the numbers are tested rather than eyeballed.
import type { FeatureCollection } from "geojson";
import type { MapFit } from "../components/MapView";
import type { Layout } from "./layout/breakpoints";
import { boundsOf } from "./mapData";

/** The part of the viewport the walk's lines may occupy. The phone sheet
 *  covers the bottom ~42 % on the routes and loops screens (Task 12 fixed
 *  the routes map at 60 %); the web card is 360 px wide (408 at ≥ 1440),
 *  16 px in from the left, and the panel is the same 408 px.
 *
 *  The routes screen's top padding is the R4 header plus 48: the compact
 *  header is 127 px in a browser tab (SPEC §3 R4, index.css) and a marker
 *  standing on its point rises ~40 px above it, so the fit — which is on the
 *  POINTS, not the pins — needs the header, the pin and a little air.
 *  Wander's loops screen has no such header: a one-line pill with its chips
 *  under it, and the same three terms measured from its own bottom edge. */
/** The R4 header's height in a browser tab (SPEC §3 R4): 8 + 36 + 3 + 36 + 6
 *  + 30 + 8. Installed it is 171, but the extra is safe-area inset the map
 *  is behind anyway. */
export const ROUTE_HEADER_H = 127;

/** The Wander header's bottom edge in a browser tab (CR-01 edit 6,
 *  index.css): a 12 px top inset, the 44 px pill, 8 px of air and the 30 px
 *  chip row. It was 110 while the pill was two lines, and the loops fit was
 *  a flat 180 measured against that — 86 px of dead space above the loop
 *  against 24 below it once the pill became one line, which spent 16 of the
 *  16 px edit 6 bought back on padding (CR-C review, C3). */
export const WANDER_HEADER_H = 94;

/** How far a marker standing on its point rises above it: the destination
 *  teardrop and the origin ring are ~40 px tall, and every fit here is on
 *  the route's coordinates, not on the pins drawn at them. */
export const MARKER_H = 40;

/** The landscape phone's left panel (SPEC §3b, board CR-03 Q4). The map is
 *  everything to the right of it, so this is the fit's left padding rather
 *  than a bottom one: there is no sheet in landscape and nothing covers the
 *  foot of the map. Mirrored in index.css as `--web-card-w` on the
 *  landscape shell. */
export const LANDSCAPE_PANEL_W = 300;

export function fitPadding(
  layout: Layout,
  viewport: { width: number; height: number },
  sheet: "routes" | "loops" = "routes",
  /** The sheet's measured height at its current snap (kit/Sheet.tsx),
   *  0 before the first measurement lands. It is the sheet's TOP EDGE measured
   *  from the bottom of the viewport, so a sheet peeking above the tab bar
   *  carries the bar's height inside it and the fit clears both without a
   *  second term (CR-01 edit 5). Since slice 4 the sheet is
   *  draggable, so the share of the phone it covers is a fact to be read off
   *  it rather than a fraction to be guessed at; the fractions below are the
   *  fallback for that one frame. */
  sheetH = 0
) {
  // 32 on a phone, where the sheet already eats the bottom and the walk has
  // to breathe sideways; 24 on the web, per SPEC §7 and the boards.
  const gutter = layout === "phone" ? 32 : 24;
  // The phone on its side: the panel is where the sheet was, so the walk is
  // fitted into the band to the RIGHT of it. Top and bottom are the web's
  // pair — nothing is over the map there — and the right keeps the same
  // 44 px control column the web frame reserves, which is what the Layers
  // and Locate buttons stand in (index.css, `.shell--landscape`).
  if (layout === "phone-landscape") {
    return {
      top: gutter + MARKER_H,
      right: gutter + 16 + 44,
      bottom: gutter + MARKER_H,
      left: LANDSCAPE_PANEL_W + gutter,
    };
  }
  if (layout === "phone") {
    // Wander's sheet is taller: three cards, Start and Share, and the tab bar
    const covered = sheet === "loops" ? 0.52 : 0.42;
    const bottom = sheetH > 0 ? sheetH : Math.round(viewport.height * covered);
    // …plus the height of a marker standing on its point: the destination
    // teardrop and the origin ring rise ~40 px above it, and the fit is on
    // the points, not the pins (seen clipped on a phone 2026-09-06)
    // …and the same three terms on both screens: the chrome above, a marker
    // standing on its point, and a little air. That is what keeps the walk
    // centred in the band the chrome leaves it.
    const top =
      sheet === "loops" ? WANDER_HEADER_H + MARKER_H + 16 : ROUTE_HEADER_H + 48;
    return { top, right: gutter, bottom: bottom + 24, left: gutter };
  }
  const card = layout === "tablet" ? 360 : 408;
  // Left: whatever the chrome's right edge is, plus the gutter. A floating
  // card stands 16 px in and so ends at 16 + its width; the panel starts at
  // x=0 and ends at its width. Slice 8 used the card's sum for both and put
  // every panelled route 16 px right of centre (review F4).
  // Right: the gutter, plus the corner the locate button and the zoom pill
  // occupy (44 px wide, 16 px in). Top and bottom: the gutter plus the
  // marker allowance, because the fit is on the POINTS and a teardrop
  // standing on its point rises above them.
  const chrome = layout === "desktop-panel" ? card : card + 16;
  return {
    top: gutter + MARKER_H,
    right: gutter + 16 + 44,
    bottom: gutter + MARKER_H,
    left: chrome + gutter,
  };
}

/** The fit for what is drawn, or null when nothing is. */
export function fitFor(
  lines: FeatureCollection,
  layout: Layout,
  viewport: { width: number; height: number },
  sheet: "routes" | "loops" = "routes",
  sheetH = 0
): MapFit | null {
  const bounds = boundsOf(lines);
  if (!bounds) return null;
  const padding = fitPadding(layout, viewport, sheet, sheetH);
  // a fit that leaves no room would throw inside maplibre; give up instead
  if (padding.left + padding.right >= viewport.width || padding.top + padding.bottom >= viewport.height) return null;
  return { bounds, padding };
}
