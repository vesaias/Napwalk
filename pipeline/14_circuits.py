"""P6: circuit catalog — precomputed "known-good" park loops.

Research 2026-08-15 (DECISIONS): live geometric loop heuristics fail on
short urban walks; the products that look good use an OFFLINE library and
compose at runtime. Planar faces of a park's path network are the natural
laps (Gemsa et al. 2013 "Greedy Faces").

Per green pocket (connected component of green edges, from edges_scored):
  1. polygonize the pocket's edge geometries -> faces (each = a closed loop)
  2. circuits = single faces + region-grown merges of adjacent faces (a
     size ladder up to 2500 m) + park outlines (full and interior-only)
  3. map each circuit boundary back to an ordered edge (eid) sequence
  4. score: isoperimetric quotient IQ = 4piA/L^2, turn count, mean
     green/deep/noise/surface, per-bucket shade (48), road crossings
  5. keep top N per pocket -> data/circuits/circuits.json
  6. contact sheet thumbnails -> reports/circuits/<city>/ + index.html for the
     human veto pass (veto ids go to data/circuits/veto.json)

Idempotent; rerun after 06/07/13/10 (needs green, deep, noise, surface, shade).
"""
import json
import math
import time
from pathlib import Path

import geopandas as gpd
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import LineString, MultiLineString, Polygon
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

from common import CITY, REPORTS, WORK, check

GREEN_EDGE = 0.78         # green fraction for an edge to count as park path
POCKET_LINK_M = 1.0       # edges sharing a node are linked (via node ids)
MIN_LEN, MAX_LEN = 300.0, 2500.0
MAX_GROW = 14             # region-growing steps per seed face
TOP_N_PER_POCKET = 6
STREET_TYPES = ["residential", "tertiary", "secondary", "primary", "service", "living_street", "unclassified"]
MIN_IQ = 0.25
# Enclosed area floor. At 15,000 m2 a park smaller than ~1.5 ha could never
# hold a circuit: Von-Bernus-Park (1.54 ha) has 401 m and 313 m rings that
# enclose ~12,800 and ~7,800 m2, and the whole neighbourhood had no circuit
# within 900 m (Viktor, 2026-08-29).
MIN_CIRCUIT_AREA = 6000
W_DEEP = 1.0              # loop depth inside green (park proper vs rim path)
PEEL_MAX_SHARE = 0.08     # interior outline: only slivers this small get peeled off the rim
MAX_STREET = 0.2          # a loop with more of its length on streets is a walk along the road, not in the park
OUT = WORK / "circuits"
SHEET = REPORTS / "circuits" / CITY  # per city: SF's sheet overwrote Frankfurt's (2026-09-01)


def edge_key(a, b):
    return (a, b) if a < b else (b, a)


def passable(edges, mode):
    """Edges a given access mode can use, by the same rule as circuit_modes."""
    if mode == "walk":
        return edges
    surf = edges["surface"].fillna("").astype(str)
    sm = (edges["smoothness"].fillna("").astype(str) if "smoothness" in edges.columns
          else surf.str.slice(0, 0))
    hw = edges["highway"].fillna("").astype(str)
    wood = edges["wood"] if "wood" in edges.columns else 0.0
    soft_in_wood = (wood >= 0.5) & (surf.isin(WOOD_SOFT) | ((surf == "") & hw.isin(["footway", "path"])))
    bad = sm.isin(BAD_SMOOTH)
    ok = ~(soft_in_wood | bad)
    if mode == "wheelchair":
        ok &= hw != "steps"
    return edges[ok]


