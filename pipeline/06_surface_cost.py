"""P2: graded per-edge surface cost from OSM surface/smoothness tags.

Gate 2026-08-14: per-edge costs (84.4 % citywide surface coverage).
Cobbles are a heavy penalty, never a block (SPEC P2).
"""
import json

import osmnx as ox
import pandas as pd

from common import WORK, check, configure_osmnx

# base cost by surface tag, 0 = stroller-perfect, 1 = wakes the baby
SURFACE_BASE = {
    "asphalt": 0.05, "paved": 0.05, "concrete": 0.10, "chipseal": 0.10,
    "concrete:plates": 0.20, "concrete:lanes": 0.25, "metal": 0.30,
    "wood": 0.30, "paving_stones": 0.15,
    # gravel family barely penalized: park paths are compacted/fine gravel
    # and strollers roll fine on them (decision 2026-08-14)
    "compacted": 0.05, "fine_gravel": 0.05, "gravel": 0.25,
    "pebblestone": 0.70,
    # bare-earth family (2026-08-17): dry compacted earth rolls nearly as
    # well as gravel and it is the surface of every Stadtwald trail; the
    # bad-trail signal (roots, ruts) comes from smoothness and informal=yes.
    # A track (vehicle width) is easier than a path; see EARTH_BY_CLASS.
    "unpaved": 0.30, "ground": 0.30, "dirt": 0.35, "earth": 0.35,
    "grass": 0.70, "grass_paver": 0.60, "sand": 0.90, "mud": 0.90,
    "woodchips": 0.70, "cobblestone:flattened": 0.70, "sett": 0.75,
    "cobblestone": 0.95, "unhewn_cobblestone": 1.00, "paving_stones:30": 0.60,
}
# untagged fallback by highway class (residential streets in FFM are asphalt)
HIGHWAY_DEFAULT = {
    "footway": 0.10, "pedestrian": 0.10, "living_street": 0.10,
    "residential": 0.10, "cycleway": 0.05, "tertiary": 0.10,
    "secondary": 0.10, "primary": 0.10, "unclassified": 0.15,
    "service": 0.15, "track": 0.50, "path": 0.40, "bridleway": 0.50,
}
FALLBACK = 0.20
EARTH = {"unpaved", "ground", "dirt", "earth"}
EARTH_BY_CLASS = {"track": -0.05, "path": 0.05}
INFORMAL_ADJ = 0.30  # a trodden desire line: narrow, rooty, single file
INFORMAL_IDS = WORK / "osm" / "informal_ways.json"  # way ids with informal=yes (data/README.md)
SMOOTHNESS_ADJ = {
    "excellent": -0.05, "good": -0.02, "intermediate": 0.05, "bad": 0.25,
    "very_bad": 0.50, "horrible": 0.80, "very_horrible": 1.00,
    "impassable": 1.00,
}


def surface_cost(surface, smoothness, highway, informal=False):
    if surface in SURFACE_BASE:
        base = SURFACE_BASE[surface]
        if surface in EARTH:
            base += EARTH_BY_CLASS.get(highway, 0.0)
    else:
        base = HIGHWAY_DEFAULT.get(highway, FALLBACK)
    base += SMOOTHNESS_ADJ.get(smoothness, 0.0)
    if informal:
        base += INFORMAL_ADJ
    return min(1.0, max(0.0, base))


def is_informal(osmid, informal_ids):
    ids = osmid if isinstance(osmid, list) else [osmid]
    return any(int(i) in informal_ids for i in ids)


def main():
    configure_osmnx()
    out_dir = WORK / "scored"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "edges_scored.gpkg"
    G = ox.load_graphml(WORK / "osm" / "graph.graphml")
    edges = ox.graph_to_gdfs(G, nodes=False).reset_index()
    for col in ("surface", "smoothness"):
        if col not in edges.columns:
            edges[col] = None
    informal_ids = set(json.loads(INFORMAL_IDS.read_text())) if INFORMAL_IDS.exists() else set()
    edges["informal"] = [is_informal(o, informal_ids) for o in edges["osmid"]]
    print(f"{int(edges['informal'].sum())} edges on informal ways ({len(informal_ids)} way ids)")
    for col in ("highway", "surface", "smoothness"):
        edges[col] = edges[col].apply(lambda v: v[0] if isinstance(v, list) else v)
    edges = edges.sort_values(["u", "v", "key"]).reset_index(drop=True)
    edges["eid"] = edges.index
    edges["surface_cost"] = [
        surface_cost(s, sm, h, inf) for s, sm, h, inf
        in zip(edges["surface"], edges["smoothness"], edges["highway"], edges["informal"])]
    check(len(edges) > 40_000, f"{len(edges)} edges, expected >40k")
    check(edges["surface_cost"].between(0, 1).all(), "surface_cost out of [0,1]")
    check(edges["surface_cost"].mean() < 0.4,
          f"mean surface cost {edges['surface_cost'].mean():.2f} — table broken?")
    # Heavy-penalty kilometres are counted over the REAL network only. A
    # pedestrian-area visibility mesh covers the same ground with many
    # overlapping chords, so summing its edge lengths counts one cobbled
    # square dozens of times: after 01c's mesh rewrite the total read
    # 1,570 km, of which 1,026 km was mesh and 544 km was actual network
    # (2026-08-28). Summed edge length only approximates extent on a
    # non-overlapping graph.
    # 01c is not optional: Berlin and Paris were scored without a mesh after
    # 01c died mid-run, and this stage reported success over a graph that
    # routed no plaza (2026-09-01). 01c asserts >10 pedestrian polygons in
    # every city, so a graph with no mesh edge at all is a graph 01c never
    # touched.
    check("is_ped_area" in edges.columns, "no is_ped_area column — run 01c_ped_areas.py first")
    ped = edges["is_ped_area"].astype(str).eq("True")
    check(ped.any(), "no pedestrian-area edges — run 01c_ped_areas.py first")
    heavy = edges["surface_cost"] >= 0.7
    cobbled = edges.loc[heavy & ~ped, "length"].sum() / 1000
    net_km = edges.loc[~ped, "length"].sum() / 1000
    share = cobbled / max(net_km, 1.0)
    # A SHARE of the network, not an absolute: 1000 km was Frankfurt-sized,
    # and Hamburg has 1,079 km of genuine cobble against Munich's 810
    # (2026-08-31). Old German cities really are paved like that; what the
    # check is for is a surface table that has gone wrong, which shows up as
    # a share far outside this band.
    check(0.001 < share < 0.35,
          f"{cobbled:.0f} km heavy-penalty = {share:.1%} of {net_km:.0f} km network")
    mesh_cobbled = edges.loc[heavy & ped, "length"].sum() / 1000
    print(f"heavy-penalty surface: {cobbled:.0f} km of network, "
          f"{mesh_cobbled:.0f} km of ped-area mesh (overlapping chords)")
    # graphml round-trips booleans as strings
    edges["is_sidewalk"] = edges.get("is_sidewalk", False).astype(str).eq("True") if "is_sidewalk" in edges.columns else False
    edges["sidewalk_tier"] = edges["sidewalk_tier"].fillna(0).astype(int) if "sidewalk_tier" in edges.columns else 0
    edges[["u", "v", "key", "eid", "highway", "surface", "smoothness", "is_sidewalk", "sidewalk_tier",
           "length", "surface_cost", "geometry"]].to_file(out, driver="GPKG")
    print(f"OK: {len(edges)} edges scored, {cobbled:.0f} km cobble-grade, "
          f"mean cost {edges['surface_cost'].mean():.2f}")


if __name__ == "__main__":
    main()
