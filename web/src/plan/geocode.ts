// Place search and reverse geocoding via Photon (komoot's public OSM
// geocoder, 2026-09-05). Static app, no key (CLAUDE.md rule 1): the browser
// calls photon.komoot.io directly. Results are biased towards the active
// city (lat/lon = the map focus or the city centre, location_bias_scale),
// not clipped to it: Photon's `bbox` is a hard filter, and a strong name
// match elsewhere ("Alexanderplatz" while in Frankfurt) is still worth
// showing greyed out — that is what `inCity` is for.
//
// `reverseGeocode` swallows network errors — a pin card with no address
// line is not worth an error state. `searchPlaces` no longer does: since QA
// F2-02 the search screen tells a failure apart from a genuine zero-match,
// so a request that could not be answered rejects with a GeocodeError and
// the caller decides. Debouncing and stale-response handling stay the
// caller's job.

import { inCity, type City } from "../cities";
import { getLocale } from "../i18n/t";
import { isLngLat } from "../lngLat";
import { distanceM } from "../ui/geo";
import type { LngLat } from "../components/MapView";

export type Place = {
  name: string;
  kind: string;             // OSM value (park, station, …), osm_key as fallback
  district: string | null;  // Photon district, else its city
  lng: number;
  lat: number;
  inCity: boolean;          // inside the active city's bounds
};

const PHOTON = "https://photon.komoot.io";

/** How much of a typed query leaves the device, in characters. Photon
 *  documents no ceiling, but nothing stopped a pathological paste from
 *  becoming a 300-character URL either (QA F6-05); 120 characters is longer
 *  than any address anyone types. */
export const MAX_QUERY = 120;

/** Photon could not answer at all: the network failed, the status was not
 *  ok, or the body was not JSON. Distinct from "answered, nothing matched",
 *  which is an empty array. */
export class GeocodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeocodeError";
  }
}

type PhotonProps = {
  name?: string;
  osm_key?: string;
  osm_value?: string;
  city?: string;
  district?: string;
  street?: string;
  housenumber?: string;
  postcode?: string;
  country?: string;
};

type PhotonFeature = {
  properties: PhotonProps;
  geometry: { coordinates: [number, number] };
};

/** Ask Photon. Throws GeocodeError when there is no answer to read; an
 *  answer with no `features` is an empty list, which is not a failure. */
async function photon(path: string, signal?: AbortSignal): Promise<PhotonFeature[]> {
  let resp: Response;
  try {
    resp = await fetch(`${PHOTON}${path}`, { signal });
  } catch (e) {
    throw new GeocodeError(`photon unreachable: ${String(e)}`);
  }
  if (!resp.ok) throw new GeocodeError(`photon ${resp.status}`);
  try {
    const body = (await resp.json()) as { features?: PhotonFeature[] };
    return Array.isArray(body.features) ? body.features : [];
  } catch (e) {
    throw new GeocodeError(`photon body: ${String(e)}`);
  }
}

/** The same request for a caller with nothing to say about a failure. */
async function photonQuiet(path: string, signal?: AbortSignal): Promise<PhotonFeature[]> {
  try {
    return await photon(path, signal);
  } catch {
    return [];
  }
}

/** Display name: Photon's `name`, else "street housenumber" for a house
 *  without one. Null when neither exists — such a feature is skipped. */
function displayName(p: PhotonProps): string | null {
  if (p.name) return p.name;
  if (p.street) return p.housenumber ? `${p.street} ${p.housenumber}` : p.street;
  return null;
}

/** Photon's location bias: 0.3 keeps the city's own hits on top without
 *  hiding a strong match elsewhere (Photon's default is 0.2). */
const BIAS_SCALE = 0.3;

/** The point the results are ranked around: where the reader is, but only
 *  while that is inside the city they have selected — otherwise the city's
 *  own centre.
 *
 *  The two are the same thing on an ordinary walk and nothing alike the
 *  moment they are not: with London selected and the fix in Frankfurt,
 *  "Hyde Park" put Niederbrechen (46 km from the fix) first and Chicago
 *  third, and "Regent" returned no London result at all (UX sweep U3). The
 *  city is the deliberate choice — a reader picks it from a list — and a
 *  GPS fix is just where the phone happens to be, so the choice wins. */
export function rankAnchor(c: City, near?: LngLat): LngLat {
  return near && inCity(c, near[0], near[1]) ? near : c.center;
}

/** Photon's order, re-sorted around the selected city: everything inside
 *  its bounds first, then by distance from `anchor`. Stable within each
 *  half, so Photon's own name-match ranking survives among equals — this
 *  re-orders, it never drops. Exported for the unit tests. */
export function rankPlaces(places: Place[], anchor: LngLat): Place[] {
  return places
    .map((p, i) => ({ p, i, d: distanceM(anchor, [p.lng, p.lat]) }))
    .sort((a, b) =>
      a.p.inCity !== b.p.inCity ? (a.p.inCity ? -1 : 1) : a.d - b.d || a.i - b.i
    )
    .map((x) => x.p);
}

/** Rejects with GeocodeError when Photon could not be reached or answered
 *  with an error — the search screen shows a retry, not "no results". */
export async function searchPlaces(q: string, c: City, near?: LngLat, signal?: AbortSignal): Promise<Place[]> {
  const query = q.trim().slice(0, MAX_QUERY);
  if (!query) return [];
  const anchor = rankAnchor(c, near);
  const [lon, lat] = anchor;
  const qs = `q=${encodeURIComponent(query)}&limit=8&lang=${getLocale()}` +
    `&lat=${lat}&lon=${lon}&location_bias_scale=${BIAS_SCALE}`;
  const features = await photon(`/api/?${qs}`, signal);
  const out: Place[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    const name = displayName(p);
    const coords = f.geometry?.coordinates;
    if (!name || !coords) continue;
    // Range, not just type: an out-of-range or lon/lat-swapped record used
    // to reach MapLibre and take the whole shell down (QA F6-01).
    if (!isLngLat(coords)) continue;
    const [lng, lat] = coords;
    out.push({
      name,
      kind: p.osm_value ?? p.osm_key ?? "",
      district: p.district ?? p.city ?? null,
      lng,
      lat,
      inCity: inCity(c, lng, lat),
    });
  }
  return rankPlaces(out, anchor);
}

/** "Berger Straße 12 · Nordend" for a dropped pin; null when Photon has
 *  nothing nameable there or the request fails. */
export async function reverseGeocode(lng: number, lat: number, signal?: AbortSignal): Promise<string | null> {
  const features = await photonQuiet(`/reverse?lon=${lng}&lat=${lat}&lang=${getLocale()}`, signal);
  const p = features[0]?.properties;
  if (!p) return null;
  const name = (p.street && (p.housenumber ? `${p.street} ${p.housenumber}` : p.street)) || p.name;
  if (!name) return null;
  const district = p.district ?? p.city ?? null;
  return district && district !== name ? `${name} · ${district}` : name;
}
