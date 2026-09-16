"""Green-space attributes: fraction of each edge inside parks/forests/green
(`green`) and fraction DEEP inside them (`deep`).

Routing prefers green (parks are the nap-walk habitat): the client charges
a not-green penalty, so green fraction per edge ships in the artifact.
Sources: OSM leisure/landuse/natural polygons, 15 m buffered so paths on a
park's rim count as green. `deep` uses the same polygons eroded by 25 m:
a path along a park's rim (houses/street 15 m away) is green but not deep,
the path through the middle is both — that is the "park proper" a walker
means (Sinaipark feedback 2026-08-16); the circuit catalog uses it.
Idempotent: overwrites the green/deep columns.
"""
import geopandas as gpd
import numpy as np
import osmnx as ox
import pandas as pd
from shapely.strtree import STRtree

from common import CRS_UTM, WORK, check, configure_osmnx, place_polygon

GREEN_TAGS = {
    "leisure": ["park", "garden", "recreation_ground", "nature_reserve",
                "dog_park"],
    # NOT allotments (2026-08-29, Viktor): Frankfurt's 627 Kleingarten
    # colonies are 13.1 km2 of fenced private plots, not open space. Counting
    # them green made 7,965 edges look like parkland and loops lapped them.
    "landuse": ["forest", "meadow", "grass", "village_green", "cemetery",
                "orchard"],
    "natural": ["wood", "grassland", "scrub", "heath"],
}
BUFFER_M = 15
DEEP_ERODE_M = 25
STEP = 20.0  # sampling interval along each edge, meters


def fetch_features(tags):
    """features_from_place, but against a SIMPLIFIED boundary.

    osmnx sends the geocoded polygon verbatim, and Greater London's outline
    has thousands of vertices — the mirror answered 413 Request Entity Too
    Large for every green query (2026-09-01). The stage clips to the exact
    city afterwards anyway, so a coarse fetch boundary costs nothing.
    """
    import osmnx as ox

    import time

    poly = gpd.GeoSeries([place_polygon()], crs="EPSG:4326").to_crs(CRS_UTM).iloc[0]
    simple = poly.simplify(200.0).buffer(500.0).simplify(200.0)
    simple = gpd.GeoSeries([simple], crs=CRS_UTM).to_crs("EPSG:4326").iloc[0]
    # Retry: London's leisure response is big enough that the mirror drops
    # the connection mid-body ("Remote end closed connection without
    # response"). Losing one tag class silently is worse than failing —
    # leisure IS the parks, and a park-walk router without them would still
    # report a healthy green share from woodland alone (2026-09-01).
    last = None
    for attempt in range(5):
        try:
            return ox.features_from_polygon(simple, tags)
        except Exception as e:
            last = e
            wait = 15 * (attempt + 1)
            print(f"  {list(tags)[0]} attempt {attempt + 1}/5 failed "
                  f"({type(e).__name__}), retrying in {wait} s")
            time.sleep(wait)
    raise last


def green_fraction(edges, green_union_tree, green_geoms):
    fracs = np.zeros(len(edges))
    for i, geom in enumerate(edges.geometry):
        n = max(2, int(geom.length / STEP) + 1)
        pts = [geom.interpolate(d) for d in np.linspace(0, geom.length, n)]
        hits = 0
        for p in pts:
            for j in green_union_tree.query(p):
                if green_geoms[j].covers(p):
                    hits += 1
                    break
        fracs[i] = hits / n
    return fracs


