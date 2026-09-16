// Shadewalk "paper" basemap theme (2026-08-16): a partial Protomaps theme
// over "light". Direction: Google-like legibility — cream ground, parks
// and woods clearly green (green is the product's subject), soft blue
// water, white roads on warm casings, buildings faintly visible so the
// shadow overlay reads on them, warm-grey labels. The shade overlay is a
// 43 % black multiply, so everything stays light.
import type { LayerSpecification } from "maplibre-gl";
import type { Theme } from "protomaps-themes-base";

export const PAPER: Partial<Theme> = {
  background: "#e9e6de",
  earth: "#f4f2ec",
  park_a: "#d3ecc7",
  park_b: "#b9e2aa",
  wood_a: "#c6e3b8",
  wood_b: "#a9d59a",
  scrub_a: "#dcebcf",
  scrub_b: "#cfe4bf",
  landcover: {
    grassland: "rgba(214, 236, 200, 1)",
    farmland: "rgba(228, 238, 212, 1)",
    forest: "rgba(190, 224, 178, 1)",
    scrub: "rgba(224, 236, 206, 1)",
    barren: "rgba(240, 233, 214, 1)",
    urban_area: "rgba(240, 237, 229, 1)",
    glacier: "rgba(255, 255, 255, 1)",
  },
  water: "#a9d6f0",
  buildings: "#e2ddd2",
  pedestrian: "#eee9dc",
  school: "#eee6d8",
  hospital: "#f2e2dc",
  industrial: "#e8e6df",
  zoo: "#dbe9cd",
  // roads: white on warm-grey casings; majors a touch cream like Google
  other: "#f7f5ef",
  minor_service: "#f7f5ef",
  minor_service_casing: "#e0dbd0",
  minor_a: "#faf8f3",
  minor_b: "#ffffff",
  minor_casing: "#dcd7cb",
  major: "#fff8e6",
  major_casing_early: "#d8d2c3",
  major_casing_late: "#d8d2c3",
  highway: "#ffefc9",
  highway_casing_early: "#d6c9a8",
  highway_casing_late: "#d6c9a8",
  link: "#fff8e6",
  link_casing: "#d8d2c3",
  railway: "#b8b3aa",
  pier: "#e6e2d9",
  // labels
  city_label: "#4a4640",
  city_label_halo: "#f4f2ec",
  subplace_label: "#6b665d",
  subplace_label_halo: "#f4f2ec",
  roads_label_minor: "#847e73",
  roads_label_minor_halo: "#f7f5ef",
  roads_label_major: "#6b665d",
  roads_label_major_halo: "#fff8e6",
  address_label: "#9c968b",
  address_label_halo: "#f4f2ec",
  waterway_label: "#5b8fb0",
  ocean_label: "#5b8fb0",
  peak_label: "#6b665d",
};

// ---------------------------------------------------------------------------
// "Meadow" (2026-09-05, UI redesign): the designer's basemap palette, in a
// light, a dark and a low-chroma grey variant. It is handed over in its own
// vocabulary (residential, cemetery, footway, …), which is finer than the
// Protomaps `Theme`; `toTheme` is the whole translation, written once so the
// three variants cannot drift apart.
//
// Keys the handoff has and `Theme` does not, and what happens to them:
//   residential / commercial / retail  — no landuse class in the base layers;
//                                        they fall through to `earth`.
//   secondary / secondary_casing       — no road tier between minor and major.
//   cemetery / allotments              — reused for `landcover.farmland`.
//   footway                            — used for `other` (paths and tracks),
//                                        the closest thing the theme has.
//   footway_casing                     — no key at all (it is a LAYER, not a
//                                        colour); the override pass draws it
//                                        and reads the colour off the
//                                        palette. `transparent` means "no
//                                        casing", as it does for the roads.
//   parking                            — no key; reads as `earth`.
//   buildings_outline                  — no key at all; `toTheme` drops it and
//                                        `applyMeadowOverrides` reads it off
//                                        the PALETTE, which is why the two
//                                        light/dark palettes are named
//                                        constants of their own below.
//   poi_label / poi_icon               — the same: protomaps paints its POIs
//                                        from a hard-coded expression rather
//                                        than from the theme (green parks,
//                                        blue transit, purple civic), so the
//                                        override pass has to repaint them
//                                        off the palette (CR-05 edit 4).
//   cycleway / tram                    — no key at all; dropped.
type Meadow = {
  earth: string; background: string; industrial: string;
  park_a: string; park_b: string; wood_a: string; wood_b: string;
  pitch: string; cemetery: string; glacier: string;
  pedestrian: string; school: string; hospital: string; water: string;
  buildings: string; buildings_outline: string;
  footway: string; footway_casing: string;
  minor_a: string; minor_b: string; minor_casing: string;
  major: string; major_casing: string; highway: string; highway_casing: string;
  railway: string;
  /** CR-06 check 3: the rail line, the ties across it, and a platform's fill.
   *  `railway` is what the handoff still carries and what `toTheme` hands
   *  protomaps' `rail` key; the override pass replaces that layer with
   *  `rail_line` + `rail_ties` drawn from these. */
  rail: string; rail_ties: string; platform: string;
  city_label: string; subplace_label: string;
  roads_label_minor: string; roads_label_major: string;
  park_label: string; water_label: string;
  poi_label: string; poi_icon: string; label_halo: string;
};

