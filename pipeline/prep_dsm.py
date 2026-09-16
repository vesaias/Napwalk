"""Normalise every city's DSM to one canonical raster: 1 m, city CRS, metres.

    python pipeline/prep_dsm.py paris|munich|london|berlin|hamburg|nyc

Output: data/work/<city>/dsm/city_dsm_1m.tif — float32 metres, the form
09_build_city_dsm already produces for Frankfurt and 10_sun_shade reads.

Seven cities, seven different raw shapes: GeoTIFF at 0.2, 0.5 and 1 m; XYZ
text in zips; a point cloud; and one raster in FEET. Normalising them here is
the whole point of the prep layer — none of that difference reaches the
pipeline.

Written windowed: the destination is created empty and each source tile is
placed into it, so peak memory is one tile rather than the whole city.
Downsampling takes the max of each block — averaging shaves roof edges and
softens every shadow, and the DSM exists to cast them.
"""
import sys
import zipfile

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.windows import Window

from common import DATA, check

RES = 1.0
NL = b"\n"

CITIES = {
    # GeoTIFF tiles already in the target CRS; only the resolution differs
    "paris": {"kind": "tif", "crs": "EPSG:2154", "glob": "*.tif"},
    "munich": {"kind": "tif", "crs": "EPSG:25832", "glob": "*_DOM.tif"},
    "london": {"kind": "tif", "crs": "EPSG:27700", "glob": "*.tif",
               # the composite fills unsurveyed ground and water with a large
               # negative; left in, the Thames drags the ground level down and
               # every riverside shadow is wrong
               "nodata_below": -100.0},
    # zips of XYZ text, one file per tile, no CRS in the file
    "berlin": {"kind": "xyz_zips", "crs": "EPSG:25833", "glob": "DOM1_*.zip"},
    "hamburg": {"kind": "xyz_zip", "crs": "EPSG:25832", "glob": "*.ASCII"},
    # LiDAR point cloud, 460 M points; the only city with no DSM raster
    # published anywhere. 3DEP ships point clouds and BARE-EARTH DEMs, and
    # bare earth has no buildings, so the surface has to be built here.
    # dsm_2024 = CA_SanFrancisco_B23, a dedicated SF flight (652 tiles, 70 GB).
    # The 2018 set in dsm/ is CA_NoCAL_3DEP_Supp_Funding_2018_D18, a
    # SUPPLEMENTAL survey that fills gaps rather than covering the city: it
    # left 53.8% of edge samples without elevation and the graph ran 3.2 km
    # further south than the raster started (2026-08-31).
    "sf": {"kind": "laz", "crs": "EPSG:26910", "glob": "*.laz",
           "subdir": "dsm_2024"},
    # One citywide raster inside a zip: 1 ft pixels, EPSG:2263, and heights
    # in US SURVEY FEET. Both the grid and the z values need converting, and
    # 2263's own units are feet, so the target is UTM 18N — a "1 m" grid in
    # 2263 would be a 1-foot grid.
    "nyc": {"kind": "zip_tif", "crs": "EPSG:26918", "glob": "*.zip",
            "z_scale": 0.3048},
}


