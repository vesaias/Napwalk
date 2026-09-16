"""W1/P1: build the Frankfurt pedestrian graph and district polygons from OSM.

Idempotent: skips work when outputs exist; delete data/osm to force refresh.
"""
import geopandas as gpd
import osmnx as ox

from cities import DISTRICTS as DISTRICT_COUNTS
from common import CITY, CRS_UTM, PLACE, WALK_FILTER, WORK, check, configure_osmnx, place_polygon

OUT = WORK / "osm"
GRAPH = OUT / "graph.graphml"
EDGES = OUT / "edges.gpkg"
DISTRICTS = OUT / "districts.gpkg"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ox.settings.cache_folder = WORK / "osm_cache"
    ox.settings.log_console = True
    # Mirrors, surveyed 2026-08-30 — only overpass-api.de has world data:
    #   overpass.osm.ch          Switzerland ONLY. Returns 0 elements for
    #                            Germany WITHOUT erroring, which cost an hour
    #                            and a wrong conclusion that Berlin has no
    #                            districts.
    #   overpass.private.coffee  world data but weeks stale (2026-08-18) and
    #                            unresponsive today
    #   kumi.systems, nchc.org.tw, osm.jp, openstreetmap.ru
    #                            no response / empty
    #
    # Set FORCE_IPV6=1 if fetches die with ConnectTimeout: IPv4 to
    # overpass-api.de times out from Python on some networks while IPv6
    # answers in 0.05 s, and curl hides it by falling back, so the service
    # looks healthy from the shell.
    #
    # Still unresolved: Paris fails repeatedly on the POST to
    # /api/interpreter even with IPv6 forced and slots free, while the same
    # POST with a small query succeeds from the same process. Frankfurt,
    # Berlin, Hamburg and Munich all fetched fine. If it persists, a
    # Geofabrik PBF extract avoids Overpass entirely (osmnx cannot read PBF;
    # pyrosm can).
    import os
    # osmnx resolves the Overpass host itself over DNS-over-HTTPS and pins
    # the address (_http._resolve_host_via_doh). That bypasses the system
    # resolver entirely, so it picks the A record and connects over IPv4 —
    # which times out on this network while IPv6 answers in 0.05 s. It is
    # why plain requests reached the very same URL in 0.24 s while every
    # osmnx fetch died with ConnectTimeout, and why patching getaddrinfo did
    # not help: osmnx never calls it. On the UK mirror the DoH lookup fails
    # outright with KeyError: 'Answer'. None = use the system resolver
    # (2026-08-30, after six wrong theories).
    ox.settings.doh_url_template = None
    configure_osmnx()   # url, DoH, timeouts, cache — one place (common.py)
    # osmnx drops way tags not listed here; SPEC P1 needs these on every edge
    ox.settings.useful_tags_way = sorted(
        set(ox.settings.useful_tags_way)
        | {"surface", "smoothness", "kerb", "incline", "footway", "sidewalk",
           # side-aware pedestrian model (2026-08-18): which side of a street
           # has a sidewalk, explicit sidewalk=no, foot access/use_sidepath,
           # shared foot/cycle segregation, walkable shoulder
           "sidewalk:left", "sidewalk:right", "sidewalk:both",
           "foot", "segregated", "shoulder",
           # street names: a street piece crossing its own street's other
           # carriageway is a fork link, not a crosswalk (2026-08-20)
           "name",
           # accessibility modes (2026-08-27, docs/accessibility-modes.md)
           "wheelchair", "stroller", "ramp", "ramp:wheelchair", "ramp:stroller",
           "ramp:bicycle", "flat_steps", "step_count", "conveying", "sac_scale",
           "trail_visibility", "obstacle", "tracktype", "width", "est_width",
           "kerb:height", "sloped_curb", "level", "handrail", "wheelchair:description"})
    ox.settings.useful_tags_node = sorted(
        set(ox.settings.useful_tags_node)
        | {"barrier", "kerb", "kerb:height", "kerb:left", "kerb:right", "sloped_curb",
           "wheelchair", "stroller", "locked", "maxwidth:physical", "opening",
           "crossing", "crossing:markings", "public_transport", "entrance", "highway",
           "access", "foot", "cycle_barrier", "stile", "step_count"})

    if GRAPH.exists():
        print(f"{GRAPH} exists, loading")
        G = ox.load_graphml(GRAPH)
    else:
        G = ox.graph_from_polygon(place_polygon(), custom_filter=WALK_FILTER,
                                  simplify=True, retain_all=False)
        G = ox.project_graph(G, to_crs=CRS_UTM)
        ox.save_graphml(G, GRAPH)

    want = CRS_UTM.split(":")[-1]
    check(G.graph.get("crs") is not None and want in str(G.graph["crs"]),
          f"graph CRS is {G.graph.get('crs')}, expected {CRS_UTM} for {CITY}")
    n_edges = G.number_of_edges()
    # A wide plausibility band, not a Frankfurt band: Berlin's walking network
    # is 1,386,803 edges against Frankfurt's 310,915, and London will be
    # larger again. This catches an empty or truncated fetch, which is what
    # the check is for — it was never meant to encode one city's size.
    check(40_000 < n_edges < 6_000_000, f"edge count {n_edges} implausible")

    edges = ox.graph_to_gdfs(G, nodes=False)
    for col in ("surface", "smoothness"):
        if col not in edges.columns:
            edges[col] = None
    # lists arise from simplification merging ways; keep the first value
    for col in ("highway", "surface", "smoothness"):
        edges[col] = edges[col].apply(lambda v: v[0] if isinstance(v, list) else v)
    edges[["highway", "surface", "smoothness", "length", "geometry"]].to_file(
        EDGES, driver="GPKG")

    if not DISTRICTS.exists():
        # Districts feed the coverage report and nothing else, so this must
        # never block a graph build — Berlin's 1.4 M-edge graph was held up by
        # a report input (2026-08-30). It is also the query most likely to
        # fail: it runs last, so it meets the rate limiter first.
        #
        # An empty districts.gpkg is written on failure and NOT retried, since
        # the guard above is `if not DISTRICTS.exists()`. Berlin has 96
        # Ortsteile at admin_level 10; its file is empty because we could not
        # fetch them, not because they are absent. Delete the file and rerun.
        try:
            d = ox.features_from_polygon(place_polygon(), {"boundary": "administrative",
                                                           "admin_level": "10"})
            d = d[d.geometry.geom_type.isin(["Polygon", "MultiPolygon"])]
            d = d.to_crs(CRS_UTM)[["name", "geometry"]]
            # the polygon query also returns neighbouring towns' districts
            # that touch the boundary — keep only those inside the city, and
            # drop the city relation itself (it carries admin_level 10 twins)
            city = gpd.GeoSeries([place_polygon()], crs="EPSG:4326").to_crs(CRS_UTM).iloc[0]
            d = d[d.representative_point().within(city)]
            d = d[d.geometry.area < 0.1 * city.area]
            d = d[d["name"] != PLACE.split(",")[0]]
        except Exception as e:
            print(f"note: districts unavailable for {CITY} ({type(e).__name__}); "
                  "coverage report will have none")
            d = gpd.GeoDataFrame({"name": []}, geometry=[], crs=CRS_UTM)
        d.to_file(DISTRICTS, driver="GPKG")
    d = gpd.read_file(DISTRICTS)
    # districts feed the coverage report, not routing; the expected count is
    # per city (cities.py), and 0 means the city has nothing at admin_level 10
    want = DISTRICT_COUNTS.get(CITY, 0)
    if want and len(d):
        check(0.4 * want <= len(d) <= 2.5 * want,
              f"{len(d)} districts, expected ~{want} for {CITY}")
    elif not len(d):
        # an empty file means the fetch above gave up; the report loses a
        # breakdown, the graph is unaffected, and a rerun after deleting
        # districts.gpkg will try again
        print(f"note: no districts for {CITY} — coverage report will be citywide only")
    # steps are IN the graph since the accessibility modes (2026-08-27);
    # the router excludes/penalises them per mode
    steps = edges[edges["highway"] == "steps"]
    check(50 < len(steps) < 200_000, f"{len(steps)} steps edges implausible")
    print(f"OK: {n_edges} edges, {len(d)} districts")


if __name__ == "__main__":
    main()