function toTheme(p: Meadow): Partial<Theme> {
  return {
    background: p.background,
    earth: p.earth,
    park_a: p.park_a,
    park_b: p.park_b,
    wood_a: p.wood_a,
    wood_b: p.wood_b,
    scrub_a: p.pitch,
    scrub_b: p.pitch,
    zoo: p.park_a,
    landcover: {
      grassland: p.park_a,
      farmland: p.cemetery,
      forest: p.wood_a,
      scrub: p.pitch,
      barren: p.industrial,
      urban_area: p.earth,
      glacier: p.glacier,
    },
    water: p.water,
    buildings: p.buildings,
    pedestrian: p.pedestrian,
    school: p.school,
    hospital: p.hospital,
    industrial: p.industrial,
    // roads. `other` is paths and tracks — a walking app draws them like the
    // footways they are, not like a road.
    other: p.footway,
    minor_service: p.minor_a,
    minor_service_casing: p.minor_casing,
    minor_a: p.minor_a,
    minor_b: p.minor_b,
    minor_casing: p.minor_casing,
    major: p.major,
    major_casing_early: p.major_casing,
    major_casing_late: p.major_casing,
    highway: p.highway,
    highway_casing_early: p.highway_casing,
    highway_casing_late: p.highway_casing,
    link: p.major,
    link_casing: p.major_casing,
    railway: p.railway,
    pier: p.pedestrian,
    // labels — one halo colour, the page colour, for all of them
    city_label: p.city_label,
    city_label_halo: p.label_halo,
    subplace_label: p.subplace_label,
    subplace_label_halo: p.label_halo,
    roads_label_minor: p.roads_label_minor,
    roads_label_minor_halo: p.label_halo,
    roads_label_major: p.roads_label_major,
    roads_label_major_halo: p.label_halo,
    address_label: p.subplace_label,
    address_label_halo: p.label_halo,
    waterway_label: p.water_label,
    ocean_label: p.water_label,
    peak_label: p.park_label,
  };
}

/** Meadow, light — v3 (CR-05, 2026-09-16): the park pass. v2's greens were
 *  ~35 chroma, so a big park came out as one saturated slab: the alternative
 *  route disappeared into it and the footpaths, being DARKER than the ground,
 *  vanished. v3 halves the chroma and lifts the lightness — park, wood, pitch
 *  and cemetery are one family two steps apart, all lighter than any road
 *  casing — pales the water one step so the route blue owns the saturation on
 *  the screen, makes the footpaths lighter than the ground rather than darker,
 *  and takes the park label to the UI accent. Everything else is v2's
 *  phone-contrast pass (CR-01 edit 11), unchanged: the ground, the white
 *  roads, the casings that carry the hierarchy, the dark labels. The UI's
 *  `--c-page` follows the ground (tokens.json `color.light.page`) —
 *  `npm run contrast` fails if the two ever drift apart.
 *
 *  Named rather than inlined into the `toTheme` call because the override
 *  pass needs `buildings_outline`, which `Theme` has no key for: reading it
 *  off the palette is one source for the colour instead of two (CR-01 review
 *  A, finding 3). `MEADOW` is the translated theme the style is built from;
 *  `MEADOW_PALETTE` is what the designer handed over.
 *
 *  v1 and v2 are NOT kept here any more. They were kept as the "before" a
 *  contrast pass could be measured against, and nothing but the test ever
 *  read them; tokens.json carries both (`basemap.MEADOW_V1`, `MEADOW_V2`),
 *  which is the archive the designer reads. */
