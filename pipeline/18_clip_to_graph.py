"""Clip the working DSM and noise rasters to the graph's footprint + buffer.

The DSM mosaics cover each portal's delivery box — 42-68 % of every box is
ground the router never sees (measured 2026-09-01, DECISIONS). Everything
downstream (10_sun_shade, 15_dsm_tiles, 17_render_noise) inherits the
smaller extent, which halves stage-10 time and the overlay tile count.

Buffer: a building outside the clip still casts shadow inside it. At the
lowest buckets (el < 10) shadows reach kilometres, but there ~90 % of edges
are shaded anyway; at el = 10 a 350 m tower — taller than anything in the
eight cities — reaches 350/tan(10) = 1985 m. BUFFER_M = 2000 accepts that
sub-10-degree rim error and keeps roughly half of every box.

Runs after 06 (needs scored edges for the hull), before 10. Idempotent: a
clipped raster carries a CLIPPED_TO_GRAPH tag and is skipped (a bbox test
skipped Frankfurt entirely — its delivery box IS the hull bbox, but 26 %
of the interior was still maskable).
In place and lossy on disk: re-extending bounds later means re-running
prep_dsm/prep_noise_db from data/input.
"""
import numpy as np
import pyogrio
import rasterio
from rasterio.features import geometry_mask
from rasterio.windows import Window, from_bounds as win_from_bounds
from shapely import concave_hull
from shapely.geometry import MultiPoint

from common import WORK, check

BUFFER_M = 2000.0
STRIP = 2048  # rows per write block


def graph_hull():
    g = pyogrio.read_dataframe(WORK / "scored" / "edges_scored.gpkg", columns=["eid"], read_geometry=True)
    mids = g.geometry.interpolate(0.5, normalized=True)
    step = max(1, len(mids) // 40000)
    hull = concave_hull(MultiPoint([(p.x, p.y) for p in mids[::step]]), ratio=0.08)
    check(hull.area > 5e7, f"graph hull {hull.area / 1e6:.0f} km2 implausible")
    return hull.buffer(BUFFER_M)


def clip(path, hull):
    with rasterio.open(path) as src:
        hb = hull.bounds
        tagged = src.tags().get("CLIPPED_TO_GRAPH")
        try:
            tagged_area = float(tagged) if tagged else None
        except ValueError:
            tagged_area = None  # "v1" tag from the first run: area unknown, re-clip (a subset is safe)
        if tagged_area is not None and tagged_area <= hull.area * 1.05:
            print(f"{path.name}: already clipped to this hull — skipped")
            return  # a SMALLER hull (London's Inner-London clip) re-clips
        # crop window = raster ∩ hull bbox, snapped to whole pixels
        w = win_from_bounds(max(hb[0], src.bounds.left), max(hb[1], src.bounds.bottom),
                            min(hb[2], src.bounds.right), min(hb[3], src.bounds.top),
                            src.transform).round_offsets().round_lengths()
        tf = src.window_transform(w)
        nodata = src.nodata if src.nodata is not None else 0
        prof = src.profile | {"width": int(w.width), "height": int(w.height), "transform": tf,
                              "tiled": True, "blockxsize": 512, "blockysize": 512,
                              "compress": "deflate", "predictor": 2, "nodata": nodata}
        tmp = path.with_suffix(".clip.tif")
        kept = total = 0
        with rasterio.open(tmp, "w", **prof) as dst:
            dst.update_tags(CLIPPED_TO_GRAPH=f"{hull.area:.0f}")  # hull area m2: re-clip if it shrinks
            for r0 in range(0, int(w.height), STRIP):
                rows = min(STRIP, int(w.height) - r0)
                sw = Window(w.col_off, w.row_off + r0, w.width, rows)
                a = src.read(1, window=sw)
                stf = src.window_transform(sw)
                outside = geometry_mask([hull], out_shape=a.shape, transform=stf)  # True = outside
                a[outside] = nodata
                kept += int((~outside).sum()); total += a.size
                dst.write(a, 1, window=Window(0, r0, w.width, rows))
    check(kept / total > 0.25, f"{path.name}: hull keeps only {kept / total:.0%} of the crop")
    print(f"{path.name}: {total / 1e6:.0f} -> kept {kept / total:.0%} of crop, "
          f"{path.stat().st_size / 1e9:.2f} GB -> {tmp.stat().st_size / 1e9:.2f} GB")
    tmp.replace(path)


def main():
    hull = graph_hull()
    print(f"graph hull + {BUFFER_M:.0f} m = {hull.area / 1e6:.0f} km2")
    clip(WORK / "dsm" / "city_dsm_1m.tif", hull)
    clip(WORK / "noise" / "lden_db.tif", hull)
    print("OK")


if __name__ == "__main__":
    main()
