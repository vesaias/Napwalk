"""Normalise every city's noise map to one canonical raster: LDEN in dB.

    python pipeline/prep_noise_db.py frankfurt|berlin|munich|london

Output: data/work/<city>/noise/lden_db.tif — uint8 decibels, 0 = unmapped
(below the source's floor, which every source treats as quiet).

Why dB and not the class index the sources ship:

The class index is not comparable between cities. Frankfurt's HLNUG raster
has EIGHT classes starting at 40 dB; Berlin's and Munich's have FIVE
starting at 55 dB — and their palettes prove the offset, since Frankfurt's
classes 4-8 are pixel-identical in colour to Berlin's 1-5. 07_noise_cost
scored `mean_class / 8`, so a Berlin street at 55-60 dB would have scored as
a Frankfurt street at 40-45: silent. Anything built on the raw class index
is wrong the moment a second city arrives (2026-08-30).

dB is the physical quantity, so it is the thing that means the same in every
city. Sources that ship real decibels (London, and the US CONUS raster) keep
their precision instead of being flattened into someone else's bands.
"""
import sys
import zipfile

import numpy as np
import rasterio
from rasterio.merge import merge

from common import DATA, check

# Band LOWER EDGE, not midpoint. A class raster only says which 5 dB band a
# pixel is in, and the lower edge is the only reading that survives uint8
# exactly: a 42.5 midpoint rounds to 42, which reads back as band 0.9 instead
# of 1 and shifted every Frankfurt cost by up to 0.0125.
#   frankfurt: class c in 1..8 -> 40-44, 45-49, ... >=75  -> 35 + 5c
#   berlin/munich: class c in 1..5 -> 55-60, ... >=75     -> 35 + 5(c+3)
CLASS_SOURCES = {
    "frankfurt": {"file": "lden2022_class.tif", "offset": 0},
    "berlin": {"file": "lden2022_class.tif", "offset": 3},
    "munich": {"file": "lden2022_class.tif", "offset": 3},
}


def from_classes(city, cfg):
    src_path = DATA / "work" / city / "noise" / cfg["file"]
    check(src_path.exists(), f"{src_path} missing — run the fetch stage first")
    with rasterio.open(src_path) as src:
        cls = src.read(1)
        profile = src.profile
    db = np.zeros_like(cls, dtype=np.uint8)
    hit = cls > 0
    db[hit] = (35 + 5 * (cls[hit].astype(np.int16) + cfg["offset"])).astype(np.uint8)
    profile.update(dtype="uint8", count=1, compress="deflate", nodata=0)
    return db, profile


def from_db_tiles(city):
    """London: 744 GeoTIFFs that already carry dB. Large negative values are
    the nodata fill, not a basement — the Thames reads -3.4e38 there."""
    tiles = sorted((DATA / "input" / city / "noise").glob("*.tif"))
    check(len(tiles) > 100, f"only {len(tiles)} tiles in input/{city}/noise")
    srcs = [rasterio.open(t) for t in tiles]
    arr, transform = merge(srcs, nodata=0, method="max")
    profile = srcs[0].profile
    for s in srcs:
        s.close()
    a = arr[0]
    a = np.where(np.isfinite(a) & (a > 30) & (a < 120), np.round(a), 0)
    profile.update(dtype="uint8", count=1, height=a.shape[0], width=a.shape[1],
                   transform=transform, compress="deflate", nodata=0)
    return a.astype(np.uint8), profile


def from_polygons(city):
    """Paris: isophone polygons, EPSG:2154. The `legende` attribute is already
    the band's lower edge in dB (55/60/65/70/75) — the same convention this
    script uses — so it rasterises straight across.

    Take type A (`_A_`), the isophone bands. Type C (`_C_`) is the
    exceedance map: a single 68 dB threshold for roads, which would collapse
    the whole city to loud/not-loud. Take source R (route); SNCF and RATP are
    rail and metro.
    """
    import geopandas as gpd
    from rasterio.features import rasterize
    from rasterio.transform import from_origin

    zips = sorted((DATA / "input" / city / "noise").glob("*.zip"))
    check(len(zips) == 1, f"expected one archive in input/{city}/noise, found {len(zips)}")
    with zipfile.ZipFile(zips[0]) as z:
        names = [n for n in z.namelist() if n.endswith("_R_A_LD_S_075.shp")]
        check(len(names) == 1, f"road Lden type-A layer not found in {zips[0].name}")
        tmp = DATA / "work" / city / "noise" / "_shp"
        tmp.mkdir(parents=True, exist_ok=True)
        stem = names[0][:-4]
        for ext in (".shp", ".shx", ".dbf", ".prj", ".cpg"):
            try:
                z.extract(stem + ext, tmp)
            except KeyError:
                pass
        shp = tmp / (stem + ".shp")

    g = gpd.read_file(shp)
    g = g[g["legende"].astype(str).str.isdigit()]
    g["db"] = g["legende"].astype(int)
    g = g[g.db >= 40]
    check(len(g) > 1000, f"only {len(g)} isophone polygons")

    RES = 2.0
    minx, miny, maxx, maxy = g.total_bounds
    minx, miny = np.floor(minx / RES) * RES, np.floor(miny / RES) * RES
    maxx, maxy = np.ceil(maxx / RES) * RES, np.ceil(maxy / RES) * RES
    w, h = int((maxx - minx) / RES), int((maxy - miny) / RES)
    transform = from_origin(minx, maxy, RES, RES)
    # loudest last: a quiet band's polygon overlaps the loud one inside it
    shapes = [(geom, int(db)) for db, geom in
              sorted(zip(g.db, g.geometry), key=lambda t: t[0])]
    arr = rasterize(shapes, out_shape=(h, w), transform=transform,
                    fill=0, dtype="uint8")
    profile = {"driver": "GTiff", "height": h, "width": w, "count": 1,
               "dtype": "uint8", "crs": g.crs, "transform": transform,
               "compress": "deflate", "nodata": 0}
    return arr, profile


