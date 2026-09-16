"""W3/P4a: mosaic the delivered DOM1 GeoTIFF tiles into one citywide raster.

Replaces the LAZ/PDAL path: the Downloadcenter delivered ready GeoTIFFs
(see DECISIONS.md). Idempotent: skips if output exists.
"""
import numpy as np
import rasterio
from rasterio.merge import merge

from common import IN, WORK, check

RAW = IN / "dsm"
OUT = WORK / "dsm" / "city_dsm_1m.tif"


def main():
    if OUT.exists():
        print(f"{OUT} exists, skipping")
        return
    tiles = sorted(RAW.glob("DOM1_*_he.tif"))
    check(len(tiles) > 200, f"only {len(tiles)} DOM1 tiles in {RAW}")
    srcs = [rasterio.open(p) for p in tiles]
    check(all("25832" in str(s.crs) for s in srcs[:5]), "tile CRS != 25832")
    mosaic, transform = merge(srcs, nodata=-9999)
    a = mosaic[0]
    valid = a[a != -9999]
    check(valid.size / a.size > 0.5, f"{valid.size / a.size:.0%} valid — merge broken?")
    check(50 < np.percentile(valid, 1) < 200, "ground level implausible")
    check(np.percentile(valid, 99.99) < 700, "peak heights implausible")
    meta = srcs[0].meta | {"height": a.shape[0], "width": a.shape[1],
                           "transform": transform, "compress": "deflate",
                           "BIGTIFF": "IF_SAFER"}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(OUT, "w", **meta) as dst:
        dst.write(a, 1)
    print(f"OK: {a.shape[1]}x{a.shape[0]} px, {valid.size / a.size:.0%} valid, "
          f"z p1={np.percentile(valid, 1):.0f} p99={np.percentile(valid, 99):.0f}")


if __name__ == "__main__":
    main()
