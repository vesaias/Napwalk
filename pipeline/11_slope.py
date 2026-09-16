"""Accessibility: per-edge gradient from the Hesse DGM1 terrain model.

Mosaic the 1 m DGM1 tiles (data/input/frankfurt/dtm/*.tif, EPSG:25832, open data
from gds.hessen.de) into data/dgm/city_dtm_1m.tif once, then sample the
terrain along every scored edge and store, per edge, the signed gradient
in the edge's FORWARD direction (the reverse edge negates it):

  slope_mean  : (z_end - z_start) / length, in percent
  slope_max   : steepest 10 m window along the edge, signed, percent

Wheelchair/stroller rules (docs/accessibility-modes.md) key on slope_max;
the DSM cannot do this (roofs and trees), hence a separate terrain model.
Recomputed automatically when the edge count changes (cf. 10_sun_shade).
"""
import glob

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.merge import merge

from common import WORK, check

DGM = WORK / "dgm"
DTM = DGM / "city_dtm_1m.tif"
OUT = WORK / "terrain"
STEP_M = 5.0      # sample spacing along the edge
WINDOW_M = 10.0   # gradient window for slope_max


def build_mosaic():
    if DTM.exists():
        print(f"{DTM} exists, skipping mosaic")
        return
    tiles = sorted(glob.glob(str(DGM / "downloads" / "*.tif")))
    check(len(tiles) >= 50, f"only {len(tiles)} DGM1 tiles in {DGM / 'downloads'}")
    srcs = [rasterio.open(p) for p in tiles]
    check(all("25832" in str(s.crs) for s in srcs), "DGM1 tile CRS != EPSG:25832")
    nodata = srcs[0].nodata if srcs[0].nodata is not None else -9999
    mosaic, transform = merge(srcs, nodata=nodata)
    meta = srcs[0].meta | {"height": mosaic.shape[1], "width": mosaic.shape[2],
                           "transform": transform, "count": 1, "nodata": nodata,
                           "compress": "deflate", "tiled": True}
    for s in srcs:
        s.close()
    a = mosaic[0]
    valid = a[(a != nodata) & np.isfinite(a)]
    check(valid.size / a.size > 0.35, f"only {valid.size / a.size:.0%} valid DTM pixels")  # tiles follow the city outline, not a rectangle
    check(80 < np.percentile(valid, 1) < 150, "Frankfurt ground level implausible")
    check(np.percentile(valid, 99.9) < 300, "DTM max implausible — is this a surface model?")
    with rasterio.open(DTM, "w", **meta) as dst:
        dst.write(a, 1)
    print(f"mosaic: {DTM} {a.shape}, z p1={np.percentile(valid, 1):.0f} "
          f"p99={np.percentile(valid, 99):.0f} m")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    build_mosaic()
    edges = gpd.read_file(WORK / "scored" / "edges_scored.gpkg")
    edges = edges.sort_values("eid").reset_index(drop=True)
    n = len(edges)
    out_mean = OUT / "edge_slope_mean.npy"
    out_max = OUT / "edge_slope_max.npy"
    if out_mean.exists() and np.load(out_mean, mmap_mode="r").shape[0] == n:
        print(f"{out_mean} matches {n} edges, skipping")
        return
    with rasterio.open(DTM) as src:
        z = src.read(1)
        tr = src.transform
        nodata = src.nodata
    smean = np.zeros(n, dtype=np.float32)
    smax = np.zeros(n, dtype=np.float32)
    known = 0
    for i, geom in enumerate(edges.geometry):
        L = geom.length
        if L < 2.0:
            continue
        k = max(2, int(L / STEP_M) + 1)
        ds = np.linspace(0.0, L, k)
        zs = np.full(k, np.nan, dtype=np.float64)
        for j, d in enumerate(ds):
            p = geom.interpolate(d)
            c = int((p.x - tr.c) / tr.a)
            r = int((p.y - tr.f) / tr.e)
            if 0 <= r < z.shape[0] and 0 <= c < z.shape[1]:
                v = z[r, c]
                if v != nodata and np.isfinite(v):
                    zs[j] = v
        ok = np.isfinite(zs)
        if ok.sum() < 2:
            continue
        known += 1
        zi = np.interp(ds, ds[ok], zs[ok])
        smean[i] = (zi[-1] - zi[0]) / L * 100.0
        # steepest signed WINDOW_M stretch
        w = max(1, int(round(WINDOW_M / (L / (k - 1)))))
        if k - 1 > w:
            g = (zi[w:] - zi[:-w]) / (ds[w:] - ds[:-w]) * 100.0
        else:
            g = np.array([smean[i]])
        smax[i] = g[np.argmax(np.abs(g))]
    smean = np.clip(smean, -60, 60)
    smax = np.clip(smax, -60, 60)
    check(known / n > 0.9, f"terrain known for only {known / n:.0%} of edges")
    flat = (np.abs(smax) < 3).mean()
    check(0.3 < flat < 0.98, f"{flat:.0%} of edges under 3 % — DTM/edge mismatch?")
    np.save(out_mean, smean)
    np.save(out_max, smax)
    print(f"OK: slope for {n} edges ({known / n:.0%} known); |slope_max| "
          f"p50={np.percentile(np.abs(smax), 50):.1f}% p90={np.percentile(np.abs(smax), 90):.1f}% "
          f"p99={np.percentile(np.abs(smax), 99):.1f}%; >6%: {(np.abs(smax) > 6).mean():.1%} of edges")


if __name__ == "__main__":
    main()
