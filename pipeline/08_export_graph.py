"""P5: pack the scored graph into the client artifact, enforce budget.

Layout v8 (little-endian, 2026-09-10, backlog B11) — TWO kinds of file:

  <stem>.core.bin.gz   magic SWG1 | uint32 header_len | JSON header |
                       nodes f32 lat,lng | edge records | geo_counts u8 per
                       edge | geo_points int16 microdegree deltas | flags |
                       side bits | acc | slope | circuits JSON
  <stem>.shade.K.bin.gz   magic SWGB | uint16 k | uint16 buckets |
                          8-byte shade hash | n_edges x buckets bytes

Two thirds of a v7 artifact was shade (Frankfurt: 17.8 MB of 26.4 MB raw)
and a session reads a sliver of it — a walk is at most ~2 h from a known
departure minute (CLAUDE.md rule 4). So the shade block is cut along the
TIME axis into bands of BAND_BUCKETS buckets and shipped as its own files;
the core header lists them (`shade_bands`) and stamps them (`shade_hash`),
and a band whose prefix does not match its core is refused rather than used.
Nothing is re-ordered and no id is remapped: a band is a column slice of the
same rows.

Layout v7 (`--v7`) is the same buffer with the shade block inline between
geo_points and flags. No city ships it since 2026-09-10 — all eight are v8 —
and the client reads both.

The shade byte is the shadier of the two sidewalks. Sunshine differs per
street side (44 % of edges differ substantially at 10:00); the walker picks
the shady side, and which side is shady does not depend on travel direction
— so max(L, R) is the routing truth. L/R stay in data/shade for a future
"walk on the left" hint; a diff vector was tried (3-bit) and still broke the
4 MB budget (4.2 MB) — the card spread is not worth 1.3 MB per download.

Budget (SPEC P5): brotli(everything) <= the city's budget_mib (cities.py),
fail loud. On v8 that is the sum over the core and every band — what the
city costs to hold in full, not what a session downloads.
"""
import argparse
import gzip
import hashlib
import io
import json

import brotli
import geopandas as gpd
import numpy as np
import osmnx as ox

from cities import CITIES
from common import CITY, DEFAULT, OUT, WORK, check, export_border

MAGIC = b"SWG1"
BAND_MAGIC = b"SWGB"
VERSION_V7 = 7  # v6.4->7: seasonal shade window in the header (2026-08-28)
VERSION_V8 = 8  # v7->8: shade lifted out into time bands (2026-09-10, backlog B11)
# One band = 8 buckets = 2 h at the 15-minute step. The span a session needs
# before it can route is [departure - 15 min, departure + 3 h] = 3 h 15 min,
# which touches two or three bands.
#
# Chosen by measurement, not by the round number (Frankfurt, 57 buckets,
# 2026-09-10). Gzip compresses the shade block far better whole than sliced —
# the columns are 15 minutes apart and nearly identical — so a narrow band
# costs total bytes while a wide one costs the bytes a session must fetch
# before it can route. Whole shade block: 3.35 MB gz. Sliced: 3.35 at width
# 57, 3.82 at 19, 4.15 at 10, 4.30 at 8, 4.43 at 6. Against that, the three
# bands a 14:00 departure needs come to 2.61 MB at width 19, 2.50 at 10,
# 2.12 at 8 and 2.28 at 6. Width 8 is the minimum of the number that matters.
BAND_BUCKETS = 8
SIDE_BYTES = 3  # derived from BUCKETS at pack time; 24 half-hour buckets, 1 bit each: 1 = LEFT sidewalk shadier (halved from 48, 2026-08-19, to pay for finer edge geometry)
# Bucket count/window come from 10_sun_shade's sun_table.json — the window is
# derived from the modelled date's sunrise/sunset, so it is seasonal
# (50 buckets on 15 September, 65 on 21 June, 32 in December). Read at pack
# time, carried in the header, read back by the client (v6.4, 2026-08-28).
BUCKETS = 48        # fallback only; overwritten from sun_table.json
BUCKET_START_MIN = 8 * 60
BUCKET_STEP_MIN = 15
EDGE_DTYPE = np.dtype([("u", "<u4"), ("v", "<u4"), ("len_dm", "<u2"),
                       ("surface_q", "u1"), ("noise_q", "u1"),
                       ("green_q", "u1")])
# 4 -> 8 MiB 2026-08-27, 8 -> 12 MiB 2026-08-28, per city 2026-09-01 (cities.py)
# (derived shade window: 50 buckets on 15 September vs the old fixed 48;
#  the 21 June window's 65-67 is what the 2026-09-10 raises paid for, and
#  the September caps of 2026-09-11 take that back)
BUDGET_BR = CITIES[CITY]["budget_mib"] * 1024 * 1024
STREET_TYPES = ["residential", "tertiary", "secondary", "primary", "service", "living_street", "unclassified",
                # link roads / trunk are carriageways too (2026-08-18: a primary_link
                # slip piece through the Bremer/Eschersheimer junction was flagged as
                # nothing and walked for free)
                "primary_link", "secondary_link", "tertiary_link", "trunk", "trunk_link", "road"]
MAX_PTS = 12
MICRO = 1_000_000
# Cloudflare Pages refuses a single asset over 25 MiB. A .gz over this is
# written as byte-slices <stem>.bin.gz.0 … .N-1 instead of one file, and the
# loader concatenates them (web/src/cities.ts `parts`, 2026-09-01).
PART_BYTES = 20 * 1024 * 1024


def check_registry_bands(stem, n_bands, city=CITY):
    """The registry has to name the band count, because the client fetches
    the bands by it (`bands` in web/src/cities.ts, its twin here). Say it the
    way write_gz says `parts` when the key is missing, and hold the export to
    it once the city has one: a window that changed the band count under a
    stale registry is a city whose last band 404s (rule 2)."""
    want = CITIES[city].get("bands")
    if want is None:
        print(f"{stem} ships {n_bands} bands — set `bands: {n_bands}` on this "
              f"city in web/src/cities.ts and pipeline/cities.py")
    else:
        check(want == n_bands,
              f"registry says bands: {want}, this export writes {n_bands}")


def artifact_stem(city=CITY):
    """`graph` for the default city, `graph-<city>` for the rest — the stem
    of every file this stage writes, and the one 08b_rebands_v7 reads."""
    return "graph" if city == DEFAULT else f"graph-{city}"