# NYC and SF have no city noise map — the EU directive that produces every
# other source here has no US counterpart. The national fallback is BTS/Volpe
# road noise: 30 m, ESRI:102039, LAeq 24h, one raster per state, with a hard
# 45 dB floor below which nothing is modelled.
#
# Two caveats that must not be forgotten downstream. The metric is LAeq 24h,
# NOT Lden: it has no evening or night penalty, so a US "quiet" is not a
# European one and the numbers are not comparable across the Atlantic. And
# BTS state plainly that it is for national trend tracking and "should not be
# used to evaluate noise levels in individual locations" — which is exactly
# what a router does. It is the honest best available, not an equal.
US_SOURCES = {
    # UTM 18N, matching cities.py — EPSG:2263 is in US survey feet, and a
    # noise raster in a different CRS from the graph samples as pure nodata:
    # NYC scored 100% class A, every edge "quiet", and passed both sanity
    # checks because an all-quiet city is not obviously broken (2026-09-01).
    "nyc": {"state": "NY", "crs": "EPSG:26918",
            "bounds_wgs": (-74.26, 40.49, -73.70, 40.92)},
    "sf": {"state": "CA", "crs": "EPSG:26910",
           "bounds_wgs": (-122.53, 37.70, -122.34, 37.84)},
}


def from_conus(city, cfg):
    import zipfile as _zip
    from pyproj import Transformer
    from rasterio.warp import calculate_default_transform, reproject, Resampling
    from rasterio.windows import from_bounds

    zpath = DATA / "input" / "us" / "noise" / "CONUS_road_noise_2022.zip"
    check(zpath.exists(), f"{zpath} missing — road-only CONUS build, not the "
                          "rail+road+aviation one (flight paths are not a walk)")
    with _zip.ZipFile(zpath) as f:
        gdb = sorted({n.split(".gdb/")[0] + ".gdb" for n in f.namelist() if ".gdb/" in n})[0]
    sub = f'OpenFileGDB:"/vsizip/{zpath.as_posix()}/{gdb}":{cfg["state"]}_road_noise'

    t = Transformer.from_crs(4326, "ESRI:102039", always_xy=True)
    w, s_, e, n = cfg["bounds_wgs"]
    xs, ys = zip(*[t.transform(x, y) for x in (w, e) for y in (s_, n)])
    pad = 2000
    with rasterio.open(sub) as src:
        win = from_bounds(min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad,
                          src.transform)
        a = src.read(1, window=win)
        wt = src.window_transform(win)
        src_crs = src.crs
    a = np.where(np.isfinite(a) & (a > 30) & (a < 120), a, 0).astype("float32")

    dst_crs = cfg["crs"]
    dt, dw, dh = calculate_default_transform(src_crs, dst_crs, a.shape[1], a.shape[0],
                                             *rasterio.transform.array_bounds(
                                                 a.shape[0], a.shape[1], wt))
    out = np.zeros((dh, dw), dtype="float32")
    reproject(a, out, src_transform=wt, src_crs=src_crs,
              dst_transform=dt, dst_crs=dst_crs, resampling=Resampling.bilinear,
              src_nodata=0, dst_nodata=0)
    db = np.where(out > 0, np.round(out), 0).astype("uint8")
    profile = {"driver": "GTiff", "height": dh, "width": dw, "count": 1,
               "dtype": "uint8", "crs": dst_crs, "transform": dt,
               "compress": "deflate", "nodata": 0}
    return db, profile


