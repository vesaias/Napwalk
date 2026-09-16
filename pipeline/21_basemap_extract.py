"""Cut this city's vector basemap out of the Protomaps daily planet build.

The map draws OSM's raster tiles under OSM's tile policy, with a Protomaps
vector basemap behind a build flag - and that one was Frankfurt's file for
all eight cities, because there was only ever one extract. The redesign
(DECISIONS 2026-09-05) wants a themed vector basemap we control, and the app
is static, so every city gets its own: a small .pmtiles beats a runtime
dependency on someone else's tile server.

Nothing is downloaded whole. `tools/pmtiles.exe extract` reads the 138 GB
planet archive over HTTP range requests and pulls only the tiles inside the
bbox — 10-20 seconds and 9-31 MB per city, not a planet download.
The binary lives in tools/ (gitignored, go-pmtiles 1.31.2; see data/README).

Bounds are the place polygon padded PAD_DEG, UNIONED with the city's
registry bounds — the map's maxBounds, carried in cities.py as the twin of
web/src/cities.ts. Both halves are needed. The padded polygon covers a
little more than the graph, because the map must not end in white where a
route can still go (London's polygon is the Inner-London clip, exactly the
extent it routes). The registry bounds cover what a user can pan to, which
is not always inside it: Frankfurt's maxBounds reaches 8.90 E against the
city boundary's 8.82, and cutting to the polygon alone left 5.7 km of blank
map at the east edge of the pannable box.

Only the polygon's LARGEST part counts. Two of the eight geocode to a
multipolygon whose smaller parts are offshore territorial water: Hamburg
owns Neuwerk, 100 km down the Elbe (24 % of its "area"), and San Francisco
the Farallon Islands, 45 km out to sea (41 %). Taking the full bounds
stretches Hamburg's box across 2.3 degrees of northern Germany — Cuxhaven
and Bremerhaven come along for the ride, and the dry run measured 70 MB
against Frankfurt's 14. Neither exclave is reachable in the app anyway:
cities.ts sets Hamburg's maxBounds to exactly the mainland part's bounds.

Build discovery: there is no index. https://build.protomaps.com/<date>.pmtiles
is a daily planet and only the last couple of days survive (20260903 was
already gone on 20260905), so we probe today's UTC date backwards. Plain
urllib gets 403 from that host — its default User-Agent is refused — hence
requests, which the pipeline already uses.

Zoom: z15, since 2026-09-16. Protomaps parks every way tagged access=no
or access=private at z15 (Roads.java, `minZoom = max(minZoom, 15)`), and
German parks tag their footpaths and tracks exactly that way — access=no,
foot=yes, "no vehicles" — so a z14 cut drew the Sinaipark as a blank meadow
while the router walked its paths. Half a minute and 36-82 MiB per city.

Size: the basemaps live on R2 (DEPLOY.md, 2026-09-15), where the only wall
is the sanity cap below; Cloudflare Pages' 25 MiB per-asset limit, which
once forced four of the eight down to z13, no longer applies. A .pmtiles
cannot be sliced into parts the way graph.bin.gz is — MapLibre range-requests
it — so anything over SOFT_MIB is re-cut one zoom coarser instead.

Idempotent: an existing extract younger than MAX_AGE_DAYS is left alone.
Delete the file to force a re-cut.
"""
import json
import subprocess
import time
from datetime import datetime, timedelta, timezone

import requests

from cities import CITIES
from common import CITY, OUT, ROOT, check, place_polygon

BUILD_URL = "https://build.protomaps.com/{date}.pmtiles"
LOOKBACK_DAYS = 14      # daily builds are pruned fast; 14 is generous
PAD_DEG = 0.02          # ~2.2 km north-south, less east-west
MAX_ZOOM = 15           # protomaps parks every access=no|private way at z15
FALLBACK_ZOOM = 14
SOFT_MIB = 150.0        # over this, re-cut one zoom coarser
HARD_MIB = 200.0        # a sanity wall, not a host's: the basemaps live on R2
MIN_MIB = 1.0           # under this the extract is empty or broken
MAX_AGE_DAYS = 30
EXTRACT_TIMEOUT_S = 1800  # a stalled range-request run must not hang the batch

PMTILES = ROOT / "tools" / "pmtiles.exe"
MIB = 1024 * 1024


def latest_build():
    """The newest daily planet that answers, probing back from today (UTC)."""
    today = datetime.now(timezone.utc).date()
    for back in range(LOOKBACK_DAYS):
        date = (today - timedelta(days=back)).strftime("%Y%m%d")
        url = BUILD_URL.format(date=date)
        try:
            r = requests.head(url, timeout=30, allow_redirects=True)
        except requests.RequestException as e:
            print(f"  {date}: {type(e).__name__}")
            continue
        if r.status_code == 200:
            size = int(r.headers.get("Content-Length", 0))
            print(f"build {date}: {size / 1e9:.0f} GB planet, {url}")
            return date
        print(f"  {date}: HTTP {r.status_code}")
    raise SystemExit("SANITY FAIL: no Protomaps daily build in the last "
                     f"{LOOKBACK_DAYS} days — check {BUILD_URL.format(date='YYYYMMDD')}")


