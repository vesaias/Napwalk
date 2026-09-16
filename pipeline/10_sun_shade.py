"""W3/P4b-d: a day of sun buckets -> shadow masks -> per-edge shade vectors.

Sheared scanline sweep: orient the grid so light propagates along +rows,
keep a running horizon H per column; a pixel is shadowed when H (dropped
by tan(elevation) per step, shifted by the azimuth's column drift) tops
its own height. One vectorized numpy op per row.

    CITY=frankfurt python -u 10_sun_shade.py
    CITY=frankfurt python -u 10_sun_shade.py --date 2026-12-21
"""
import argparse
import datetime as dt
import json
from zoneinfo import ZoneInfo

import geopandas as gpd
import numpy as np
import rasterio
from astral import Observer
from astral.sun import azimuth, elevation

from common import CENTER as _CENTER, TZ as _TZ, WORK, check

# The observer and timezone are the city's (cities.py). These were
# Frankfurt's constants: over another city's DSM that computes the wrong sun
# for every bucket and silently produces wrong shadows (2026-08-31).
OBS = Observer(latitude=_CENTER[1], longitude=_CENTER[0])
TZ = ZoneInfo(_TZ)
# The bucket window is DERIVED from the modelled date's sunrise/sunset, not
# fixed at 08:00-19:45 (2026-08-28). The old fixed window missed real walking
# time. Step stays 15 min, so the count follows the modelled day: 50 buckets
# on 15 September in Frankfurt, 65 on 21 June, 32 in December
# (tests/test_sun_window.py). The artifact header carries start/step/count
# and the client reads them.
#
# THE MODELLED DAY IS 15 SEPTEMBER — the current season (Viktor, 2026-09-11,
# backlog B14). It was the 15th of whatever month the export ran in until
# 2026-09-10, then 21 June for one day, and it is the 15th of the current
# month again — pinned to an explicit date rather than derived from
# date.today(), so that an export run tomorrow prices the same hours as the
# one committed today and a re-run is a decision rather than a side effect
# of the calendar.
#
# Why not the longest day. 21 June prices the widest window there is, so
# nothing a reader can pick goes unpriced — but a June sun stands HIGHEST,
# which makes a June artifact the year's SHORTEST shadows (P1 review F2).
# Frankfurt at 15:00, a 20 m building: June casts 12.6 m of shadow, April
# 18.6 m, October 43.8 m, December 129 m. An app being walked in September
# should be right in September, so the ruling is the season over the span.
#
# The caveat, stated for September: an equinox model is ACCURATE in spring
# and autumn, OVER-estimates shade in summer (the real June sun is higher
# and its shadows shorter than these) and UNDER-estimates it in winter (the
# real December sun is far lower and its shadows far longer). What is given
# up against June is the 05:30-07:15 and 19:30-21:30 of a midsummer day:
# those minutes fall outside the window, plan/hours.ts `pricedDaylight`
# intersects them away and the leave-at strip does not offer them.
#
# Re-run when the season moves; B15 will make this a client-side pick
# (June + September + December band sets, the reader's date choosing).
MODEL_DATE = (2026, 9, 15)
STEP_MIN = 15
MARGIN_MIN = 8    # start/end this far inside sunrise/sunset. astral's
                  # sunrise/sunset include atmospheric refraction, so the
                  # GEOMETRIC elevation there is -0.833 deg, not 0; the sun
                  # climbs ~0.2 deg/min at this latitude, so a few minutes
                  # are needed before elevation() turns positive at all.
EPS = 0.01
SHADE_DIR = WORK / "shade"


def model_date(year=None):
    """The day the shade is modelled on: MODEL_DATE, or the same month and
    day in another `year`. One place, so the stage, the sun table and the
    tests cannot drift apart."""
    y, m, d = MODEL_DATE
    return dt.date(year or y, m, d)


