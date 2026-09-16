import { afterEach, describe, expect, it, vi } from "vitest";
import { getCity } from "../cities";
import {
  GeocodeError,
  MAX_QUERY,
  rankAnchor,
  rankPlaces,
  reverseGeocode,
  searchPlaces,
} from "./geocode";

type Feature = { properties: Record<string, unknown>; geometry: { coordinates: [number, number] } };

function photonStub(features: Feature[]) {
  const calls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    inits.push(init);
    return { ok: true, json: async () => ({ type: "FeatureCollection", features }) };
  });
  vi.stubGlobal("fetch", fetch);
  return Object.assign(calls, { inits });
}

afterEach(() => vi.unstubAllGlobals());

describe("searchPlaces", () => {
  it("maps a Photon feature to a Place, skips nameless ones, biases to the city centre", async () => {
    const calls = photonStub([
      { properties: { name: "Günthersburgpark", osm_key: "leisure", osm_value: "park", district: "Nordend" },
        geometry: { coordinates: [8.696, 50.128] } },
      { properties: { osm_key: "place", osm_value: "locality" }, geometry: { coordinates: [8.7, 50.1] } },
    ]);
    const out = await searchPlaces("günth", getCity("frankfurt"));
    expect(out).toEqual([
      { name: "Günthersburgpark", kind: "park", district: "Nordend", lng: 8.696, lat: 50.128, inCity: true },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("https://photon.komoot.io/api/?q=g%C3%BCnth");
    expect(calls[0]).toContain("limit=8");
    expect(calls[0]).toContain("lang=en");
    expect(calls[0]).toContain("lat=50.1109");
    expect(calls[0]).toContain("lon=8.6821");
    expect(calls[0]).toContain("location_bias_scale=0.3");
    expect(calls[0]).not.toContain("bbox="); // bbox is a hard filter: no out-of-city hits, inCity meaningless
  });

  it("skips a feature with malformed coordinates", async () => {
    photonStub([
      { properties: { name: "Broken", osm_key: "place" }, geometry: { coordinates: ["8.7", 50.1] as unknown as [number, number] } },
      { properties: { name: "Half", osm_key: "place" }, geometry: { coordinates: [8.7] as unknown as [number, number] } },
    ]);
    expect(await searchPlaces("b", getCity("frankfurt"))).toEqual([]);
  });

  it("passes an AbortSignal through to fetch", async () => {
    const calls = photonStub([]);
    const ctl = new AbortController();
    await searchPlaces("x", getCity("frankfurt"), undefined, ctl.signal);
    expect(calls.inits[0]?.signal).toBe(ctl.signal);
  });

  it("names a house by street + number, falls back to osm_key and city, flags out-of-city hits", async () => {
    const calls = photonStub([
      { properties: { street: "Berger Straße", housenumber: "12", osm_key: "building", city: "Frankfurt am Main" },
        geometry: { coordinates: [8.70, 50.12] } },
      { properties: { name: "Alexanderplatz", osm_key: "railway", osm_value: "station", city: "Berlin" },
        geometry: { coordinates: [13.41, 52.52] } },
    ]);
    const out = await searchPlaces("berger", getCity("frankfurt"), [8.68, 50.11]);
    expect(out).toEqual([
      { name: "Berger Straße 12", kind: "building", district: "Frankfurt am Main", lng: 8.70, lat: 50.12, inCity: true },
      { name: "Alexanderplatz", kind: "station", district: "Berlin", lng: 13.41, lat: 52.52, inCity: false },
    ]);
    expect(calls[0]).toContain("lat=50.11"); // `near` wins over the city centre
    expect(calls[0]).toContain("lon=8.68");
  });

  // QA F2-02: a failure used to be folded into the same empty list as a
  // genuine zero-match, so the search screen could not tell them apart.
  it("rejects with GeocodeError on a network error or a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await expect(searchPlaces("x", getCity("frankfurt"))).rejects.toBeInstanceOf(GeocodeError);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    await expect(searchPlaces("x", getCity("frankfurt"))).rejects.toBeInstanceOf(GeocodeError);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError("<html>"); } })));
    await expect(searchPlaces("x", getCity("frankfurt"))).rejects.toBeInstanceOf(GeocodeError);
  });

  it("answers an empty feature list as a zero-match, not a failure", async () => {
    photonStub([]);
    expect(await searchPlaces("nothing here", getCity("frankfurt"))).toEqual([]);
  });

  // QA F6-01: [999, -999] reached MapLibre's easeTo and threw "Invalid
  // LngLat" inside an effect, taking the whole React tree down.
  it("drops a feature whose coordinates are out of range", async () => {
    photonStub([
      { properties: { name: "Extreme", osm_key: "place" }, geometry: { coordinates: [999, -999] } },
      { properties: { name: "Swapped", osm_key: "place" }, geometry: { coordinates: [50.1109, 8.6821] as [number, number] } },
      { properties: { name: "NaN", osm_key: "place" }, geometry: { coordinates: [NaN, 50.11] } },
      { properties: { name: "Real", osm_key: "place" }, geometry: { coordinates: [8.696, 50.128] } },
    ]);
    const out = await searchPlaces("x", getCity("frankfurt"));
    // a swap INSIDE range is a place, just the wrong one — and since U3 the
    // city's own hit sorts above it
    expect(out.map((p) => p.name)).toEqual(["Real", "Swapped"]);
  });

  // QA F6-05: a 300-character paste became a 300-character URL.
  it("caps the query it sends at MAX_QUERY characters", async () => {
    const calls = photonStub([]);
    await searchPlaces(`  ${"x".repeat(300)}  `, getCity("frankfurt"));
    expect(MAX_QUERY).toBe(120);
    expect(calls[0]).toContain(`q=${"x".repeat(MAX_QUERY)}&`);
    expect(calls[0]).not.toContain("x".repeat(MAX_QUERY + 1));
  });

  it("returns [] for a blank query without calling the network", async () => {
    const calls = photonStub([]);
    expect(await searchPlaces("   ", getCity("frankfurt"))).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("reverseGeocode", () => {
  it("formats 'street housenumber · district'", async () => {
    const calls = photonStub([
      { properties: { street: "Berger Straße", housenumber: "12", district: "Nordend", osm_key: "building" },
        geometry: { coordinates: [8.70, 50.12] } },
    ]);
    expect(await reverseGeocode(8.70, 50.12)).toBe("Berger Straße 12 · Nordend");
    expect(calls[0]).toContain("https://photon.komoot.io/reverse?lon=8.7&lat=50.12");
    expect(calls[0]).toContain("lang=en");
  });

  it("passes an AbortSignal through to fetch", async () => {
    const calls = photonStub([]);
    const ctl = new AbortController();
    await reverseGeocode(8.7, 50.12, ctl.signal);
    expect(calls.inits[0]?.signal).toBe(ctl.signal);
  });

  it("uses the name when there is no street, and drops a missing district", async () => {
    photonStub([{ properties: { name: "Günthersburgpark", osm_key: "leisure" }, geometry: { coordinates: [8.696, 50.128] } }]);
    expect(await reverseGeocode(8.696, 50.128)).toBe("Günthersburgpark");
  });

  it("returns null with no features or on a network error", async () => {
    photonStub([]);
    expect(await reverseGeocode(0, 0)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await reverseGeocode(0, 0)).toBeNull();
  });
});

// UX sweep U3: with London selected and the fix still in Frankfurt, "Hyde
// Park" put Niederbrechen (46 km from the fix) first and Chicago third, and
// "Regent" returned no London result at all. The city is a deliberate
// choice; a fix is only where the phone happens to be.
describe("ranking around the selected city (UX sweep U3)", () => {
  const LONDON = getCity("london");
  const FRANKFURT = getCity("frankfurt");
  const FIX: [number, number] = [8.6821, 50.1109]; // the walker, in Frankfurt

  it("ranks around the city centre when the fix is in another city", () => {
    expect(rankAnchor(LONDON, FIX)).toEqual(LONDON.center);
  });

  it("ranks around the fix when the fix is inside the selected city", () => {
    expect(rankAnchor(FRANKFURT, FIX)).toEqual(FIX);
  });

  it("sends Photon the city centre, and sorts the answer by it", async () => {
    const calls = photonStub([
      { properties: { name: "Niederbrechen", osm_key: "place", osm_value: "village" },
        geometry: { coordinates: [8.18, 50.39] } },
      { properties: { name: "Hyde Park Chicago", osm_key: "place", osm_value: "suburb" },
        geometry: { coordinates: [-87.59, 41.79] } },
      { properties: { name: "Hyde Park", osm_key: "leisure", osm_value: "park" },
        geometry: { coordinates: [-0.1642, 51.5074] } },
    ]);
    const out = await searchPlaces("hyde park", LONDON, FIX);
    // the bias point that LEFT the device is London's centre, not the fix
    expect(calls[0]).toContain(`lat=${LONDON.center[1]}`);
    expect(calls[0]).toContain(`lon=${LONDON.center[0]}`);
    // …and the one hit inside London leads, however Photon ordered them
    expect(out.map((p) => p.name)).toEqual(["Hyde Park", "Niederbrechen", "Hyde Park Chicago"]);
    expect(out.map((p) => p.inCity)).toEqual([true, false, false]);
  });

  it("orders the out-of-city remainder by distance from the anchor", () => {
    const place = (name: string, lng: number, lat: number, inCity: boolean) => ({
      name, kind: "place", district: null, lng, lat, inCity,
    });
    const out = rankPlaces(
      [place("Chicago", -87.59, 41.79, false), place("Brighton", -0.14, 50.82, false)],
      LONDON.center
    );
    expect(out.map((p) => p.name)).toEqual(["Brighton", "Chicago"]);
  });

  it("keeps Photon's own order among equals — it re-sorts, it never drops", () => {
    const at = (name: string) => ({
      name, kind: "place", district: null, lng: 8.68, lat: 50.11, inCity: true,
    });
    const out = rankPlaces([at("first"), at("second"), at("third")], [8.68, 50.11]);
    expect(out.map((p) => p.name)).toEqual(["first", "second", "third"]);
  });
});
