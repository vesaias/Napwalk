"""P3: sample the LDEN raster along each edge -> noise class A-E.

Reads data/work/<city>/noise/lden_db.tif, decibels (prep_noise_db.py). It
used to read the source's own class index, which is not comparable between
cities: Frankfurt ships 8 classes from 40 dB, Berlin and Munich 5 from 55,
so `mean_class / 8` scored a Berlin street at 55-60 dB as a Frankfurt street
at 40-45 (2026-08-30).

dB 0 (unmapped, below the source's floor) counts as quiet: buildings are
unmapped but edges are streets/paths, and park paths outside the mapping are
quiet.
"""
import geopandas as gpd
import numpy as np
import rasterio

from common import WORK, check

STEP = 5.0  # sampling interval along the edge, meters
# dB -> the 5 dB band index the cost model has always used. Frankfurt band c
# spans 40+5(c-1), i.e. lower edge 35+5c, so this inverts exactly and every
# Frankfurt edge keeps the cost it had before the switch to dB.
DB_BASE, DB_STEP, MAX_BAND = 35.0, 5.0, 8


def to_band(db):
    """dB -> 0..8 band. 0 stays 0 (unmapped = quiet), not (0-37.5)/5."""
    out = np.zeros(db.shape, dtype=np.float32)
    hit = db > 0
    out[hit] = np.clip((db[hit].astype(np.float32) - DB_BASE) / DB_STEP, 0, MAX_BAND)
    return out


def sample_classes(xs, ys, arr, transform):
    cols = ((xs - transform.c) / transform.a).astype(int)
    rows = ((ys - transform.f) / transform.e).astype(int)
    ok = (rows >= 0) & (rows < arr.shape[0]) & (cols >= 0) & (cols < arr.shape[1])
    out = np.zeros(len(xs), dtype=np.float32)
    out[ok] = arr[rows[ok], cols[ok]]
    return out


def edge_noise(mean_class):
    letters = ["A", "B", "C", "D", "E"]
    # 0 -> A, 1-2 -> B, 3-4 -> C, 5-6 -> D, 7-8 -> E
    idx = 0 if mean_class < 0.5 else min(4, int((round(mean_class) + 1) // 2))
    return letters[idx], round(mean_class / 8.0, 4)


def main():
    path = WORK / "scored" / "edges_scored.gpkg"
    edges = gpd.read_file(path)
    with rasterio.open(WORK / "noise" / "lden_db.tif") as src:
        arr = to_band(src.read(1))
        transform = src.transform
    letters, costs = [], []
    for geom in edges.geometry:
        n = max(3, int(geom.length / STEP) + 1)
        pts = [geom.interpolate(d) for d in np.linspace(0, geom.length, n)]
        xs = np.array([p.x for p in pts])
        ys = np.array([p.y for p in pts])
        mean_class = float(sample_classes(xs, ys, arr, transform).mean())
        letter, cost = edge_noise(mean_class)
        letters.append(letter)
        costs.append(cost)
    edges["noise_class"] = letters
    edges["noise_cost"] = costs
    dist = edges["noise_class"].value_counts(normalize=True)
    # PLUS mapping paints even forests 45-54 dB; the quiet tier here is A-C.
    # Verified against the full-city render 2026-08-14 (see DECISIONS.md).
    quiet = dist.get("A", 0) + dist.get("B", 0) + dist.get("C", 0)
    check(quiet > 0.15, f"only {quiet:.0%} edges <= class C — sampling broken?")
    # Cities differ in how loud they actually are, and the check is for
    # sampling that dumps everything into one class, not for a loud city.
    # Measured 2026-09-01 on the source rasters: Paris reads median 65 dB and
    # p90 75, against 60/70 for Frankfurt, Munich and Hamburg and 52/64 for
    # San Francisco — so Paris's 32% class E is its isophones, not a bug.
    check(dist.get("E", 0) < 0.5, f"{dist.get('E', 0):.0%} class E — sampling broken?")
    # A single class for the whole city is degenerate, and neither bound
    # above catches it: NYC scored 100% class A and passed both, because its
    # noise raster was in EPSG:2263 while the graph had moved to 26918, so
    # every sample missed and read as unmapped-quiet (2026-09-01). No real
    # city puts every edge in one class.
    check(dist.max() < 0.95,
          f"class {dist.idxmax()} holds {dist.max():.0%} of edges — one class "
          "for the whole city; is the noise raster in the graph's CRS?")
    check(edges["noise_cost"].between(0, 1).all(), "noise_cost out of [0,1]")
    edges.to_file(path, driver="GPKG")
    print("OK:", {k: f"{v:.0%}" for k, v in dist.sort_index().items()})


if __name__ == "__main__":
    main()