def _circuit_bytes(circuits):
    """circuits: list of dicts {id, pocket, eids, length, iq, shade[48], green,
    noise, surface, score} -> compact JSON block after the shade bytes."""
    return json.dumps([{"id": c["id"], "p": c["pocket"], "e": c["eids"],
                        "L": c["length"], "iq": c["iq"], "s": c["shade"],
                        "g": c["green"], "d": c.get("deep", 0.0), "n": c["noise"], "u": c["surface"],
                        "sc": c["score"], "st": c.get("street", 0.0), "c": c["centroid"],
                        "m": c.get("modes", 7)} for c in circuits],
                      separators=(",", ":")).encode("utf-8")


def _side_bits(shade_l, shade_r, force_left=None, force_right=None):
    """side bits: bucket b -> byte b >> 3, bit b & 7; 1 = left shadier."""
    left = (np.asarray(shade_l) > np.asarray(shade_r)).astype("u1")[:, ::2]  # (e, 24)
    if force_left is not None:
        left[np.asarray(force_left, dtype=bool), :] = 1
    if force_right is not None:
        left[np.asarray(force_right, dtype=bool), :] = 0
    return np.packbits(left, axis=1, bitorder="little")


def shade_block(shade_l, shade_r):
    """What the artifact carries per edge and bucket: the SHADIER side, in
    16 levels (steps of ~6%). Visually and cost-wise indistinguishable from
    255 levels, and it compresses far better — it is what pays for the 0.8 m
    geometry (2026-08-20). Shape (n_edges, buckets), dtype u1."""
    return ((np.maximum(shade_l, shade_r).astype("u1") >> 4) * 17).astype("u1")


def shade_hash8(block):
    """Eight bytes of sha256 over the WHOLE shade block.

    Written into the v8 core header and into every band file's 16-byte
    prefix. A band from another export therefore cannot be read as this
    graph's shade — which matters more here than anywhere else in the
    artifact, because a wrong shade byte is a wrong route at a wrong time
    (CLAUDE.md rule 4) and nothing downstream could tell."""
    return hashlib.sha256(np.ascontiguousarray(block, dtype="u1").tobytes()).digest()[:8]


def split_bands(n_buckets, width=BAND_BUCKETS):
    """The bucket ranges the shade block is cut into: [(bucket0, buckets)].

    Plain chunking, last band short. `width` = BAND_BUCKETS = 8 buckets =
    2 h at the 15-minute step; see the note there for why 8 and not 10."""
    check(n_buckets >= 1, f"n_buckets {n_buckets} < 1")
    check(width >= 1, f"band width {width} < 1")
    return [(b, min(width, n_buckets - b)) for b in range(0, n_buckets, width)]


def band_specs(n_buckets, start_min, step_min, stem, width=BAND_BUCKETS):
    """The `shade_bands` list the v8 core header carries. `start_min` and
    `end_min` are the band's own clock span — derived here so the client
    never redoes the arithmetic, and asserted against it when it parses."""
    out = []
    for k, (b0, nb) in enumerate(split_bands(n_buckets, width)):
        out.append({"k": k, "bucket0": int(b0), "buckets": int(nb),
                    "start_min": int(start_min + b0 * step_min),
                    "end_min": int(start_min + (b0 + nb - 1) * step_min),
                    "file": f"{stem}.shade.{k}.bin.gz"})
    return out