export const MEADOW_PALETTE: Meadow = {
  earth: "#eef1e9", background: "#eef1e9", industrial: "#e4e8e2",
  // v3.1 (2026-09-16, Viktor on the live Tuileries): the greens a third of
  // the way back toward v2 — v3's half-chroma parks read washed out — and
  // the park label one step darker to keep 4.5:1 on them (ERRATA 37).
  // CR-06 check (2026-09-16): protomaps fills a park body with `park_b` at
  // EVERY zoom (`park_a` only reaches the landcover and zoo fills), and v3.1
  // had set park_b to the wood green — so every park read as wood and the
  // paths on it as white lines on dark green. park_b is the park body now,
  // wood one step lighter than v3.1's, and the cemetery has a fill of its
  // own (a layer override; the Theme has no key for it).
  park_a: "#c5e1be", park_b: "#c5e1be", wood_a: "#b9d9b3", wood_b: "#b9d9b3",
  pitch: "#beddb6", cemetery: "#d1e2cb", glacier: "#ffffff",
  pedestrian: "#e2e6df", school: "#e8e7ee", hospital: "#eee4e4", water: "#b3d6ea",
  buildings: "#dde1d9", buildings_outline: "#c2c9bf",
  // CR-06 (2026-09-16): the paths are six layers of their own now (PATHS,
  // below), coloured from PATHS, not from here. `footway` reaches nothing the
  // map draws any more (protomaps' `other` layers are replaced; its bridge
  // paths read `bridges_other`, which Meadow leaves alone) and is set to the
  // path core so the palette still says what a path is. No casing layer.
  footway: "#98a494", footway_casing: "transparent",
  minor_a: "#ffffff", minor_b: "#ffffff", minor_casing: "#c3cbc0",
  major: "#f6ebb8", major_casing: "#cdbd7c", highway: "#f1de8e", highway_casing: "#c1ad5e",
  railway: "#a9b0a8",
  rail: "#b3bbb2", rail_ties: "#8f978d", platform: "#e2e6df",
  city_label: "#33402f", subplace_label: "#33402f",
  roads_label_minor: "#33402f", roads_label_major: "#33402f",
  park_label: "#3a6446", water_label: "#3d70a6",
  poi_label: "#4f5a4c", poi_icon: "#6f7a6c", label_halo: "#eef1e9",
};
export const MEADOW: Partial<Theme> = toTheme(MEADOW_PALETTE);

/** Meadow, dark — v2 (CR-05, 2026-09-16). v1 was a night version of the
 *  light theme and the live Paris screenshots showed what that costs: the
 *  ground #1f2422 and the buildings #2b312e were four L* apart, which is no
 *  difference at all on a phone, and the parks were the only chroma on the
 *  screen. v2 lifts the ground to #24292a and the buildings to #2e3435 with
 *  a visible #3a4142 outline, drops the road casings entirely and says the
 *  road hierarchy in four grey steps instead (#3a4142 → #66706f), and takes
 *  the greens down to chroma ≈ 8 — green in hue only, so the route and the
 *  shade overlay are what carries colour. Labels are #c9d0cb on a 1 px halo
 *  in the ground colour; the black halos the library ships read as a glow.
 *
 *  `--c-page` and `--c-card` follow the ground (CR-05 edit 8); `npm run
 *  contrast` fails if `--c-page` and `earth` ever drift apart.
 *
 *  Named for the same reason `MEADOW_PALETTE` is. `transparent` in a casing
 *  means "draw no casing", the convention the handoff and MEADOW_GREY share. */
export const MEADOW_DARK_PALETTE: Meadow = {
  earth: "#24292a", background: "#24292a", industrial: "#232829",
  park_a: "#2f3d33", park_b: "#354838", wood_a: "#354838", wood_b: "#354838",
  pitch: "#2f3d33", cemetery: "#2d3831", glacier: "#3a4142",
  pedestrian: "#2b3131", school: "#2a2d33", hospital: "#302c2e", water: "#2b3f4d",
  buildings: "#2e3435", buildings_outline: "#3a4142",
  footway: "#3f4847", footway_casing: "transparent", // unread since CR-06 (see the light palette)
  minor_a: "#3a4142", minor_b: "#3a4142", minor_casing: "transparent",
  major: "#535c5c", major_casing: "transparent", highway: "#66706f", highway_casing: "transparent",
  railway: "#4e5656",
  rail: "#4e5656", rail_ties: "#6a7372", platform: "#2b3131",
  city_label: "#c9d0cb", subplace_label: "#c9d0cb",
  roads_label_minor: "#b3bbb5", roads_label_major: "#c9d0cb",
  park_label: "#93b596", water_label: "#7ea6c4",
  poi_label: "#9fb3a2", poi_icon: "#8a9a8c", label_halo: "#24292a",
};
export const MEADOW_DARK: Partial<Theme> = toTheme(MEADOW_DARK_PALETTE);

/** Meadow, grey: roads by value only, no casings — for the moments the route
 *  has to be the loudest thing on the screen. */