def sun_window(d, obs=OBS, tz=TZ):
    """(first bucket minute-of-day, bucket count) for the modelled DATE.

    `obs`/`tz` default to this CITY's (common.py); they are parameters so a
    test can ask for another city's window without re-importing the module
    under a different CITY."""
    from astral.sun import sunrise as _sr, sunset as _ss
    sr = _sr(obs, d, tzinfo=tz) + dt.timedelta(minutes=MARGIN_MIN)
    ss = _ss(obs, d, tzinfo=tz) - dt.timedelta(minutes=MARGIN_MIN)
    # snap the start UP to the grid: rounding down would give back the margin
    # and put bucket 0 before the sun is properly above the horizon
    start = -(-(sr.hour * 60 + sr.minute) // STEP_MIN) * STEP_MIN
    end = ss.hour * 60 + ss.minute
    return start, max(1, int((end - start) // STEP_MIN) + 1)


def sun_positions(d, obs=OBS, tz=TZ):
    start, n = sun_window(d, obs, tz)
    out = []
    for i in range(n):
        t = (dt.datetime(d.year, d.month, d.day, 0, 0, tzinfo=tz)
             + dt.timedelta(minutes=start + STEP_MIN * i))
        out.append((float(azimuth(obs, t)), float(elevation(obs, t))))
    return out


def bucket_at(hour, start_min, n_buckets):
    """The bucket nearest a clock HOUR, clamped into the window.

    The sanity checks below used to name bucket indices (8 = "10:00",
    20 = "noon") that were only those hours in the 08:00 window they were
    written for; at 06:30 bucket 8 is 08:30 and at 05:30 it is 07:30. The
    hour is the thing meant, so the hour is what is written."""
    b = round((hour * 60 - start_min) / STEP_MIN)
    return int(max(0, min(n_buckets - 1, b)))


def shadow_mask(z, res, az_deg, el_deg):
    az = np.radians(az_deg)
    # unit vector shadows travel along (away from the sun): east, north
    de, dn = -np.sin(az), -np.cos(az)
    drow, dcol = -dn, de  # row axis points south
    zw = z
    t_pose = abs(dcol) > abs(drow)
    if t_pose:
        zw = zw.T
        drow, dcol = dcol, drow
    f_row = drow < 0
    if f_row:
        zw = zw[::-1]
        drow = -drow
    f_col = dcol < 0
    if f_col:
        zw = zw[:, ::-1]
        dcol = -dcol
    slope = dcol / drow                       # in [0, 1]
    step = res * float(np.hypot(1.0, slope))  # meters per row advance
    drop = np.tan(np.radians(el_deg)) * step
    n_rows, _ = zw.shape
    out = np.zeros(zw.shape, dtype=np.uint8)
    H = zw[0].astype(np.float32).copy()
    shifted = 0
    for r in range(1, n_rows):
        want = int(round(slope * r))
        if want != shifted:
            H[1:] = H[:-1]
            H[0] = -1e9
            shifted = want
        H -= drop
        row = zw[r]
        out[r] = H > row + EPS
        np.maximum(H, row, out=H)
    if f_col:
        out = out[:, ::-1]
    if f_row:
        out = out[::-1]
    if t_pose:
        out = out.T
    return np.ascontiguousarray(out)


SIDE_OFFSET_M = 4.0  # sidewalk distance from the street centerline


def edge_sample_points(edges, transform, shape, side=0.0, z=None):
    """Precompute per-edge sample pixel indices once; reused for 48 buckets.

    side = 0 samples the centerline; +/-SIDE_OFFSET_M samples the left /
    right sidewalk (offset along the local normal, left = +90° from the
    direction of travel). Sunshine differs per street side, and the walker
    picks the shady one — so both are computed.

    Roof guard (2026-08-22, Roßmarkt): a 4 m side offset beside a facade
    lands ON the building roof in the DSM — roofs are sunlit, so narrow
    sidewalks along buildings read as sunny. If the offset sample rises
    more than ROOF_JUMP_M above the centerline sample, shrink the offset
    until it is back at street level (the wall base, where the walker is).
    """
    ROOF_JUMP_M = 3.0
    rows, cols, eids = [], [], []
    for eid, geom in zip(edges["eid"], edges.geometry):
        n = max(3, int(geom.length / 5.0) + 1)
        L = geom.length
        for d in np.linspace(0, L, n):
            p = geom.interpolate(d)
            x0, y0 = p.x, p.y
            x, y = x0, y0
            if side != 0.0 and L > 0:
                a = geom.interpolate(max(0.0, d - 1.0))
                b = geom.interpolate(min(L, d + 1.0))
                dx, dy = b.x - a.x, b.y - a.y
                nrm = np.hypot(dx, dy)
                if nrm > 0:
                    ux, uy = -dy / nrm, dx / nrm  # left normal
                    c0 = int((x0 - transform.c) / transform.a)
                    r0 = int((y0 - transform.f) / transform.e)
                    z0 = z[r0, c0] if (z is not None and 0 <= r0 < shape[0] and 0 <= c0 < shape[1]) else None
                    for f in (1.0, 0.6, 0.3, 0.0):
                        x, y = x0 + ux * side * f, y0 + uy * side * f
                        if z is None or z0 is None or z0 == -9999:
                            break
                        c1 = int((x - transform.c) / transform.a)
                        r1 = int((y - transform.f) / transform.e)
                        if not (0 <= r1 < shape[0] and 0 <= c1 < shape[1]):
                            continue
                        if z[r1, c1] == -9999 or z[r1, c1] - z0 <= ROOF_JUMP_M:
                            break
            c = int((x - transform.c) / transform.a)
            r = int((y - transform.f) / transform.e)
            if 0 <= r < shape[0] and 0 <= c < shape[1]:
                rows.append(r)
                cols.append(c)
                eids.append(eid)
    return (np.array(rows, np.int32), np.array(cols, np.int32),
            np.array(eids, np.int32))


def cached_matches(out_npy, date_iso):
    """Is the cache on disk this date's, for this edge set?

    Three facts have to agree, not one. The row count was the only one
    checked (a stale count failed 14/08 sanity late — lesson of 2026-08-20),
    but with a pinned modelled date the WINDOW can move under a cache too: a
    tree still carrying June's 65-bucket vectors would otherwise be
    "matching" for September's 50-bucket run and every downstream stage
    would quietly ship the wrong hours (B14)."""
    st = SHADE_DIR / "sun_table.json"
    if not st.exists():
        return False, "no sun_table.json beside them"
    tab = json.loads(st.read_text())
    if tab.get("date") != date_iso:
        return False, f"modelled on {tab.get('date')}, want {date_iso}"
    cached = np.load(out_npy, mmap_mode="r")
    if cached.shape[1] != int(tab.get("buckets", -1)):
        return False, f"{cached.shape[1]} buckets cached, sun_table says {tab.get('buckets')}"
    n_now = len(gpd.read_file(WORK / "scored" / "edges_scored.gpkg",
                              ignore_geometry=True))
    if cached.shape[0] != n_now:
        return False, f"{cached.shape[0]} rows cached, {n_now} edges now"
    return True, f"{n_now} edges x {cached.shape[1]} buckets on {date_iso}"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--date", metavar="YYYY-MM-DD", default=None,
                    help="model the sun on this date instead of MODEL_DATE "
                         "(experiments only — nothing in the chain passes it)")
    args = ap.parse_args(argv)
    day = dt.date.fromisoformat(args.date) if args.date else model_date()
    date_iso = day.isoformat()

    SHADE_DIR.mkdir(parents=True, exist_ok=True)
    out_npy = SHADE_DIR / "edge_shade.npy"
    out_L = SHADE_DIR / "edge_shade_L.npy"
    out_R = SHADE_DIR / "edge_shade_R.npy"
    if out_npy.exists() and out_L.exists() and out_R.exists():
        ok, why = cached_matches(out_npy, date_iso)
        if ok:
            print(f"{out_npy} (+L/R) exist and match {why}, "
                  "skipping (delete to recompute)")
            return
        print(f"recomputing shade vectors: {why}")
    START_MIN, BUCKETS = sun_window(day)
    # overlay snapshots at 10:00 / 13:00 / 16:00 / 18:00, as bucket indices in
    # whatever window this date has (they were fixed offsets into 08:00-19:45)
    DISPLAY_BUCKETS = [b for b in
                       ((h * 60 - START_MIN) // STEP_MIN for h in (10, 13, 16, 18))
                       if 0 <= b < BUCKETS]
    pos = sun_positions(day)
    check(all(el > 0 for _, el in pos), "sun below horizon in a bucket")
    print(f"modelled date {date_iso} ({_TZ}) — sun window: "
          f"{START_MIN // 60:02d}:{START_MIN % 60:02d} + "
          f"{BUCKETS} x {STEP_MIN} min -> "
          f"{(START_MIN + STEP_MIN * (BUCKETS - 1)) // 60:02d}:"
          f"{(START_MIN + STEP_MIN * (BUCKETS - 1)) % 60:02d}")
    # a shadow raster is named by its BUCKET index, and the window just moved:
    # last run's shadow_b8.tif is a different hour from this run's, and
    # 12_validate_shade reads them by index. Idempotence means clearing them.
    for stale in sorted(SHADE_DIR.glob("shadow_b*.tif")):
        stale.unlink()
    (SHADE_DIR / "sun_table.json").write_text(json.dumps(
        {"date": date_iso, "tz": _TZ,
         "start_min": START_MIN, "step_min": STEP_MIN, "buckets": BUCKETS,
         "positions": [(round(a, 2), round(e, 2)) for a, e in pos]}, indent=2))

    with rasterio.open(WORK / "dsm" / "city_dsm_1m.tif") as src:
        z = src.read(1)
        transform, meta = src.transform, src.meta
    edges = gpd.read_file(WORK / "scored" / "edges_scored.gpkg")
    edges = edges.sort_values("eid").reset_index(drop=True)
    n_edges = len(edges)
    print("precomputing edge sample points (center, left, right)...")
    sets = {}
    for name, side in (("C", 0.0), ("L", SIDE_OFFSET_M), ("R", -SIDE_OFFSET_M)):
        rows, cols, eids = edge_sample_points(edges, transform, z.shape, side, z=z)
        on_nodata = z[rows, cols] == -9999
        check(on_nodata.mean() < 0.05,
              f"{on_nodata.mean():.1%} of {name} samples outside DSM coverage")
        counts = np.bincount(eids, minlength=n_edges).astype(np.float64)
        counts[counts == 0] = 1
        sets[name] = (rows, cols, eids, on_nodata, counts)
        print(f"  {name}: {len(rows)} points, {on_nodata.mean():.2%} on nodata")

    shade = {k: np.zeros((n_edges, BUCKETS), dtype=np.uint8) for k in sets}
    for i, (az, el) in enumerate(pos):
        mask = shadow_mask(z, 1.0, az, el)
        for name, (rows, cols, eids, on_nodata, counts) in sets.items():
            hit = mask[rows, cols].astype(np.float64)
            hit[on_nodata] = 0.0
            frac = np.bincount(eids, weights=hit, minlength=n_edges) / counts
            shade[name][:, i] = np.round(frac * 255).astype(np.uint8)
        if i in DISPLAY_BUCKETS:
            m = meta | {"dtype": "uint8", "nodata": None, "compress": "deflate"}
            with rasterio.open(SHADE_DIR / f"shadow_b{i}.tif", "w", **m) as dst:
                dst.write(mask, 1)
        print(f"bucket {i:2d} az={az:5.1f} el={el:4.1f} "
              f"city shade={mask.mean():.1%} edge C={shade['C'][:, i].mean() / 255:.1%} "
              f"L={shade['L'][:, i].mean() / 255:.1%} R={shade['R'][:, i].mean() / 255:.1%}")
    np.save(out_npy, shade["C"])
    np.save(out_L, shade["L"])
    np.save(out_R, shade["R"])
    c = shade["C"]
    # by the CLOCK, not by a bucket index: the window is the modelled date's
    # and moves with it, so 13:00 is bucket 20 in an 08:00 window, 30 in
    # June's 05:30 one and 23 in September's 07:15 one (B14)
    b_noon = bucket_at(13, START_MIN, BUCKETS)
    b_ten = bucket_at(10, START_MIN, BUCKETS)
    noon, morning = c[:, b_noon].mean() / 255, c[:, 0].mean() / 255
    check(morning > noon,
          f"first-bucket shade {morning:.0%} <= 13:00 {noon:.0%} — geometry wrong")
    check(0.03 < noon < 0.6, f"13:00 mean shade {noon:.0%} implausible")
    # side-awareness sanity: at 10:00 the two sidewalks must disagree
    # substantially on a real share of edges (N-S canyons)
    diff = np.abs(shade["L"][:, b_ten].astype(int) - shade["R"][:, b_ten].astype(int))
    disagree = (diff > 64).mean()
    check(disagree > 0.10,
          f"only {disagree:.0%} of edges have side-different shade at 10:00 — offsets broken?")
    print(f"OK: {out_npy} (+L/R) {c.shape} on {date_iso}, 13:00 mean {noon:.0%}, "
          f"{START_MIN // 60:02d}:{START_MIN % 60:02d} mean {morning:.0%}, "
          f"side-disagree@10:00 {disagree:.0%}")


if __name__ == "__main__":
    main()
