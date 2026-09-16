// The city registry (2026-08-30). Until now Frankfurt was hardcoded here and
// there — CLAUDE.md rule 2 said generality arrives with city #2, and it has.
// See DECISIONS.md 2026-08-30.
//
// `available` is the honest bit: a city is only usable once its graph
// artifact ships. All eight shipped on 2026-09-01 (DECISIONS); a city whose
// artifact is regenerated at a different size may need its `parts` updated
// — 08_export_graph prints the count.

export type CityId =
  | "frankfurt" | "hamburg" | "berlin" | "munich"
  | "paris" | "london" | "nyc" | "sf";

export type City = {
  id: CityId;
  center: [number, number];      // lng, lat
  bounds: [number, number, number, number]; // west, south, east, north
  timeZone: string;              // IANA, for the clock and the sun
  artifact: string;              // graph artifact, relative to the site root
  basemap: string;               // vector basemap .pmtiles, relative to the site root
  parts?: number;                // artifact sliced into <artifact>.0 … .N-1 (Pages caps an asset at 25 MiB)
  bands?: number;                // > 0 = artifact v8: a core plus this many shade bands (B11)
  tileExt?: "png" | "webp";      // overlay tile format (default webp since 2026-09-05)
  tileMaxZoom?: number;          // finest DSM tile level shipped (default 16)
  shadeYear?: number;            // the DSM's survey year — see the note below
  noiseYear?: number;            // the noise map's mapping round
  available: boolean;            // false = listed, not yet built
};

// The two data YEARS are READ BY NOTHING since 2026-09-15: the city sheet was
// the one screen that showed them and it is a list of city names now (Viktor:
// "remove the years and the MB size from the city picker"). They stay in the
// registry because they are true, they are cited below, and the citation is
// the expensive half — a future "Data & sources" line, or B21's pipeline
// manifest, starts from this and not from an archaeology of PDFs. Anything
// that reads them again must read them from HERE, not re-derive them.
//
// They belong here rather than in the generated manifest for the same reason
// `timeZone` does: they are data about the CITY, not about the file, and no
// build step can derive them. They are optional because they are only
// written where a file in this repo STATES them — the 2026-09-06 audit's rule
// (DECISIONS): a year we cannot point at is a guess, and a wrong survey year
// on a shade claim is worse than no year. Sources, one per value:
//
//   shadeYear  hamburg 2020, berlin 2021, paris 2023, nyc 2017
//              (docs/manifests/dsm/README.md, "Per-city notes"), sf 2024
//              (pipeline/prep_dsm.py, the CA_SanFrancisco_B23 survey).
//              frankfurt, munich and london: no file names a flight year.
//   noiseYear  frankfurt 2022 (pipeline/03_fetch_noise.py), berlin and
//              munich 2022 (pipeline/03b_fetch_noise_wms.py layer names),
//              hamburg 2012 and nyc/sf 2022 (docs/manifests/noise/README.md
//              and pipeline/prep_noise_db.py's CONUS_road_noise_2022).
//              paris and london: the round is named, the year is not.

export const CITIES: City[] = [
  { id: "frankfurt", center: [8.6821, 50.1109], bounds: [8.44, 50.01, 8.90, 50.24],
    timeZone: "Europe/Berlin", artifact: "/graph.bin.gz", basemap: "/basemap/frankfurt.pmtiles", noiseYear: 2022, bands: 7, available: true },
  { id: "hamburg", center: [9.9937, 53.5511], bounds: [9.73, 53.39, 10.32, 53.74],
    timeZone: "Europe/Berlin", artifact: "/graph-hamburg.bin.gz", basemap: "/basemap/hamburg.pmtiles", bands: 7, shadeYear: 2020, noiseYear: 2012, available: true },
  { id: "berlin", center: [13.4050, 52.5200], bounds: [13.09, 52.34, 13.76, 52.68],
    timeZone: "Europe/Berlin", artifact: "/graph-berlin.bin.gz", basemap: "/basemap/berlin.pmtiles", bands: 7, shadeYear: 2021, noiseYear: 2022, available: true },
  { id: "munich", center: [11.5820, 48.1351], bounds: [11.36, 48.06, 11.72, 48.25],
    timeZone: "Europe/Berlin", artifact: "/graph-munich.bin.gz", basemap: "/basemap/munich.pmtiles", bands: 7, noiseYear: 2022, available: true },
  { id: "paris", center: [2.3522, 48.8566], bounds: [2.22, 48.81, 2.47, 48.91],
    timeZone: "Europe/Paris", artifact: "/graph-paris.bin.gz", basemap: "/basemap/paris.pmtiles", bands: 7, shadeYear: 2023, available: true },
  { id: "london", center: [-0.1276, 51.5072], bounds: [-0.28, 51.40, 0.12, 51.62], // Inner London (cities.py clip, 2026-09-02)
    timeZone: "Europe/London", artifact: "/graph-london.bin.gz", basemap: "/basemap/london.pmtiles", bands: 7, available: true },
  { id: "nyc", center: [-73.9857, 40.7484], bounds: [-74.26, 40.49, -73.70, 40.92],
    timeZone: "America/New_York", artifact: "/graph-nyc.bin.gz", basemap: "/basemap/nyc.pmtiles", bands: 7, shadeYear: 2017, noiseYear: 2022, available: true },
  { id: "sf", center: [-122.4194, 37.7749], bounds: [-122.53, 37.70, -122.34, 37.84],
    timeZone: "America/Los_Angeles", artifact: "/graph-sf.bin.gz", basemap: "/basemap/sf.pmtiles", bands: 7, shadeYear: 2024, noiseYear: 2022, available: true },
];