export const MEADOW_GREY: Partial<Theme> = toTheme({
  earth: "#f5f7f3", background: "#f5f7f3", industrial: "#eceeeb",
  park_a: "#b8e0b3", park_b: "#98cf97", wood_a: "#98cf97", wood_b: "#98cf97",
  pitch: "#b8e0b3", cemetery: "#cde4c9", glacier: "#ffffff",
  pedestrian: "#e9ece7", school: "#eeedf4", hospital: "#f3eaea", water: "#a6d3e4",
  buildings: "#e5e8e3", buildings_outline: "#d8dcd6",
  footway: "#c5cdc2", footway_casing: "transparent",
  minor_a: "#eaede8", minor_b: "#eaede8", minor_casing: "transparent",
  major: "#d1d6d1", major_casing: "transparent", highway: "#b9c1bb", highway_casing: "transparent",
  railway: "#b5bbb4",
  rail: "#b5bbb4", rail_ties: "#949b93", platform: "#e9ece7",
  city_label: "#4f5a4c", subplace_label: "#4f5a4c",
  roads_label_minor: "#4f5a4c", roads_label_major: "#4f5a4c",
  park_label: "#2f6b3a", water_label: "#4a7fb5",
  poi_label: "#4f5a4c", poi_icon: "#6f7a6c", label_halo: "#f5f7f3",
});

// ---------------------------------------------------------------------------
// The overrides a colour theme cannot express (CR-01 edit 11, 2026-09-08).
//
// `Theme` is colours and nothing else, and the first live phone build showed
// that colour alone does not carry the map: the minor-road casings were a
// hairline, the buildings had no edge at all, the street names were 12 px, and
// the POI icons sat on top of the route at z15. Those are layer properties —
// widths, minzooms, text sizes — so they are applied to the generated layer
// list instead, once, immediately after `layersWithPartialCustomTheme`
// (MapView.buildStyle). Only the two Meadow themes that are wired to a style
// get them; the OSM raster basemap has no vector layers to override.

/** The palette behind a theme. `Theme` has no key for a building's edge, for
 *  a POI's ink or for the halo width, so the override pass reads those off
 *  the Meadow palette itself — the same literals the handoff and tokens.json
 *  carry, held in one place. */
function palette(theme: "light" | "dark"): Meadow {
  return theme === "dark" ? MEADOW_DARK_PALETTE : MEADOW_PALETTE;
}

/** Merge `over` into one layer without caring which of protomaps' layer kinds
 *  it is. One cast, in one place: `LayerSpecification` is a union whose
 *  `paint` and `layout` differ per kind, and spreading a union is not
 *  something the compiler can check for us. */
function patch(
  l: LayerSpecification,
  over: {
    id?: string;
    minzoom?: number;
    filter?: unknown;
    paint?: Record<string, unknown>;
    /** paint properties to REMOVE, so the library's default applies. A key
     *  set to undefined is not the same thing: maplibre validates the style
     *  it is handed and an explicit undefined is an error, not a default. */
    unpaint?: string[];
    layout?: Record<string, unknown>;
  }
): LayerSpecification {
  const cur = l as { paint?: Record<string, unknown>; layout?: object };
  const paint = over.paint || over.unpaint ? { ...cur.paint, ...over.paint } : undefined;
  for (const k of over.unpaint ?? []) delete paint![k];
  return {
    ...l,
    ...(over.id === undefined ? {} : { id: over.id }),
    ...(over.minzoom === undefined ? {} : { minzoom: over.minzoom }),
    ...(over.filter === undefined ? {} : { filter: over.filter }),
    ...(paint ? { paint } : {}),
    ...(over.layout ? { layout: { ...cur.layout, ...over.layout } } : {}),
  } as LayerSpecification;
}

/**
 * The POI kinds that are LANDMARKS: things a walker navigates by rather than
 * things they might drop into (CR-03 table C).
 *
 * `pois` was pushed to z16 because at z15 the school and shop icons sat on
 * the drawn route (SPEC-3b). That took the park names with them, and a park
 * name is the opposite case — it is the thing this app is about, and at z14
 * a map with an unlabelled green blob on it is a map that has stopped saying
 * where the walk goes. So the layer is split: these six from z14, everything
 * else from z16.
 *
 * MapLibre has no per-feature `minzoom`, so it really has to be two layers
 * over one source-layer, each with the complement of the other's filter —
 * never both, so nothing is drawn twice and nothing collides with itself.
 *
 * Of the six, protomaps' own `pois` filter carries `park`, `garden` and
 * `station`; `playground`, `square` and `viewpoint` are not in its kind list
 * and therefore draw nothing today. They are named anyway, because the
 * CR names them and because the split's filter is ANDed with protomaps' —
 * the day the library styles them they are already on the right side of it.
 */
export const EARLY_POIS = ["park", "garden", "playground", "station", "square", "viewpoint"];

