import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "geojson";
import { NO_FC } from "./mapData";
import {
  fitFor,
  fitPadding,
  LANDSCAPE_PANEL_W,
  MARKER_H,
  ROUTE_HEADER_H,
  WANDER_HEADER_H,
} from "./mapFit";

const line: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[8.68, 50.11], [8.69, 50.13]] } },
  ],
};
const phone = { width: 390, height: 844 };
const desk = { width: 1440, height: 900 };
const land = { width: 744, height: 390 };

describe("fitPadding on the phone's side (CR-03 Q4)", () => {
  it("clears the 300 px panel on the left, and nothing at the bottom", () => {
    const p = fitPadding("phone-landscape", land);
    expect(p.left).toBe(LANDSCAPE_PANEL_W + 24);
    // no sheet in landscape: the foot of the map is the map
    expect(p.bottom).toBe(24 + MARKER_H);
    expect(p.top).toBe(24 + MARKER_H);
    // the Layers/Locate column on the map's right edge
    expect(p.right).toBe(24 + 16 + 44);
  });

  it("ignores the sheet height it is never given one of", () => {
    expect(fitPadding("phone-landscape", land, "routes", 300)).toEqual(
      fitPadding("phone-landscape", land, "loops", 0),
    );
  });

  it("leaves a band the walk can actually be drawn in", () => {
    const p = fitPadding("phone-landscape", land);
    expect(land.width - p.left - p.right).toBeGreaterThan(0);
    expect(land.height - p.top - p.bottom).toBeGreaterThan(0);
    expect(fitFor(line, "phone-landscape", land)).not.toBeNull();
  });

  it("gives up rather than throwing inside maplibre on an iPhone SE", () => {
    // 667 × 375: the padding is 324 + 84 = 408 wide and 128 tall, which
    // still fits — the guard is what catches anything narrower.
    expect(fitFor(line, "phone-landscape", { width: 667, height: 375 })).not.toBeNull();
    expect(fitFor(line, "phone-landscape", { width: 400, height: 375 })).toBeNull();
  });
});

describe("fitPadding", () => {
  it("keeps the phone's bottom sheet clear", () => {
    const p = fitPadding("phone", phone);
    expect(p.bottom).toBeGreaterThan(phone.height * 0.4);
    expect(p.top).toBeGreaterThan(100); // the search bar and chips
    expect(fitPadding("phone", phone, "loops").bottom).toBeGreaterThan(p.bottom);
  });
  // Slice 4: the sheet is draggable, so the share of the phone it covers is
  // measured off it rather than guessed at.
  it("follows the sheet's measured height when there is one", () => {
    const guessed = fitPadding("phone", phone);
    expect(fitPadding("phone", phone, "routes", 88).bottom).toBe(88 + 24);
    expect(fitPadding("phone", phone, "routes", 617).bottom).toBe(617 + 24);
    // 0 is "nothing has been measured yet": the old fraction stands in
    expect(fitPadding("phone", phone, "routes", 0).bottom).toBe(guessed.bottom);
    // the web card is not a floor, and never passes one
    expect(fitPadding("desktop-card", desk, "routes", 300).bottom).toBe(
      fitPadding("desktop-card", desk).bottom
    );
  });

  it("clears the R4 header and the marker standing on the point", () => {
    // The compact header is 127 px (SPEC §3 R4, measured against HB-routes);
    // a destination teardrop rises ~40 px above the point the fit is made on.
    expect(ROUTE_HEADER_H).toBe(127);
    expect(fitPadding("phone", phone).top).toBe(ROUTE_HEADER_H + 48);
    // Wander's chrome is its own — a one-line pill and a chip row, 94 px —
    // and its fit is measured from that, not from R4's panel
    expect(fitPadding("phone", phone, "loops").top).not.toBe(ROUTE_HEADER_H + 48);
    expect(WANDER_HEADER_H).toBe(94);
    expect(fitPadding("phone", phone, "loops").top).toBe(WANDER_HEADER_H + 56);
  });

  // CR-C review C3: a flat 180 was calibrated against the two-line Wander
  // header. With a 94 px header it left 86 px of dead space above the loop
  // and 24 below, pushing the walk ~31 px under the centre of its band —
  // and spending the 16 px the one-line pill had just bought back.
  it("leaves the loop within a marker's height of the centre of its band", () => {
    const sheetH = 207; // W1 at peek, 402 x 700: the sheet's 150 plus the bar
    const p = fitPadding("phone", phone, "loops", sheetH);
    const above = p.top - WANDER_HEADER_H;
    const below = p.bottom - sheetH;
    // both are "a marker's height, or a little air" — never one of each
    expect(above - below).toBeLessThanOrEqual(MARKER_H);
    expect(above).toBeGreaterThanOrEqual(below);
  });
  it("keeps the web card and panel clear on the left", () => {
    expect(fitPadding("tablet", desk).left).toBeGreaterThan(360);
    expect(fitPadding("desktop-panel", desk).left).toBeGreaterThan(408);
    expect(fitPadding("desktop-card", desk).bottom).toBeLessThan(100);
  });

  // Slice 8, board B: every web number is the card's width, the 16 px it
  // stands in from the edge, and the 24 px gutter — plus, on the right, the
  // corner the locate button and the zoom pill occupy, and top and bottom a
  // marker's 40 px, because the fit is made on the POINTS and a teardrop
  // stands above the one it marks.
  it("boxes the web frames off the card, the controls and the markers", () => {
    expect(fitPadding("tablet", desk)).toEqual({
      top: 64,
      right: 84,
      bottom: 64,
      left: 360 + 16 + 24,
    });
    expect(fitPadding("desktop-card", desk)).toEqual({
      top: 64,
      right: 84,
      bottom: 64,
      left: 408 + 16 + 24,
    });
    // ...and the panel starts at x=0, so it wants 16 px less than the card
    // that stands in from the edge. Slice 8 used one sum for both and put
    // every panelled route 16 px right of centre (review F4).
    expect(fitPadding("desktop-panel", desk)).toEqual({
      top: 64,
      right: 84,
      bottom: 64,
      left: 408 + 24,
    });
    expect(fitPadding("desktop-panel", desk).left).toBe(
      fitPadding("desktop-card", desk).left - 16
    );
  });

  it("leaves the right-hand corner wider than the controls that stand in it", () => {
    // 44 px of button, 16 px in from the edge: anything less and the walk
    // runs under the zoom pill.
    expect(fitPadding("desktop-card", desk).right).toBeGreaterThanOrEqual(16 + 44);
  });
});

describe("fitFor", () => {
  it("is null with nothing drawn", () => {
    expect(fitFor(NO_FC, "phone", phone)).toBeNull();
  });
  it("boxes the lines with the layout's padding", () => {
    const f = fitFor(line, "phone", phone);
    expect(f?.bounds).toEqual([[8.68, 50.11], [8.69, 50.13]]);
    expect(f?.padding).toEqual(fitPadding("phone", phone));
  });
  it("still fits a route that collapsed to a single point", () => {
    const dot: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[8.68, 50.11]] } },
      ],
    };
    const f = fitFor(dot, "phone", phone);
    // a zero-size box is a legitimate fit — maplibre centres on it and
    // keeps its own maxZoom — so this must not be null
    expect(f).not.toBeNull();
    expect(f?.bounds).toEqual([[8.68, 50.11], [8.68, 50.11]]);
    expect(f?.padding).toEqual(fitPadding("phone", phone));
  });

  it("gives up rather than fit into a box the chrome fills", () => {
    expect(fitFor(line, "desktop-panel", { width: 400, height: 300 })).toBeNull();
  });
});
