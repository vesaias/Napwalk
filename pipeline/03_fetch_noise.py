"""W1/P3 source: Hessen Umgebungslärm 2022 road LDEN raster, color-classified.

No WFS/download service exists for this data (HLNUG); the map service is the
endpoint. We export tiles and classify pixels against the legend palette.
Layer 130 = Straßenlärm PLUS / Lärmpegel LDEN (raster, EPSG:25832).
"""
import base64
import io
import json
import math

import geopandas as gpd
import numpy as np
import rasterio
import requests
from PIL import Image
from rasterio.transform import from_origin

from common import WORK, check

SERVICE = ("https://geodienste-umwelt.hessen.de/arcgis/rest/services/"
           "laerm/umgebungslaerm/MapServer")
LAYER = 130
RES = 2.0        # m per pixel
TILE_PX = 2048   # export tile size
OUT = WORK / "noise"


def classify(rgba, palette, tol=8):
    h, w, _ = rgba.shape
    out = np.zeros((h, w), dtype=np.uint8)
    opaque = rgba[:, :, 3] > 0
    for i, (r, g, b) in enumerate(palette, start=1):
        d = (abs(rgba[:, :, 0].astype(int) - r)
             + abs(rgba[:, :, 1].astype(int) - g)
             + abs(rgba[:, :, 2].astype(int) - b))
        out[np.where(opaque & (d <= tol) & (out == 0))] = i
    return out


def fetch_legend():
    r = requests.get(f"{SERVICE}/legend", params={"f": "json"}, timeout=60)
    r.raise_for_status()
    layers = [l for l in r.json()["layers"] if l["layerId"] == LAYER]
    check(len(layers) == 1, f"legend for layer {LAYER} not found")
    palette, labels = [], []
    for item in layers[0]["legend"]:
        img = Image.open(io.BytesIO(base64.b64decode(item["imageData"]))).convert("RGBA")
        a = np.asarray(img)
        px = a[a[:, :, 3] > 0]
        check(len(px) > 0, f"empty legend swatch {item['label']}")
        palette.append(tuple(int(v) for v in px[:, :3].mean(axis=0).round()))
        labels.append(item["label"])
    return palette, labels


def frankfurt_bounds():
    d = gpd.read_file(WORK / "osm" / "districts.gpkg")
    minx, miny, maxx, maxy = d.total_bounds
    pad = 500
    return (math.floor(minx - pad), math.floor(miny - pad),
            math.ceil(maxx + pad), math.ceil(maxy + pad))


def export_tile(bbox):
    r = requests.get(f"{SERVICE}/export", params={
        "bbox": ",".join(map(str, bbox)), "bboxSR": 25832, "imageSR": 25832,
        "size": f"{TILE_PX},{TILE_PX}", "format": "png32",
        "transparent": "true", "layers": f"show:{LAYER}", "f": "image",
    }, timeout=120)
    r.raise_for_status()
    return np.asarray(Image.open(io.BytesIO(r.content)).convert("RGBA"))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tif = OUT / "lden2022_class.tif"
    if tif.exists():
        print(f"{tif} exists, skipping (delete to refetch)")
        return
    palette, labels = fetch_legend()
    (OUT / "legend.json").write_text(json.dumps(
        {"labels": labels, "palette": palette,
         "note": "class 0 = below 55 dB / unmapped"}, indent=2))
    minx, miny, maxx, maxy = frankfurt_bounds()
    step = int(TILE_PX * RES)
    nx = math.ceil((maxx - minx) / step)
    ny = math.ceil((maxy - miny) / step)
    width, height = nx * TILE_PX, ny * TILE_PX
    grid = np.zeros((height, width), dtype=np.uint8)
    for iy in range(ny):
        for ix in range(nx):
            x0 = minx + ix * step
            y1 = maxy - iy * step
            rgba = export_tile((x0, y1 - step, x0 + step, y1))
            grid[iy * TILE_PX:(iy + 1) * TILE_PX,
                 ix * TILE_PX:(ix + 1) * TILE_PX] = classify(rgba, palette)
            print(f"tile {iy * nx + ix + 1}/{nx * ny}")
    # the 2022 PLUS mapping starts at 40 dB, so most of the city carries a
    # class; sanity is therefore "several classes, loud ones a minority"
    classified = (grid > 0).mean()
    counts = np.bincount(grid.ravel(), minlength=len(palette) + 1)
    check(0.1 < classified < 0.995,
          f"{classified:.1%} of pixels classified — palette or bbox wrong")
    check((counts[1:] > 0).sum() >= 4,
          f"only {(counts[1:] > 0).sum()} classes present — palette mismatch")
    # verified visually 2026-08-14: every street canyon maps 65+, so the loud
    # share is genuinely high; this bound only catches a collapsed palette
    loud = counts[6:].sum() / max(counts[1:].sum(), 1)  # >= 65 dB
    check(loud < 0.5, f"{loud:.1%} of classified pixels >= 65 dB — implausible")
    with rasterio.open(
            tif, "w", driver="GTiff", height=height, width=width, count=1,
            dtype="uint8", crs="EPSG:25832",
            transform=from_origin(minx, maxy, RES, RES),
            compress="deflate") as dst:
        dst.write(grid, 1)
    print(f"OK: {tif} {width}x{height}px, {classified:.1%} classified, "
          f"classes: {labels}")


if __name__ == "__main__":
    main()