/**
 * A POI's ink (CR-05 edit 4).
 *
 * protomaps paints its POIs from a hard-coded expression rather than from
 * the theme: parks and gardens come out #20834D, transit #315BCF, civic
 * #6A5B8F. On the dark flavour those are a neon green and a brand blue over
 * a near-black ground, and on either flavour they are three more colours on
 * a map whose only loud thing should be the route. One ink for all of them,
 * off the palette, and the icons pulled back rather than recoloured:
 *
 * the sprite is NOT SDF — none of the 53 icons in
 * `public/basemap-assets/sprites/v4/*.json` carries `"sdf": true` — and
 * `icon-color` only applies to an SDF icon, so setting it would be a silent
 * no-op. The CR's own fallback is what is drawn instead: `icon-opacity` .7,
 * which sits the icon back into the map without pretending to recolour it.
 * `poi_icon` stays in the palette for the day the sprite is regenerated as
 * SDF; nothing reads it yet.
 */
function poiInk(theme: "light" | "dark"): Record<string, unknown> {
  return { "text-color": palette(theme).poi_label, "icon-opacity": 0.7 };
}

/** `kind` is (or is not) one of the six, ANDed onto protomaps' own filter so
 *  the split can only ever narrow what the library already draws. */
function poiSplit(l: LayerSpecification, early: boolean): unknown {
  const mine = ["in", ["get", "kind"], ["literal", EARLY_POIS]];
  const base = (l as { filter?: unknown }).filter;
  const clause = early ? mine : ["!", mine];
  return base === undefined ? ["all", clause] : ["all", base, clause];
}

/** CR-06 (2026-09-16), "Gravel solid": a path is a strip in the ground
 *  colour with a solid mid-tone core. On green the strip reads as gravel
 *  (the grammar the pedestrian areas already have); on grey the strip
 *  vanishes and the core alone carries it. Nothing here is white and nothing
 *  uses the road-casing grey, so a path cannot read as a street — six
 *  attempts before this one did, or vanished on the greens, or beat against
 *  themselves through a zoom (DECISIONS 2026-09-16). Dashes mean "lesser or
 *  special" — track, cycleway, sidewalk — and only one dashed layer ever
 *  stacks on a spot. Values: docs/design/handoff/cr-06/CR-06-paths.md. */
export const PATHS = {
  light: { carrier: "#eef1e9", core: "#98a494", track: "#9c8a5c", sidewalk: "#a3ada0" },
  dark: { carrier: "#24292a", core: "#6b7674", track: "#8a7c58", sidewalk: "#5c6664" },
} as const;

/** The path kinds each CR-06 layer draws (`kind_detail` in the roads layer). */
const PATH_KINDS = {
  // `path` moved from the core to the hairline on 2026-09-16 ("try to, maybe
  // I will revert"): in Frankfurt a shared foot-and-cycle way beside a road is
  // highway=path, the same kind as every park path, and the owner would
  // rather a park net of dots than a road-side path that looks like gravel.
  carrier: ["pedestrian", "steps", "corridor"],
  core: ["pedestrian", "corridor"],
  footway: ["footway", "path"], // drawn exactly as a sidewalk, no carrier (Viktor, 2026-09-16)
  cycleway: ["cycleway"], // NOT drawn: a cycleway is not a walk (Viktor, 2026-09-16)
  steps: ["steps"],
  track: ["track", "bridleway"],
  sidewalk: ["sidewalk"],
  crossing: ["crossing"], // hidden on streets; drawn from z16 above the rail (check 3, interim)
} as const;

/** protomaps' `roads_other` filter minus the tunnel exclusion (tunnels are
 *  the same layers at half opacity, CR-06) and narrowed to `kinds`. Bridges
 *  keep their own layers, unchanged. */
function pathFilter(kinds: readonly string[], untagged = false): unknown {
  // no polygons (CR-06 check 2): an `area:highway` or a pedestrian square
  // would draw its outline as a path on top of the pedestrian fill, and next
  // to a footway that is a twin carrier. Legacy filter syntax throughout —
  // protomaps' own is, and the two grammars do not mix.
  const kind = ["in", "kind_detail", ...kinds];
  return ["all", ["!has", "is_bridge"], ["!=", "$type", "Polygon"], ["in", "kind", "other", "path"],
    untagged ? ["any", kind, ["!has", "kind_detail"]] : kind];
}
// CR-06 rev. 2: a notch thinner than the first cut
const CORE_WIDTH = ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 0.75, 15, 1.25, 16, 1.75, 17, 2.5, 18, 3];
/** The sidewalk's hairline (CR-06: 1.1 @ z17 → 1.25 @ z18), carried down to
 *  the path zooms for the footways and crossings that wear the same style. */
const SIDEWALK_WIDTH = ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 0.75, 16, 1, 17, 1.1, 18, 1.25];
const CEMETERY = ["==", ["get", "kind"], "cemetery"];
const TUNNEL_OPACITY = ["case", ["has", "is_tunnel"], 0.5, 1];
/** `opacity` above ground, half of it in a tunnel (CR-06: a tunnel is the same layer at half). */
const fade = (opacity: number): unknown => ["case", ["has", "is_tunnel"], opacity / 2, opacity];

