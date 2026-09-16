"""Derive the v8 core + shade bands from an EXISTING v7 artifact.

08_export_graph.py writes v8 directly, but re-running it costs a 374 MB
graphml load, a re-simplification of 312 019 geometries and a fresh brotli
pass — and it would re-derive every byte of the artifact from the geodata,
which is a change with a much larger blast radius than "move the shade block
into its own files". This script does only the move: it unpacks the v7
`.bin.gz` (or its `.gz.0 … .N-1` parts) that already shipped, and re-emits

    <stem>.core.bin.gz        the same buffer with the shade block lifted out
    <stem>.shade.K.bin.gz     the block, cut along the time axis

so the core is byte-for-byte the graph the v7 artifact carries and the bands
are byte-for-byte its shade. Nothing is recomputed, so nothing can drift.

Idempotent and re-runnable (CLAUDE.md): it reads data/output, writes into
data/output, removes the v7 files for that stem and any stale bands, and
asserts every step — the v7 header, the section lengths, the reassembly of
the bands into exactly the block that came out, and a full round-trip of the
core through `unpack`. Fails loud.

    CITY=frankfurt python -u 08b_rebands_v7.py
    CITY=frankfurt python -u 08b_rebands_v7.py --band-buckets 8
    CITY=frankfurt python -u 08b_rebands_v7.py --check   # verify, write nothing

Retire this script once every city has been exported by 08 itself.
"""
import argparse
import gzip
import importlib

import numpy as np

from common import OUT, check

_ex = importlib.import_module("08_export_graph")
EDGE_DTYPE = _ex.EDGE_DTYPE
MAGIC = _ex.MAGIC


def v7_dir(out_dir, stem):
    """Where this stem's v7 artifact is: data/output, or data/output/v7 once
    a previous run filed it away. Looking in both is what makes the script
    re-runnable after it has moved its own input."""
    if (out_dir / f"{stem}.bin.gz").exists() or list(out_dir.glob(f"{stem}.bin.gz.*")):
        return out_dir
    return out_dir / "v7"


def read_v7(out_dir, stem):
    """The v7 gzip artifact as raw bytes — one file, or the parts in order.

    A stem with neither is not a mistake this script can work around, and a
    stem with BOTH is a half-finished export nobody should reband."""
    whole = out_dir / f"{stem}.bin.gz"
    parts = sorted(out_dir.glob(f"{stem}.bin.gz.*"),
                   key=lambda p: int(p.name.rsplit(".", 1)[1]))
    check(whole.exists() or parts, f"no v7 artifact for {stem} in {out_dir}")
    check(not (whole.exists() and parts),
          f"{stem}: both {whole.name} and {len(parts)} parts — clean one up first")
    if whole.exists():
        gz = whole.read_bytes()
    else:
        for i, p in enumerate(parts):
            check(p.name.endswith(f".{i}"), f"{stem}: part {i} missing ({p.name})")
        gz = b"".join(p.read_bytes() for p in parts)
    return gzip.decompress(gz)


def reband(buf, stem, width):
    """Split a v7 buffer into (core_bytes, [band_bytes]). Pure.

    The v7 layout puts the shade block between `geo_points` and `flags`, so
    the core is the buffer with that one slice cut out and a new header
    glued on — every other byte is carried over untouched, in order."""
    header = _ex.core_header(buf)
    check(header["version"] == _ex.VERSION_V7,
          f"{stem}: artifact is version {header['version']}, not v7")
    n, e, g = header["n_nodes"], header["n_edges"], header["n_geo_points"]
    b = header["buckets"]
    # locate the sections by the header LENGTH the file itself declares,
    # never by a re-encode of the parsed dict
    hlen = int(np.frombuffer(buf[4:8], "<u4")[0])
    before = 8 + hlen + 8 * n + EDGE_DTYPE.itemsize * e + e + 4 * g
    shade_end = before + e * b
    check(shade_end <= len(buf), f"{stem}: truncated before the shade block")
    block = np.frombuffer(buf[before:shade_end], "u1").reshape(e, b)

    core_header = dict(header)
    core_header["version"] = _ex.VERSION_V8
    core_header["shade_hash"] = _ex.shade_hash8(block).hex()
    core_header["shade_bands"] = _ex.band_specs(
        b, header["bucket_start_min"], header["bucket_step_min"], stem, width)
    core = _ex.framed(core_header, [buf[8 + hlen:before], buf[shade_end:]])
    bands = _ex.pack_bands(block, _ex.core_header(core))
    return core, bands, block


