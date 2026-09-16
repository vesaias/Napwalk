"""W1: sample 1 m DSM mosaic for the Nordend/Bornheim probe area.

Source preference:
  1. data/bdom/laz/*.laz (bDOM20 via 04_fetch_bdom.py) -> PDAL in Docker
  2. INSPIRE-WCS HE DOM1 (LiDAR DSM, 1 m, dl-de/zero) -> direct GeoTIFF
The bDOM20 Downloadcenter needs a browser session (see data/README.md), so
the W1 spike runs on DOM1; W3 uses DOM1 as the cross-check source anyway.

Idempotent: per-tile downloads and rasterizations are skipped when present.
"""
import json
import subprocess

import numpy as np
import rasterio
import requests
from rasterio.merge import merge

from common import OUT, ROOT, WORK, check

LAZ = WORK / "bdom" / "laz"
DSM = WORK / "dsm"
TILE_OUT = DSM / "tiles"

WCS = "https://inspire-hessen.de/raster/dom1/ows"
# 4x4 km probe: Nordend + Bornheim + Guenthersburgpark + Innenstadt edge
SAMPLE_E = (475000, 479000)
SAMPLE_N = (5552000, 5556000)
KM = 1000


def tiles_from_laz():
    template = json.loads((ROOT / "pipeline" / "pdal_laz2tif.json").read_text())
    for laz in sorted(LAZ.glob("*.la?")):
        tif = TILE_OUT / (laz.stem + ".tif")
        if tif.exists():
            print(f"have {tif.name}")
            continue
        print(f"rasterizing {laz.name}")
        pl = json.loads(json.dumps(template))
        pl[0]["filename"] = f"/work/bdom/laz/{laz.name}"
        pl[1]["filename"] = f"/work/dsm/tiles/{tif.name}"
        subprocess.run(
            ["docker", "run", "--rm", "-i",
             "-v", f"{DATA.as_posix()}:/work",
             "pdal/pdal", "pdal", "pipeline", "--stdin"],
            input=json.dumps(pl).encode(), check=True)


def tiles_from_wcs():
    for e in range(*SAMPLE_E, KM):
        for n in range(*SAMPLE_N, KM):
            tif = TILE_OUT / f"dom1_{e}_{n}.tif"
            if tif.exists():
                print(f"have {tif.name}")
                continue
            print(f"fetching {tif.name}")
            r = requests.get(WCS, params={
                "SERVICE": "WCS", "VERSION": "2.0.1", "REQUEST": "GetCoverage",
                "COVERAGEID": "dom1", "FORMAT": "image/gtiff",
                "SUBSETTINGCRS": "http://www.opengis.net/def/crs/EPSG/0/25832",
                # list value -> SUBSET appears twice (E and N axes)
                "SUBSET": [f"E({e},{e + KM})", f"N({n},{n + KM})"],
            }, timeout=300, allow_redirects=True)
            r.raise_for_status()
            check("tif" in r.headers.get("Content-Type", ""),
                  f"WCS returned {r.headers.get('Content-Type')} for {tif.name}")
            tif.write_bytes(r.content)


def main():
    TILE_OUT.mkdir(parents=True, exist_ok=True)
    if any(LAZ.glob("*.la?")):
        tiles_from_laz()
    else:
        print("no bDOM LAZ tiles found -> using DOM1 WCS (see data/README.md)")
        tiles_from_wcs()

    srcs = [rasterio.open(p) for p in sorted(TILE_OUT.glob("*.tif"))]
    check(len(srcs) >= 1, "no DSM tiles present")
    nodata = srcs[0].nodata if srcs[0].nodata is not None else -9999
    mosaic, transform = merge(srcs, nodata=nodata)
    meta = srcs[0].meta | {"height": mosaic.shape[1], "width": mosaic.shape[2],
                           "transform": transform, "count": 1,
                           "compress": "deflate"}
    out = DSM / "sample_dsm_1m.tif"
    with rasterio.open(out, "w", **meta) as dst:
        dst.write(mosaic[0], 1)

    a = mosaic[0]
    valid = a[(a != nodata) & np.isfinite(a)]
    check("25832" in str(srcs[0].crs), f"DSM CRS {srcs[0].crs} != EPSG:25832")
    check(valid.size / a.size > 0.8, f"only {valid.size / a.size:.0%} valid pixels")
    check(50 < np.percentile(valid, 1) < 200, "ground level implausible for Frankfurt")
    check(np.percentile(valid, 99.9) < 450, "max heights implausible (over ~450 m)")
    spread = np.percentile(valid, 99) - np.percentile(valid, 1)
    check(spread > 10, f"height spread {spread:.1f} m — buildings/trees missing?")

    # hillshade for the eyeball check
    z = np.where((a == nodata) | ~np.isfinite(a), np.median(valid), a)
    gy, gx = np.gradient(z)
    az, alt = np.radians(315), np.radians(45)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    hs = np.sin(alt) * np.sin(slope) + np.cos(alt) * np.cos(slope) * np.cos(az - aspect)
    from PIL import Image
    hs8 = (255 * (hs - hs.min()) / ((hs.max() - hs.min()) or 1)).astype("uint8")
    Image.fromarray(hs8).save(DSM / "sample_hillshade.png")
    print(f"OK: {out}, {valid.size} px valid, z p1={np.percentile(valid, 1):.0f} "
          f"p99={np.percentile(valid, 99):.0f} m, spread={spread:.0f} m")


if __name__ == "__main__":
    main()