/** One of the six path layers, cloned off protomaps' `roads_other` so the
 *  source, source-layer and everything else it does not set are the library's.
 *  Every one is butt-capped and round-joined; protomaps' own 3/1 dash is
 *  stripped unless the layer sets its own. */
function pathLayer(
  l: LayerSpecification,
  id: string,
  kinds: readonly string[],
  paint: Record<string, unknown>,
  minzoom?: number,
): LayerSpecification {
  return patch(l, {
    id,
    filter: pathFilter(kinds, id === "path_core"),
    ...(minzoom === undefined ? {} : { minzoom }),
    paint: { "line-opacity": TUNNEL_OPACITY, ...paint },
    unpaint: paint["line-dasharray"] === undefined ? ["line-dasharray"] : [],
    layout: { "line-cap": "butt", "line-join": "round" },
  });
}

/** The CR-06 path layers, bottom to top, in place of `roads_other`. */
function pathLayers(l: LayerSpecification, theme: "light" | "dark"): LayerSpecification[] {
  const c = PATHS[theme];
  return [
    // the strip: ground-coloured, core + 2.5 px (steps: their own width × 1.1)
    // Check 3: thinned by CONTRAST, not pixels — the strip is 60 % earth
    // over the fill (≈ #dde9d7 on the park, 1.15:1 instead of 1.3) and one
    // notch narrower, core + 1.5. A park full of paths had read as a light
    // net over the green.
    pathLayer(l, "path_carrier", PATH_KINDS.carrier, {
      "line-color": c.carrier,
      "line-opacity": fade(0.6),
      "line-blur": 0, // a hard edge; two soft strips 8 px apart fuse into a slab (check 2)
      "line-width": ["interpolate", ["linear"], ["zoom"],
        13, 0,
        14, ["case", ["==", ["get", "kind_detail"], "steps"], 2.75, 2.25],
        15, ["case", ["==", ["get", "kind_detail"], "steps"], 3.3, 2.75],
        16, ["case", ["==", ["get", "kind_detail"], "steps"], 4.95, 3.25],
        17, ["case", ["==", ["get", "kind_detail"], "steps"], 6.6, 4],
        18, ["case", ["==", ["get", "kind_detail"], "steps"], 6.6, 4.5]],
    }),
    // track and bridleway: the hiking colour, dashed, no carrier
    pathLayer(l, "track", PATH_KINDS.track, {
      "line-color": c.track,
      "line-width": CORE_WIDTH,
      "line-dasharray": [3, 2],
    }),
    // the core: solid mid-tone, 1 / 1.5 / 3 px at z14 / 15 / 17
    // …and a way with no kind_detail at all is a plain path (check 2, fix 4)
    pathLayer(l, "path_core", PATH_KINDS.core, {
      "line-color": c.core,
      "line-opacity": fade(0.85), // check 3: one notch lighter on the green, ≈ #a0aba0
      "line-width": CORE_WIDTH,
    }),
    // footway: drawn EXACTLY as a sidewalk — the same grey, the same dotted
    // hairline, no carrier — only from the path zooms rather than z17. On a
    // street a `highway=footway` the mapper never tagged as a sidewalk sat
    // solid next to dotted sidewalks — "why some sidewalks are solid, some
    // are dotted" → "same dotted as the sidewalks" (Viktor, 2026-09-16).
    // A footway through a park is a dotted hairline on green, by choice.
    pathLayer(l, "footway_core", PATH_KINDS.footway, {
      "line-color": c.sidewalk,
      "line-width": SIDEWALK_WIDTH,
      "line-dasharray": [1, 1.5],
    }),
    // cycleway: not drawn (Viktor, 2026-09-16, "remove 'only cycleway'") —
    // a way that is a cycleway in the tiles is not a walk, and the ones that
    // are walkable too are the router's business, not the map's.
    // steps: a ladder, wider than a path
    pathLayer(l, "steps", PATH_KINDS.steps, {
      "line-color": c.core,
      "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 2.5, 15, 3, 17, 6],
      "line-dasharray": [0.35, 0.35],
    }),
    // sidewalk: a dotted hairline, no carrier. CR-06 held it back to z17
    // (a street's two sidewalks were a dashed twin on each side of every
    // road); the owner wants them as early as the footways, which now wear
    // the same style, and at 0.75 px they are a whisper at z14.
    pathLayer(l, "sidewalk", PATH_KINDS.sidewalk, {
      "line-color": c.sidewalk,
      "line-width": SIDEWALK_WIDTH,
      "line-dasharray": [1, 1.5],
    }), // no minzoom since 2026-09-16 ("sidewalks need to appear earlier") — the ramp fades them in from z13 like a footway
  ];
}