def main():
    configure_osmnx()
    ox.settings.cache_folder = WORK / "osm_cache"
    frames = []
    for key, values in GREEN_TAGS.items():
        try:
            f = fetch_features({key: values})
            frames.append(f[f.geometry.geom_type.isin(["Polygon", "MultiPolygon"])])
        except Exception as e:  # a tag class with zero hits raises in osmnx
            print(f"note: {key} query empty ({e})")
            # leisure IS the parks. A city can plausibly lack landuse=forest
            # or natural=wood, but a lost leisure query leaves a park-walk
            # router with no parks while still reporting a healthy green
            # share from woodland — London hit exactly that (2026-09-01).
            check(key != "leisure",
                  f"the leisure query failed ({type(e).__name__}) — that is "
                  "every park; refusing to score green without it")
    # Every tag class coming back empty means the fetch failed, not that the
    # city has no parks — pd.concat then dies with "No objects to
    # concatenate", which says nothing useful (2026-08-31).
    check(bool(frames), "no green polygons fetched at all — Overpass failed, "
                        "not a city without parks; rerun")
    green = gpd.GeoDataFrame(
        pd.concat(frames, ignore_index=True), crs="EPSG:4326").to_crs(CRS_UTM)
    check(len(green) > 200, f"only {len(green)} green polygons — query broken?")
    # Clip to the city. features_from_place returns whole relations that
    # merely intersect the place, and some are enormous: San Francisco pulled
    # 24,477 km2 of "green" for a 121 km2 city, because Bay Area reserves and
    # coastal forest relations extend far beyond it (2026-08-31).
    city = gpd.GeoSeries([place_polygon()], crs="EPSG:4326").to_crs(CRS_UTM).iloc[0]
    green = green.clip(city)
    green = green[~green.geometry.is_empty]
    city_km2 = city.area / 1e6
    area_km2 = green.geometry.area.sum() / 1e6
    check(0.02 * city_km2 < area_km2 < city_km2,
          f"green area {area_km2:.0f} km2 against a {city_km2:.0f} km2 city")
    geoms = list(green.geometry.buffer(BUFFER_M))
    tree = STRtree(geoms)
    # eroded polygons: dissolve first so two adjacent green polygons do not
    # both lose 25 m along their shared edge
    deep_geoms = [g for g in getattr(green.geometry.union_all().buffer(-DEEP_ERODE_M), "geoms", [])
                  if not g.is_empty]
    deep_tree = STRtree(deep_geoms)

    path = WORK / "scored" / "edges_scored.gpkg"
    edges = gpd.read_file(path)
    edges["green"] = green_fraction(edges, tree, geoms)
    # WOODLAND separately (2026-08-28). GREEN_TAGS unions park, forest, wood,
    # meadow and cemetery, so the router cannot tell a maintained park path
    # from a forest trail — Sinaipark's lawns and its south woodland scored
    # identically, and a stroller was sent down the trails. `green` keeps its
    # meaning (shade/pleasantness); `wood` is what makes a soft surface rough.
    wframes = []
    for key, values in {"landuse": ["forest"], "natural": ["wood", "scrub"]}.items():
        try:
            f = fetch_features({key: values})
            wframes.append(f[f.geometry.geom_type.isin(["Polygon", "MultiPolygon"])])
        except Exception as e:
            print(f"note: woodland {key} query empty ({e})")
    wood = (gpd.GeoDataFrame(pd.concat(wframes, ignore_index=True), crs="EPSG:4326").to_crs(CRS_UTM)
            if wframes else gpd.GeoDataFrame(geometry=[], crs=CRS_UTM))
    if len(wood):
        wgeoms = list(wood.geometry.buffer(BUFFER_M))
        edges["wood"] = green_fraction(edges, STRtree(wgeoms), wgeoms)
    else:
        edges["wood"] = 0.0
    # allotment fraction, so 08 can price walking through a colony
    aframes = []
    try:
        af = fetch_features({"landuse": ["allotments"]})
        aframes.append(af[af.geometry.geom_type.isin(["Polygon", "MultiPolygon"])])
    except Exception as e:
        print(f"note: allotments query empty ({e})")
    allot = (gpd.GeoDataFrame(pd.concat(aframes, ignore_index=True), crs="EPSG:4326").to_crs(CRS_UTM)
             if aframes else gpd.GeoDataFrame(geometry=[], crs=CRS_UTM))
    if len(allot):
        ageoms = list(allot.geometry)
        edges["allot"] = green_fraction(edges, STRtree(ageoms), ageoms)
    else:
        edges["allot"] = 0.0
    ashare = (edges["allot"] * edges["length"]).sum() / edges["length"].sum()
    print(f"allotments: {len(allot)} polygons, {ashare:.0%} of edge length")
    wshare = (edges["wood"] * edges["length"]).sum() / edges["length"].sum()
    print(f"woodland: {len(wood)} polygons, {wshare:.0%} of edge length")
    edges["deep"] = green_fraction(edges, deep_tree, deep_geoms)
    share = (edges["green"] * edges["length"]).sum() / edges["length"].sum()
    deep_share = (edges["deep"] * edges["length"]).sum() / edges["length"].sum()
    check(0.05 < share < 0.7, f"green length share {share:.0%} implausible")
    check(0.0 < deep_share < share, f"deep share {deep_share:.0%} vs green {share:.0%} implausible")
    edges.to_file(path, driver="GPKG")
    print(f"OK: {len(green)} polygons ({area_km2:.0f} km2), "
          f"{share:.0%} of edge length green, {deep_share:.0%} deep")


if __name__ == "__main__":
    main()