def block_max(a, f):
    """Downsample by an integer factor, taking the max of each f x f block.
    rasterio's Resampling.max is warp-only, and averaging would shave roof
    edges and soften every shadow — the DSM exists to cast them."""
    h, w = (a.shape[0] // f) * f, (a.shape[1] // f) * f
    return a[:h, :w].reshape(h // f, f, w // f, f).max(axis=(1, 3))


def tif_extent(paths, cfg):
    minx = miny = float("inf")
    maxx = maxy = float("-inf")
    for p in paths:
        with rasterio.open(p) as s:
            b = s.bounds
        minx, miny = min(minx, b.left), min(miny, b.bottom)
        maxx, maxy = max(maxx, b.right), max(maxy, b.top)
    return minx, miny, maxx, maxy


def build_from_tifs(city, cfg, paths, dst_path):
    minx, miny, maxx, maxy = tif_extent(paths, cfg)
    minx, miny = np.floor(minx), np.floor(miny)
    maxx, maxy = np.ceil(maxx), np.ceil(maxy)
    w, h = int((maxx - minx) / RES), int((maxy - miny) / RES)
    transform = from_origin(minx, maxy, RES, RES)
    profile = {"driver": "GTiff", "height": h, "width": w, "count": 1,
               "dtype": "float32", "crs": cfg["crs"], "transform": transform,
               "tiled": True, "blockxsize": 512, "blockysize": 512,
               "nodata": -9999.0, "BIGTIFF": "YES"}   # compressed by compress_copy
    floor = cfg.get("nodata_below")
    scale = cfg.get("z_scale", 1.0)
    print(f"  {w} x {h} px ({w * RES / 1000:.0f} x {h * RES / 1000:.0f} km), "
          f"{w * h * 4 / 1e9:.2f} GB uncompressed")
    # raster order, and uncompressed until the final pass — same reasons as
    # build_from_xyz: source tiles never align to output blocks
    paths = sorted(paths, key=lambda q: (-rasterio.open(q).bounds.top,
                                         rasterio.open(q).bounds.left))
    tmp = dst_path.with_suffix(".tmp.tif")
    with rasterio.open(tmp, "w", **profile) as dst:
        for i, p in enumerate(paths, 1):
            with rasterio.open(p) as s:
                a = s.read(1).astype("float32")
                b = s.bounds
                if s.nodata is not None:
                    a = np.where(a == s.nodata, -9999.0, a)
                f = int(round(RES / s.res[0]))
            if f > 1:
                a = block_max(a, f)
            oh, ow = a.shape
            if floor is not None:
                a = np.where(a < floor, -9999.0, a)
            if scale != 1.0:
                a = np.where(a > -9998.0, a * scale, -9999.0)
            col = int(round((b.left - minx) / RES))
            row = int(round((maxy - b.top) / RES))
            ow, oh = min(ow, w - col), min(oh, h - row)
            if ow <= 0 or oh <= 0:
                continue
            if col < 0:
                a = a[:, -col:]; col = 0
            if row < 0:
                a = a[-row:, :]; row = 0
            oh, ow = a.shape
            ow, oh = min(ow, w - col), min(oh, h - row)
            if ow <= 0 or oh <= 0:
                continue
            dst.write(a[:oh, :ow], 1, window=Window(col, row, ow, oh))
            if i % 100 == 0:
                print(f"    {i}/{len(paths)}")
    print("  compressing")
    compress_copy(tmp, dst_path)
    tmp.unlink()


# LAS classes to drop before taking the surface. 7 and 18 are noise — 18 is
# "high noise", birds and haze returns that sit hundreds of metres up and
# would otherwise become the highest hit and cast an enormous false shadow.
# 9 is water, where returns are unreliable. Everything else is kept: a DSM
# wants the top of whatever is there, building or tree.
LAZ_DROP = {7, 9, 18}


def build_from_laz(city, cfg, paths, dst_path):
    """Bin the point cloud to a 1 m grid, taking the highest point per cell.

    Reprojects per point rather than warping a raster afterwards, and reads
    the source CRS from each tile's own header. Hardcoding it was wrong: the
    2018 supplemental tiles are NAD83(2011) Conus Albers (EPSG:6350) but the
    2024 San Francisco survey is NAD83(2011) / San Francisco CS13 (EPSG:7131),
    a local Transverse Mercator. Assuming Albers for those put every point
    somewhere else entirely and left downtown with no elevation at all
    (2026-09-01).
    """
    import laspy
    from pyproj import Transformer

    _tr_cache = {}

    def transformer_for(path):
        with laspy.open(path) as h:
            crs = h.header.parse_crs()
        check(crs is not None, f"{path.name} carries no CRS")
        key = crs.to_string()
        if key not in _tr_cache:
            _tr_cache[key] = Transformer.from_crs(crs, cfg["crs"], always_xy=True)
            print(f"  source CRS: {crs.name}")
        return _tr_cache[key]

    print(f"{city}: {len(paths)} LAZ tiles; pass 1 of 2, sizing")
    minx = miny = float("inf")
    maxx = maxy = float("-inf")
    for p in paths:
        tr = transformer_for(p)
        with laspy.open(p) as h:
            lo, hi = h.header.mins, h.header.maxs
        xs, ys = tr.transform([lo[0], hi[0], lo[0], hi[0]],
                              [lo[1], lo[1], hi[1], hi[1]])
        minx, maxx = min(minx, *xs), max(maxx, *xs)
        miny, maxy = min(miny, *ys), max(maxy, *ys)
    minx, miny = np.floor(minx), np.floor(miny)
    maxx, maxy = np.ceil(maxx), np.ceil(maxy)
    w, h = int((maxx - minx) / RES), int((maxy - miny) / RES)
    print(f"  {w} x {h} px ({w * RES / 1000:.0f} x {h * RES / 1000:.0f} km), "
          f"{w * h * 4 / 1e9:.2f} GB uncompressed; pass 2, binning")

    # one pass over the cloud into a single array: 15.9 x 13.1 km at 1 m is
    # only 0.8 GB, so the whole grid fits and tiles can be read in any order
    grid = np.full((h, w), -9999.0, dtype="float32")
    kept = dropped = 0
    for i, p in enumerate(paths, 1):
        tr = transformer_for(p)
        las = laspy.read(p)
        keep = ~np.isin(las.classification, list(LAZ_DROP))
        dropped += int((~keep).sum())
        if not keep.any():
            continue
        x, y = tr.transform(np.asarray(las.x)[keep], np.asarray(las.y)[keep])
        z = np.asarray(las.z)[keep].astype("float32")
        ci = np.floor((x - minx) / RES).astype(np.int64)
        ri = np.floor((maxy - y) / RES).astype(np.int64)
        ok = (ci >= 0) & (ci < w) & (ri >= 0) & (ri < h)
        flat = ri[ok] * w + ci[ok]
        np.maximum.at(grid.reshape(-1), flat, z[ok])
        kept += int(ok.sum())
        if i % 25 == 0:
            print(f"    {i}/{len(paths)}")
    print(f"  {kept:,} points binned, {dropped:,} dropped as noise/water")

    profile = {"driver": "GTiff", "height": h, "width": w, "count": 1,
               "dtype": "float32", "crs": cfg["crs"],
               "transform": from_origin(minx, maxy, RES, RES),
               "tiled": True, "blockxsize": 512, "blockysize": 512,
               "nodata": -9999.0, "BIGTIFF": "YES"}
    tmp = dst_path.with_suffix(".tmp.tif")
    with rasterio.open(tmp, "w", **profile) as dst:
        dst.write(grid, 1)
    print("  compressing")
    compress_copy(tmp, dst_path)
    tmp.unlink()


def build_from_zip_tif(city, cfg, src_dir, dst_path):
    """One big raster inside a zip, reprojected and rescaled.

    Read straight out of the archive with /vsizip — NYC's tif is 30.5 GB
    unpacked and there is no reason to write it to disk first. WarpedVRT does
    the reprojection lazily so only the blocks being written are computed,
    and Resampling.max keeps building tops: this is the one place max IS
    available, since it is a warp rather than a decimated read.
    """
    from rasterio.enums import Resampling
    from rasterio.vrt import WarpedVRT
    from rasterio.warp import calculate_default_transform

    archives = sorted(src_dir.glob(cfg["glob"]))
    check(len(archives) == 1, f"expected one archive in {src_dir}")
    with zipfile.ZipFile(archives[0]) as z:
        inner = [n for n in z.namelist() if n.lower().endswith(".tif")]
    check(len(inner) == 1, f"expected one tif in {archives[0].name}, found {len(inner)}")
    src_uri = f"/vsizip/{archives[0].as_posix()}/{inner[0]}"
    print(f"{city}: {inner[0]} inside {archives[0].name}")

    scale = cfg.get("z_scale", 1.0)
    with rasterio.open(src_uri) as src:
        print(f"  source {src.width}x{src.height} {src.crs} res={src.res[0]:.4f}")
        transform, w, h = calculate_default_transform(
            src.crs, cfg["crs"], src.width, src.height, *src.bounds, resolution=RES)
        print(f"  target {w}x{h} ({w * RES / 1000:.0f} x {h * RES / 1000:.0f} km) {cfg['crs']}")
        profile = {"driver": "GTiff", "height": h, "width": w, "count": 1,
                   "dtype": "float32", "crs": cfg["crs"], "transform": transform,
                   "tiled": True, "blockxsize": 512, "blockysize": 512,
                   "nodata": -9999.0, "BIGTIFF": "YES"}
        tmp = dst_path.with_suffix(".tmp.tif")
        with WarpedVRT(src, crs=cfg["crs"], transform=transform, width=w, height=h,
                       resampling=Resampling.max, src_nodata=src.nodata,
                       nodata=-9999.0) as vrt:
            with rasterio.open(tmp, "w", **profile) as dst:
                done = 0
                for _, win in dst.block_windows(1):
                    a = vrt.read(1, window=win).astype("float32")
                    if scale != 1.0:
                        a = np.where(a > -9998.0, a * scale, -9999.0)
                    dst.write(a, 1, window=win)
                    done += 1
                    if done % 2000 == 0:
                        print(f"    {done} blocks")
    print("  compressing")
    compress_copy(tmp, dst_path)
    tmp.unlink()


def xyz_to_array(raw):
    """Space-separated 'x y z', no header, on a regular grid sorted by y then
    x (verified for both Berlin and Hamburg). Returns the north-up grid and
    its top-left corner.

    pandas rather than np.loadtxt: a Berlin tile is 4,000,000 rows and 120 MB,
    which loadtxt takes minutes to parse and read_csv takes 3 seconds.
    """
    import io

    import pandas as pd

    df = pd.read_csv(io.BytesIO(raw), sep=r"\s+", header=None,
                     names=["x", "y", "z"], engine="c")
    xs = df.x.to_numpy(); ys = df.y.to_numpy()
    ux, uy = np.unique(xs), np.unique(ys)
    # step from the unique coordinates, not from row order: Berlin's corner
    # tiles hold a few dozen points rather than 4,000,000 and are not a full
    # grid, so consecutive rows there can share an x
    step = float(np.median(np.diff(ux))) if len(ux) > 1 else (
        float(np.median(np.diff(uy))) if len(uy) > 1 else 1.0)
    check(step > 0, "cannot infer XYZ grid step")
    w = int(round((ux[-1] - ux[0]) / step)) + 1
    h = int(round((uy[-1] - uy[0]) / step)) + 1
    grid = np.full((h, w), -9999.0, dtype="float32")
    ci = np.rint((xs - ux[0]) / step).astype(int)
    ri = np.rint((uy[-1] - ys) / step).astype(int)   # north-up
    ok = (ci >= 0) & (ci < w) & (ri >= 0) & (ri < h)
    grid[ri[ok], ci[ok]] = df.z.to_numpy(dtype="float32")[ok]
    # coordinates are cell centres, so the corner is half a cell out
    return grid, ux[0] - step / 2, uy[-1] + step / 2, step


def compress_copy(tmp_path, dst_path):
    """Sequential windowed copy into a compressed tiled TIFF. Compression is
    applied HERE, never during the scattered tile writes: a deflate block
    cannot be rewritten once flushed, and source tiles do not align to output
    blocks, so a second tile touching a finished block fails the write.
    Sorting the writes into raster order reduced those collisions but did not
    remove them (Berlin, 2026-08-30)."""
    with rasterio.open(tmp_path) as src:
        profile = dict(src.profile)
        profile.update(compress="deflate", predictor=2, tiled=True,
                       blockxsize=512, blockysize=512, BIGTIFF="YES")
        with rasterio.open(dst_path, "w", **profile) as dst:
            for _, win in dst.block_windows(1):
                dst.write(src.read(1, window=win), 1, window=win)


def build_from_xyz(city, cfg, members, dst_path):
    """members: list of (label, bytes-loader). Two passes — the first reads
    every tile's corner to size the mosaic, the second writes them in."""
    print(f"{city}: {len(members)} XYZ tiles; pass 1 of 2, sizing")
    corners = []
    for i, (label, load) in enumerate(members, 1):
        # only the first and last line: the grid is sorted, so they are the
        # SW and NE cell centres. Parsing the whole tile twice would double a
        # 15-minute run for nothing.
        raw = load()
        head = raw[:200].split(NL)[0].split()
        tail = raw.rstrip().rsplit(NL, 1)[-1].split()
        x0, y0 = float(head[0]), float(head[1])
        x1, y1 = float(tail[0]), float(tail[1])
        second = raw[:400].split(NL)[1].split()
        step = abs(float(second[0]) - x0) or 1.0
        corners.append((x0 - step / 2, y1 + step / 2,
                        x1 - x0 + step, y1 - y0 + step))
        if i % 100 == 0:
            print(f"    {i}/{len(members)}")
    minx = min(c[0] for c in corners)
    maxy = max(c[1] for c in corners)
    maxx = max(c[0] + c[2] for c in corners)
    miny = min(c[1] - c[3] for c in corners)
    w, h = int(round((maxx - minx) / RES)), int(round((maxy - miny) / RES))
    profile = {"driver": "GTiff", "height": h, "width": w, "count": 1,
               "dtype": "float32", "crs": cfg["crs"],
               "transform": from_origin(minx, maxy, RES, RES),
               "tiled": True, "blockxsize": 512, "blockysize": 512,
               "nodata": -9999.0, "BIGTIFF": "YES"}   # uncompressed; see compress_copy
    print(f"  {w} x {h} px ({w * RES / 1000:.0f} x {h * RES / 1000:.0f} km), "
          f"{w * h * 4 / 1e9:.2f} GB uncompressed; pass 2, writing")
    # Raster order, north-west first. A deflate-compressed tiled TIFF cannot
    # rewrite a block once it has been flushed, and the archive order jumps
    # around the city, so two tiles sharing a block would fail the second
    # write. Sorted, blocks finish as the write front moves past them.
    order = sorted(range(len(members)), key=lambda k: (-corners[k][1], corners[k][0]))
    members = [members[k] for k in order]
    tmp = dst_path.with_suffix(".tmp.tif")
    with rasterio.open(tmp, "w", **profile) as dst:
        for i, (label, load) in enumerate(members, 1):
            g, cx, cy, step = xyz_to_array(load())
            f = int(round(RES / step))
            if f > 1:
                g = block_max(g, f)
            col = int(round((cx - minx) / RES))
            row = int(round((maxy - cy) / RES))
            # Pass 1 infers the grid step from two lines, pass 2 from the
            # unique coordinates. On Berlin's near-empty corner tiles — a few
            # dozen points instead of 4,000,000 — those disagree, which put a
            # tile a pixel outside the mosaic and failed the write with
            # nothing but "Write failed" (2026-08-30). Trim to the
            # destination instead of trusting the offsets.
            if col < 0:
                g = g[:, -col:]
                col = 0
            if row < 0:
                g = g[-row:, :]
                row = 0
            gh, gw = g.shape
            gw, gh = min(gw, w - col), min(gh, h - row)
            if gw <= 0 or gh <= 0:
                continue
            dst.write(g[:gh, :gw], 1, window=Window(col, row, gw, gh))
            if i % 50 == 0:
                print(f"    {i}/{len(members)}")
    print("  compressing")
    compress_copy(tmp, dst_path)
    tmp.unlink()


def main():
    city = (sys.argv[1] if len(sys.argv) > 1 else "").lower()
    check(city in CITIES, f"usage: prep_dsm.py {'|'.join(CITIES)}")
    cfg = CITIES[city]
    src_dir = DATA / "input" / city / cfg.get("subdir", "dsm")
    check(src_dir.is_dir(), f"{src_dir} missing")
    out = DATA / "work" / city / "dsm" / "city_dsm_1m.tif"
    out.parent.mkdir(parents=True, exist_ok=True)

    if cfg["kind"] == "tif":
        paths = sorted(src_dir.glob(cfg["glob"]))
        check(len(paths) > 10, f"only {len(paths)} tiles in {src_dir}")
        print(f"{city}: {len(paths)} GeoTIFF tiles")
        build_from_tifs(city, cfg, paths, out)
    elif cfg["kind"] == "zip_tif":
        build_from_zip_tif(city, cfg, src_dir, out)
    elif cfg["kind"] == "laz":
        paths = sorted(src_dir.glob(cfg["glob"]))
        check(len(paths) > 10, f"only {len(paths)} LAZ tiles in {src_dir}")
        build_from_laz(city, cfg, paths, out)
    elif cfg["kind"] == "xyz_zips":
        zips = sorted(src_dir.glob(cfg["glob"]))
        check(len(zips) > 10, f"only {len(zips)} zips in {src_dir}")
        members = []
        for z in zips:
            def load(z=z):
                with zipfile.ZipFile(z) as f:
                    return f.read(f.namelist()[0])
            members.append((z.name, load))
        build_from_xyz(city, cfg, members, out)
    elif cfg["kind"] == "xyz_zip":
        arch = sorted(src_dir.glob(cfg["glob"]))
        check(len(arch) == 1, f"expected one archive in {src_dir}")
        with zipfile.ZipFile(arch[0]) as f:
            infos = [i for i in f.infolist()
                     if i.filename.lower().endswith((".xyz", ".txt"))]
            names = [i.filename for i in infos]
            deflate64 = any(i.compress_type == 9 for i in infos)
        check(len(names) > 100, f"only {len(names)} tiles in {arch[0].name}")
        if deflate64:
            # Hamburg's archive is Deflate64, which Python's zipfile cannot
            # read ("That compression method is not supported"). Info-ZIP can,
            # and `unzip -p` streams one member at a time — extracting all 872
            # would be 26 GB on disk (2026-08-30).
            import shutil
            import subprocess

            exe = shutil.which("unzip")
            check(exe is not None,
                  "archive is Deflate64 and `unzip` is not on PATH; install "
                  "Info-ZIP or add the zipfile-deflate64 package")
            print(f"  {arch[0].name} is Deflate64 — streaming via {exe}")

            def make(n):
                def load():
                    r = subprocess.run([exe, "-p", str(arch[0]), n],
                                       capture_output=True)
                    check(r.returncode == 0 and r.stdout,
                          f"unzip failed on {n}: {r.stderr[:200]!r}")
                    return r.stdout
                return load
        else:
            def make(n):
                def load():
                    with zipfile.ZipFile(arch[0]) as f:
                        return f.read(n)
                return load
        build_from_xyz(city, cfg, [(n, make(n)) for n in names], out)
    else:
        raise SystemExit(f"SANITY FAIL: {cfg['kind']} not implemented yet")

    # Sample real windows, not a decimated whole-raster read: on a 46002 x
    # 38230 tiled TIFF the latter came back 99.8% nodata for a mosaic that is
    # in fact 99.4% full, which looked like a catastrophic bug (2026-08-30).
    with rasterio.open(out) as d:
        rng = np.random.default_rng(0)
        cov, zs = [], []
        for _ in range(24):
            c = int(rng.integers(0, max(1, d.width - 1024)))
            r = int(rng.integers(0, max(1, d.height - 1024)))
            a = d.read(1, window=Window(c, r, min(1024, d.width), min(1024, d.height)))
            v = a[a > -9998.0]
            cov.append(v.size / a.size)
            if v.size:
                zs.append((float(v.min()), float(v.max())))
        check(zs, "every sampled window is nodata")
        lo = min(z[0] for z in zs)
        hi = max(z[1] for z in zs)
        print(f"OK: {out} — {d.width}x{d.height} {d.crs}, "
              f"{100 * float(np.mean(cov)):.0f}% covered, z {lo:.1f}..{hi:.1f} m")


if __name__ == "__main__":
    main()
