import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CITIES, DEFAULT_CITY, type City } from "../cities";
import { bootSettings } from "./useSettings";
import { DEFAULT_SETTINGS } from "../plan/settings";
import {
  askEdge,
  fetchWhere,
  WHERE_TIMEOUT_MS,
  cityFromEdge,
  cityFromTimeZone,
  EDGE_RADIUS_M,
  parseWhere,
  pickBootCity,
  type EdgeWhere,
} from "./where";

const where = (p: Partial<EdgeWhere>): EdgeWhere => ({
  city: null,
  region: null,
  country: null,
  lat: null,
  lng: null,
  ...p,
});

describe("cityFromTimeZone", () => {
  it("names the city when exactly one is in the zone", () => {
    expect(cityFromTimeZone("Europe/London")).toBe("london");
    expect(cityFromTimeZone("Europe/Paris")).toBe("paris");
    expect(cityFromTimeZone("America/New_York")).toBe("nyc");
    expect(cityFromTimeZone("America/Los_Angeles")).toBe("sf");
  });

  // The brief's rule, and the reason there is no offset arithmetic here.
  it("is null for a zone with no city in it, however close the offset", () => {
    expect(cityFromTimeZone("Asia/Tokyo")).toBeNull();
    // same UTC offset as Europe/Berlin for half the year, and not Germany
    expect(cityFromTimeZone("Africa/Lagos")).toBeNull();
    expect(cityFromTimeZone("Europe/Madrid")).toBeNull();
  });

  it("is null for a zone that holds more than one city", () => {
    // frankfurt, hamburg, berlin and munich are all Europe/Berlin: the clock
    // says "Germany", which is not an answer. This is the case the edge is
    // asked about.
    expect(CITIES.filter((c) => c.timeZone === "Europe/Berlin")).toHaveLength(4);
    expect(cityFromTimeZone("Europe/Berlin")).toBeNull();
  });

  it("is null for nothing at all", () => {
    expect(cityFromTimeZone(null)).toBeNull();
    expect(cityFromTimeZone(undefined)).toBeNull();
    expect(cityFromTimeZone("")).toBeNull();
  });

  it("ignores a city that is not built", () => {
    const listed: City[] = [{ ...CITIES[5], available: false }];
    expect(cityFromTimeZone("Europe/London", listed)).toBeNull();
    expect(cityFromTimeZone("Europe/London", [CITIES[5]])).toBe("london");
  });
});

describe("cityFromEdge", () => {
  it("takes the city whose bounds the point is in", () => {
    expect(cityFromEdge(where({ lng: 2.35, lat: 48.85 }))).toBe("paris");
    expect(cityFromEdge(where({ lng: -73.98, lat: 40.75 }))).toBe("nyc");
    expect(cityFromEdge(where({ lng: 13.4, lat: 52.52 }))).toBe("berlin");
  });

  it("takes the nearest centre within the radius when the point is outside every box", () => {
    // Offenbach: outside Frankfurt's box by a few km, and nowhere else near
    expect(cityFromEdge(where({ lng: 8.7667, lat: 50.1 }))).toBe("frankfurt");
    // Potsdam is 26 km from the Berlin centre and outside its clip
    expect(cityFromEdge(where({ lng: 13.06, lat: 52.4 }))).toBe("berlin");
  });

  it("is null past the radius", () => {
    // mid-Atlantic
    expect(cityFromEdge(where({ lng: -30, lat: 45 }))).toBeNull();
    // Warsaw: a real city, 900 km from the nearest of the eight
    expect(cityFromEdge(where({ lng: 21.01, lat: 52.23 }))).toBeNull();
  });

  it("keeps the two cities the radius could confuse apart", () => {
    expect(EDGE_RADIUS_M).toBeLessThan(344_000); // Paris–London
    expect(cityFromEdge(where({ lng: 2.35, lat: 48.85 }))).toBe("paris");
    expect(cityFromEdge(where({ lng: -0.13, lat: 51.51 }))).toBe("london");
  });

  it("ignores the name and needs both coordinates", () => {
    // "London, Ontario" — the name is never matched, only the point
    expect(cityFromEdge(where({ city: "London", lng: -81.24, lat: 42.98 }))).toBeNull();
    expect(cityFromEdge(where({ city: "Paris", lat: 48.85 }))).toBeNull();
    expect(cityFromEdge(where({ city: "Paris", lng: 2.35 }))).toBeNull();
    expect(cityFromEdge(null)).toBeNull();
  });
});

describe("parseWhere", () => {
  it("keeps what the edge really sent", () => {
    expect(parseWhere({ city: "Paris", region: "Île-de-France", country: "FR", lat: 48.85, lng: 2.35 }))
      .toEqual({ city: "Paris", region: "Île-de-France", country: "FR", lat: 48.85, lng: 2.35 });
  });

  it("drops anything that is not what it claims", () => {
    const w = parseWhere({ city: 7, lat: "48.85", lng: 2.35, country: "" });
    expect(w).toEqual({ city: null, region: null, country: null, lat: null, lng: 2.35 });
  });

  it("survives an empty answer, and refuses a non-object", () => {
    expect(parseWhere({})).toEqual({ city: null, region: null, country: null, lat: null, lng: null });
    expect(parseWhere(null)).toBeNull();
    expect(parseWhere([1, 2])).toBeNull();
    expect(parseWhere("Paris")).toBeNull();
  });

  it("refuses coordinates off the planet", () => {
    expect(parseWhere({ lat: 1e9, lng: 2.35 })?.lat).toBeNull();
    expect(parseWhere({ lat: 48.85, lng: -400 })?.lng).toBeNull();
    expect(parseWhere({ lat: Number.NaN, lng: 2.35 })?.lat).toBeNull();
  });
});

