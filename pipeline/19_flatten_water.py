"""Flatten water bodies in the working DSM to their bank level.

Hamburg's DOM merges the port authority's soundings into the surface model:
every river and lake is a 10-30 m trench with a noisy floor (Elbe fairway
-20 to -33 m, Alster -13; area-weighted sigma 8.4 m inside water polygons,
2026-09-02). Banks then cast shadows "into" the water at every sun angle
and the floor noise adds speckle. NYC (sparse returns, sigma 3.9) and Paris
(3.4) have milder versions; Berlin, London and Munich are flat already.

Per OSM natural=water polygon over 2 ha: the level is the 10th percentile
of the DSM in a 2-8 m ring outside the polygon (the lowest shore — a quay
is higher than the water, a beach is at it); every cell inside, nodata
included, becomes that level — except under bridges (bridge=yes ways
buffered to their width), whose decks carry sidewalks and must keep their
height. In place, strip-wise, tagged FLAT_WATER for idempotency. Runs after
18 (smaller raster) and before 10.
"""
import numpy as np
import geopandas as gpd
import osmnx as ox
import rasterio
from rasterio.features import rasterize
from rasterio.windows import Window, from_bounds
from shapely.geometry import box
from shapely.ops import unary_union

from common import CRS_UTM, WORK, check, configure_osmnx, place_polygon

MIN_AREA_M2 = 20_000
RING_IN, RING_OUT = 2.0, 8.0
STRIP = 2048
WATER = WORK / "osm" / "water.gpkg"
BRIDGES = WORK / "osm" / "bridges.gpkg"


def fetch():
    if not WATER.exists():
        w = ox.features_from_polygon(place_polygon(), {"natural": "water"})
        w = w[w.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].to_crs(CRS_UTM)
        w = w[w.geometry.area > MIN_AREA_M2][["geometry"]].reset_index(drop=True)
        w.to_file(WATER, driver="GPKG")
    if not BRIDGES.exists():
        try:
            b = ox.features_from_polygon(place_polygon(), {"bridge": True}).to_crs(CRS_UTM)
            width = b["width"].apply(lambda v: float(str(v).split()[0]) if str(v).replace(".", "", 1).isdigit() else np.nan) if "width" in b else None
            geoms = []
            for i, g in enumerate(b.geometry):
                if g.geom_type in ("LineString", "MultiLineString"):
                    w = width.iloc[i] if width is not None and np.isfinite(width.iloc[i]) else 10.0
                    geoms.append(g.buffer(max(w, 6.0) / 2 + 2.0))
                elif g.geom_type in ("Polygon", "MultiPolygon"):
                    geoms.append(g.buffer(2.0))
            b = gpd.GeoDataFrame(geometry=geoms, crs=CRS_UTM)
        except Exception as e:  # noqa: BLE001 — bridges are a refinement, water is the fix
            print(f"WARN: bridge fetch failed ({e}); flattening under bridges too")
            b = gpd.GeoDataFrame(geometry=[], crs=CRS_UTM)
        b.to_file(BRIDGES, driver="GPKG")
    return gpd.read_file(WATER), gpd.read_file(BRIDGES)


def window_for(src, bounds):
    b = box(*bounds).intersection(box(*src.bounds))
    if b.is_empty:
        return None
    return from_bounds(*b.bounds, src.transform).round_offsets().round_lengths()


def bank_level(src, geom):
    ring = geom.buffer(RING_OUT).difference(geom.buffer(RING_IN))
    win = window_for(src, ring.bounds)
    if win is None or win.width < 1 or win.height < 1:
        return None
    vals = []
    for r0 in range(0, int(win.height), STRIP):
        sw = Window(win.col_off, win.row_off + r0, win.width, min(STRIP, int(win.height) - r0))
        a = src.read(1, window=sw)
        m = rasterize([ring], out_shape=a.shape, transform=src.window_transform(sw)) == 1
        v = a[m & (a != src.nodata)]
        if v.size:
            vals.append(v)
    if not vals:
        return None
    v = np.concatenate(vals)
    return float(np.percentile(v, 10)) if v.size > 200 else None


def main():
    configure_osmnx()
    ox.settings.doh_url_template = None
    water, bridges = fetch()
    check(len(water) > 0, "no water polygons over 2 ha — query broken?")
    path = WORK / "dsm" / "city_dsm_1m.tif"
    with rasterio.open(path) as src:
        if src.tags().get("FLAT_WATER"):
            print(f"{path.name}: water already flattened ({src.tags()['FLAT_WATER']}) — skipped")
            return
    keep = unary_union(list(bridges.geometry)) if len(bridges) else None
    total = flattened = 0
    done = []
    with rasterio.open(path, "r+") as src:
        total = src.width * src.height
        for geom in water.geometry.iloc[np.argsort(-water.geometry.area.to_numpy())]:
            level = bank_level(src, geom)
            if level is None:
                continue
            flat = geom.difference(keep) if keep is not None else geom
            if flat.is_empty:
                continue
            win = window_for(src, flat.bounds)
            if win is None or win.width < 1 or win.height < 1:
                continue
            n = 0
            for r0 in range(0, int(win.height), STRIP):
                sw = Window(win.col_off, win.row_off + r0, win.width, min(STRIP, int(win.height) - r0))
                a = src.read(1, window=sw)
                m = rasterize([flat], out_shape=a.shape, transform=src.window_transform(sw)) == 1
                if not m.any():
                    continue
                a[m] = level
                src.write(a, 1, window=sw)
                n += int(m.sum())
            flattened += n
            done.append((geom.area, level, n))
        src.update_tags(FLAT_WATER=f"{len(done)} bodies, {flattened} cells")
    share = flattened / total
    check(0 < share < 0.4, f"flattened {share:.0%} of the raster — water mask implausible")
    # the DSM changed under every riverside edge: 10_sun_shade skips when its
    # outputs exist, so they must go (a stale-shade rerun cost an hour, 2026-09-02)
    for stale in (WORK / "shade").glob("edge_shade*.npy"):
        stale.unlink()
        print(f"removed {stale.name} — rerun 10_sun_shade")
    levels = np.array([d[1] for d in done])
    print(f"OK: {len(done)} of {len(water)} water bodies flattened, {flattened / 1e6:.1f} M cells ({share:.1%}); "
          f"levels p5 {np.percentile(levels, 5):.1f} med {np.median(levels):.1f} p95 {np.percentile(levels, 95):.1f} m; "
          f"{len(bridges)} bridge footprints kept")
    for area, level, n in sorted(done, reverse=True)[:5]:
        print(f"  {area / 1e6:6.2f} km2 -> {level:7.1f} m ({n / 1e6:.2f} M cells)")


if __name__ == "__main__":
    main()