# Turn DENSITY, not raw count. -0.02 * turns punished a long ring for being
# long and let a wiggly short one through: the median circuit lost 0.08 of a
# 2.06 score, under 4 %. A ring round the Kinderfarm zigzagged into every side
# face at 1.50 turns/100 m and still scored 2.505 (Viktor, 2026-08-29).
# Median density is 0.52, p90 is 1.31, so 0.8 costs a median ring 0.42 and a
# zigzag 1.2 — enough to reorder them without banning bends.
W_TURNS = 0.8
# ...and above this, reject outright. Weighting only reorders: the Kinderfarm
# ring still won its pocket at 1.50 turns/100 m because nothing straighter
# exists there, and nobody walks a lap that doubles back into every side face
# (Viktor, 2026-08-29). Median density is 0.52 and p90 is 1.31, so this drops
# the worst ~10 %; those pockets fall back to a promenade.
MAX_TURN_DENSITY = 1.2
# Turns are counted BEYOND the 4 corners any closed loop must have. As a raw
# per-100 m rate the cap scaled with size and threw away every small park:
# Von-Bernus-Park's four laps are 313-401 m, iq 0.60-0.70, green 1.0, and
# each has exactly 5 turns -- 1.25-1.60 per 100 m, over the cap purely
# because they are short. The whole neighbourhood had no circuit within
# 900 m (Viktor, 2026-08-29).
BASE_TURNS = 4   # corners a simple closed loop needs, not charged as zigzag
# A ring wedged between two arterials is not a nap walk whatever else it
# scores. Ludwig-Erhard-Anlage: a 380 m circuit at noise 0.881 (loudest 8 %)
# was offered as option 1 on maxQuiet, lapped 4x with 1.5 km of walking to
# reach it (Viktor, 2026-08-29). Catalog median is 0.64 and p90 0.85, so this
# drops the worst 10 % and leaves 6 pockets without a ring.
MAX_CIRCUIT_NOISE = 0.85


def build_pockets(edges):
    """Connected components over green edges, by shared node ids. Sidewalks
    along a park's rim street are green by proximity but are not park
    paths — a face bounded by one walks the rim (2026-08-17)."""
    green = edges[(edges["green"] >= GREEN_EDGE) & (edges["sidewalk_tier"].astype(int) < 2)]
    parent = {}

    def find(x):
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for u, v in zip(green["u"], green["v"]):
        union(u, v)
    comp = {}
    for idx, (u, v) in zip(green.index, zip(green["u"], green["v"])):
        comp.setdefault(find(u), []).append(idx)
    return [green.loc[ix] for ix in comp.values() if len(ix) >= 8]


def faces_of(pocket):
    """Polygonize the pocket's undirected edge geometries."""
    # dedupe both directions
    seen = set()
    lines = []
    for r in pocket.itertuples():
        k = edge_key(r.u, r.v)
        if k in seen:
            continue
        seen.add(k)
        lines.append(r.geometry)
    merged = unary_union(lines)
    return [p for p in polygonize(merged) if p.area > 200]


def boundary_walk(poly, pocket_lookup, tree, tol=0.8):
    """Walk the polygon boundary as a closed sequence of directed edges.

    Boundary edges = pocket edges whose endpoints and midpoint lie on the
    ring. Then graph-walk: start at any boundary edge, at each node take the
    unused boundary edge leaving it, until back at the start. Returns list
    of (eid, u, v) or None if the boundary is not a single closed walk.

    `tree` is the STRtree over pocket_lookup's geometries: candidates come
    from a dwithin query, a superset of the exact test (an edge whose
    midpoint and ends are within tol is itself within tol). Testing every
    pocket edge per candidate was 83 % of the stage — 20,879 edges x 11,048
    candidates on Golden Gate Park (2026-09-01).
    """
    ring = poly.exterior
    on = []
    for idx in sorted(tree.query(ring, predicate="dwithin", distance=tol)):
        r = pocket_lookup[idx]
        g = r["geom"]
        if g.length == 0:
            continue
        if ring.distance(r["mid"]) < tol and ring.distance(g.boundary) < tol:
            on.append(r)
    if len(on) < 3:
        return None
    adj = {}
    for r in on:
        adj.setdefault(r["u"], []).append(r)
        adj.setdefault(r["v"], []).append(r)
    # every node on a simple closed walk has degree 2 among boundary edges
    if any(len(v) != 2 for v in adj.values()):
        return None
    start = on[0]
    walk = [(start["eid_fwd"], start["u"], start["v"])]
    used = {id(start)}
    cur = start["v"]
    guard = 0
    while cur != start["u"]:
        nxt = next((r for r in adj[cur] if id(r) not in used), None)
        if nxt is None:
            return None
        used.add(id(nxt))
        if nxt["u"] == cur:
            walk.append((nxt["eid_fwd"], nxt["u"], nxt["v"]))
            cur = nxt["v"]
        else:
            walk.append((nxt["eid_rev"], nxt["v"], nxt["u"]))
            cur = nxt["u"]
        guard += 1
        if guard > 10_000:
            return None
    if len(used) != len(on):
        return None  # boundary edges not all consumed: not one simple ring
    return walk