describe("pickBootCity", () => {
  const PARIS = where({ city: "Paris", lat: 48.85, lng: 2.35 });

  it("is Frankfurt when nothing says otherwise", () => {
    expect(pickBootCity({})).toBe(DEFAULT_CITY);
    expect(pickBootCity({ tz: "Asia/Tokyo", edge: where({}) })).toBe(DEFAULT_CITY);
  });

  it("takes the time zone over the default", () => {
    expect(pickBootCity({ tz: "Europe/London" })).toBe("london");
    expect(pickBootCity({ tz: "America/New_York" })).toBe("nyc");
  });

  it("takes the edge over the time zone", () => {
    expect(pickBootCity({ tz: "Europe/Berlin", edge: PARIS })).toBe("paris");
    // and over a zone that DOES name a city, if it is ever asked there
    expect(pickBootCity({ tz: "Europe/London", edge: PARIS })).toBe("paris");
  });

  it("takes a stored city over both guesses", () => {
    expect(pickBootCity({ stored: "hamburg", tz: "Europe/London", edge: PARIS })).toBe("hamburg");
  });

  it("takes the link over everything", () => {
    expect(pickBootCity({ link: "sf", stored: "hamburg", tz: "Europe/London", edge: PARIS })).toBe("sf");
  });
});

describe("askEdge", () => {
  it("asks only when nothing on the device can answer", () => {
    expect(askEdge({ tz: "Europe/Berlin" })).toBe(true);
    expect(askEdge({ tz: "Asia/Tokyo" })).toBe(true);
    expect(askEdge({ tz: null })).toBe(true);
  });

  it("never asks when a city is stored, linked, or named by the clock", () => {
    expect(askEdge({ tz: "Europe/London" })).toBe(false);
    expect(askEdge({ stored: "frankfurt", tz: "Europe/Berlin" })).toBe(false);
    expect(askEdge({ link: "nyc", tz: "Europe/Berlin" })).toBe(false);
  });
});

// boot.ts splits the precedence in two: the record's DEFAULT is picked
// without the link, and `bootSettings` lays the link on top. The two paths
// have to agree, or a share link would open on the wrong city.
describe("the boot path bootSettings takes", () => {
  it("ends on the same city as pickBootCity with all four", () => {
    for (const link of [null, "sf"] as const) {
      for (const stored of [null, "hamburg"] as const) {
        for (const tz of [null, "Europe/London", "Europe/Berlin"]) {
          const dflt = pickBootCity({ stored, tz });
          const pair = bootSettings(
            { ...DEFAULT_SETTINGS, city: stored ?? dflt },
            link ? { city: link } : {}
          );
          expect(pair.session.city).toBe(pickBootCity({ stored, link, tz }));
        }
      }
    }
  });
});

describe("fetchWhere", () => {
  afterEach(() => vi.unstubAllGlobals());

  const answers = (impl: (url: string) => unknown) => {
    const spy = vi.fn(async (url: string) => impl(url));
    vi.stubGlobal("fetch", spy);
    return spy;
  };

  it("GETs /api/where and parses the answer", async () => {
    const spy = answers(() => ({
      ok: true,
      json: async () => ({ city: "Paris", lat: 48.85, lng: 2.35 }),
    }));
    const w = await fetchWhere();
    expect(spy.mock.calls[0][0]).toBe("/api/where");
    expect(cityFromEdge(w)).toBe("paris");
  });

  // Every failure means the same thing: go on with what the device knew.
  it("is null on a 404, on junk, and on a network error", async () => {
    answers(() => ({ ok: false, json: async () => ({}) }));
    expect(await fetchWhere()).toBeNull();
    // the SPA fallback answering with index.html
    answers(() => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }));
    expect(await fetchWhere()).toBeNull();
    answers(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await fetchWhere()).toBeNull();
  });

  it("gives up rather than hanging, and says how long it waits", async () => {
    expect(WHERE_TIMEOUT_MS).toBe(1500);
    vi.stubGlobal(
      "fetch",
      (_u: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new DOMException("aborted")));
        })
    );
    expect(await fetchWhere(5)).toBeNull();
  });

});

// The privacy rules the endpoint's comment states, held down as a test —
// the same trick report.test.ts uses to pin its three copies of MAX_BODY
// together, and for the same reason: nothing can import that file.
describe("the /api/where endpoint", () => {
  const src = readFileSync(resolve(__dirname, "../../functions/api/where.ts"), "utf8");

  it("never lets another origin read the answer", () => {
    expect(src).not.toMatch(/access-control-allow-origin/i);
    expect(src).toMatch(/cross-origin/);
  });

  it("is never cached, anywhere", () => {
    expect(src).toMatch(/"cache-control": "private, no-store"/);
  });

  it("logs nothing", () => {
    expect(src).not.toMatch(/console\./);
  });

  it("answers the five fields the client parses, and no more", () => {
    const body = /const body = \{([^}]*)\}/.exec(src)?.[1] ?? "";
    const fields = [...body.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
    expect(fields).toEqual(["city", "region", "country", "lat", "lng"]);
    expect(Object.keys(parseWhere({})!)).toEqual(fields);
  });
});