/** CR-06 check 3: platforms and crossings next to the rail. The rail with
 *  ties the check specified lived for an afternoon; the owner asked for
 *  protomaps' dash back (2026-09-16), so `roads_rail` is passed through and
 *  the `rail` / `rail_ties` palette keys are unread until the designer says
 *  otherwise. Platforms are pedestrian-coloured pads; crossings draw above. */

function railLayers(l: LayerSpecification, theme: "light" | "dark"): LayerSpecification[] {
  const p = palette(theme);
  return [
    // The rail itself is protomaps' own `roads_rail`, untouched: the morning
    // look — `railway` grey, dash 0.3/0.75, 50 %, its exponential ramp — is
    // the one the owner asked back ("please only bring back rail design from
    // this morning", 2026-09-16). rail_line + rail_ties (check 3) are gone;
    // the platforms and the crossings over the rail stay.
    l,
    // a platform's edge, where the tiles carry it as a line (roads layer)
    patch(l, {
      id: "platform_line",
      minzoom: 15,
      filter: ["==", "kind_detail", "platform"],
      paint: { "line-color": p.buildings_outline, "line-width": 2, "line-opacity": 1 },
      unpaint: ["line-dasharray"],
      layout: { "line-cap": "butt", "line-join": "round" },
    }),
    // Crossings (CR-06 check 3). CR-06 hid every crossing — "the route line
    // shows them" — which is right on a street, where the sidewalk hairline
    // meets the road, and wrong over rail, where nothing else shows the gap
    // and a walker sees an unbroken track. The rule wanted is "drawn where
    // it spans rail or tram", and the tiles cannot say which crossings do:
    // the basemap is a Protomaps planet extract, not a build of ours, so
    // there is no `rail_crossing` attribute to filter on (backlog B25).
    // Interim, as the check allows: every crossing, from z16, in the path
    // style — solid core on a carrier, +0.5 px so the pad reads as a
    // walk-over — drawn here, ABOVE the ties, and the small extra clutter
    // at street crossings accepted.
    // …and since the owner's ruling of the same day, exactly as a sidewalk:
    // the same grey dotted hairline, no carrier, from z16.
    pathLayer(l, "crossing_core", PATH_KINDS.crossing, {
      "line-color": PATHS[theme].sidewalk,
      "line-width": SIDEWALK_WIDTH,
      "line-dasharray": [1, 1.5],
    }, 16),
  ];
}

/**
 * Apply the Meadow layer overrides to a generated protomaps layer list.
 *
 * Pure: a new array, new objects for the six layers it touches, and every
 * other layer left identity-equal, so what it changed is easy to read.
 *
 * What each override is for (the measurements are in
 * `docs/design/handoff/cr-01/SPEC-3b.md`):
 *
 * - `roads_other` — the footpaths, REPLACED by the CR-06 path layers
 *   (`pathLayers`: carrier, core, cycleway, steps, track, sidewalk, split by
 *   kind_detail; crossings never drawn). `roads_tunnels_other` and its casing
 *   go with it: a tunnel is the same layers at half opacity.
 * - `roads_minor_casing` — protomaps ramps the casing from nothing at z12 to
 *   a flat 1 px, which is a hairline on a phone. From z13 a casing is a
 *   casing: the drawn width is `line-gap-width` (the road itself) plus twice
 *   `line-width`, so 1 is fill + 2 at z15 and 1.5 is fill + 3 at z17.
 * - `buildings` — an outline in `buildings_outline`, from z13 rather than
 *   whenever the tiles happen to carry footprints. `fill-opacity` goes to 1
 *   with it: protomaps draws buildings at 0.5, which halves the outline too
 *   and leaves the edge under the 1.48:1 the contrast pass asks for.
 * - `pois` — one ink for every kind (`poiInk`), and from z16. At z15 the
 *   school and shop icons sit on the route —
 *   except the six landmark kinds (`EARLY_POIS`), which are split off into
 *   `pois-landmarks` and drawn from z14, because a park with no name on it
 *   is not a park (CR-03 table C).
 * - `roads_labels_minor` / `places_subplace` — 12 px street names are not
 *   readable at arm's length: 13 px at z15, 14 px at z17, subplaces a flat
 *   15 px, and a 1.5 px halo so a name crossing a park still separates.
 * - `landuse_park` / `landuse_urban_green` — opaque, and with no outline
 *   (CR-05 e6). protomaps washes the urban green to 0.7 and fades the parks
 *   in between z6 and z11, and green is the product's subject: at the widest
 *   the map goes (minZoom 10, MapView) a park is a park. The outline is
 *   dropped rather than asserted absent — the library draws none today, and
 *   the day it does, one green shape with a line around it is a different
 *   map from the one the palette was mixed for.
 */
