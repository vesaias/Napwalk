"""W3 gate: crops + edge-shade numbers at five known locations, two times.

Frankfurt only: the five locations are Frankfurt streets and parks, and the
bucket indices it samples are that city's sun window. It skips elsewhere
rather than asserting another city against Frankfurt's landmarks
(2026-08-31).

Output: reports/w3_validation/<name>_<hour>.png (400x400 m crops of the
shadow raster) and a printed table of mean edge shade nearby. The verdict
is eyeballed and recorded in DECISIONS.md (SPEC W3 gate).
"""
import json

import geopandas as gpd
import numpy as np
import rasterio
from PIL import Image
from shapely.geometry import Point

from common import REPORTS, WORK, check

LOCATIONS = {
    "guenthersburgpark": (477850, 5555350),
    "gruenebergpark": (474350, 5554500),
    "oeder_weg": (476750, 5553900),
    "schweizer_str": (476300, 5550200),
    "berger_str": (478000, 5554500),
}
HOURS = (10, 16)  # the two crops, by the CLOCK
HALF = 200  # crop half-size, meters


def buckets_for(hours):
    """{"10h": bucket} for this city's window, read from the sun table.

    These were the literal indices 8 and 32, which were 10:00 and 16:00 only
    in the 08:00 window they were written for. The window has been the
    modelled date's since 2026-08-28 and is 15 September's since 2026-09-11
    (it was 21 June's for a day), so at 07:15 the same indices are 09:15 and
    13:15 — and, worse, 10_sun_shade writes its shadow rasters at the buckets
    nearest 10/13/16/18, so a hardcoded 8 named a file that no longer exists
    for any current export."""
    tab = json.loads((WORK / "shade" / "sun_table.json").read_text())
    start, step, n = tab["start_min"], tab["step_min"], tab["buckets"]
    out = {}
    for h in hours:
        b = (h * 60 - start) // step   # exactly how 10_sun_shade picks them
        check(0 <= b < n, f"{h}:00 is outside this city's window "
                          f"({start // 60:02d}:{start % 60:02d} + {n} x {step} min)")
        out[f"{h}h"] = int(b)
    return out


def main():
    from common import CITY
    if CITY != "frankfurt":
        print(f"note: 12_validate_shade is Frankfurt's W3 gate; skipping for {CITY}")
        return
    TIMES = buckets_for(HOURS)
    print(f"crops at {', '.join(f'{k} = bucket {v}' for k, v in TIMES.items())}")
    out_dir = REPORTS / "w3_validation"
    out_dir.mkdir(parents=True, exist_ok=True)
    shade = np.load(WORK / "shade" / "edge_shade.npy")
    edges = gpd.read_file(WORK / "scored" / "edges_scored.gpkg")
    edges = edges.sort_values("eid").reset_index(drop=True)
    sidx = edges.sindex
    for tname, bucket in TIMES.items():
        with rasterio.open(WORK / "shade" / f"shadow_b{bucket}.tif") as src:
            for name, (e, n) in LOCATIONS.items():
                win = rasterio.windows.from_bounds(
                    e - HALF, n - HALF, e + HALF, n + HALF, src.transform)
                a = src.read(1, window=win)
                check(a.size > 0, f"{name} outside raster")
                img = np.full(a.shape + (3,), 255, dtype=np.uint8)
                img[a > 0] = (40, 40, 90)
                Image.fromarray(img).resize((400, 400)).save(
                    out_dir / f"{name}_{tname}.png")
                near = list(sidx.intersection(Point(e, n).buffer(150).bounds))
                mean_shade = shade[edges.iloc[near]["eid"].to_numpy(), bucket].mean() / 255
                print(f"{tname} {name:20s} raster shade {a.mean():.0%}  "
                      f"edges near {mean_shade:.0%}")
    print(f"OK: crops in {out_dir}")


if __name__ == "__main__":
    main()