export const DEFAULT_CITY: CityId = "frankfurt";

/** Where overlay tiles are served from. Empty (dev) = this origin, from
 *  web/public/tiles. Production sets VITE_TILE_BASE to the R2 bucket's
 *  public URL — 70k tiles cannot ride on Cloudflare Pages (20k-file cap),
 *  so they live in object storage (DECISIONS 2026-09-05). */
export const TILE_BASE: string = (import.meta.env.VITE_TILE_BASE ?? "").replace(/\/$/, "");
export const tileUrl = (path: string) => `${TILE_BASE}/tiles/${path}`;
/** The city's vector basemap. Same origin in dev; on the same bucket as the
 *  tiles in production, because Cloudflare Pages answers a byte-range
 *  request with the whole file (200, no Accept-Ranges) and a .pmtiles is
 *  nothing BUT range requests — the first deploy drew a blank map
 *  (2026-09-15). R2 answers 206. */
export const basemapUrl = (c: City) => `${TILE_BASE}${c.basemap}`;

/** The URL(s) to fetch for a city's artifact, build-stamped to bust the
 *  cache. A chunked artifact (08_export_graph slices any .gz over 20 MiB
 *  because Cloudflare Pages refuses assets over 25 MiB, 2026-09-01) is
 *  `<artifact>.0` … `.N-1`; the loader concatenates them. A wrong `parts`
 *  count fails loud either way: too few and the inflate is truncated, too
 *  many and a fetch 404s. */

export function artifactUrls(c: City, build: string): string[] {
  const v = `?v=${encodeURIComponent(build)}`;
  if (!c.parts || c.parts < 2) return [`${c.artifact}${v}`];
  return Array.from({ length: c.parts }, (_, i) => `${c.artifact}.${i}${v}`);
}

/** Is this city's artifact the banded v8 layout (backlog B11)?
 *
 *  One flag, `bands`, rather than three new path literals: the two new file
 *  names are derived from `artifact` below, so a city that has not been
 *  re-exported yet needs no registry change at all and keeps its `parts`.
 *  All eight cities are v8 since 2026-09-10 (B14); the flag stays because
 *  the client still reads a v7 core and a re-export is what sets it. */
export function isBanded(c: City): boolean {
  return (c.bands ?? 0) > 0;
}

function stem(c: City): string {
  return c.artifact.replace(/\.bin\.gz$/, "");
}

/** The URL(s) of a city's CORE — the whole artifact for a v7 city, the
 *  everything-but-shade file for a v8 one. Still sliceable: a core over
 *  25 MiB would ship as parts exactly as a v7 artifact does. */
export function coreUrls(c: City, build: string): string[] {
  if (!isBanded(c)) return artifactUrls(c, build);
  const v = `?v=${encodeURIComponent(build)}`;
  const base = `${stem(c)}.core.bin.gz`;
  if (!c.parts || c.parts < 2) return [`${base}${v}`];
  return Array.from({ length: c.parts }, (_, i) => `${base}.${i}${v}`);
}

/** One shade band's URL.
 *
 *  `hash` is the core header's `shade_hash`. It is NOT what invalidates a
 *  deployed band — `?v=<build>` already does that, because every deploy
 *  changes the build stamp and the CORE's own key carries no hash, so a
 *  stale core would hand out stale band URLs anyway (S8 review F6). What it
 *  buys is the case `?v=` cannot see: an artifact re-exported UNDER THE SAME
 *  BUILD, which is every `sync-artifacts.ps1` run in dev. There the band
 *  keys change and the stale bodies are simply never asked for again.
 *  Belonging is enforced separately and properly, by `acceptShadeBand`
 *  checking the hash in the band's own 16-byte prefix. */
export function shadeBandUrl(c: City, k: number, build: string, hash: string): string {
  return `${stem(c)}.shade.${k}.bin.gz?v=${encodeURIComponent(build)}&h=${encodeURIComponent(hash)}`;
}


export function getCity(id: CityId | string | null | undefined): City {
  return CITIES.find((c) => c.id === id) ?? CITIES.find((c) => c.id === DEFAULT_CITY)!;
}

/** Is this point inside the city's box? Used to reject a shared link whose
 *  coordinates belong to a different city than its `c=` parameter. */
export function inCity(c: City, lng: number, lat: number): boolean {
  return lng >= c.bounds[0] && lng <= c.bounds[2] && lat >= c.bounds[1] && lat <= c.bounds[3];
}
