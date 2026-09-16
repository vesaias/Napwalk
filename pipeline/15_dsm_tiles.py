"""W7: DSM -> Terrarium PNG tiles for client-side shadow computation.

The 1 m city DSM (EPSG:25832) is reprojected to EPSG:3857 and cut into
512-px XYZ tiles, zoom 12..16 (z16 @ 512 px ~ 0.77 m/px at 50.1 N — the
DSM's native detail; lower zooms are MAX-pooled so buildings keep casting
shadows at city zoom). Encoding = Mapbox/Tilezen Terrarium:
h = R*256 + G + B/256 - 32768, quantised to 0.25 m (B in {0,64,128,192})
so the PNGs compress. Nodata (-9999) is filled with the DSM's 1st
percentile (ground level at the city edge).

Output data/output/dsm_tiles/{z}/{x}/{y}.png; sync copies to
web/public/dsm_tiles. Idempotent (overwrites). Sanity: tile count, decode
round trip of one tile within 0.25 m, byte total.
"""
import math
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.warp import Resampling, calculate_default_transform, reproject

from common import CITY, OUT, WORK, check

SRC = WORK / "dsm" / "city_dsm_1m.tif"
OUT = OUT / "tiles" / CITY / "dsm"  # per city since 2026-09-01; served as /tiles/<city>/dsm/{z}/{x}/{y}.webp
TILE = 512
ZOOMS = range(12, 17)
ONLY_ZOOMS = None  # e.g. range(12, 16) to redo the coarse levels only
R = 20037508.342789244


def tile_bounds(z, x, y):
    size = 2 * R / (2 ** z)
    return (-R + x * size, R - (y + 1) * size, -R + (x + 1) * size, R - y * size)


def encode(h):
    """Terrarium RGB, 0.25 m quantised."""
    v = np.round((h + 32768.0) * 4.0) / 4.0
    v = np.clip(v, 0, 65535.75)
    r = np.floor(v / 256.0)
    g = np.floor(v - r * 256.0)
    b = np.round((v - r * 256.0 - g) * 256.0)
    return np.dstack([r, g, b]).astype(np.uint8)


def decode(rgb):
    a = rgb.astype(np.float64)
    return a[..., 0] * 256.0 + a[..., 1] + a[..., 2] / 256.0 - 32768.0


def main():
    if ONLY_ZOOMS is None and OUT.exists():
        import shutil
        shutil.rmtree(OUT)  # a full render owns the directory: no stale tiles from a wider DSM
    OUT.mkdir(parents=True, exist_ok=True)
    src = rasterio.open(SRC)
    # ground level for nodata: 1st percentile of a coarse sample
    samp = src.read(1, out_shape=(1, 2000, 2000))
    fill = float(np.percentile(samp[samp != src.nodata], 1))
    # ground elevation, not Frankfurt's ground elevation: SF and NYC sit at
    # sea level, Munich at ~520 m (the 50-200 band was Frankfurt's, 2026-09-01)
    check(-50 < fill < 1100, f"DSM fill {fill:.0f} m implausible")  # Hamburg's port reads -12
    # tile range from the DSM's mercator bounds
    tf, w, h = calculate_default_transform(src.crs, "EPSG:3857", src.width, src.height, *src.bounds)
    minx, maxy = tf.c, tf.f
    maxx, miny = minx + tf.a * w, maxy + tf.e * h
    n_files, n_bytes = 0, 0
    sample = None
    for zoom in (ONLY_ZOOMS or ZOOMS):
        size = 2 * R / (2 ** zoom)
        res = size / TILE
        x0, x1 = int((minx + R) // size), int((maxx + R) // size)
        y0, y1 = int((R - maxy) // size), int((R - miny) // size)
        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                b = tile_bounds(zoom, tx, ty)
                dst_tf = rasterio.transform.from_origin(b[0], b[3], res, res)
                tile = np.full((TILE, TILE), np.nan, dtype=np.float32)
                reproject(rasterio.band(src, 1), tile, dst_transform=dst_tf, dst_crs="EPSG:3857",
                          # MAX below native: a 6-12 m cell keeps its tallest thing,
                          # so buildings still cast shadows at city zoom (average
                          # blended them into the ground -> no shadows zoomed out)
                          resampling=Resampling.max if zoom < 16 else Resampling.bilinear,
                          src_nodata=src.nodata, dst_nodata=np.nan, init_dest_nodata=True)
                if np.isnan(tile).all():
                    continue  # outside the clipped DSM: the client fills missing tiles with ground
                tile[np.isnan(tile)] = fill
                d = OUT / str(zoom) / str(tx)
                d.mkdir(parents=True, exist_ok=True)
                p = d / f"{ty}.webp"
                # 1 m steps + WebP lossless: 37 % of the 0.25 m PNG (measured
                # 2026-09-05); shadows do not see a quarter metre
                Image.fromarray(encode(np.round(tile)), "RGB").save(p, "WEBP", lossless=True, quality=100, method=4)
                n_files += 1
                n_bytes += p.stat().st_size
                if sample is None and (tile.max() - tile.min()) > 30:
                    sample = (p, tile)
        print(f"z{zoom}: {n_files} files so far, {n_bytes / 1e6:.0f} MB", flush=True)
    src.close()
    check(n_files > 100, f"only {n_files} tiles")  # was 1000: clipped SF renders ~700
    p, tile = sample
    back = decode(np.asarray(Image.open(p).convert("RGB")))
    err = float(np.abs(back - np.round(tile)).max())
    check(err <= 0.13, f"round trip error {err:.3f} m")
    print(f"OK: {n_files} tiles, {n_bytes / 1e6:.0f} MB, round-trip max err {err:.3f} m")


if __name__ == "__main__":
    main()
