"""Shared constants for the Shadewalk pipeline.

Paths are city-scoped since 2026-08-30 (see data/LAYOUT.md):

    IN    data/input/<city>/    raw downloads, read only by prep stages
    WORK  data/work/<city>/     intermediates, regenerable
    OUT   data/output/          what the web app consumes

Set CITY to work on another city; PLACE, CRS_UTM and TZ come from
pipeline/cities.py, the twin of web/src/cities.ts.
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
REPORTS = ROOT / "reports"

from cities import CITIES, DEFAULT

CITY = os.environ.get("CITY", DEFAULT)
if CITY not in CITIES:
    raise SystemExit(f"SANITY FAIL: unknown CITY {CITY!r}; "
                     f"known: {', '.join(CITIES)}")
IN = DATA / "input" / CITY
WORK = DATA / "work" / CITY
OUT = DATA / "output"

# Per-city, from the registry. CRS_UTM keeps its name for the dozen stages
# that import it, but it is the city's working projection and is not always
# a UTM zone: Paris is Lambert-93, London OSGB, New York State Plane.
CRS_UTM = CITIES[CITY]["crs"]
PLACE = CITIES[CITY]["place"]
TZ = CITIES[CITY]["tz"]
CENTER = CITIES[CITY]["center"]

# Pedestrian network. steps are blocked outright (SPEC P1): a stroller
# cannot take stairs, and a penalty would still route through them.
#
# Two Overpass filters, unioned by osmnx:
#   1. the general walkable set (no access=private/no, no foot=no)
#   2. ways where foot is EXPLICITLY allowed even though access=no/private
#      — the standard OSM idiom for "closed to cars, open to walkers"
#      (forest tracks, park service roads; e.g. Kirschwaldstraße, way
#      4711477: access=no + foot=yes). foot=* overrides access=* in OSM
#      semantics; the single-filter version silently dropped all of these
#      (bug found 2026-08-15).
# OSM-wiki audit 2026-08-21 (Key:foot, Tag:foot=yes/designated, DE access
# defaults): bridleway is foot=NO by default in Germany (Stadtwald riding
# paths were walkable); foot=private/discouraged must not route (only "no"
# was filtered); foot=official is an old synonym of designated and joins
# the access=no rescue. trunk stays excluded deliberately (legal but never
# a nap walk); cycleway stays included and is priced by the router.
# steps re-enter the graph for the accessibility modes (2026-08-27):
# blocked/penalised per mode by the router, not at fetch time
_HW_EXCLUDE = (
    'motorway|motorway_link|trunk|trunk_link|bridleway|'
    'construction|proposed|abandoned|platform|raceway|bus_guideway'
)
WALK_FILTER = [
    f'["highway"]["area"!~"yes"]["highway"!~"{_HW_EXCLUDE}"]'
    '["foot"!~"no|private|discouraged"]["access"!~"private|no"]',
    # foot=* overrides both access=* and the highway-type exclusion
    # (a bridleway signed frei für Fußgänger is walkable)
    '["highway"]["area"!~"yes"]["highway"!~"motorway|motorway_link|'
    'construction|proposed|abandoned|platform|raceway|bus_guideway"]'
    '["foot"~"yes|designated|permissive|official"]',
]


def force_ipv6():
    """Make Python resolve AAAA only.

    Some networks (a VPN here, 2026-08-30) break IPv4 to overpass-api.de
    while IPv6 works: a raw IPv4 connect times out after 15 s, IPv6 answers
    in 0.05 s. curl hides this by falling back, so the service looks healthy
    from the shell while every osmnx fetch dies with ConnectTimeout — which
    reads exactly like rate limiting and sent me chasing mirrors for an hour.

    Opt in with FORCE_IPV6=1; off by default, since forcing IPv6 on a
    v4-only network would break everything the other way.
    """
    import socket

    real = socket.getaddrinfo

    def only_v6(host, port, family=0, *a, **kw):
        res = real(host, port, socket.AF_INET6, *a, **kw)
        return res or real(host, port, family, *a, **kw)

    socket.getaddrinfo = only_v6
    print("note: FORCE_IPV6 — resolving AAAA only")


if os.environ.get("FORCE_IPV6") == "1":
    force_ipv6()


def configure_osmnx():
    """One place that points osmnx at Overpass, for every stage that uses it.

    Only 01_build_graph read OVERPASS_URL and disabled DoH; 13_green_edges
    and 01c_ped_areas quietly used osmnx's default instance, so setting
    OVERPASS_URL appeared to work while their queries still went to
    overpass-api.de and timed out. Hamburg's green fetch failed that way and
    reported "no green polygons", which reads like a city without parks
    (2026-08-31).

    doh_url_template=None matters just as much: osmnx otherwise resolves the
    host over DNS-over-HTTPS and pins the address, bypassing the system
    resolver — see 01_build_graph for the full story.
    """
    try:
        import osmnx as ox
    except ImportError:
        return
    ox.settings.cache_folder = WORK / "osm_cache"
    ox.settings.overpass_url = os.environ.get(
        "OVERPASS_URL", "https://maps.mail.ru/osm/tools/overpass/api")
    ox.settings.overpass_rate_limit = "overpass-api.de" in ox.settings.overpass_url
    ox.settings.doh_url_template = None
    ox.settings.requests_timeout = 1800


def place_polygon():
    """The city's boundary in EPSG:4326: the geocoded `place`, or the union
    of the registry's `clip` areas (London, 2026-09-02). Cached in
    work/<city>/osm/place.gpkg so Nominatim is asked once. Every
    place-scoped fetch (graph, pedestrian areas, green, districts) goes
    through this, so a clip is a clip everywhere."""
    import geopandas as gpd
    import osmnx as ox
    from shapely.ops import unary_union
    cache = WORK / "osm" / "place.gpkg"
    if cache.exists():
        return gpd.read_file(cache).geometry.iloc[0]
    names = CITIES[CITY].get("clip") or [PLACE]
    polys = []
    for name in names:
        g = ox.geocode_to_gdf(name).to_crs("EPSG:4326")
        check(g.geometry.iloc[0].geom_type in ("Polygon", "MultiPolygon"),
              f"{name!r} geocoded to a {g.geometry.iloc[0].geom_type}, not an area")
        polys.append(g.geometry.iloc[0])
    poly = unary_union(polys)
    cache.parent.mkdir(parents=True, exist_ok=True)
    gpd.GeoDataFrame({"names": ["|".join(names)]}, geometry=[poly], crs="EPSG:4326").to_file(cache, driver="GPKG")
    print(f"place polygon: {len(names)} area(s), bounds {tuple(round(b, 3) for b in poly.bounds)}")
    return poly


def export_border():
    """The city's data border for the web: place_polygon() simplified to
    ~20 m, as a GeoJSON Feature at data/output/tiles/<city>/border.json.
    MapView draws it and ShadeLayer clips the shadow overlay to it
    (2026-09-02)."""
    import json
    from shapely.geometry import mapping
    poly = place_polygon().simplify(0.0002, preserve_topology=True)
    out = OUT / "tiles" / CITY / "border.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"type": "Feature", "properties": {"city": CITY}, "geometry": mapping(poly)},
                              separators=(",", ":")), encoding="utf-8")
    print(f"border: {out} ({out.stat().st_size / 1e3:.0f} kB)")
    return out


def check(cond, msg):
    if not cond:
        raise SystemExit(f"SANITY FAIL: {msg}")