def turn_count(coords):
    n = 0
    for i in range(1, len(coords) - 1):
        (x0, y0), (x1, y1), (x2, y2) = coords[i - 1], coords[i], coords[i + 1]
        a1 = math.atan2(y1 - y0, x1 - x0)
        a2 = math.atan2(y2 - y1, x2 - x1)
        d = abs((a2 - a1 + math.pi) % (2 * math.pi) - math.pi)
        if d > math.radians(40):
            n += 1
    return n


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    SHEET.mkdir(parents=True, exist_ok=True)
    edges = gpd.read_file(WORK / "scored" / "edges_scored.gpkg")
    edges = edges.sort_values("eid").reset_index(drop=True)
    check("green" in edges.columns and "noise_cost" in edges.columns, "run 07/13 first")
    shade = np.load(WORK / "shade" / "edge_shade.npy")
    check(shade.shape[0] == len(edges), "edge_shade.npy does not match edges")
    veto = set()
    vp = OUT / "veto.json"
    if vp.exists():
        veto = set(json.loads(vp.read_text()))

    # directed twin lookup: (u,v) -> eid
    eid_of = {(u, v): e for u, v, e in zip(edges["u"], edges["v"], edges["eid"])}
    circuits = []
    cid = 0
    # Build rings ONCE PER MODE, over the edges that mode can use. Tagging
    # rings after the fact can only delete: in Sinaipark every ring found on
    # the full green pocket either crossed the Wildnis or took a 27 m
    # staircase, so a pram was offered no lapped loop at all — while the
    # stroller-passable subgraph there holds 16.7 km of path and 13 cycles
    # over 200 m (2026-08-28).
    all_pockets = build_pockets(edges)
    print(f"{len(all_pockets)} pockets")
    pi_base = 0
    for pass_mode in ("walk", "stroller", "wheelchair"):
      mode_pockets = (all_pockets if pass_mode == "walk"
                      else build_pockets(passable(edges, pass_mode)))
      print(f"  pass {pass_mode}: {len(mode_pockets)} pockets")
      for pi_local, pocket in enumerate(mode_pockets):
        pi = pi_base + pi_local
        t_pocket = time.monotonic()
        lookup = []
        seen = set()
        for r in pocket.itertuples():
            k = edge_key(r.u, r.v)
            if k in seen:
                continue
            seen.add(k)
            lookup.append({"u": r.u, "v": r.v, "geom": r.geometry,
                           "mid": r.geometry.interpolate(0.5, normalized=True),
                           "noise": float(r.noise_cost), "deep": float(r.deep), "length": float(r.length),
                           "eid_fwd": eid_of.get((r.u, r.v)),
                           "eid_rev": eid_of.get((r.v, r.u))})
        faces = faces_of(pocket)
        if not faces:
            continue
        polys = faces
        if len(polys) > 200:  # a big park announces itself before the O(faces^2) work
            print(f"    pocket {pi}: {len(pocket)} edges, {len(polys)} faces — growing...", flush=True)
        # street geometry of this pocket (rim roads that got a green score
        # because they run along the park): faces leaning on them are the
        # park's EDGE, not its interior
        street_geoms = [r.geometry for r in pocket.itertuples() if r.highway in STREET_TYPES or bool(r.is_sidewalk)]
        street_zone = unary_union(street_geoms).buffer(0.5) if street_geoms else None

        def street_share_of(poly):
            if street_zone is None:
                return 0.0
            return poly.exterior.intersection(street_zone).length / max(1.0, poly.exterior.length)

        # face adjacency by shared boundary length. Pairs come from an
        # STRtree: Golden Gate Park + Presidio is one pocket of 1,832 faces
        # (2026-09-01), and the pairwise loop was 1.7 M intersects.
        nbrs = {i: [] for i in range(len(polys))}
        ptree = STRtree(polys)
        for i, j in zip(*ptree.query(polys, predicate="intersects")):
            if i >= j:
                continue
            shared = polys[i].boundary.intersection(polys[j].boundary).length
            if shared > 10:
                nbrs[i].append(j)
                nbrs[j].append(i)
        # per-face boundary edges (undirected keys) so a region's boundary
        # is the XOR of its members' boundaries — lets growth see the NOISE
        # of the loop it would walk, not just its shape
        tree = STRtree([r["geom"] for r in lookup])
        attr_of = {edge_key(r["u"], r["v"]): (r["noise"], r["deep"], r["length"]) for r in lookup}
        face_edges = []
        for f in polys:
            ring = f.exterior
            ks = set()
            for idx in tree.query(ring, predicate="dwithin", distance=1.0):
                r = lookup[idx]
                g = r["geom"]
                if g.length == 0:
                    continue
                if ring.distance(g.interpolate(0.5, normalized=True)) < 0.8 and ring.distance(g.boundary) < 0.8:
                    ks.add(edge_key(r["u"], r["v"]))
            face_edges.append(ks)

        def boundary_obj(iq, keys, w_iq=1.5):
            """The catalog's trade-off for a candidate loop: round, quiet,
            and DEEP in the park (rim paths are green but not park proper)."""
            tot = sum(attr_of[k][2] for k in keys)
            if not tot:
                return -9
            noise = sum(attr_of[k][0] * attr_of[k][2] for k in keys) / tot
            deep = sum(attr_of[k][1] * attr_of[k][2] for k in keys) / tot
            return w_iq * iq - 0.8 * noise + W_DEEP * deep

        cands = [(p,) for p in polys]
        # REGION GROWING (2026-08-15, Sinaipark feedback): merges of 2–3
        # faces top out at ~900 m in a park of small faces, leaving nothing
        # between "4 laps of a pocket" and "the rim outline". Grow from every
        # face, always adding the neighbour that gives the best loop by the
        # catalog's own trade-off (round, quiet AND deep — pure roundness
        # swallowed the strip along the rim path and walked the park's edge
        # instead of the path through the middle, 2026-08-16),
        # and record every intermediate region -> a size ladder of interior
        # loops (800, 1200, 1700, 2500 m) per park.
        seen_regions = set()
        for seed in range(len(polys)):
            region = [seed]
            poly = polys[seed]
            bkeys = set(face_edges[seed])
            for _ in range(MAX_GROW):
                best = None
                for j in set(n for i in region for n in nbrs[i]):
                    if j in region:
                        continue
                    u = poly.union(polys[j])
                    if u.geom_type != "Polygon" or len(u.interiors) > 0:
                        continue
                    L = u.exterior.length
                    iq = 4 * math.pi * u.area / (L * L)
                    nk = bkeys ^ face_edges[j]
                    obj = boundary_obj(iq, nk)
                    if best is None or obj > best[0]:
                        best = (obj, j, u, nk)
                if best is None:
                    break
                region.append(best[1])
                poly = best[2]
                bkeys = best[3]
                key = frozenset(region)
                if key not in seen_regions:
                    seen_regions.add(key)
                    cands.append(tuple(polys[k] for k in region))
                if poly.exterior.length > MAX_LEN:
                    break
        # the park's OUTLINE(S): union of all faces — "walk around the park"
        # is the classic walk even when the park is long and thin (low IQ)
        # or has a pathless wood in the middle (a hole). Its exterior ring
        # is a circuit; interiors are dropped (walking around, not through).
        # Two flavours: the full outline (may run on rim streets) and the
        # INTERIOR outline = union of faces not leaning on streets — "walk
        # the park proper all the way round" (Sinaipark feedback 2026-08-15).
        for interior_only in (False, True):
            idxs = [i for i, f in enumerate(faces) if not interior_only or street_share_of(f) < 0.15]
            if not idxs:
                continue
            outline = unary_union([faces[i] for i in idxs])
            for part in getattr(outline, "geoms", [outline]):
                if part.area < MIN_CIRCUIT_AREA:
                    continue
                if not interior_only:
                    cands.append(("outline", part))
                    # a large hole = a pathless wood / lake / meadow — walking
                    # around it is a classic park loop too (Miquelanlage lake)
                    for ring in part.interiors:
                        hole = Polygon(ring)
                        if hole.area >= 8000:
                            cands.append(("outline", hole))
                    continue
                # INTERIOR outline: the bare union's exterior IS the rim
                # path. Trim thin slivers along the rim (a strip between the
                # rim path and the path through the middle) while the loop
                # gets quieter/deeper — shape is not rewarded here, so the
                # peel swaps rim for inner path but never eats the park's
                # fat faces (Sinaipark west lobe, 2026-08-16)
                members = [i for i in idxs if faces[i].within(part.buffer(0.1))]
                poly = Polygon(part.exterior)
                bkeys = set()
                for i in members:
                    bkeys ^= face_edges[i]
                cur = boundary_obj(0, bkeys, w_iq=0)
                for _ in range(200):
                    best = None
                    for i in members:
                        if not (face_edges[i] & bkeys):
                            continue  # not on the boundary
                        if faces[i].area > PEEL_MAX_SHARE * poly.area:
                            continue  # a real piece of the park, not a sliver
                        u = poly.difference(faces[i])
                        if u.geom_type != "Polygon" or len(u.interiors) > 0 or u.area < MIN_CIRCUIT_AREA:
                            continue
                        if u.exterior.length > poly.exterior.length * 1.02:
                            continue  # trimming along the rim shortens the loop; carving a notch lengthens it
                        obj = boundary_obj(0, bkeys ^ face_edges[i], w_iq=0)
                        if best is None or obj > best[0]:
                            best = (obj, i, u)
                    if best is None or best[0] <= cur + 1e-6:
                        break
                    cur, poly = best[0], best[2]
                    bkeys ^= face_edges[best[1]]
                    members.remove(best[1])
                cands.append(("outline", poly))
        pocket_circuits = []
        for group in cands:
            is_outline = isinstance(group, tuple) and len(group) == 2 and group[0] == "outline"
            if is_outline:
                poly = Polygon(group[1].exterior)  # ring only, holes dropped
            else:
                poly = unary_union(group) if len(group) > 1 else group[0]
                if poly.geom_type != "Polygon" or len(poly.interiors) > 0:
                    continue
            L = poly.exterior.length
            if L < MIN_LEN or L > (4000 if is_outline else MAX_LEN):
                continue
            iq = 4 * math.pi * poly.area / (L * L)
            if iq < (0.05 if is_outline else MIN_IQ):
                continue
            walk = boundary_walk(poly, lookup, tree)
            if not walk:
                continue
            eids = [w[0] for w in walk if w[0] is not None]
            if len(eids) != len(walk):
                continue
            sub = edges.iloc[eids]
            length = float(sub["length"].sum())
            if abs(length - L) > 0.15 * L:
                continue  # boundary mapping missed edges
            wlen = sub["length"].to_numpy()
            sh = (shade[eids] * wlen[:, None]).sum(axis=0) / wlen.sum()
            coords = list(poly.exterior.coords)
            # a sidewalk along the park's rim street is the rim too (2026-08-17: sidewalks kept as edges)
            street_mask = sub["highway"].isin(STREET_TYPES) | sub["is_sidewalk"].astype(bool)
            crossings = int(street_mask.sum())
            # share of the circuit's LENGTH that runs on streets (rim roads):
            # an outline along the park's edge streets is not "in the park"
            street_share = float(sub.loc[street_mask, "length"].sum() / max(1.0, sub["length"].sum()))
            if street_share > MAX_STREET:
                continue  # rim-street outlines vetoed (Sinaipark 2026-08-15/16); interior loops cover the park
            c = {
                "id": cid, "pocket": pi, "eids": eids, "nodes": [w[1] for w in walk],
                "length": round(length), "iq": round(iq, 3),
                "turns": turn_count(coords),
                "green": round(float(np.average(sub["green"], weights=wlen)), 3),
                "noise": round(float(np.average(sub["noise_cost"], weights=wlen)), 3),
                "deep": round(float(np.average(sub["deep"], weights=wlen)), 3),
                "surface": round(float(np.average(sub["surface_cost"], weights=wlen)), 3),
                "shade": [int(x) for x in np.round(sh)],
                "crossings": crossings,
                # Which access modes can actually USE this circuit. The
                # catalog was mode-blind, so one circuit served walk,
                # stroller and wheelchair alike and a loop of Sinai-Wildnis
                # trails was offered to a wheelchair (2026-08-28). Bit 0
                # walk, 1 stroller, 2 wheelchair — the composer skips a
                # circuit its mode cannot use.
                "modes": circuit_modes(sub, wlen),
                "street": round(street_share, 3),
                "centroid": [round(poly.centroid.x), round(poly.centroid.y)],
                "wkt": poly.wkt,
            }
            # score: rounder, greener, quieter, fewer turns; shade at 13:00 as tiebreak
            c["outline"] = bool(is_outline)
            c["score"] = round(
                1.5 * iq + 1.0 * c["green"] + W_DEEP * c["deep"] - 0.8 * c["noise"] - 0.5 * c["surface"]
                - W_TURNS * (max(0, c["turns"] - BASE_TURNS) / max(c["length"], 1.0) * 100.0)
                - 0.15 * crossings + 0.3 * (sh[20] / 255)
                - 1.5 * street_share
                + (0.8 if is_outline else 0.0), 3)
            if max(0, c["turns"] - BASE_TURNS) / max(c["length"], 1.0) * 100.0 > MAX_TURN_DENSITY:
                continue                      # zigzag, not a lap
            if c["noise"] > MAX_CIRCUIT_NOISE:
                continue                      # between two arterials
            pocket_circuits.append(c)
            cid += 1
        # keep a LADDER of sizes per 400 m cell (big green complexes — the
        # Grüneburgpark/Palmengarten/Miquelanlage belt is ONE pocket of 4,898
        # edges — need coverage everywhere, not 6 circuits for a dozen parks)
        pocket_circuits.sort(key=lambda c: -c["score"])
        bands = [(300, 500), (500, 800), (800, 1200), (1200, 1700), (1700, 2500), (2500, 4000)]
        by_cell = {}
        for c in pocket_circuits:
            key = (c["centroid"][0] // 400, c["centroid"][1] // 400)
            by_cell.setdefault(key, []).append(c)
        kept = []
        for cell_list in by_cell.values():
            cell_kept = []
            for lo, hi in bands:
                for c in cell_list:
                    if not (lo <= c["length"] < hi):
                        continue
                    se = set(c["eids"])
                    # near-duplicate = shares most of the LARGER circuit; a big
                    # loop that merely contains a kept small face is a
                    # different walk and must survive
                    if all(len(se & set(k["eids"])) / max(len(se), len(k["eids"])) < 0.7 for k in cell_kept):
                        cell_kept.append(c)
                        break
            for c in cell_list:
                if len(cell_kept) >= TOP_N_PER_POCKET:
                    break
                if c in cell_kept:
                    continue
                se = set(c["eids"])
                if all(len(se & set(k["eids"])) / max(len(se), len(k["eids"])) < 0.7 for k in cell_kept):
                    cell_kept.append(c)
            kept.extend(cell_kept)
        circuits.extend(kept)
        dt = time.monotonic() - t_pocket
        if dt > 5:  # a slow pocket shows itself in the log, not by silence
            print(f"    pocket {pi}: {len(pocket)} edges, {len(polys)} faces, "
                  f"{len(cands)} candidates, {len(kept)} kept, {dt:.0f} s", flush=True)
      pi_base += len(mode_pockets)

    # a ring found in more than one pass is one circuit usable by both modes
    merged = {}
    for c in circuits:
        k = frozenset(c["eids"])
        if k in merged:
            merged[k]["modes"] |= c["modes"]
        else:
            merged[k] = c
    circuits = list(merged.values())
    for i, c in enumerate(circuits):
        c["id"] = i

    check(len(circuits) >= 60, f"only {len(circuits)} circuits — polygonize/mapping broken?")
    for c in circuits:
        c["vetoed"] = c["id"] in veto
    (OUT / "circuits.json").write_text(json.dumps(
        [{k: v for k, v in c.items() if k != "wkt"} for c in circuits]))
    print(f"OK: {len(circuits)} circuits from {len(all_pockets)} pockets, "
          f"{sum(1 for c in circuits if c['vetoed'])} vetoed; "
          f"IQ median {np.median([c['iq'] for c in circuits]):.2f}, "
          f"len median {np.median([c['length'] for c in circuits]):.0f} m; "
          f"modes: {sum(1 for c in circuits if c['modes'] & 2)} stroller, "
          f"{sum(1 for c in circuits if c['modes'] & 4)} wheelchair of {len(circuits)}")
    render_sheet(circuits, edges)


# access-mode viability of a circuit, from the same accessibility signals
# 08_export_graph packs into flags2 (docs/accessibility-modes.md)
# A circuit's rough share must be measured the SAME way 08_export_graph sets
# flags2 bit7, or the catalog and the router disagree: a surface_cost >= 0.30
# cutoff called Sinaipark's long ring 14 % rough when the real figure is 7 %,
# and a 5 % threshold then disqualified every circuit in the park (2026-08-28).
WOOD_SOFT = {"ground", "dirt", "earth", "grass", "mud", "sand",
             "woodchips", "pebblestone", "unpaved", "rock", "stone"}
BAD_SMOOTH = {"bad", "very_bad", "horrible", "very_horrible", "impassable"}
# 0.10 admits Sinaipark's 2,433 m ring (7 % rough: compacted/asphalt/fine
# gravel) while excluding the smaller rings that dip into the Wildnis (24-51 %)
STROLLER_ROUGH_SHARE = 0.10
STROLLER_STEPS_M = 15         # a step or two is a lift-over, a staircase is not


def circuit_modes(sub, wlen):
    """Bitmask: 1 walk, 2 stroller, 4 wheelchair."""
    import numpy as _np
    import pandas as _pd
    w = _np.asarray(wlen, dtype=float)
    tot = float(w.sum()) or 1.0
    surf = sub["surface"].fillna("").astype(str)
    sm = (sub["smoothness"].fillna("").astype(str) if "smoothness" in sub.columns
          else _pd.Series([""] * len(sub), index=sub.index))
    hw = sub["highway"].fillna("").astype(str)
    wood = sub["wood"].to_numpy() if "wood" in sub.columns else _np.zeros(len(sub))
    steps = (hw == "steps").to_numpy()
    soft_in_wood = ((wood >= 0.5)
                    & (surf.isin(WOOD_SOFT) | ((surf == "") & hw.isin(["footway", "path"]))).to_numpy())
    bad = sm.isin(BAD_SMOOTH).to_numpy()
    rough = soft_in_wood | bad
    rough_share = float(w[rough].sum()) / tot
    # Steps are a BARRIER for a wheelchair and a lift-over for a pram. One
    # step in Sinaipark's 2,433 m ring disqualified the whole circuit and left
    # the park with no stroller loop at all (2026-08-28); edgeCost already
    # prices a step for a stroller at STEPS_STROLLER_M (400 m-equivalent), so
    # the catalog only needs to reject circuits that are made of them.
    steps_m = float(w[steps].sum())
    m = 1                                          # walking is always fine
    if steps_m <= STROLLER_STEPS_M and rough_share <= STROLLER_ROUGH_SHARE:
        m |= 2
    if not steps.any() and rough_share == 0.0:
        m |= 4
    return int(m)


def render_sheet(circuits, edges):
    """Thumbnail per circuit + index.html for the veto pass."""
    from shapely import wkt as shp_wkt
    thumbs = []
    for c in circuits:
        poly = shp_wkt.loads(c["wkt"])
        minx, miny, maxx, maxy = poly.bounds
        pad = 40
        minx, miny, maxx, maxy = minx - pad, miny - pad, maxx + pad, maxy + pad
        S = 220 / max(maxx - minx, maxy - miny)
        img = Image.new("RGB", (240, 240), "white")
        d = ImageDraw.Draw(img)

        def px(x, y):
            return ((x - minx) * S + 10, (maxy - y) * S + 10)

        # context: nearby edges in light grey, green edges greenish
        box = poly.buffer(pad)
        near = edges[edges.intersects(box)]
        for r in near.itertuples():
            col = (170, 210, 170) if r.green >= GREEN_EDGE else (215, 215, 215)
            d.line([px(*q) for q in r.geometry.coords], fill=col, width=2)
        d.line([px(*q) for q in poly.exterior.coords], fill=(30, 40, 90), width=4)
        name = f"c{c['id']}"
        img.save(SHEET / f"{name}.png")
        thumbs.append((c, name))
    rows = []
    for c, name in thumbs:
        rows.append(
            f'<div class="t" id="{name}"><img src="{name}.png"><div class="m">'
            f'<b>#{c["id"]}</b> p{c["pocket"]} · {c["length"]} m · IQ {c["iq"]} · turns {c["turns"]}<br>'
            f'green {c["green"]} · noise {c["noise"]} · surf {c["surface"]} · cross {c["crossings"]}<br>'
            f'shade13 {c["shade"][20] * 100 // 255}% · score {c["score"]}'
            f'{" · <span class=v>VETOED</span>" if c["vetoed"] else ""}</div></div>')
    html = ("<!doctype html><meta charset=utf-8><title>Circuit catalog</title>"
            "<style>body{font:12px system-ui;margin:12px}.g{display:flex;flex-wrap:wrap;gap:8px}"
            ".t{width:240px;border:1px solid #ddd;padding:4px}.m{padding:4px;line-height:1.35}"
            ".v{color:#b00}</style>"
            f"<h2>{len(thumbs)} circuits — veto ids into data/circuits/veto.json</h2>"
            "<div class=g>" + "".join(rows) + "</div>")
    (SHEET / "index.html").write_text(html, encoding="utf-8")
    print(f"contact sheet: {SHEET / 'index.html'}")


if __name__ == "__main__":
    main()
