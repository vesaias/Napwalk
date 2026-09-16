// One question, asked in the two places a coordinate enters the app: is this
// a point MapLibre will accept?
//
// QA F6-01 (2026-09-06): Photon's contract is [lon, lat] in degrees, but
// nothing enforced it. One feature with `coordinates: [999, -999]` — a
// lat/lon swap, or simply a bad OSM record — travelled from the search list
// into MapView's focus effect, where `easeTo({ center })` threw "Invalid
// LngLat latitude value" synchronously inside a useEffect. React unmounted
// the whole tree and the page went white.
//
// So: geocode.ts drops such a feature at the door, and MapView ignores any
// point that gets past it anyway. Range, not just finiteness — NaN is the
// easy half; 999 is the one that actually happened.

/** A [lng, lat] MapLibre can be handed: two finite numbers, lng in
 *  −180…180, lat in −90…90. */
export function isLngLat(v: unknown): v is [number, number] {
  if (!Array.isArray(v) || v.length < 2) return false;
  const [lng, lat] = v as unknown[];
  return (
    typeof lng === "number" &&
    typeof lat === "number" &&
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}