export function applyMeadowOverrides(
  layers: LayerSpecification[],
  theme: "light" | "dark"
): LayerSpecification[] {
  const p = theme === "dark" ? MEADOW_DARK : MEADOW;
  // flatMap, for the one override that makes TWO layers out of one: `pois`
  // splits into the landmarks (z14) and the rest (z16). Every other case
  // returns exactly what it was handed, so the list keeps its order and its
  // identities (mapTheme.test.ts).
  //
  // …and the split is one of the two overrides that cannot be written as an
  // absolute
  // value, because its filter is protomaps' own narrowed by ours: run twice
  // it would narrow twice and clone a second time, over a layer id that
  // already exists. So a list that has been split already is left alone —
  // both halves carry the values this pass would set (test "is idempotent").
  const split = layers.some((l) => l.id === "pois-landmarks");
  // …and the platform pad, the pass's other clone (CR-06 check 3)
  const platformed = layers.some((l) => l.id === "platform");
  const railed = layers.some((l) => l.id === "platform_line"); // roads_rail is passed through, its followers added once
  const patched = layers.flatMap((l): LayerSpecification | LayerSpecification[] => {
    switch (l.id) {
      // The footpaths, which are what a walking app is drawing. CR-06 splits
      // protomaps' one `roads_other` by kind_detail into the PATHS layers
      // (pathLayers), and folds the tunnel twins into them at half opacity.
      case "roads_other":
        return pathLayers(l, theme);
      case "roads_tunnels_other":
      case "roads_tunnels_other_casing":
        return [];
      // rail, tram and platforms (CR-06 check 3): protomaps' `roads_rail`
      // as it is, then the platform edges and the crossings over the rail
      case "roads_rail":
        return railed ? l : railLayers(l, theme);
      // …and a platform's pad, where the tiles carry it as a polygon
      // (landuse layer): a clone of the pedestrian fill, once
      case "landuse_pedestrian":
        return platformed
          ? l
          : [
              l,
              patch(l, {
                id: "platform",
                minzoom: 15,
                filter: ["==", "kind", "platform"],
                paint: { "fill-color": palette(theme).platform, "fill-outline-color": palette(theme).buildings_outline },
              }),
            ];
      case "roads_minor_casing":
        return patch(l, {
          minzoom: 13,
          paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1, 15, 1, 17, 1.5] },
        });
      case "buildings":
        return patch(l, {
          minzoom: 13,
          paint: { "fill-outline-color": palette(theme).buildings_outline, "fill-opacity": 1 },
        });
      case "pois":
        return split
          ? l
          : [
              patch(l, { minzoom: 16, filter: poiSplit(l, false), paint: poiInk(theme) }),
              patch(l, {
                id: "pois-landmarks",
                minzoom: 14,
                filter: poiSplit(l, true),
                paint: poiInk(theme),
              }),
            ];
      case "roads_labels_minor":
        return patch(l, {
          layout: { "text-size": ["interpolate", ["linear"], ["zoom"], 15, 13, 17, 14] },
          paint: { "text-color": p.roads_label_minor },
        });
      case "places_subplace":
        return patch(l, {
          layout: { "text-size": 15 },
          paint: { "text-color": p.subplace_label },
        });
      case "landuse_park": {
        // …and the cemetery gets the palette's own fill: protomaps lists it
        // with the parks, and `Theme` has no key for it (CR-06 check). A
        // fill that is already the cemetery case is left as it is — the
        // pass is idempotent.
        const fill = (l as { paint?: Record<string, unknown> }).paint?.["fill-color"];
        const wrapped = Array.isArray(fill) && fill[0] === "case" && JSON.stringify(fill[1]) === JSON.stringify(CEMETERY);
        return patch(l, {
          paint: {
            "fill-opacity": 1,
            "fill-color": wrapped ? fill : ["case", CEMETERY, palette(theme).cemetery, fill],
          },
          unpaint: ["fill-outline-color"],
        });
      }
      case "landuse_urban_green":
        return patch(l, { paint: { "fill-opacity": 1 }, unpaint: ["fill-outline-color"] });
      default:
        return l;
    }
  });

  // …and then the halo, on every symbol layer there is (CR-05 edit 3).
  //
  // protomaps hands each label family its own halo: the road names wear the
  // road's fill, the water names a cyan, the places a grey — and on the dark
  // flavour several of them are near-black, which at 200 % is not a halo but
  // a GLOW around every word (the live Paris screenshots). A halo is there to
  // separate a word from whatever it crosses, so there is one answer for all
  // of them: 1 px of the ground colour, no blur. Written as a pass over the
  // whole list rather than a case per layer because "every symbol layer"
  // is the rule, and a case list would be a rule that forgets the layer
  // protomaps adds next.
  return patched.map((l) =>
    l.type === "symbol"
      ? patch(l, {
          paint: {
            "text-halo-color": palette(theme).earth,
            "text-halo-width": 1,
            "text-halo-blur": 0,
          },
        })
      : l
  );
}
