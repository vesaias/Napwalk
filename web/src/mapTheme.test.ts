import { describe, expect, it } from "vitest";
import type { LayerSpecification } from "maplibre-gl";
import { layersWithPartialCustomTheme } from "protomaps-themes-base";
import {
  applyMeadowOverrides,
  EARLY_POIS,
  MEADOW,
  MEADOW_DARK,
  MEADOW_DARK_PALETTE,
  MEADOW_GREY,
  MEADOW_PALETTE,
  PAPER,
} from "./mapTheme";
// The designer's own file, imported rather than retyped: the palettes below
// are checked against it key for key, so a hand-edit of mapTheme.ts that the
// handoff did not ask for is a red test (CR-05).
import { MEADOW_DARK_V2, MEADOW_V3 } from "../../docs/design/handoff/mapTheme.meadow";

// PAPER is the reference for "a key protomaps' Theme actually has": it has
// been on the map since 2026-08-16, so anything outside its key set is a
// key the library ignores (a silent no-op, the worst kind of theme bug).
const allowed = new Set(Object.keys(PAPER));

describe("MEADOW themes", () => {
  it("carries the designer's Meadow v3 values, with the v3.1 greens", () => {
    // CR-05: half the chroma, a step lighter, water paler, park label on
    // the UI accent — then v3.1 (Viktor, 2026-09-16, ERRATA 37): the greens
    // a third of the way back toward v2, the label a step darker to keep
    // 4.5:1 on them, and paths dashed and darker than the ground again
    expect(MEADOW.park_a).toBe("#c5e1be");
    expect(MEADOW.park_b).toBe("#c5e1be"); // the park BODY (protomaps fills with park_b)
    expect(MEADOW.wood_a).toBe("#b9d9b3");
    expect(MEADOW.scrub_a).toBe("#beddb6"); // `pitch`, in Theme's vocabulary
    expect(MEADOW.water).toBe("#b3d6ea");
    expect(MEADOW.other).toBe("#98a494"); // `footway`: the CR-06 path core; nothing reads it now
    expect(MEADOW.peak_label).toBe("#3a6446"); // `park_label`
    // and v2's phone-contrast pass, untouched by the park pass
    expect(MEADOW.earth).toBe("#eef1e9");
    expect(MEADOW.minor_a).toBe("#ffffff"); // check 3, section 0: the streets are white —
    expect(MEADOW.minor_b).toBe("#ffffff"); // both stops, so roads_minor never leaves white
    expect(MEADOW.minor_casing).toBe("#c3cbc0");
    expect(MEADOW.roads_label_minor).toBe("#33402f");
  });

  // The palettes are the designer's file, byte for byte. Anything a handoff
  // object and a palette do not share is listed on purpose, with the reason:
  // the handoff's vocabulary is finer than `Theme`'s (the header comment in
  // mapTheme.ts says what happens to each), and `glacier` has no handoff
  // entry at all.
  const DROPPED = ["residential", "commercial", "retail", "allotments", "parking",
    "secondary", "secondary_casing", "tram", "cycleway"];

  const sameAsHandoff = (
    name: string,
    palette: object,
    handoff: object,
    extra: string[],
    overrides: Record<string, string> = {},
  ) => {
    const theirs = handoff as Record<string, string>;
    const mine = palette as Record<string, string>;
    expect(Object.keys(theirs).filter((k) => !(k in mine)).sort()).toEqual([...DROPPED].sort());
    expect(Object.keys(mine).filter((k) => !(k in theirs)).sort()).toEqual([...extra].sort());
    for (const k of Object.keys(mine)) {
      if (extra.includes(k)) continue;
      expect(mine[k], `${name}.${k}`).toBe(k in overrides ? overrides[k] : theirs[k]);
    }
  };

  // The owner's corrections on top of the designer's v3 — ERRATA 37, until
  // the handoff folds them in. Listed here, and nowhere else, so a value the
  // designer did not send is a red test unless it is one of these.
  const V3_1 = {
    park_a: "#c5e1be", park_b: "#c5e1be", wood_a: "#b9d9b3", wood_b: "#b9d9b3",
    pitch: "#beddb6", cemetery: "#d1e2cb", footway: "#98a494", park_label: "#3a6446",
  };

  it("is the handoff's MEADOW_V3 with the owner's v3.1 greens, key for key", () => {
    // v3 carries no POI colours of its own; tokens.json does
    // (basemap.MEADOW.poiLabel / .poiIcon / .footwayCasing), and they are
    // the light twin of the MEADOW_DARK_V2 names below.
    sameAsHandoff("MEADOW_PALETTE", MEADOW_PALETTE, MEADOW_V3, [
      "glacier", "roads_label_major", "poi_label", "poi_icon", "footway_casing",
      "rail", "rail_ties", "platform", // CR-06 check 3 (RAIL in mapTheme.meadow.v3.1.ts)
    ], V3_1);
  });

  it("is the handoff's MEADOW_DARK_V2, key for key", () => {
    sameAsHandoff("MEADOW_DARK_PALETTE", MEADOW_DARK_PALETTE, MEADOW_DARK_V2, [
      "glacier", "footway_casing", "rail", "rail_ties", "platform",
    ]);
  });

  it("has a dark twin, lifted off the black (CR-05)", () => {
    expect(MEADOW_DARK.earth).toBe("#24292a");
    expect(MEADOW_DARK.buildings).toBe("#2e3435");
    expect(MEADOW_DARK.water).toBe("#2b3f4d");
    // the dark roads are four grey steps and no casings at all
    expect(MEADOW_DARK.minor_a).toBe("#3a4142");
    expect(MEADOW_DARK.major).toBe("#535c5c");
    expect(MEADOW_DARK.highway).toBe("#66706f");
    for (const k of ["minor_casing", "minor_service_casing", "major_casing_early",
      "major_casing_late", "highway_casing_early", "highway_casing_late"] as const) {
      expect(MEADOW_DARK[k], k).toBe("transparent");
    }
    // …and a major road's name is a step brighter than a minor one's, which
    // is the one label pair v1 did not distinguish
    expect(MEADOW_DARK.roads_label_major).toBe("#c9d0cb");
    expect(MEADOW_DARK.roads_label_minor).toBe("#b3bbb5");
  });

  it("drops the road casings in the grey variant", () => {
    expect(MEADOW_GREY.minor_casing).toBe("transparent");
    expect(MEADOW_GREY.major_casing_early).toBe("transparent");
    expect(MEADOW_GREY.highway_casing_late).toBe("transparent");
  });

  it("uses only keys the Theme type has", () => {
    for (const [name, theme] of [
      ["MEADOW", MEADOW],
      ["MEADOW_DARK", MEADOW_DARK],
      ["MEADOW_GREY", MEADOW_GREY],
    ] as const) {
      for (const k of Object.keys(theme)) {
        expect(allowed.has(k), `${name}.${k} is not a Theme key`).toBe(true);
      }
    }
  });

  it("styles the same keys in all three variants", () => {
    const keys = Object.keys(MEADOW).sort();
    expect(Object.keys(MEADOW_DARK).sort()).toEqual(keys);
    expect(Object.keys(MEADOW_GREY).sort()).toEqual(keys);
  });

  it("gives landcover every field the library expects", () => {
    for (const theme of [MEADOW, MEADOW_DARK, MEADOW_GREY]) {
      expect(Object.keys(theme.landcover ?? {}).sort()).toEqual(
        ["barren", "farmland", "forest", "glacier", "grassland", "scrub", "urban_area"]
      );
    }
  });
});