def bbox():
    poly = place_polygon()
    parts = sorted(getattr(poly, "geoms", [poly]), key=lambda g: -g.area)
    main = parts[0]
    share = main.area / poly.area
    check(share > 0.5, f"largest part of the {CITY} place polygon holds only "
                       f"{share:.0%} of its area — not one dominant body, "
                       "check cities.py before trusting these bounds")
    if len(parts) > 1:
        print(f"{CITY}: place polygon has {len(parts)} parts; "
              f"cutting to the largest ({share:.0%} of the area), "
              f"dropping {', '.join(f'{g.area / poly.area:.0%}' for g in parts[1:])}")
    w, s, e, n = main.bounds
    padded = (w - PAD_DEG, s - PAD_DEG, e + PAD_DEG, n + PAD_DEG)
    reg = CITIES[CITY]["bounds"]
    box = (min(padded[0], reg[0]), min(padded[1], reg[1]),
           max(padded[2], reg[2]), max(padded[3], reg[3]))
    if box != padded:
        print(f"{CITY}: registry bounds {reg} widen the box to "
              f"{tuple(round(v, 4) for v in box)} — the map pans past the city boundary")
    check(-180 <= box[0] < box[2] <= 180 and -90 <= box[1] < box[3] <= 90,
          f"bbox out of range: {box}")
    check((box[2] - box[0]) * (box[3] - box[1]) < 4.0,
          f"bbox {box} spans {(box[2] - box[0]) * (box[3] - box[1]):.2f} deg2 — too big for one extract")
    return box


def extract(url, box, maxzoom, tmp):
    """Cut into a temp file. Nothing is moved into place until the size is
    known and accepted: a run killed mid-download, or one whose z14 cut is
    too big to ship, must not leave a fresh-looking archive at the real path
    — the age check would then skip the city forever."""
    tmp.unlink(missing_ok=True)
    cmd = [str(PMTILES), "extract", url, str(tmp),
           "--bbox=" + ",".join(f"{v:.4f}" for v in box), f"--maxzoom={maxzoom}"]
    print("$ " + " ".join(cmd), flush=True)
    t0 = time.time()
    r = subprocess.run(cmd, timeout=EXTRACT_TIMEOUT_S)
    check(r.returncode == 0, f"pmtiles extract exited {r.returncode}")
    check(tmp.exists(), f"pmtiles extract wrote no {tmp}")
    mib = tmp.stat().st_size / MIB
    print(f"z{maxzoom}: {mib:.1f} MiB in {time.time() - t0:.0f} s", flush=True)
    return mib


def main():
    check(PMTILES.exists(), f"{PMTILES} missing — see data/README.md for go-pmtiles")
    dest = OUT / "basemap" / f"{CITY}.pmtiles"
    side = dest.with_name(dest.name + ".json")   # which build, which zoom, which box
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and side.exists():
        age = (time.time() - dest.stat().st_mtime) / 86400
        if age < MAX_AGE_DAYS:
            meta = json.loads(side.read_text(encoding="utf-8"))
            print(f"{dest.name}: {dest.stat().st_size / MIB:.1f} MiB, maxzoom "
                  f"{meta['maxzoom']}, build {meta['build']}, cut {meta['cut'][:10]} "
                  f"({age:.0f} days ago) — skipped (delete it to re-cut)")
            print("OK")
            return
        print(f"{dest.name}: {age:.0f} days old, re-cutting")
    elif dest.exists():
        print(f"{dest.name}: no {side.name} sidecar — re-cutting to record its build and zoom")

    box = bbox()
    print(f"{CITY}: bbox {tuple(round(v, 4) for v in box)}")
    build = latest_build()
    url = BUILD_URL.format(date=build)

    # .part, not .tmp.pmtiles: sync-artifacts mirrors this directory and
    # counts *.pmtiles, so a leftover temp would be deployed AND would let a
    # half-finished city pass the guard. finally removes it either way.
    tmp = dest.with_name(dest.name + ".part")
    try:
        zoom = MAX_ZOOM
        mib = extract(url, box, zoom, tmp)
        if mib > SOFT_MIB:
            print(f"WARN {CITY}: {mib:.1f} MiB at z{MAX_ZOOM} is over the "
                  f"{SOFT_MIB:.0f} MiB soft cap — re-cutting at z{FALLBACK_ZOOM} "
                  "(coarser labels and buildings at the closest zooms)", flush=True)
            zoom = FALLBACK_ZOOM
            mib = extract(url, box, zoom, tmp)

        check(mib > MIN_MIB, f"{dest.name} is {mib:.2f} MiB — empty or truncated extract")
        check(mib <= HARD_MIB, f"{dest.name} is {mib:.1f} MiB, over Cloudflare Pages' "
                               f"{HARD_MIB:.0f} MiB per-asset limit even at z{zoom}")
        tmp.replace(dest)
    finally:
        tmp.unlink(missing_ok=True)

    side.write_text(json.dumps({
        "build": build,
        "maxzoom": zoom,
        "bbox": [round(v, 4) for v in box],
        "cut": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }, indent=2) + "\n", encoding="utf-8")
    print(f"{dest}: {mib:.1f} MiB, maxzoom {zoom} (build {build}, recorded in {side.name})")
    print("OK")


if __name__ == "__main__":
    main()
