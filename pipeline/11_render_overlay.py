"""W3/P4e: render the four display-hour shadow rasters as XYZ overlay tiles.

Semi-transparent black PNGs (SPEC F8), EPSG:3857, z11-15. Crisp mode
(feedback 2026-08-14): nearest sampling straight from the 1 m mask, binary
alpha, no averaging or blur — shadows keep their hard true edges; low
zooms alias into speckle, which is accepted for now.
"""
import numpy as np
import rasterio
from PIL import Image
from rasterio.warp import Resampling, calculate_default_transform, reproject

from common import OUT, WORK, check

HOURS = {10: 8, 13: 20, 16: 32, 18: 40}
ZOOMS = range(11, 16)
ALPHA = 110
R = 20037508.342789244
OUT = OUT / "shade_tiles"


def merc_tile_bounds(z, x, y):
    size = 2 * R / (2 ** z)
    return (-R + x * size, R - (y + 1) * size, -R + (x + 1) * size, R - y * size)


def to_mercator(bucket):
    with rasterio.open(WORK / "shade" / f"shadow_b{bucket}.tif") as src:
        transform, w, h = calculate_default_transform(
            src.crs, "EPSG:3857", src.width, src.height, *src.bounds)
        dst = np.zeros((h, w), dtype=np.uint8)
        reproject(src.read(1) * 255, dst, src_transform=src.transform,
                  src_crs=src.crs, dst_transform=transform, dst_crs="EPSG:3857",
                  resampling=Resampling.nearest)
        return dst, transform


def main():
    n_files, n_bytes = 0, 0
    for hour, bucket in HOURS.items():
        arr, transform = to_mercator(bucket)
        base_res = transform.a
        minx, maxy = transform.c, transform.f
        maxx = minx + transform.a * arr.shape[1]
        miny = maxy + transform.e * arr.shape[0]
        for z in ZOOMS:
            size = 2 * R / (2 ** z)
            x0, x1 = int((minx + R) // size), int((maxx + R) // size)
            y0, y1 = int((R - maxy) // size), int((R - miny) // size)
            for tx in range(x0, x1 + 1):
                for ty in range(y0, y1 + 1):
                    b = merc_tile_bounds(z, tx, ty)
                    px = np.linspace(b[0], b[2], 256, endpoint=False)
                    py = np.linspace(b[3], b[1], 256, endpoint=False)
                    ci = ((px - minx) / base_res).astype(int)
                    ri = ((maxy - py) / base_res).astype(int)
                    ok_c = (ci >= 0) & (ci < arr.shape[1])
                    ok_r = (ri >= 0) & (ri < arr.shape[0])
                    if not (ok_c.any() and ok_r.any()):
                        continue
                    val = np.zeros((256, 256), dtype=np.uint8)
                    rows = np.clip(ri, 0, arr.shape[0] - 1)
                    cols = np.clip(ci, 0, arr.shape[1] - 1)
                    val[:] = arr[np.ix_(rows, cols)]
                    val[~ok_r, :] = 0
                    val[:, ~ok_c] = 0
                    mask = (val > 127).astype(np.uint8)
                    if not mask.any():
                        continue
                    img = Image.fromarray(mask, mode="P")
                    img.putpalette([0, 0, 30] * 2)
                    p = OUT / str(hour) / str(z) / str(tx)
                    p.mkdir(parents=True, exist_ok=True)
                    fpath = p / f"{ty}.png"
                    img.save(fpath, optimize=True, transparency=bytes([0, ALPHA]))
                    n_files += 1
                    n_bytes += fpath.stat().st_size
        print(f"hour {hour}: done ({n_files} tiles cumulative)")
    check(n_files > 100, f"only {n_files} tiles rendered")
    check(n_files < 15000, f"{n_files} tiles — too many for Pages")
    print(f"OK: {n_files} tiles, {n_bytes / 1e6:.1f} MB total")


if __name__ == "__main__":
    main()
