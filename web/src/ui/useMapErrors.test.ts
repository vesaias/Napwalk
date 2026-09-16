import { describe, expect, it } from "vitest";
import { mapErrorKind } from "./useMapErrors";

// QA F2-08: the basemap `.pmtiles` 404ing left a blank rectangle and said
// nothing. The shell only interrupts the walker for `basemap`, so what
// counts as one is the whole decision.
describe("mapErrorKind", () => {
  it("names the basemap by its source id", () => {
    expect(mapErrorKind("protomaps", "AJAXError: 404")).toBe("basemap");
    expect(mapErrorKind("osm", "AJAXError: 404")).toBe("basemap");
  });

  it("names the noise overlay, which is not worth a toast", () => {
    expect(mapErrorKind("noise", "AJAXError: 404")).toBe("tiles");
  });

  it("leaves every other named source alone", () => {
    expect(mapErrorKind("routes", "bad geojson")).toBe("other");
    expect(mapErrorKind("border", "bad geojson")).toBe("other");
    // a named source we do not know is not the basemap, whatever it says
    expect(mapErrorKind("somethingelse", "frankfurt.pmtiles failed")).toBe("other");
  });

  it("falls back to the message when the event names no source", () => {
    // the pmtiles protocol can fail before the source is attributed
    expect(mapErrorKind(undefined, "Error: pmtiles://…/frankfurt.pmtiles 404")).toBe("basemap");
    expect(mapErrorKind(undefined, "failed to fetch /basemap/frankfurt.pmtiles")).toBe("basemap");
    expect(mapErrorKind(undefined, "GET /tiles/frankfurt/noise/14/1/1.webp 404")).toBe("tiles");
    expect(mapErrorKind(undefined, "WebGL context lost")).toBe("other");
  });
});
