"""W7: noise overlay tiles from the normalised LDEN decibel raster.

Source lden_db.tif (uint8 dB, 0 = unmapped) since 2026-09-01 — the class
rasters are NOT comparable between cities (Frankfurt 8 classes from 40 dB,
Berlin 5 from 55); decibels are. dB maps onto the same palette scale as
Frankfurt's classes: class = (dB - 35) / 5, so 55-59 dB is class 4, exactly
the band the palette already colours.

Static XYZ PNG tiles, EPSG:3857, z11-16, 256 px. The source raster is
interpolated bilinearly and the palette blended between classes, so the
5 dB steps read as a smooth field, not blocks. Classes < 55 dB (1-3) are transparent — quiet is the
default state of the map; 55+ ramps yellow -> orange -> red -> dark red
(warm-to-magenta ramp, alpha rising with level).
Output data/output/noise_tiles/{z}/{x}/{y}.png (~6 MB). Idempotent.
"""
import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_origin
from rasterio.warp import Resampling, calculate_default_transform, reproject

from common import CITY, OUT, WORK, check

SRC = WORK / "noise" / "lden_db.tif"  # normalised decibels, 0 = unmapped (prep_noise_db)
OUT = OUT / "tiles" / CITY / "noise"  # per city since 2026-09-01
ZOOMS = range(11, 17)
R = 20037508.342789244
# class -> RGBA (0 = no data, 1-3 = < 55 dB: transparent). Warm-to-magenta
# ramp with alpha rising by level: quiet-ish streets whisper, loud ones
# shout; the hues stay clear of the paper basemap's park green / water blue
PALETTE = np.zeros((9, 4), dtype=np.float32)
PALETTE[3] = (255, 214, 130, 0)     # 50-54: the ramp fades in from transparent
PALETTE[4] = (255, 214, 130, 40)    # 55-59
PALETTE[5] = (250, 170, 90, 60)     # 60-64
PALETTE[6] = (236, 112, 78, 80)     # 65-69
PALETTE[7] = (205, 70, 95, 95)      # 70-74
PALETTE[8] = (150, 45, 110, 110)    # >= 75


def merc_tile_bounds(z, x, y):
    size = 2 * R / (2 ** z)
    return (-R + x * size, R - (y + 1) * size, -R + (x + 1) * size, R - y * size)


def colorize(v):
    """Continuous class value (1..8, float) -> RGBA, palette blended
    between classes so 5 dB steps do not show as hard edges."""
    v = np.clip(v, 1.0, 8.0)
    c0 = np.floor(v).astype(int)
    c1 = np.minimum(c0 + 1, 8)
    f = (v - c0)[..., None]
    rgba = PALETTE[c0] * (1 - f) + PALETTE[c1] * f
    return np.round(rgba).astype(np.uint8)


def main():
    if OUT.exists():
        import shutil
        shutil.rmtree(OUT)  # a render owns its directory: London's Greater-London tiles outlived the Inner clip (2026-09-05)
    with rasterio.open(SRC) as src:
        db = src.read(1).astype(np.float32)
        mapped = db > 0
        check(mapped.any(), "lden_db.tif is empty")
        cls = np.clip((db - 35.0) / 5.0, 1.0, 8.0)
        # degenerate guard over the MAPPED area only: SF's raster covers 4 %
        # of its box, and a box-wide mean would always fail there
        check((cls[mapped] >= 4).mean() > 0.2,
              f"only {(cls[mapped] >= 4).mean():.0%} of mapped cells >= 55 dB — normalisation broken?")
        cls[~mapped] = 1.0  # unmapped -> quiet (transparent)
        # the service raster is a 10 m grid exported at 2 m: average back to
        # 10 m, then upsample bilinearly so the 10 m steps become ramps
        t10, w10, h10 = calculate_default_transform(src.crs, "EPSG:3857", src.width, src.height, *src.bounds,
                                                    resolution=(10.0, 10.0))
        a10 = np.ones((h10, w10), dtype=np.float32)
        reproject(cls, a10, src_transform=src.transform, src_crs=src.crs,
                  dst_transform=t10, dst_crs="EPSG:3857", resampling=Resampling.average,
                  src_nodata=None, dst_nodata=1.0, init_dest_nodata=True)
        # 3x3 mean at 10 m (~30 m kernel): class jumps between neighbouring
        # cells become gradients instead of softened block edges
        pad = np.pad(a10, 1, mode="edge")
        a10 = sum(pad[i:i + h10, j:j + w10] for i in range(3) for j in range(3)) / 9.0
        transform, w, h = calculate_default_transform(src.crs, "EPSG:3857", src.width, src.height, *src.bounds,
                                                      resolution=(2.5, 2.5))
        arr = np.ones((h, w), dtype=np.float32)
        reproject(a10, arr, src_transform=t10, src_crs="EPSG:3857",
                  dst_transform=transform, dst_crs="EPSG:3857", resampling=Resampling.bilinear,
                  src_nodata=None, dst_nodata=1.0, init_dest_nodata=True)
    minx, maxy = transform.c, transform.f
    maxx, miny = minx + transform.a * w, maxy - transform.a * h
    n_files, n_bytes = 0, 0
    for z in ZOOMS:
        size = 2 * R / (2 ** z)
        res = size / 256
        x0, x1 = int((minx + R) // size), int((maxx + R) // size)
        y0, y1 = int((R - maxy) // size), int((R - miny) // size)
        # one tile-aligned raster per zoom, then slice (per-tile reprojects
        # from the in-memory array were far too slow at z16)
        nx, ny = x1 - x0 + 1, y1 - y0 + 1
        zt = from_origin(-R + x0 * size, R - y0 * size, res, res)
        zr = np.ones((ny * 256, nx * 256), dtype=np.float32)
        reproject(arr, zr, src_transform=transform, src_crs="EPSG:3857",
                  dst_transform=zt, dst_crs="EPSG:3857",
                  resampling=Resampling.average if res > transform.a * 1.5 else Resampling.bilinear,
                  src_nodata=None, dst_nodata=1.0, init_dest_nodata=True)
        for i in range(nx):
            for j in range(ny):
                tile = zr[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256]
                if tile.max() < 3.05:
                    continue
                d = OUT / str(z) / str(x0 + i)
                d.mkdir(parents=True, exist_ok=True)
                p = d / f"{y0 + j}.webp"  # lossy is fine for a colour wash: 22 % of the PNG (2026-09-05)
                Image.fromarray(colorize(tile), "RGBA").save(p, "WEBP", quality=85, method=4)
                n_files += 1
                n_bytes += p.stat().st_size
        print(f"z{z}: {n_files} files, {n_bytes / 1e6:.1f} MB", flush=True)
    check(n_files > 500, f"only {n_files} noise tiles")
    print(f"OK: {n_files} noise tiles, {n_bytes / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
