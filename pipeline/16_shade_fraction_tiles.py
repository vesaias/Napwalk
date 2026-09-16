"""W7: shaded-FRACTION tiles for the far zooms (z10-13).

Zoomed out, a coarse DSM cannot cast shadows (a 6-12 m cell has no street
left between buildings), but the pipeline already computes exact 1 m
shadow masks for all 48 buckets (08:00-20:00, 15 min). Here each mask is
block-averaged to a 16 m shaded fraction and cut into 256-px XYZ tiles
(EPSG:3857, z10..13; alpha = fraction, black) ->
data/output/shade_frac/{bucket}/{z}/{x}/{y}.png. The client shows these
below zoom 13.5 and the live GPU shadows above. Sun geometry = the 15th of
the current month (same as 10_sun_shade). Idempotent; ~10 min.
"""
import datetime as dt
import importlib.util
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_origin
from rasterio.warp import Resampling, calculate_default_transform, reproject

from common import OUT, WORK, check

_spec = importlib.util.spec_from_file_location("sun10", Path(__file__).with_name("10_sun_shade.py"))
sun10 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sun10)

OUT = OUT / "shade_frac"
BLOCK = 64          # metres per fraction cell — neighbourhood scale, soft; 16 m read as grain at z13 (2026-08-16)
ZOOMS = range(10, 14)
TILE = 256
R = 20037508.342789244


def tile_bounds(z, x, y):
    size = 2 * R / (2 ** z)
    return (-R + x * size, R - (y + 1) * size, -R + (x + 1) * size, R - y * size)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    today = dt.date.today()
    pos = sun10.sun_positions(today.year, today.month)
    with rasterio.open(WORK / "dsm" / "city_dsm_1m.tif") as src:
        z = src.read(1)
        crs, tf = src.crs, src.transform
        left, bottom, right, top = src.bounds
    nod = z == -9999
    z[nod] = float(np.percentile(z[~nod], 1))
    H, W = z.shape
    hb, wb = H // BLOCK, W // BLOCK
    frac_tf = from_origin(tf.c, tf.f, BLOCK * tf.a, BLOCK * tf.a)
    # mercator tile range covering the DSM
    mtf, mw, mh = calculate_default_transform(crs, "EPSG:3857", W, H, left, bottom, right, top)
    minx, maxy = mtf.c, mtf.f
    maxx, miny = minx + mtf.a * mw, maxy + mtf.e * mh
    n_files = 0
    for i, (az, el) in enumerate(pos):
        mask = sun10.shadow_mask(z, 1.0, az, el)
        frac = mask[: hb * BLOCK, : wb * BLOCK].reshape(hb, BLOCK, wb, BLOCK).mean(axis=(1, 3)).astype(np.float32)
        for zoom in ZOOMS:
            size = 2 * R / (2 ** zoom)
            res = size / TILE
            x0, x1 = int((minx + R) // size), int((maxx + R) // size)
            y0, y1 = int((R - maxy) // size), int((R - miny) // size)
            for tx in range(x0, x1 + 1):
                for ty in range(y0, y1 + 1):
                    b = tile_bounds(zoom, tx, ty)
                    dst = np.zeros((TILE, TILE), dtype=np.float32)
                    reproject(frac, dst, src_transform=frac_tf, src_crs=crs,
                              dst_transform=from_origin(b[0], b[3], res, res), dst_crs="EPSG:3857",
                              resampling=Resampling.average if res > BLOCK else Resampling.bilinear,
                              src_nodata=None, dst_nodata=0.0, init_dest_nodata=True)
                    if dst.max() <= 0:
                        continue
                    rgba = np.zeros((TILE, TILE, 4), dtype=np.uint8)
                    rgba[..., 3] = np.round(np.clip(dst, 0, 1) * 255).astype(np.uint8)
                    d = OUT / str(i) / str(zoom) / str(tx)
                    d.mkdir(parents=True, exist_ok=True)
                    Image.fromarray(rgba, "RGBA").save(d / f"{ty}.png", optimize=True)
                    n_files += 1
        print(f"bucket {i:2d} az={az:5.1f} el={el:4.1f} city shade={mask.mean():.1%} files={n_files}", flush=True)
    check(n_files > 500, f"only {n_files} tiles")
    print(f"OK: {n_files} fraction tiles in {OUT}")


if __name__ == "__main__":
    main()