// The override pass runs against the REAL layer list, not a hand-written
// stand-in: half of what it does is "keep everything protomaps already put
// there and change one property", and a fixture cannot fail when the library
// renames a layer under us — which is exactly the failure worth catching.
describe("applyMeadowOverrides", () => {
  const base = (flavor: "light" | "dark") =>
    layersWithPartialCustomTheme(
      "protomaps",
      flavor,
      flavor === "dark" ? MEADOW_DARK : MEADOW,
      "en"
    ) as LayerSpecification[];

  const byId = (ls: LayerSpecification[], id: string) => {
    const l = ls.find((x) => x.id === id);
    expect(l, `no layer "${id}" in the generated list`).toBeDefined();
    return l as LayerSpecification & {
      minzoom?: number;
      paint?: Record<string, unknown>;
      layout?: Record<string, unknown>;
    };
  };

  // the CR-06 path layers, bottom to top, where `roads_other` was
  const PATHS_ORDER = ["path_carrier", "track", "path_core", "footway_core", "steps", "sidewalk"];
  // …the rail pair and the platform edge where `roads_rail` was, and the
  // platform pad after the pedestrian fill (CR-06 check 3)
  const RAIL_ORDER = ["platform_line", "crossing_core"]; // right after protomaps' roads_rail, which stays
  const ADDED = ["pois-landmarks", ...PATHS_ORDER, ...RAIL_ORDER, "platform"];
  // …and the four library layers the pass removes: `roads_other` (split
  // into PATHS_ORDER), the tunnel twins (a tunnel is the same layers at
  // half opacity, CR-06) and `roads_rail` (RAIL_ORDER)
  const REMOVED = ["roads_other", "roads_tunnels_other", "roads_tunnels_other_casing"];

  it("is pure: same order, the path layers in place of roads_other, untouched layers identity-equal", () => {
    const before = base("light");
    const after = applyMeadowOverrides(before, "light");
    expect(after).not.toBe(before);
    // the same list, minus REMOVED, plus the layers the pass adds:
    // `pois-landmarks` immediately after the layer it is cloned from (CR-03
    // table C), and the path layers, in order, where `roads_other` was
    expect(after.map((l) => l.id).filter((id) => !ADDED.includes(id))).toEqual(
      before.map((l) => l.id).filter((id) => !REMOVED.includes(id)),
    );
    expect(after.findIndex((l) => l.id === "pois-landmarks")).toBe(
      after.findIndex((l) => l.id === "pois") + 1,
    );
    const at = after.findIndex((l) => l.id === PATHS_ORDER[0]);
    expect(after.slice(at, at + PATHS_ORDER.length).map((l) => l.id)).toEqual(PATHS_ORDER);
    // …exactly where roads_other stood: the layer before it is the same
    const beforeAt = before.findIndex((l) => l.id === "roads_other");
    expect(after[at - 1].id).toBe(before[beforeAt - 1].id);
    const railAt = after.findIndex((l) => l.id === "platform_line");
    expect(after.slice(railAt, railAt + RAIL_ORDER.length).map((l) => l.id)).toEqual(RAIL_ORDER);
    expect(after[railAt - 1].id).toBe("roads_rail");
    expect(after.findIndex((l) => l.id === "platform")).toBe(
      after.findIndex((l) => l.id === "landuse_pedestrian") + 1,
    );
    const touched = new Set([
      "roads_minor_casing",
      "buildings",
      "pois",
      "roads_labels_minor",
      "places_subplace",
      "landuse_park",
      "landuse_urban_green",
    ]);
    const kept = after.filter((l) => !ADDED.includes(l.id));
    const was = before.filter((l) => !REMOVED.includes(l.id));
    for (let i = 0; i < was.length; i++) {
      // …plus every symbol layer, which the halo pass rewrites (CR-05 e3)
      const mine = touched.has(was[i].id) || was[i].type === "symbol";
      if (mine) expect(kept[i]).not.toBe(was[i]);
      else expect(kept[i], `${was[i].id} was rewritten`).toBe(was[i]);
    }
    // every layer the pass claims to touch really is in the library's list
    expect(before.filter((l) => touched.has(l.id)).length).toBe(touched.size);
  });

  // Every override sets an ABSOLUTE value; nothing reads the current one and
  // adds to it. `buildStyle` regenerates the layer list from scratch and
  // `setStyle` is `{diff:false}`, so a second pass over an already-patched
  // list should not happen — but "should not" is not "cannot", and a future
  // override written as an increment would compound silently (CR-01 review
  // A, finding 10).
  it("is idempotent: applying it twice is applying it once", () => {
    for (const theme of ["light", "dark"] as const) {
      const once = applyMeadowOverrides(base(theme), theme);
      expect(applyMeadowOverrides(once, theme)).toEqual(once);
    }
  });

  it("gives the minor roads a casing from z13, fill + 2 at z15 and + 3 at z17", () => {
    const after = applyMeadowOverrides(base("light"), "light");
    const casing = byId(after, "roads_minor_casing");
    expect(casing.minzoom).toBe(13);
    // the drawn casing is line-gap-width (the road) plus twice line-width
    expect(casing.paint?.["line-width"]).toEqual([
      "interpolate", ["linear"], ["zoom"], 13, 1, 15, 1, 17, 1.5,
    ]);
    // the road under it is left exactly as protomaps drew it
    expect(byId(after, "roads_minor").paint?.["line-width"]).toEqual(
      byId(base("light"), "roads_minor").paint?.["line-width"]
    );
    // ...and the gap the casing wraps is still the road's own width
    expect(casing.paint?.["line-gap-width"]).toEqual(
      byId(base("light"), "roads_minor_casing").paint?.["line-gap-width"]
    );
    expect(casing.paint?.["line-color"]).toBe("#c3cbc0");
  });

  // CR-06 "Gravel solid". A path is a strip in the ground colour with a
  // solid mid-tone core; the kinds are split into layers of their own.
  const CORE_WIDTH = ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 0.75, 15, 1.25, 16, 1.75, 17, 2.5, 18, 3];
  const SIDEWALK_WIDTH = ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 0.75, 16, 1, 17, 1.1, 18, 1.25];
  const isSteps = ["==", ["get", "kind_detail"], "steps"];
  // no bridges (they keep protomaps' layers), no polygons (check 2, fix 2)
  const pathFilter = (...kinds: string[]) => [
    "all", ["!has", "is_bridge"], ["!=", "$type", "Polygon"], ["in", "kind", "other", "path"],
    ["in", "kind_detail", ...kinds],
  ];
  const paths = (theme: "light" | "dark") => {
    const after = applyMeadowOverrides(base(theme), theme);
    return Object.fromEntries(PATHS_ORDER.map((id) => [id, byId(after, id)]));
  };
  const light = paths("light");
  const dark = paths("dark");

  it("every path layer is cloned off roads_other, butt-capped, round-joined, half-opaque in a tunnel", () => {
    const src = byId(base("light"), "roads_other") as { source: string; "source-layer": string };
    for (const theme of [light, dark]) {
      for (const id of PATHS_ORDER) {
        const l = theme[id] as { source: string; "source-layer": string; layout?: Record<string, unknown>; paint?: Record<string, unknown> };
        expect(l.source, id).toBe(src.source);
        expect(l["source-layer"], id).toBe(src["source-layer"]);
        expect(l.layout?.["line-cap"], id).toBe("butt");
        expect(l.layout?.["line-join"], id).toBe("round");
        // …and half as opaque in a tunnel, whatever the layer's own opacity
        const op = l.paint?.["line-opacity"] as [string, unknown, number, number];
        expect(op[0], id).toBe("case");
        expect(op[1], id).toEqual(["has", "is_tunnel"]);
        expect(op[2], id).toBeCloseTo(op[3] / 2, 5);
      }
    }
    // the library's own path layers are gone — the split replaces them
    const after = applyMeadowOverrides(base("light"), "light");
    for (const id of REMOVED) expect(after.find((l) => l.id === id), id).toBeUndefined();
    // …the bridge paths stay the library's (`bridges_other`, untouched)
    expect(byId(after, "roads_bridges_other")).toEqual(byId(base("light"), "roads_bridges_other"));
  });

  it("path_carrier: the ground-coloured strip, core + 2.5 px, steps x 1.1", () => {
    expect(light.path_carrier.filter).toEqual(pathFilter("pedestrian", "steps", "corridor"));
    expect(light.path_carrier.paint?.["line-color"]).toBe("#eef1e9");
    expect(dark.path_carrier.paint?.["line-color"]).toBe("#24292a");
    expect(light.path_carrier.paint?.["line-dasharray"]).toBeUndefined();
    expect(light.path_carrier.paint?.["line-blur"]).toBe(0); // a hard edge (check 2)
    // check 3: 60 % earth over the fill (30 % in a tunnel), core + 1.5 at
    // every stop; steps × 1.1 of their own ramp
    expect(light.path_carrier.paint?.["line-opacity"]).toEqual(["case", ["has", "is_tunnel"], 0.3, 0.6]);
    expect(light.path_carrier.paint?.["line-width"]).toEqual([
      "interpolate", ["linear"], ["zoom"],
      13, 0,
      14, ["case", isSteps, 2.75, 2.25],
      15, ["case", isSteps, 3.3, 2.75],
      16, ["case", isSteps, 4.95, 3.25],
      17, ["case", isSteps, 6.6, 4],
      18, ["case", isSteps, 6.6, 4.5],
    ]);
  });

  it("path_core: the solid mid-tone core, 1 / 1.5 / 3 px", () => {
    // …and a way with no kind_detail is a plain path, and only that (check 2, fix 4)
    const plain = pathFilter("pedestrian", "corridor") as unknown[];
    expect(light.path_core.filter).toEqual([
      ...plain.slice(0, 4), ["any", plain[4], ["!has", "kind_detail"]],
    ]);
    for (const id of PATHS_ORDER.filter((id) => id !== "path_core")) {
      expect(JSON.stringify(light[id].filter), id).not.toContain('"!has","kind_detail"');
    }
    expect(light.path_core.paint?.["line-color"]).toBe("#98a494");
    expect(dark.path_core.paint?.["line-color"]).toBe("#6b7674");
    expect(light.path_core.paint?.["line-width"]).toEqual(CORE_WIDTH);
    expect(light.path_core.paint?.["line-dasharray"]).toBeUndefined();
    expect(light.path_core.paint?.["line-opacity"]).toEqual(["case", ["has", "is_tunnel"], 0.425, 0.85]); // check 3
    // the split leaves no PATH layer for a crossing — on a street the route
    // line shows them. Crossings are drawn above the rail instead, from z16
    // (check 3, interim until the tiles can say which ones span rail)
    const after = applyMeadowOverrides(base("light"), "light");
    for (const l of after) {
      if (l.id === "crossing_carrier" || l.id === "crossing_core") continue;
      const f = JSON.stringify(l.filter ?? null);
      expect(f, l.id).not.toContain('"crossing"');
    }
    // …exactly as a sidewalk (owner, 2026-09-16), no carrier, from z16
    const cross = byId(after, "crossing_core");
    expect(after.find((l) => l.id === "crossing_carrier")).toBeUndefined();
    expect(cross.minzoom).toBe(16);
    expect(cross.filter).toEqual(pathFilter("crossing"));
    for (const k of ["line-color", "line-width", "line-dasharray"]) {
      expect(cross.paint?.[k], k).toEqual(byId(after, "sidewalk").paint?.[k]);
    }
    // …drawn above the ties
    expect(after.findIndex((l) => l.id === "crossing_core")).toBeGreaterThan(after.findIndex((l) => l.id === "rail_ties"));
  });

  it("steps: a 0.35/0.35 ladder, 2.5 / 3 / 6 px", () => {
    expect(light.steps.filter).toEqual(pathFilter("steps"));
    expect(light.steps.paint?.["line-color"]).toBe("#98a494");
    expect(light.steps.paint?.["line-width"]).toEqual([
      "interpolate", ["linear"], ["zoom"], 13, 0, 14, 2.5, 15, 3, 17, 6,
    ]);
    expect(light.steps.paint?.["line-dasharray"]).toEqual([0.35, 0.35]);
  });

  it("track: olive, dashed 3/2, core width, no carrier", () => {
    expect(light.track.filter).toEqual(pathFilter("track", "bridleway"));
    expect(light.track.paint?.["line-color"]).toBe("#9c8a5c");
    expect(dark.track.paint?.["line-color"]).toBe("#8a7c58");
    expect(light.track.paint?.["line-width"]).toEqual(CORE_WIDTH);
    expect(light.track.paint?.["line-dasharray"]).toEqual([3, 2]);
    // no carrier: the carrier's filter does not name it
    expect((light.path_carrier.filter as unknown[])[3]).not.toContain("track");
  });

  it("sidewalk: a dotted hairline, no carrier, from the path zooms", () => {
    expect(light.sidewalk.filter).toEqual(pathFilter("sidewalk"));
    expect(light.sidewalk.minzoom).toBeUndefined(); // was z17; earlier since 2026-09-16 (owner)
    expect(light.sidewalk.paint?.["line-color"]).toBe("#a3ada0");
    expect(dark.sidewalk.paint?.["line-color"]).toBe("#5c6664");
    expect(light.sidewalk.paint?.["line-width"]).toEqual(SIDEWALK_WIDTH);
    expect(light.sidewalk.paint?.["line-dasharray"]).toEqual([1, 1.5]);
    expect((light.path_carrier.filter as unknown[])[3]).not.toContain("sidewalk");
  });

  it("gives the cemetery its own fill, ahead of protomaps' park colour", () => {
    for (const theme of ["light", "dark"] as const) {
      const before = byId(base(theme), "landuse_park").paint?.["fill-color"];
      const after = byId(applyMeadowOverrides(base(theme), theme), "landuse_park");
      expect(after.paint?.["fill-color"]).toEqual([
        "case", ["==", ["get", "kind"], "cemetery"], theme === "light" ? "#d1e2cb" : "#2d3831", before,
      ]);
      expect(after.paint?.["fill-opacity"]).toBe(1);
    }
  });

  it("the drawing layers' kinds are mutually exclusive (check 2, fix 4)", () => {
    const kinds = (id: string) => (light[id].filter as unknown[][])[4] as unknown[];
    const drawn = PATHS_ORDER.filter((id) => id !== "path_carrier" && id !== "path_core");
    const seen = new Set<string>(["pedestrian", "corridor"]); // path_core's
    for (const id of drawn) {
      for (const k of kinds(id).slice(2) as string[]) {
        expect(seen.has(k), `${k} drawn twice (${id})`).toBe(false);
        seen.add(k);
      }
    }
  });

  // CR-06 check 3 specified rail as a line with ties; the owner asked for
  // protomaps' morning dash back the same day. The rail is the library's.
  it("leaves protomaps' roads_rail as it is, and draws platforms as pads (check 3, owner)", () => {
    for (const theme of ["light", "dark"] as const) {
      const after = applyMeadowOverrides(base(theme), theme);
      expect(byId(after, "roads_rail")).toEqual(byId(base(theme), "roads_rail")); // untouched
      expect(after.find((l) => l.id === "rail_line")).toBeUndefined();
      expect(after.find((l) => l.id === "rail_ties")).toBeUndefined();
      const edge = byId(after, "platform_line");
      expect(edge.minzoom).toBe(15);
      expect(edge.filter).toEqual(["==", "kind_detail", "platform"]);
      expect(edge.paint?.["line-width"]).toBe(2);
      const pad = byId(after, "platform") as { "source-layer": string; minzoom?: number; paint?: Record<string, unknown> };
      expect(pad["source-layer"]).toBe("landuse");
      expect(pad.minzoom).toBe(15);
      expect(pad.paint?.["fill-color"]).toBe(theme === "light" ? "#e2e6df" : "#2b3131");
      expect(pad.paint?.["fill-outline-color"]).toBe(theme === "light" ? "#c2c9bf" : "#3a4142");
      // no dash-only ROAD layer is left in the theme: every dashed line on
      // the roads source layer is one of the paths, the ties, or protomaps'
      // dashed road-tunnel casings, which sit under a solid fill. (The
      // country boundary is dashed too, and is not a road.)
      for (const l of after) {
        const spec = l as { "source-layer"?: string; paint?: Record<string, unknown> };
        if (l.type !== "line" || spec["source-layer"] !== "roads" || !spec.paint?.["line-dasharray"]) continue;
        if (l.id.startsWith("roads_tunnels_") && l.id.endsWith("_casing")) continue;
        expect(["roads_rail", "steps", "track", "sidewalk", "footway_core", "crossing_core", "roads_bridges_other"], l.id).toContain(l.id);
      }
    }
  });

  it("footway_core: exactly a sidewalk — grey dotted hairline, no carrier — from the path zooms (owner)", () => {
    expect(light.footway_core.filter).toEqual(pathFilter("footway", "path")); // `path` too, since the owner's trial of 2026-09-16
    expect(light.footway_core.minzoom).toBeUndefined(); // like the sidewalk
    for (const k of ["line-color", "line-width", "line-dasharray"]) {
      expect(light.footway_core.paint?.[k], k).toEqual(light.sidewalk.paint?.[k]);
      expect(dark.footway_core.paint?.[k], k).toEqual(dark.sidewalk.paint?.[k]);
    }
    expect((light.path_carrier.filter as unknown[])[4]).not.toContain("footway");
  });

  it("cycleways are not drawn at all (owner, 2026-09-16)", () => {
    const after = applyMeadowOverrides(base("light"), "light");
    for (const l of after) {
      expect(JSON.stringify(l.filter ?? null), l.id).not.toContain('"cycleway"');
    }
  });

  it("outlines the buildings, opaquely, from z13", () => {
    const light = byId(applyMeadowOverrides(base("light"), "light"), "buildings");
    expect(light.minzoom).toBe(13);
    expect(light.paint?.["fill-outline-color"]).toBe("#c2c9bf");
    // protomaps ships 0.5, which would halve the outline colour too
    expect(byId(base("light"), "buildings").paint?.["fill-opacity"]).toBe(0.5);
    expect(light.paint?.["fill-opacity"]).toBe(1);
    expect(light.paint?.["fill-color"]).toBe("#dde1d9");

    const dark = byId(applyMeadowOverrides(base("dark"), "dark"), "buildings");
    expect(dark.paint?.["fill-outline-color"]).toBe("#3a4142");
    expect(dark.paint?.["fill-opacity"]).toBe(1);
  });

  it("keeps the POI icons off the route until z16", () => {
    expect(byId(base("light"), "pois").minzoom).toBeUndefined();
    expect(byId(applyMeadowOverrides(base("light"), "light"), "pois").minzoom).toBe(16);
  });

  // CR-03 table C. z16 took the park and station names with the shop icons,
  // and a green blob with no name on it is not a park. MapLibre has no
  // per-feature minzoom, so the layer is cloned and the two filters are each
  // other's complement.
  it("brings the landmark names back at z14, and only them", () => {
    for (const flavor of ["light", "dark"] as const) {
      const after = applyMeadowOverrides(base(flavor), flavor);
      const rest = byId(after, "pois");
      const marks = byId(after, "pois-landmarks");
      expect(marks.minzoom).toBe(14);
      expect(rest.minzoom).toBe(16);

      // same source-layer, same paint and layout as the half it was cloned
      // from: a clone, not a second style (the halo and POI passes run over
      // both of them, so the comparison is between the two halves rather
      // than against the library's untouched layer)
      expect(marks["source-layer" as keyof typeof marks]).toBe(
        rest["source-layer" as keyof typeof rest],
      );
      expect(marks.paint).toEqual(rest.paint);
      expect(marks.layout).toEqual(rest.layout);
      expect(marks.layout).toEqual(byId(base(flavor), "pois").layout);

      // …and the filters are complementary: protomaps' own, narrowed by the
      // six kinds on one side and by their negation on the other, so no
      // feature is ever drawn by both.
      const mine = ["in", ["get", "kind"], ["literal", EARLY_POIS]];
      const proto = (byId(base(flavor), "pois") as { filter?: unknown }).filter;
      expect((marks as { filter?: unknown }).filter).toEqual(["all", proto, mine]);
      expect((rest as { filter?: unknown }).filter).toEqual(["all", proto, ["!", mine]]);
    }
  });

  // CR-05 edit 4. The library paints its POIs from a hard-coded expression:
  // #20834D parks, #315BCF transit, #6A5B8F civic — a neon green and a brand
  // blue on the dark ground, and three colours too many on any ground.
  it("gives every POI one ink, and sits its icon back", () => {
    for (const flavor of ["light", "dark"] as const) {
      const proto = JSON.stringify(byId(base(flavor), "pois").paint?.["text-color"]);
      // the library's own: a transit blue, and on the dark flavour a green
      // that really is neon (#30C573 over a #24292a ground)
      expect(proto).toContain(flavor === "dark" ? "#2B5CEA" : "#315BCF");
      expect(proto).toContain(flavor === "dark" ? "#30C573" : "#20834D");
      const after = applyMeadowOverrides(base(flavor), flavor);
      const ink = flavor === "dark" ? "#9fb3a2" : "#4f5a4c";
      for (const id of ["pois", "pois-landmarks"]) {
        const l = byId(after, id);
        expect(l.paint?.["text-color"], id).toBe(ink);
        // the sprite is not SDF (no "sdf": true in basemap-assets/sprites),
        // so icon-color would be a silent no-op: the icon is pulled back
        // with icon-opacity instead
        expect(l.paint?.["icon-opacity"], id).toBe(0.7);
        expect(l.paint?.["icon-color"], id).toBeUndefined();
      }
    }
  });

  it("names the six kinds the CR asks for, in the CR's own words", () => {
    expect(EARLY_POIS).toEqual([
      "park",
      "garden",
      "playground",
      "station",
      "square",
      "viewpoint",
    ]);
    // …of which protomaps' pois layer actually carries three today. The
    // other three draw nothing until the library styles them, which is why
    // the split's filter is ANDed with protomaps' rather than replacing it.
    const proto = JSON.stringify((byId(base("light"), "pois") as { filter?: unknown }).filter);
    expect(EARLY_POIS.filter((k) => proto.includes(`"${k}"`))).toEqual([
      "park",
      "garden",
      "station",
    ]);
  });

  it("makes the labels readable at arm's length, in both themes", () => {
    for (const flavor of ["light", "dark"] as const) {
      const after = applyMeadowOverrides(base(flavor), flavor);
      const ink = flavor === "dark" ? "#b3bbb5" : "#33402f";

      const road = byId(after, "roads_labels_minor");
      expect(road.layout?.["text-size"]).toEqual([
        "interpolate", ["linear"], ["zoom"], 15, 13, 17, 14,
      ]);
      expect(road.paint?.["text-color"]).toBe(ink);
      // the layer's own placement is protomaps' business, and stays
      expect(road.layout?.["symbol-placement"]).toBe("line");

      const sub = byId(after, "places_subplace");
      expect(sub.layout?.["text-size"]).toBe(15);
      expect(sub.paint?.["text-color"]).toBe(flavor === "dark" ? "#c9d0cb" : "#33402f");
    }
  });

  // CR-05 edit 3. protomaps gives each label family a halo of its own — the
  // road's fill, a cyan on water, a near-black on the dark flavour — and at
  // 200 % the dark ones read as a glow around every word. One answer for all
  // of them: 1 px of the ground colour, no blur.
  it("halos every label in the ground colour, 1 px, unblurred", () => {
    for (const flavor of ["light", "dark"] as const) {
      const before = base(flavor);
      const after = applyMeadowOverrides(before, flavor);
      const earth = flavor === "dark" ? "#24292a" : "#eef1e9";
      const symbols = after.filter((l) => l.type === "symbol");
      // the library's own eleven, plus the landmark split's clone
      expect(symbols.length).toBe(before.filter((l) => l.type === "symbol").length + 1);
      for (const l of symbols) {
        const paint = (l as { paint?: Record<string, unknown> }).paint ?? {};
        expect(paint["text-halo-color"], `${l.id} halo colour`).toBe(earth);
        expect(paint["text-halo-width"], `${l.id} halo width`).toBe(1);
        expect(paint["text-halo-blur"], `${l.id} halo blur`).toBe(0);
      }
      // and nothing black is left anywhere in a label's paint
      expect(JSON.stringify(symbols.map((l) => (l as { paint?: object }).paint)))
        .not.toMatch(/#000|black/i);
    }
  });

  it("stops washing the green, and draws no line around it", () => {
    // the library's own: 0.7 on the urban green, and a fade-in on the parks
    // that is still only 0.8 at the widest the app goes (minZoom 10)
    expect(byId(base("light"), "landuse_urban_green").paint?.["fill-opacity"]).toBe(0.7);
    expect(byId(base("light"), "landuse_park").paint?.["fill-opacity"]).toEqual([
      "interpolate", ["linear"], ["zoom"], 6, 0, 11, 1,
    ]);
    for (const flavor of ["light", "dark"] as const) {
      const after = applyMeadowOverrides(base(flavor), flavor);
      for (const id of ["landuse_park", "landuse_urban_green"]) {
        expect(byId(after, id).paint?.["fill-opacity"], id).toBe(1);
        expect(byId(after, id).paint?.["fill-outline-color"], id).toBeUndefined();
      }
    }
  });
});