def _header(version, nodes, edges, geo_points, buckets, side_bytes, cb, n_circuits,
            has_slope):
    return {"version": version, "n_nodes": int(len(nodes)),
            "n_edges": int(len(edges)), "buckets": int(buckets),
            "bucket_start_min": int(BUCKET_START_MIN), "bucket_step_min": int(BUCKET_STEP_MIN),
            "n_geo_points": int(len(geo_points) // 2),
            "len_unit": "dm", "coord": "latlng-f32", "shade": "shadier-side-max",
            "flags": 1, "side_bytes": int(side_bytes), "acc_bytes": 2,
            "circuits_bytes": len(cb), "n_circuits": int(n_circuits),
            # False = city shipped without a DTM (DECISIONS 2026-08-30):
            # slope bytes are all zero and wheelchair mode cannot be honest
            "slope": bool(has_slope)}


def framed(header, blobs):
    hb = json.dumps(header).encode()
    return b"".join([MAGIC, np.uint32(len(hb)).tobytes(), hb, *blobs])


def pack(nodes, edges, shade_l, shade_r, geo_counts, geo_points, circuits=None, flags=None,
         force_left=None, force_right=None, acc=None, slope=None, has_slope=True):
    """The v7 monolith: one buffer with the shade block in the middle.

    flags: u1 per edge, bit0 = street class (drawn offset onto the shadier
    sidewalk by the client), bit1 = street has a mapped sidewalk (carriageway
    penalty), bit2 = crossing edge (fixed crossing cost) (v6, 2026-08-17).

    Kept exactly as it was: the client reads v7 unchanged while the eight
    cities are re-exported one at a time (`--v7`, and every city but
    Frankfurt as of 2026-09-10)."""
    circuits = circuits or []
    cb = _circuit_bytes(circuits)
    if flags is None:
        flags = np.zeros(len(edges), dtype="u1")
    sides = _side_bits(shade_l, shade_r, force_left, force_right)
    # v6.3 (2026-08-27, docs/accessibility-modes.md): the two bytes that
    # carried v6.2's way codes (never read by the final turn rule) now hold
    # flags2 (accessibility bits) and slope (signed forward gradient, 0.5 %
    # steps). Size-neutral.
    if acc is None:
        acc = np.zeros(len(edges), dtype="u1")
    if slope is None:
        slope = np.zeros(len(edges), dtype="i1")
    header = _header(VERSION_V7, nodes, edges, geo_points,
                     np.asarray(shade_l).shape[1], int(sides.shape[1]), cb,
                     len(circuits), has_slope)
    return framed(header, [
        nodes.astype("<f4").tobytes(),
        edges.astype(EDGE_DTYPE).tobytes(),
        geo_counts.astype("u1").tobytes(),
        geo_points.astype("<i2").tobytes(),
        shade_block(shade_l, shade_r).tobytes(),
        np.asarray(flags, dtype="u1").tobytes(),
        sides.astype("u1").tobytes(),
        np.asarray(acc, dtype="u1").tobytes(),
        np.asarray(slope, dtype="i1").tobytes(),
        cb])


def pack_core(nodes, edges, shade_l, shade_r, geo_counts, geo_points, circuits=None, flags=None,
              force_left=None, force_right=None, acc=None, slope=None, has_slope=True,
              stem="graph", width=BAND_BUCKETS):
    """v8: the same buffer with the shade block LIFTED OUT.

    Two thirds of a v7 artifact is shade (Frankfurt: 17.8 of 26.4 MB raw)
    and a session reads a sliver of it — a walk is at most ~2 h from a known
    departure minute. The core carries everything else plus the map of where
    the shade went (`shade_bands`, `shade_hash`); the bands are separate
    files (`pack_band`). See docs/superpowers/plans/2026-09-10-chunked-graph.md.

    `buckets`, `bucket_start_min` and `bucket_step_min` still describe the
    WHOLE window: the bands are a transport detail and the client's bucket
    arithmetic is unchanged."""
    circuits = circuits or []
    cb = _circuit_bytes(circuits)
    if flags is None:
        flags = np.zeros(len(edges), dtype="u1")
    sides = _side_bits(shade_l, shade_r, force_left, force_right)
    if acc is None:
        acc = np.zeros(len(edges), dtype="u1")
    if slope is None:
        slope = np.zeros(len(edges), dtype="i1")
    block = shade_block(shade_l, shade_r)
    n_buckets = int(block.shape[1])
    header = _header(VERSION_V8, nodes, edges, geo_points, n_buckets,
                     int(sides.shape[1]), cb, len(circuits), has_slope)
    header["shade_hash"] = shade_hash8(block).hex()
    header["shade_bands"] = band_specs(n_buckets, BUCKET_START_MIN,
                                       BUCKET_STEP_MIN, stem, width)
    return framed(header, [
        nodes.astype("<f4").tobytes(),
        edges.astype(EDGE_DTYPE).tobytes(),
        geo_counts.astype("u1").tobytes(),
        geo_points.astype("<i2").tobytes(),
        np.asarray(flags, dtype="u1").tobytes(),
        sides.astype("u1").tobytes(),
        np.asarray(acc, dtype="u1").tobytes(),
        np.asarray(slope, dtype="i1").tobytes(),
        cb])


def pack_band(block, k, bucket0, buckets, hash8):
    """One shade band: a 16-byte prefix, then n_edges x buckets bytes,
    edge-major — the v7 rows sliced on the bucket axis, nothing reordered.

        0..3   magic SWGB
        4..5   u16 band index
        6..7   u16 buckets in this band
        8..15  the core header's shade_hash

    There is no JSON header: a band is one rectangle of bytes whose shape
    the core already states. The prefix exists so that a band which does not
    belong to this core is REFUSED rather than used."""
    block = np.ascontiguousarray(block, dtype="u1")
    check(0 <= bucket0 and bucket0 + buckets <= block.shape[1],
          f"band {k} range {bucket0}+{buckets} outside {block.shape[1]} buckets")
    check(len(hash8) == 8, "shade hash must be 8 bytes")
    body = np.ascontiguousarray(block[:, bucket0:bucket0 + buckets]).tobytes()
    check(len(body) == block.shape[0] * buckets,
          f"band {k} body {len(body)} != {block.shape[0]} x {buckets}")
    return b"".join([BAND_MAGIC, np.uint16(k).tobytes(),
                     np.uint16(buckets).tobytes(), hash8, body])


def core_header(buf):
    """The JSON header of a packed buffer, v7 or v8."""
    check(buf[:4] == MAGIC, f"bad magic {bytes(buf[:4])!r}")
    hlen = int(np.frombuffer(buf[4:8], "<u4")[0])
    return json.loads(buf[8:8 + hlen])


def pack_bands(block, header):
    """Every band file for a v8 core, in band order — the core's own header
    is the single statement of how the block is cut."""
    h8 = bytes.fromhex(header["shade_hash"])
    return [pack_band(block, s["k"], s["bucket0"], s["buckets"], h8)
            for s in header["shade_bands"]]


def unpack_band(buf, header, k):
    """Read one band file back against a v8 core header. Fails loud on a
    prefix that does not match — the same four checks the client makes."""
    check(buf[:4] == BAND_MAGIC, f"band {k}: bad magic {buf[:4]!r}")
    got_k = int(np.frombuffer(buf[4:6], "<u2")[0])
    got_b = int(np.frombuffer(buf[6:8], "<u2")[0])
    spec = header["shade_bands"][k]
    check(got_k == spec["k"], f"band {k}: index {got_k} != {spec['k']}")
    check(got_b == spec["buckets"], f"band {k}: {got_b} buckets != {spec['buckets']}")
    check(bytes(buf[8:16]).hex() == header["shade_hash"],
          f"band {k}: shade hash {bytes(buf[8:16]).hex()} != {header['shade_hash']}")
    e = header["n_edges"]
    check(len(buf) - 16 == e * got_b,
          f"band {k}: body {len(buf) - 16} != {e} x {got_b}")
    return np.frombuffer(buf[16:], "u1").reshape(e, got_b)


def unpack(buf, bands=None):
    """Read v7 or v8. `bands` (v8 only) is the list of band file buffers in
    band order; without them the returned `shade` is None — which is exactly
    the state the client boots in."""
    if buf[:4] != MAGIC:
        raise ValueError("bad magic")
    hlen = int(np.frombuffer(buf[4:8], "<u4")[0])
    header = json.loads(buf[8:8 + hlen])
    version = header["version"]
    if version not in (VERSION_V7, VERSION_V8):
        raise ValueError(f"unsupported version {version}")
    o = 8 + hlen
    n, e, g = header["n_nodes"], header["n_edges"], header["n_geo_points"]
    nodes = np.frombuffer(buf[o:o + 8 * n], "<f4").reshape(n, 2)
    o += 8 * n
    edges = np.frombuffer(buf[o:o + EDGE_DTYPE.itemsize * e], EDGE_DTYPE)
    o += EDGE_DTYPE.itemsize * e
    geo_counts = np.frombuffer(buf[o:o + e], "u1")
    o += e
    geo_points = np.frombuffer(buf[o:o + 4 * g], "<i2")
    o += 4 * g
    b = header["buckets"]
    if version == VERSION_V7:
        shade = np.frombuffer(buf[o:o + e * b], "u1").reshape(e, b)
        o += e * b
    elif bands is None:
        shade = None
    else:
        specs = header["shade_bands"]
        check(len(bands) == len(specs), f"{len(bands)} band buffers != {len(specs)} bands")
        shade = np.concatenate([unpack_band(bands[k], header, k)
                                for k in range(len(specs))], axis=1)
        check(shade.shape == (e, b), f"reassembled shade {shade.shape} != ({e}, {b})")
    if header.get("flags"):
        o += e
    o += e * header.get("side_bytes", 0)
    o += e * header.get("way_bytes", 0) + e * header.get("acc_bytes", 0)
    nc = header.get("circuits_bytes", 0)
    circuits = json.loads(buf[o:o + nc].decode("utf-8")) if nc else []
    return {"header": header, "nodes": nodes, "edges": edges,
            "geo_counts": geo_counts, "geo_points": geo_points,
            "shade": shade, "circuits": circuits}


def write_gz(out_dir, name, gz):
    """Write `gz` as one file, or as byte-slices `<name>.0 … .N-1` when it
    would exceed what Cloudflare Pages accepts for a single asset (v8 bands
    never do; only a core still can). Idempotent: slices left by a previous
    run are removed either way. Returns the part count."""
    whole = out_dir / name
    for stale in out_dir.glob(f"{name}.*"):
        if stale.name[len(name) + 1:].isdigit():
            stale.unlink()
    n_parts = -(-len(gz) // PART_BYTES)
    if n_parts <= 1:
        whole.write_bytes(gz)
    else:
        whole.unlink(missing_ok=True)  # a >25 MiB file in web/public would fail the Pages deploy
        for i in range(n_parts):
            (out_dir / f"{name}.{i}").write_bytes(gz[i * PART_BYTES:(i + 1) * PART_BYTES])
        print(f"{name} is {len(gz) / 1e6:.1f} MB — written as {n_parts} parts; "
              f"set `parts: {n_parts}` on this city in web/src/cities.ts")
    return n_parts


def encode_geometry(edges_gdf):
    """Simplify to <= MAX_PTS intermediates, delta-encode as int16 microdeg."""
    # 1.5 m: at 5 m a curved 157 m sidewalk kept ONE intermediate point and
    # the app drew chords cutting visibly into the street (Jean-Paul,
    # 2026-08-19). Geometry fidelity is what the whole display rides on.
    # 0.8 m: at 1.5 m the plaza footway at Westendbrunnen lost its bend
    # around the REWE building and drew through its corner (2026-08-20)
    simp = edges_gdf.geometry.simplify(0.8)
    coarse = edges_gdf.geometry.simplify(3)
    wgs = gpd.GeoSeries(simp, crs=edges_gdf.crs).to_crs("EPSG:4326")
    wgs_coarse = gpd.GeoSeries(coarse, crs=edges_gdf.crs).to_crs("EPSG:4326")
    counts = np.zeros(len(edges_gdf), dtype=np.uint8)
    pts = []
    for i, (g5, g10) in enumerate(zip(wgs.values, wgs_coarse.values)):
        coords = list(g5.coords)
        if len(coords) - 2 > MAX_PTS:
            coords = list(g10.coords)
        inner = coords[1:-1][:MAX_PTS]
        prev = coords[0]
        for p in inner:
            dlat = round((p[1] - prev[1]) * MICRO)
            dlng = round((p[0] - prev[0]) * MICRO)
            check(abs(dlat) < 32767 and abs(dlng) < 32767,
                  f"geometry delta overflow on edge {i}")
            pts.extend([dlat, dlng])
            prev = p
        counts[i] = len(inner)
    return counts, np.array(pts, dtype=np.int16)


def _budget(label, raw, br, n_edges, n_geo, has_shade):
    """The size line and the budget check, one place for both layouts.

    The size line comes FIRST, so an over-budget city still reports its
    number — bytes/edge is what the budget decision needs."""
    note = " (zero shade — pre-W3 artifact)" if not has_shade else ""
    print(f"{label}: raw {raw / 1e6:.1f} MB, brotli {br / 1e6:.2f} MB "
          f"(budget {BUDGET_BR / 1024 / 1024:.0f} MiB), {br / n_edges:.1f} B/edge brotli, "
          f"{n_geo} geometry points{note}")
    check(br <= BUDGET_BR,
          f"brotli {br / 1e6:.1f} MB exceeds {BUDGET_BR / 1e6:.0f} MB budget")


def gz(buf):
    """gzip level 9, byte-REPRODUCIBLE.

    `gzip.compress(buf, 9)` stamps the current time into the header's MTIME
    field, so two runs over the same input produced identical payloads and
    different bytes — every re-run churned every artifact's ETag, and
    "idempotent and re-runnable" (CLAUDE.md's working agreement) was true of
    the contents and not of the files (S8 review F8). `mtime=0` is the
    documented way to leave it out.
    """
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode="wb", compresslevel=9, mtime=0) as f:
        f.write(buf)
    return out.getvalue()


def emit_v7(out_dir, stem, buf, n_edges, n_geo, has_shade):
    """The one-file artifact, exactly as it has shipped since 2026-08-28."""
    br = brotli.compress(buf, quality=11)
    (out_dir / f"{stem}.bin").write_bytes(buf)
    (out_dir / f"{stem}.bin.br").write_bytes(br)
    # browsers can inflate gzip natively (DecompressionStream); brotli they
    # cannot, and Pages does not compress .bin — so the client fetches .gz
    n_parts = write_gz(out_dir, f"{stem}.bin.gz", gz(buf))
    _budget(stem, len(buf), len(br), n_edges, n_geo, has_shade)
    print(f"OK: {out_dir / (stem + '.bin.gz')}" + (f" in {n_parts} parts" if n_parts > 1 else ""))


def emit_v8(out_dir, stem, core, bands, n_edges, n_geo, has_shade, drop_v7=True):
    """Core plus one file per shade band (backlog B11).

    Idempotent: bands left over from an export with more of them (a wider
    window, or another band width) are removed first, and so are the v7 files
    for this stem unless `drop_v7` says otherwise — a directory must never
    hold both layouts for one city, because sync-artifacts.ps1 copies every
    `graph*.bin.gz*` it finds and the manifest would count the city twice.
    08b_rebands_v7 passes `drop_v7=False`: the v7 artifact is its INPUT, and
    it files it away under `v7/` instead so a re-run still has it.

    The budget is checked on the SUM of the brotli sizes, which is what the
    city costs to hold in full. It is not what a session downloads any more —
    that is the core plus one or two bands — but a budget that only counted
    the first band would stop catching a graph that grew.

    `.bin.br` is written for the core only: it is the artifact of record for
    the budget line and the one file `_headers` names. A band's brotli size
    is computed for the sum and thrown away; nothing fetches it."""
    if drop_v7:
        for stale in list(out_dir.glob(f"{stem}.bin*")):
            stale.unlink()
    for stale in list(out_dir.glob(f"{stem}.shade.*")):
        stale.unlink()
    br_core = brotli.compress(core, quality=11)
    (out_dir / f"{stem}.core.bin").write_bytes(core)
    (out_dir / f"{stem}.core.bin.br").write_bytes(br_core)
    core_parts = write_gz(out_dir, f"{stem}.core.bin.gz", gz(core))
    total_raw = len(core)
    total_br = len(br_core)
    gz_total = (out_dir / f"{stem}.core.bin.gz").stat().st_size if core_parts <= 1 else sum(
        (out_dir / f"{stem}.core.bin.gz.{i}").stat().st_size for i in range(core_parts))
    core_gz = gz_total
    for k, band in enumerate(bands):
        band_gz = gz(band)
        # a band is never near the 25 MiB asset cap — assert it rather than
        # slicing, because a band that needed parts would mean the band width
        # or the edge count moved by an order of magnitude
        check(len(band_gz) <= PART_BYTES,
              f"band {k} gz {len(band_gz) / 1e6:.1f} MB exceeds the "
              f"{PART_BYTES / 1e6:.0f} MB asset slice")
        (out_dir / f"{stem}.shade.{k}.bin.gz").write_bytes(band_gz)
        total_raw += len(band)
        total_br += len(brotli.compress(band, quality=11))
        gz_total += len(band_gz)
        print(f"  band {k}: {len(band) / 1e6:.1f} MB raw, {len(band_gz) / 1e6:.2f} MB gz")
    _budget(f"{stem} (v8, core + {len(bands)} bands)", total_raw, total_br,
            n_edges, n_geo, has_shade)
    print(f"first route needs core {core_gz / 1e6:.2f} MB + 1-2 bands; "
          f"whole city {gz_total / 1e6:.2f} MB gz")
    print(f"OK: {out_dir / (stem + '.core.bin.gz')}"
          + (f" in {core_parts} parts" if core_parts > 1 else "")
          + f" and {len(bands)} shade bands")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--v7", action="store_true",
                    help="write the one-file v7 artifact instead of the v8 core + "
                         "shade bands (the seven cities not yet re-exported)")
    ap.add_argument("--band-buckets", type=int, default=BAND_BUCKETS,
                    help=f"buckets per shade band (default {BAND_BUCKETS} = 2 h)")
    args = ap.parse_args(argv)
    out_dir = OUT
    out_dir.mkdir(parents=True, exist_ok=True)
    # The artifact's file stem, and the name the band files are derived from.
    # It was lost in the v8 rewrite (S8) and main() has referred to an
    # undefined `stem` ever since — a NameError on every run, unnoticed
    # because Frankfurt's v8 files were produced by 08b_rebands_v7.py and no
    # other city had been re-exported. Same expression 08b uses.
    stem = artifact_stem()
    edges = gpd.read_file(WORK / "scored" / "edges_scored.gpkg")
    edges = edges.sort_values("eid").reset_index(drop=True)
    check((edges["eid"] == edges.index).all(), "eid not dense/sorted")
    check("noise_cost" in edges.columns, "run 07_noise_cost.py first")
    G = ox.load_graphml(WORK / "osm" / "graph.graphml")
    # sort by OSM id so node indices are monotone with the (u,v,key) edge
    # sort — the client builds its CSR from that ordering guarantee
    nodes_gdf = ox.graph_to_gdfs(G, edges=False).to_crs("EPSG:4326").sort_index()
    node_ids = {osmid: i for i, osmid in enumerate(nodes_gdf.index)}
    nodes = np.column_stack([nodes_gdf.geometry.y.to_numpy(),
                             nodes_gdf.geometry.x.to_numpy()]).astype("<f4")
    rec = np.zeros(len(edges), dtype=EDGE_DTYPE)
    rec["u"] = [node_ids[u] for u in edges["u"]]
    rec["v"] = [node_ids[v] for v in edges["v"]]
    rec["len_dm"] = np.clip(edges["length"].to_numpy() * 10, 0, 65535).astype("<u2")
    # Walking THROUGH a Kleingarten colony is not a walk: 3,334 edges / 239 km
    # lie strictly inside Frankfurt's 627 allotment polygons, and OSM tags
    # almost none of them (3,080 have no foot tag), so nothing marks them
    # private (Viktor, 2026-08-29). Priced rather than banned: some interior
    # service lanes are the only through-route, and an Infinity would strand
    # people. Raising surface_cost is the lever that needs no new artifact
    # byte and applies to every access mode.
    sc = edges["surface_cost"].to_numpy().copy()
    if "allot" in edges.columns:
        ALLOT_FLOOR = 0.60          # a colony lane costs like cobbles
        inside = edges["allot"].to_numpy() >= 0.5
        bumped = inside & (sc < ALLOT_FLOOR)
        sc[bumped] = ALLOT_FLOOR
        print(f"allotment interiors priced up: {int(bumped.sum())} edges "
              f"(of {int(inside.sum())} inside a colony)")
    rec["surface_q"] = np.round(sc * 255).astype("u1")
    rec["noise_q"] = np.round(edges["noise_cost"].to_numpy() * 255).astype("u1")
    check("green" in edges.columns, "run 13_green_edges.py first")
    rec["green_q"] = np.round(edges["green"].to_numpy() * 255).astype("u1")
    # has_sidewalk from 01b lives on the graph edges
    # graphml round-trips booleans as strings
    hs = {(u, v, k): str(d.get("has_sidewalk", False)) == "True" for u, v, k, d in G.edges(keys=True, data=True)}
    first = lambda x: x[0] if isinstance(x, list) else x
    # 01b's is_crossing is AUTHORITATIVE. Re-deriving from the raw footway tag
    # here silently overrode it: 01b reclassifies a mapped footway=crossing
    # longer than 40 m as walkway (osmnx fuses a short crossing with the
    # sidewalk either side into one edge), but this line put bit2 straight
    # back on from the tag, so the 210 m Frankenallee "crossing" still billed
    # 14 crossings (2026-08-28). Every edge that reaches here carries
    # is_crossing, including the ones 01b and 01c synthesise.
    xing = {(u, v, k): str(d.get("is_crossing", False)) == "True" or str(d.get("is_jaywalk", False)) == "True"
            for u, v, k, d in G.edges(keys=True, data=True)}
    # bit0: street class (a walker is on its sidewalk, mapped or not — the
    # client offsets the drawn line to the shadier side); bit1: OSM had a
    # separately mapped sidewalk that 01b collapsed
    street = edges["highway"].isin(STREET_TYPES).to_numpy()
    mapped = np.array([hs.get((u, v, k), False) for u, v, k in zip(edges["u"], edges["v"], edges["key"])])
    # bit2: a street crossing (footway=crossing / traffic_island) — the router
    # charges a fixed cost per crossing so it does not hop sides for a little shade
    crossing = np.array([xing.get((u, v, k), False) for u, v, k in zip(edges["u"], edges["v"], edges["key"])])
    # bit3: sidewalk edge (any tier), bit4: strong sidewalk (01b) — debug overlay
    tier = edges["sidewalk_tier"].to_numpy().astype(int) if "sidewalk_tier" in edges.columns else np.zeros(len(edges), int)
    # bit5: major road carriageway (primary/secondary/tertiary/trunk) — with a
    # mapped sidewalk (bit1) the router charges 20/m: a 4-lane road is not for
    # walking between crossings (2026-08-17, Bremer Str./Bockenheimer)
    MAJOR = {"primary", "secondary", "tertiary", "trunk", "primary_link", "secondary_link", "tertiary_link", "trunk_link"}
    major = edges["highway"].isin(MAJOR).to_numpy()
    # bit6: cycle crossing (01b) — a bike crossing, walkable at a multiple of
    # the crossing cost (2026-08-18, Eschersheimer/Bremer)
    # bit6 = bike infrastructure: with bit2 a cycle crossing (4x crossing
    # cost), without bit2 a pure cycleway stretch (per-metre penalty)
    cyc = {(u, v, k): str(d.get("is_cycle_crossing", False)) == "True" or str(d.get("is_cycleway", False)) == "True" or str(d.get("is_jaywalk", False)) == "True"
           for u, v, k, d in G.edges(keys=True, data=True)}
    cycle_x = np.array([cyc.get((u, v, k), False) for u, v, k in zip(edges["u"], edges["v"], edges["key"])])
    # bit7: walk on the carriageway CENTRED — car-free road (free) or a street
    # with sidewalk=no on both sides (router adds a penalty when bit0 is set;
    # car-free edges drop bit0). Side-aware model 2026-08-18.
    def gattr(name, default):
        m = {(u, v, k): d.get(name, default) for u, v, k, d in G.edges(keys=True, data=True)}
        return [m.get((u, v, k), default) for u, v, k in zip(edges["u"], edges["v"], edges["key"])]
    # bit3 on a CROSSING edge (bit2): explicitly mapped crosswalk
    # (footway=crossing / traffic_island) — the router prices it below an
    # inferred crossing so organized crosswalks win (2026-08-21)
    marked = np.array([str(x) == "True" for x in gattr("is_xing_tagged", False)])
    carfree = np.array([str(x) == "True" for x in gattr("is_carfree", False)])
    no_sw = np.array([str(x) == "True" for x in gattr("no_sidewalk", False)])
    sw_l0 = np.array([str(x) for x in gattr("sw_left", "-")])
    sw_r0 = np.array([str(x) for x in gattr("sw_right", "-")])
    # a service road without sidewalk evidence is a lane/driveway: drawn at
    # 1 m like sidewalk=no streets (wish 2026-08-20)
    no_sw = no_sw | (edges["highway"].eq("service").to_numpy() & street
                     & ~((sw_l0 == "1") | (sw_r0 == "1")))
    centred = carfree | no_sw
    street = street & ~carfree
    flags = (street.astype("u1") | (mapped.astype("u1") << 1) | (crossing.astype("u1") << 2)
             | ((tier >= 1).astype("u1") << 3) | ((tier >= 2).astype("u1") << 4) | (major.astype("u1") << 5)
             | (cycle_x.astype("u1") << 6) | (centred.astype("u1") << 7)).astype("u1")
    # side clamp for the display: a street walkable on exactly one side
    # forces the drawn side; both/unknown -> the shadier side (status quo)
    sw_l = sw_l0
    sw_r = sw_r0
    force_left = (sw_l == "1") & (sw_r == "0")
    force_right = (sw_r == "1") & (sw_l == "0")
    # bit3 on a STREET edge (bit0) = sidewalk evidence on some side (tag or
    # mapped): drawn 3 m out. A street with no evidence draws at 1 m — right
    # at the road edge (2026-08-20). On non-street edges bit3 keeps meaning
    # "sidewalk edge" (tier >= 1).
    evidence = street & ((sw_l == "1") | (sw_r == "1"))
    flags = (flags | (evidence.astype("u1") << 3)
             | ((marked & crossing).astype("u1") << 3)).astype("u1")
    print(f"marked crossings: {int((marked & crossing).sum())} of {int(crossing.sum())}")
    print(f"sidewalk evidence on {int(evidence.sum())} street edges (3 m offset); rest of streets 1 m")
    print(f"side clamp: {int(force_left.sum())} left-only, {int(force_right.sum())} right-only, {int(centred.sum())} centred")
    print(f"{int(street.sum())} street edges ({int(mapped.sum())} with a mapped sidewalk), {int(crossing.sum())} crossing edges ({int(cycle_x.sum())} cycle)")

    # v6.2: way hash for the turn-aware router (docs/turn-router.md).
    # osmid comes from the graphml (edges_scored.gpkg has no osmid column);
    # merged ways carry a list — the first id identifies the way well enough.
    # accessibility flags2 (docs/accessibility-modes.md, 2026-08-27). Per edge:
    #  bit0 steps                     bit1 ramp usable by strollers (ramp:stroller / untyped)
    #  bit2 ramp:wheelchair           bit3 kerb > 7 cm on a crossing piece
    #  bit4 wheelchair-blocking (wheelchair=no, blocking barrier, gap < 0.9 m)
    #  bit5 limited (wheelchair/stroller=limited, soft barrier, kerb 3-7 cm, 0.9-1.2 m)
    #  bit6 hard (wheel modes excluded: horrible+, sand/mud, sac >= T2, obstacle,
    #       stroller=no, tracktype >= 4, gap < 0.6 m, escalator)
    #  bit7 rough (wheelchair excluded, stroller penalised: bad/very_bad, loose/soft/
    #       cobble surface, sac hiking, tracktype 3, untagged path)
    def gs(name, default=""):
        return [str(x) for x in gattr(name, default)]
    a_steps = np.array([x == "True" for x in gs("acc_steps", False)])
    a_ramp = np.array(gs("acc_ramp", "none"))
    a_conv = np.array([x == "True" for x in gs("acc_conveying", False)])
    a_wc = np.array(gs("acc_wc", ""))
    a_st = np.array(gs("acc_stroller", ""))
    a_sm = np.array([int(float(x)) for x in gs("acc_smooth", -1)])
    a_surf = np.array(gs("acc_surface", "unknown"))
    a_sac = np.array([int(float(x)) for x in gs("acc_sac", -1)])
    a_trail = np.array(gs("acc_trail", ""))
    a_obs = np.array([x == "True" for x in gs("acc_obstacle", False)])
    a_tt = np.array([int(float(x)) for x in gs("acc_tracktype", -1)])
    a_kerb = np.array([float(x) for x in gs("acc_kerb_cm", -1.0)])
    a_bar = np.array(gs("acc_barrier", "none"))
    a_nar = np.array([float(x) for x in gs("acc_narrow_m", -1.0)])
    hwy = edges["highway"].to_numpy()
    b0 = a_steps
    b1 = np.isin(a_ramp, ["stroller", "untyped"])
    b2 = a_ramp == "wheelchair"
    b3 = a_kerb > 7
    b4 = (a_wc == "no") | (a_bar == "block") | ((a_nar > 0) & (a_nar < 0.9))
    b5 = (a_wc == "limited") | (a_st == "limited") | (a_bar == "soft") | ((a_kerb > 3) & (a_kerb <= 7)) | ((a_nar >= 0.9) & (a_nar < 1.2))
    b6 = ((a_sm >= 5) | (a_surf == "bad") | (a_sac >= 2) | a_obs | np.isin(a_trail, ["bad", "horrible", "no"])
          | (a_st == "no") | (a_tt >= 4) | ((a_nar > 0) & (a_nar < 0.6)) | a_conv)
    # WOODLAND soft surfaces (2026-08-28). The same tag means different things
    # by context: fine_gravel in a park is a maintained path, ground/dirt in a
    # forest is a trail. Viktor: "light gravel in park is fine, gravel in
    # forest - no bueno". So inside woodland (13_green_edges' `wood`), a soft
    # or untagged surface is ROUGH — stroller x2.5, wheelchair excluded, walk
    # untouched, which is exactly the asked-for behaviour. compacted,
    # fine_gravel, asphalt and paving_stones stay walkable: the Stadtwald's
    # firm tracks are fine with a pram.
    WOOD_SOFT = ["ground", "dirt", "earth", "grass", "mud", "sand",
                 "woodchips", "pebblestone", "unpaved", "rock", "stone"]
    WOOD_WAYS = ["footway", "path", "track", "bridleway", "cycleway", "service"]
    raw_surf = np.array(["" if (x is None or str(x) == "nan") else str(x)
                         for x in edges["surface"]])
    wood_frac = (edges["wood"].to_numpy() if "wood" in edges.columns
                 else np.zeros(len(edges)))
    in_wood = wood_frac >= 0.5
    b7_wood = (in_wood & np.isin(hwy, WOOD_WAYS)
               & (np.isin(raw_surf, WOOD_SOFT)
                  | ((raw_surf == "") & np.isin(hwy, ["footway", "path"]))))
    b7 = (np.isin(a_sm, [3, 4]) | np.isin(a_surf, ["loose", "soft", "cobble"]) | (a_sac == 1) | (a_tt == 3)
          | ((hwy == "path") & (a_surf == "unknown") & (a_sm < 0))
          | b7_wood)
    print(f"woodland soft surfaces marked rough: {int(b7_wood.sum())} edges")
    acc = (b0.astype("u1") | (b1.astype("u1") << 1) | (b2.astype("u1") << 2) | (b3.astype("u1") << 3)
           | (b4.astype("u1") << 4) | (b5.astype("u1") << 5) | (b6.astype("u1") << 6) | (b7.astype("u1") << 7)).astype("u1")
    print(f"accessibility: steps {int(b0.sum())} (ramp stroller {int(b1.sum())}, wheelchair {int(b2.sum())}), "
          f"kerb>7cm {int(b3.sum())}, wc-block {int(b4.sum())}, limited {int(b5.sum())}, hard {int(b6.sum())}, rough {int(b7.sum())}")
    # Cities 2-8 ship without a DTM (DECISIONS 2026-08-30): no terrain/
    # directory means zero slope and a header flag, not a failure. A terrain/
    # directory that exists but is incomplete is still a failure — that is a
    # half-run 11_slope, not a decision.
    has_slope = (WORK / "terrain").is_dir()
    sp = WORK / "terrain" / "edge_slope_max.npy"
    if has_slope:
        check(sp.exists(), "run 11_slope.py first")
        slope_pct = np.load(sp)
        check(slope_pct.shape[0] == len(edges), f"edge_slope_max rows {slope_pct.shape[0]} != {len(edges)}")
    else:
        slope_pct = np.zeros(len(edges))
        print("no terrain/ for this city — slope zeroed, header slope=false")
    # the DTM has no bridge decks or tunnel floors: an edge on a bridge samples
    # the river bank below (44 % "slope" over the Main, 2026-08-27) — zero the
    # gradient on bridge/tunnel/layered edges
    def gflag(name):
        return np.array([str(x) not in ("", "None", "no", "False", "0", "nan") for x in gattr(name, "")])
    structural = gflag("bridge") | gflag("tunnel") | np.array([str(x) not in ("", "None", "0", "nan") for x in gattr("layer", "")])
    slope_pct = np.where(structural, 0.0, slope_pct)
    print(f"slope zeroed on {int(structural.sum())} bridge/tunnel/layer edges")
    # ...but the tag is often missing. Frankenallee bridges the Galluswarte
    # railway with no bridge tag at all, so 11_slope sampled the deck at one
    # end and the cutting at the other: slope_MAX pinned at the 60 % clamp
    # while slope_MEAN stayed at -8 %. Since the router prices the max, one
    # bad DTM sample charged a stroller 163-326 /m over those edges and
    # routes looped a block south to avoid them (Viktor, 2026-08-28).
    #
    # Signature of a DTM discontinuity: a steep MAX with a flat MEAN. A real
    # ramp lifts both. Fall back to the mean there — it is the honest
    # gradient of the edge, and keeps genuinely steep edges steep.
    mp = WORK / "terrain" / "edge_slope_mean.npy"
    if not has_slope:
        pass
    elif mp.exists():
        slope_mean = np.load(mp)
        check(slope_mean.shape[0] == len(edges),
              f"edge_slope_mean rows {slope_mean.shape[0]} != {len(edges)}")
        SLOPE_MAX_PLAUSIBLE = 25.0   # Frankfurt's steepest real streets are ~12 %
        SLOPE_MEAN_FLAT = 12.0
        bogus = (np.abs(slope_pct) > SLOPE_MAX_PLAUSIBLE) & (np.abs(slope_mean) < SLOPE_MEAN_FLAT) & ~structural
        slope_pct = np.where(bogus, slope_mean, slope_pct)
        print(f"slope: {int(bogus.sum())} edges had a steep max with a flat mean "
              f"(DTM discontinuity) — using the mean instead")
    else:
        print("WARN: edge_slope_mean.npy missing — cannot screen DTM discontinuities")
    slope = np.clip(np.round(slope_pct * 2), -127, 127).astype("i1")  # 0.5 % steps

    # orient every geometry from its SOURCE node: interior vertices are
    # delta-encoded from coords[0], and a piece stored in the other
    # direction draws an out-and-back spike (2026-08-27). Belt and braces
    # for anything 01b/01c synthesise.
    ng_ = ox.graph_to_gdfs(G, edges=False)  # EPSG:25832, same frame as edges
    nx_ = {osmid: (pt.x, pt.y) for osmid, pt in zip(ng_.index, ng_.geometry)}
    from shapely.geometry import LineString as _LS
    flipped = 0
    geoms = []
    for u, g0 in zip(edges["u"], edges.geometry):
        c0, c1 = g0.coords[0], g0.coords[-1]
        ux, uy = nx_[u]
        if (c0[0] - ux) ** 2 + (c0[1] - uy) ** 2 > (c1[0] - ux) ** 2 + (c1[1] - uy) ** 2:
            geoms.append(_LS(list(g0.coords)[::-1])); flipped += 1
        else:
            geoms.append(g0)
    edges = edges.set_geometry(gpd.GeoSeries(geoms, crs=edges.crs, index=edges.index))
    print(f"geometry orientation: {flipped} edges flipped to run from their source node")
    print("encoding geometry...")
    geo_counts, geo_points = encode_geometry(edges)

    st = WORK / "shade" / "sun_table.json"
    check(st.exists(), "run 10_sun_shade.py first (sun_table.json missing)")
    _sun = json.loads(st.read_text())
    global BUCKETS, BUCKET_START_MIN, BUCKET_STEP_MIN
    BUCKETS = int(_sun["buckets"])
    BUCKET_START_MIN = int(_sun["start_min"])
    BUCKET_STEP_MIN = int(_sun["step_min"])
    print(f"sun window from sun_table: {BUCKET_START_MIN // 60:02d}:{BUCKET_START_MIN % 60:02d} "
          f"+ {BUCKETS} x {BUCKET_STEP_MIN} min")
    lp = WORK / "shade" / "edge_shade_L.npy"
    rp = WORK / "shade" / "edge_shade_R.npy"
    check(lp.exists() and rp.exists(), "run 10_sun_shade.py (side-aware) first")
    shade_l = np.load(lp)
    shade_r = np.load(rp)
    check(shade_l.shape == (len(edges), BUCKETS) and shade_r.shape == shade_l.shape,
          f"edge_shade_L/R shape {shade_l.shape}/{shade_r.shape} != ({len(edges)}, {BUCKETS})")
    shade = np.maximum(shade_l, shade_r)  # for the note below only
    cpath = WORK / "circuits" / "circuits.json"
    circuits = []
    if cpath.exists():
        circuits = [c for c in json.loads(cpath.read_text()) if not c.get("vetoed")]
        # eids must be valid for this graph
        circuits = [c for c in circuits if all(0 <= e < len(edges) for e in c["eids"])]
        print(f"circuits: {len(circuits)} (after veto)")
    else:
        print("WARN: no circuits.json — run 14_circuits.py; exporting without catalog")
    if args.v7:
        buf = pack(nodes, rec, shade_l, shade_r, geo_counts, geo_points, circuits, flags,
                   force_left=force_left, force_right=force_right, acc=acc, slope=slope,
                   has_slope=has_slope)
        rt = unpack(buf)
        check(rt["header"]["n_edges"] == len(edges), "roundtrip edge count mismatch")
        check(rt["header"]["version"] == VERSION_V7, "roundtrip version mismatch")
        emit_v7(out_dir, stem, buf, len(edges), len(geo_points) // 2, shade.any())
        export_border()
        return

    core = pack_core(nodes, rec, shade_l, shade_r, geo_counts, geo_points, circuits, flags,
                     force_left=force_left, force_right=force_right, acc=acc, slope=slope,
                     has_slope=has_slope, stem=stem, width=args.band_buckets)
    block = shade_block(shade_l, shade_r)
    bands = pack_bands(block, core_header(core))
    # round-trip through the reader BEFORE anything is written: a core whose
    # bands do not reassemble into exactly the block that went in is not an
    # artifact, it is a wrong route at a wrong time (rule 4)
    rt = unpack(core, bands)
    check(rt["header"]["n_edges"] == len(edges), "roundtrip edge count mismatch")
    check(rt["header"]["version"] == VERSION_V8, "roundtrip version mismatch")
    np.testing.assert_array_equal(rt["shade"], block)
    check_registry_bands(stem, len(bands))
    emit_v8(out_dir, stem, core, bands, len(edges), len(geo_points) // 2, shade.any())
    export_border()


if __name__ == "__main__":
    main()