def verify(core, bands, block, v7):
    """Everything the client will check, checked here first."""
    out = _ex.unpack(core, bands)
    check(out["header"]["version"] == _ex.VERSION_V8, "core is not v8")
    np.testing.assert_array_equal(out["shade"], block)
    ref = _ex.unpack(v7)
    np.testing.assert_array_equal(out["shade"], ref["shade"])
    np.testing.assert_array_equal(out["edges"], ref["edges"])
    np.testing.assert_array_equal(out["nodes"], ref["nodes"])
    np.testing.assert_array_equal(out["geo_counts"], ref["geo_counts"])
    np.testing.assert_array_equal(out["geo_points"], ref["geo_points"])
    check(out["circuits"] == ref["circuits"], "circuit catalog changed")
    for key in ("n_nodes", "n_edges", "n_geo_points", "buckets",
                "bucket_start_min", "bucket_step_min", "side_bytes", "acc_bytes",
                "circuits_bytes", "n_circuits", "slope"):
        # .get: the shipped Frankfurt artifact predates the `slope` key, and
        # a key absent from both is still a key that did not change
        check(out["header"].get(key) == ref["header"].get(key),
              f"header {key} changed: {out['header'].get(key)} != {ref['header'].get(key)}")
    # the bands tile the window exactly once
    specs = out["header"]["shade_bands"]
    check(sum(s["buckets"] for s in specs) == ref["header"]["buckets"],
          "bands do not cover the window")
    want = 0
    for s in specs:
        check(s["bucket0"] == want, f"band {s['k']} starts at {s['bucket0']}, expected {want}")
        want += s["buckets"]
    return out["header"]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--band-buckets", type=int, default=_ex.BAND_BUCKETS,
                    help=f"buckets per band (default {_ex.BAND_BUCKETS} = 2 h)")
    ap.add_argument("--check", action="store_true",
                    help="verify the split and print the sizes; write nothing")
    args = ap.parse_args(argv)

    stem = _ex.artifact_stem()
    src = v7_dir(OUT, stem)
    v7 = read_v7(src, stem)
    header = _ex.core_header(v7)
    print(f"{stem}: v7 {len(v7) / 1e6:.1f} MB raw, {header['n_edges']} edges, "
          f"{header['buckets']} buckets from {header['bucket_start_min'] // 60:02d}:"
          f"{header['bucket_start_min'] % 60:02d} every {header['bucket_step_min']} min")
    core, bands, block = reband(v7, stem, args.band_buckets)
    core_header = verify(core, bands, block, v7)
    print(f"shade {block.nbytes / 1e6:.1f} MB raw -> {len(bands)} bands "
          f"(hash {core_header['shade_hash']})")
    if args.check:
        # _ex.gz, not gzip.compress: the same reproducible writer the
        # emit path uses, so --check reports the sizes that will be written
        gz_core = len(_ex.gz(core))
        gz_bands = [len(_ex.gz(b)) for b in bands]
        print(f"core {len(core) / 1e6:.1f} MB raw / {gz_core / 1e6:.2f} MB gz; "
              f"bands gz {[round(x / 1e6, 2) for x in gz_bands]}; "
              f"total gz {(gz_core + sum(gz_bands)) / 1e6:.2f} MB")
        return
    _ex.emit_v8(OUT, stem, core, bands, header["n_edges"], header["n_geo_points"],
                bool(block.any()), drop_v7=False)
    file_away(OUT, stem)


def file_away(out_dir, stem):
    """Move the v7 files out of data/output into data/output/v7.

    They must not stay beside the v8 ones: sync-artifacts.ps1 copies every
    `graph*.bin.gz*` into web/public and cities-manifest.mjs would then count
    Frankfurt's 7.3 MB v7 artifact into the same city as its v8 files. They
    must not be DELETED either — they are this script's input, and a re-run
    (a different band width, a bug found in the split) would have nothing to
    read. So: filed away, one directory up from the deploy."""
    dest = out_dir / "v7"
    dest.mkdir(exist_ok=True)
    moved = []
    for f in sorted(out_dir.glob(f"{stem}.bin*")):
        target = dest / f.name
        target.unlink(missing_ok=True)
        f.replace(target)
        moved.append(f.name)
    if moved:
        print(f"filed away under {dest}: {', '.join(moved)}")


if __name__ == "__main__":
    main()