# Hamburg ships neither a raster nor isophone polygons: 101,020 RECEPTOR
# POINTS with a class each, encoded as degenerate micro-polygons inside a
# 63 MB GML, from the 2012 round. The 2022 round exists but its WFS host
# (geodienste-hamburg.de) no longer resolves and there is no bulk file.
#
# Points cannot rasterise directly — they would give isolated pixels rather
# than a field — so each point covers a disc and overlaps take the max. The
# radius is a judgement call: points sit roughly 114 m apart on average, so
# 30 m keeps a street's own level local without smearing it across blocks.
# This is the weakest noise source of the eight; treat Hamburg's numbers as
# coarser than the rest.
HH_RADIUS_M = 30.0
HH_RES = 2.0


def from_points(city):
    import re

    zips = sorted((DATA / "input" / city / "noise").glob("*.zip"))
    check(len(zips) == 1, f"expected one archive in input/{city}/noise")
    with zipfile.ZipFile(zips[0]) as z:
        name = next(n for n in z.namelist() if "LDen" in n and n.endswith(".gml"))
        raw = z.read(name).decode("utf-8", errors="replace")

    kre = re.compile(r"<fme:Klasse>(\d+)</fme:Klasse>")
    pre = re.compile(r"<gml:posList>([-\d.]+) ([-\d.]+)")
    cur, pts = None, []
    for line in raw.splitlines():
        m = kre.search(line)
        if m:
            cur = int(m.group(1)); continue
        m = pre.search(line)
        if m and cur is not None:
            pts.append((float(m.group(1)), float(m.group(2)), cur))
    check(len(pts) > 50_000, f"only {len(pts)} points parsed from {name}")

    xs = np.fromiter((p[0] for p in pts), float, len(pts))
    ys = np.fromiter((p[1] for p in pts), float, len(pts))
    cs = np.fromiter((p[2] for p in pts), np.int16, len(pts))
    # same 5-band scheme as Berlin/Munich: class 1 = 55-60 dB
    db_pt = (35 + 5 * (cs + 3)).astype(np.uint8)

    pad = HH_RADIUS_M + HH_RES
    minx, maxx = xs.min() - pad, xs.max() + pad
    miny, maxy = ys.min() - pad, ys.max() + pad
    w = int((maxx - minx) / HH_RES) + 1
    h = int((maxy - miny) / HH_RES) + 1
    arr = np.zeros((h, w), dtype=np.uint8)

    r = int(HH_RADIUS_M / HH_RES)
    dy, dx = np.ogrid[-r:r + 1, -r:r + 1]
    disc = (dx * dx + dy * dy) <= r * r
    col = ((xs - minx) / HH_RES).astype(int)
    row = ((maxy - ys) / HH_RES).astype(int)
    for c0, r0, v in zip(col, row, db_pt):
        y0, y1 = max(0, r0 - r), min(h, r0 + r + 1)
        x0, x1 = max(0, c0 - r), min(w, c0 + r + 1)
        sub = arr[y0:y1, x0:x1]
        d = disc[y0 - (r0 - r):y1 - (r0 - r), x0 - (c0 - r):x1 - (c0 - r)]
        np.maximum(sub, np.where(d, v, 0), out=sub)

    from rasterio.transform import from_origin
    profile = {"driver": "GTiff", "height": h, "width": w, "count": 1,
               "dtype": "uint8", "crs": "EPSG:25832",
               "transform": from_origin(minx, maxy, HH_RES, HH_RES),
               "compress": "deflate", "nodata": 0}
    return arr, profile


def main():
    city = (sys.argv[1] if len(sys.argv) > 1 else "").lower()
    check(city in set(CLASS_SOURCES) | set(US_SOURCES) | {"london", "paris", "hamburg"},
          "usage: prep_noise_db.py frankfurt|berlin|munich|london|paris|nyc|sf|hamburg")
    if city in US_SOURCES:
        db, profile = from_conus(city, US_SOURCES[city])
    elif city == "hamburg":
        db, profile = from_points(city)
    elif city == "london":
        db, profile = from_db_tiles(city)
    elif city == "paris":
        db, profile = from_polygons(city)
    else:
        db, profile = from_classes(city, CLASS_SOURCES[city])

    mapped = db > 0
    share = float(mapped.mean())
    check(0.005 < share < 0.95, f"{share:.1%} of pixels mapped — source wrong?")
    lo, hi = int(db[mapped].min()), int(db[mapped].max())
    check(35 <= lo <= 60 and 65 <= hi <= 110, f"dB range {lo}-{hi} implausible")
    if city in US_SOURCES:
        print("  NOTE: LAeq 24h, not Lden — no evening/night penalty, and BTS "
              "say it is not for individual locations")

    out = DATA / "work" / city / "noise" / "lden_db.tif"
    out.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out, "w", **profile) as d:
        d.write(db, 1)
    print(f"OK: {out} — {db.shape[1]}x{db.shape[0]}, {share:.1%} mapped, "
          f"{lo}-{hi} dB, median {int(np.median(db[mapped]))}")


if __name__ == "__main__":
    main()
