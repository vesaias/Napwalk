"""Road LDEN raster for cities whose noise map is an OGC WMS.

Frankfurt's source (03_fetch_noise.py) is an ArcGIS MapServer with a /legend
endpoint. Berlin and Munich publish the same kind of data as a plain OGC WMS
and offer no bulk download of the isophones, so the map service is again the
endpoint: export tiles and classify pixels against the standard palette.

    python pipeline/03b_fetch_noise_wms.py berlin
    python pipeline/03b_fetch_noise_wms.py munich

Output: data/<city>/noise/lden2022_class.tif (uint8 classes) + legend.json,
matching what 07_noise_cost.py already consumes for Frankfurt.

Re-running overwrites; there is no per-tile resume, so a failed run starts
over (Munich is ~40 tiles, Berlin ~120 — minutes, not hours).
"""
import io
import json
import math
import sys
from urllib.parse import urlencode

import numpy as np
import requests
from PIL import Image
from rasterio.transform import from_origin

from common import DATA, check

# Verified 2026-08-30 by fetching a tile and the legend from each service.
# Berlin: STYLES= is mandatory and WMS 1.1.1 is refused outright; 1.3.0 works.
# Munich: `aggroadlden2022` is road noise inside the agglomeration, which is
# the whole of the city. `aggmroadlden2022` is the major-road subset and
# `hauptverkehrsstrassen` a separate service for roads OUTSIDE agglomerations
# — neither is what a city router wants.
CITIES = {
    "berlin": {
        "wms": "https://gdi.berlin.de/services/wms/ua_stratlaerm_2022",
        "layer": "bb_strasse_gesamt_den2022",
        "crs": "EPSG:25833",
        # Berlin + the ~250 m buffer the DOM tiles carry
        "bounds": (368000, 5798000, 416000, 5836000),
    },
    "munich": {
        "wms": "https://www.lfu.bayern.de/gdi/wms/laerm/ballungsraeume",
        "layer": "aggroadlden2022",
        "crs": "EPSG:25832",
        "bounds": (676000, 5326000, 703000, 5348000),
    },
}

# Both services render the standard German Umgebungslärm ramp, verified
# 2026-08-30 against a real tile from each: Munich's pixels match these five
# exactly (107,821 of 107,821 opaque), Berlin's match 76 % on a hard
# threshold and the rest are anti-aliasing at class boundaries — which is why
# classification is nearest-colour rather than a tolerance test.
# LDEN bands, quiet to loud: 55-60, 60-65, 65-70, 70-75, >=75 dB(A).
PALETTE = [(226, 242, 191), (243, 198, 131), (205, 70, 62), (117, 8, 92), (67, 10, 74)]
LABELS = ["55-60 dB", "60-65 dB", "65-70 dB", "70-75 dB", ">=75 dB"]

RES = 2.0        # m per pixel, as Frankfurt
TILE_PX = 2000   # 4 km per tile at 2 m — well inside any WMS size cap
TIMEOUT = 180


def classify(rgba):
    """Nearest palette colour per opaque pixel. A threshold would drop the
    anti-aliased boundary between two classes; nearest-colour puts it in one
    of the two, which is what the renderer meant."""
    opaque = rgba[:, :, 3] > 128
    rgb = rgba[:, :, :3].astype(np.int16)
    d = np.stack([np.abs(rgb - np.array(c, dtype=np.int16)).sum(axis=2) for c in PALETTE])
    out = (d.argmin(axis=0) + 1).astype(np.uint8)
    out[~opaque] = 0
    return out


def get_tile(cfg, minx, miny, maxx, maxy, px):
    q = {"SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap",
         "LAYERS": cfg["layer"], "STYLES": "", "CRS": cfg["crs"],
         "BBOX": f"{minx},{miny},{maxx},{maxy}",
         "WIDTH": px, "HEIGHT": px, "FORMAT": "image/png", "TRANSPARENT": "TRUE"}
    for attempt in range(5):
        r = requests.get(f"{cfg['wms']}?{urlencode(q)}", timeout=TIMEOUT)
        if r.ok and r.headers.get("content-type", "").startswith("image"):
            return np.asarray(Image.open(io.BytesIO(r.content)).convert("RGBA"))
        # a service exception comes back as XML with HTTP 200 — retry, then fail loud
        if attempt == 4:
            raise SystemExit(f"SANITY FAIL: WMS refused {minx},{miny}: "
                             f"{r.status_code} {r.text[:200]}")
    return None


def main():
    city = (sys.argv[1] if len(sys.argv) > 1 else "").lower()
    check(city in CITIES, f"usage: 03b_fetch_noise_wms.py {'|'.join(CITIES)}")
    cfg = CITIES[city]
    out_dir = DATA / city / "noise"
    out_dir.mkdir(parents=True, exist_ok=True)

    (out_dir / "legend.json").write_text(json.dumps(
        {"palette": PALETTE, "labels": LABELS, "layer": cfg["layer"], "wms": cfg["wms"]}, indent=1))

    minx, miny, maxx, maxy = cfg["bounds"]
    step = TILE_PX * RES
    nx = math.ceil((maxx - minx) / step)
    ny = math.ceil((maxy - miny) / step)
    print(f"{city}: {nx} x {ny} = {nx * ny} tiles of {step / 1000:.0f} km at {RES} m/px")

    full = np.zeros((ny * TILE_PX, nx * TILE_PX), dtype=np.uint8)
    for iy in range(ny):
        for ix in range(nx):
            x0 = minx + ix * step
            y1 = maxy - iy * step
            rgba = get_tile(cfg, x0, y1 - step, x0 + step, y1, TILE_PX)
            full[iy * TILE_PX:(iy + 1) * TILE_PX,
                 ix * TILE_PX:(ix + 1) * TILE_PX] = classify(rgba)
        print(f"  row {iy + 1}/{ny}")

    covered = float((full > 0).mean())
    check(0.01 < covered < 0.9, f"{covered:.1%} of pixels classified — palette or bbox wrong")
    import rasterio
    path = out_dir / "lden2022_class.tif"
    with rasterio.open(
        path, "w", driver="GTiff", height=full.shape[0], width=full.shape[1],
        count=1, dtype="uint8", crs=cfg["crs"], compress="deflate",
        transform=from_origin(minx, maxy, RES, RES),
    ) as d:
        d.write(full, 1)
    print(f"OK: {path} ({covered:.1%} classified)")


if __name__ == "__main__":
    main()
