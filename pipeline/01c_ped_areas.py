"""P1c: freely navigable pedestrian areas (2026-08-21).

Squares like Hauptwache (relation 5710507) are mapped as polygons —
highway=pedestrian ways with area=yes, or multipolygon relations — and
never enter the osmnx walk graph (WALK_FILTER drops area=yes; relations
are not ways). A walker crosses such a square in a straight line, so:

  1. fetch every highway=pedestrian polygon in Frankfurt (cached),
  2. take the walk-graph nodes touching each polygon (boundary and
     interior — mappers often draw virtual footways through squares),
  3. join every mutually visible pair with a straight edge clipped to
     the polygon (holes respected), tagged car-free with the square's
     surface.

The router then just picks the best entry and the best line across.
Downstream stages (surface, noise, green, shade, export) pick the new
edges up from graph.graphml automatically. Runs AFTER 01b: 01b rebuilds
graph.graphml from the raw graph and would drop these edges.

Idempotent: skips when the graph already carries ped-area edges
(rerun 01b to refresh); the Overpass fetch is cached in data/osm.
"""
import geopandas as gpd
import numpy as np
import osmnx as ox
from shapely.geometry import LineString, Point
from shapely.prepared import prep

from common import CRS_UTM, OUT, WORK, check, configure_osmnx, place_polygon

AREAS = WORK / "osm" / "ped_areas.gpkg"
OBSTACLES = WORK / "osm" / "ped_obstacles.gpkg"
GRAPH = WORK / "osm" / "graph.graphml"
MIN_AREA_M2 = 150       # smaller than this a square adds nothing
MAX_AREA_M2 = 120_000   # bigger is a mistagged park/zone, not a square
CLUSTER_M = 2.0         # entry nodes closer than this: keep one (was 8: dropped
                        # Matthias-Beltz-Platz's crossing-corner node 7 m from
                        # the tip -> square had no mesh at all, 2026-08-27)
BUFFER_M = 0.5          # tolerance for "node on boundary" / "line inside"
MAX_ENTRIES = 30        # per polygon, spread-preserving cap
OBST_MIN_SURFACE_M2 = 2000  # only big squares carry mapped street furniture

# things standing ON a square that a stroller cannot roll through — OSM
# maps them as separate features, not as holes in the pedestrian polygon
# (Zeil 2026-08-21: the diagonal cut through tree rows, U-Bahn stairs and
# the Brockhausbrunnen). Each entry: (tags, buffer metres).
OBSTACLE_TAGS = {"building": True, "amenity": ["fountain"],
                 "natural": ["tree", "tree_row", "water"],
                 "highway": ["steps"], "railway": ["subway_entrance"],
                 "barrier": True, "landuse": ["grass", "flowerbed"],
                 "leisure": ["garden", "playground"]}
OBSTACLE_BUF = {"building": 0.5, "fountain": 1.0, "tree": 2.0,
                "tree_row": 2.0, "water": 0.5, "steps": 2.5,
                "subway_entrance": 3.0, "barrier": 0.5, "grass": 0.5,
                "flowerbed": 0.5, "garden": 0.5, "playground": 0.5}


def first(v):
    return v[0] if isinstance(v, list) else v


def fetch_areas():
    if AREAS.exists():
        print(f"{AREAS} exists, loading")
        return gpd.read_file(AREAS)
    # Overpass config lives in common.configure_osmnx(), called from main().
    # This block repeated it with its own default of overpass.private.coffee
    # — a mirror that is now dead — and ran after configure_osmnx(), so it
    # silently won (2026-09-01).
    g = ox.features_from_polygon(place_polygon(), {"highway": "pedestrian"})
    g = g[g.geometry.geom_type.isin(["Polygon", "MultiPolygon"])]
    # respect access tagging the same way WALK_FILTER does
    for col, bad in (("foot", {"no"}), ("access", {"private", "no"})):
        if col in g.columns:
            keep = ~g[col].isin(bad)
            # foot=yes overrides access=no (OSM semantics, cf. WALK_FILTER)
            if col == "access" and "foot" in g.columns:
                keep |= g["foot"].isin(["yes", "designated", "permissive"])
            g = g[keep]
    g = g.to_crs(CRS_UTM)
    cols = [c for c in ("name", "surface", "smoothness") if c in g.columns]
    g = g.reset_index()[["element", "id"] + cols + ["geometry"]] \
        if "element" in g.reset_index().columns else g.reset_index()[["element_type", "osmid"] + cols + ["geometry"]]
    g.columns = ["etype", "osmid"] + cols + ["geometry"]
    g.to_file(AREAS, driver="GPKG")
    return g


def fetch_obstacles(surfaces):
    """Obstacle features on the big walk surfaces — ONE batched Overpass
    request over all surface bboxes (56 per-polygon osmnx queries kept
    timing out / getting throttled, 2026-08-21). Over-fetches each bbox;
    obstacle_union intersects with the true polygon later. Cached."""
    if OBSTACLES.exists():
        print(f"{OBSTACLES} exists, loading")
        return gpd.read_file(OBSTACLES)
    import os
    import requests as rq
    from shapely.geometry import LineString as LS, Polygon as PG
    url = os.environ.get("OVERPASS_URL", "https://overpass-api.de/api") + "/interpreter"
    big = [p for p in surfaces if p.area > OBST_MIN_SURFACE_M2]
    boxes = gpd.GeoSeries(big, crs=CRS_UTM).to_crs("EPSG:4326").bounds
    clauses = []
    for r in boxes.itertuples():
        bb = f"({r.miny:.5f},{r.minx:.5f},{r.maxy:.5f},{r.maxx:.5f})"
        clauses.append(
            f'node["natural"="tree"]{bb};way["natural"~"tree_row|water"]{bb};'
            f'nwr["amenity"="fountain"]{bb};way["highway"="steps"]{bb};'
            f'node["railway"="subway_entrance"]{bb};way["barrier"]{bb};'
            f'way["landuse"~"grass|flowerbed"]{bb};way["leisure"~"garden|playground"]{bb};'
            f'way["building"]{bb};'
            # gates/entrances on barriers: a fence with a gate is passable
            # THERE — punched back out of the obstacle union (wiki
            # Guidelines_for_pedestrian_navigation, queued 2026-08-22)
            f'node["barrier"~"^(gate|entrance|swing_gate|kissing_gate|lift_gate)$"]{bb};'
            f'node["entrance"]{bb};')
    # Chunk count scales with the city: 4 was tuned on Frankfurt, and Berlin
    # has ~5x the pedestrian surfaces, so its chunks 504'd on every retry
    # (2026-08-31). Aim for roughly Frankfurt's bboxes-per-chunk.
    import time
    hdr = {"User-Agent": "shadewalk-pipeline/0.1 (nap-walk router; batch obstacle fetch)"}
    elements = []
    n_chunk = max(4, -(-len(clauses) // 60))
    for ci in range(n_chunk):
        part = clauses[ci::n_chunk]
        q = f"[out:json][timeout:120];({''.join(part)});out geom;"
        print(f"fetching obstacles: chunk {ci + 1}/{n_chunk} ({len(part)} bboxes)...")
        for attempt in range(6):
            resp = rq.post(url, data={"data": q}, timeout=300, headers=hdr)
            if resp.status_code == 200:
                break
            wait = 20 * (attempt + 1)
            print(f"  HTTP {resp.status_code}, retry {attempt + 1}/6 in {wait} s")
            time.sleep(wait)
        check(resp.status_code == 200, f"obstacle fetch HTTP {resp.status_code}")
        elements += resp.json()["elements"]
    kinds, geoms = [], []
    for el in elements:
        t = el.get("tags", {})
        GATES = ("gate", "entrance", "swing_gate", "kissing_gate", "lift_gate")
        kind = (("gate" if (el["type"] == "node"
                            and (t.get("barrier") in GATES or "entrance" in t)
                            and t.get("foot") != "no"
                            and t.get("access") not in ("no", "private")) else None)
                or ("tree" if t.get("natural") == "tree" else None)
                or ("tree_row" if t.get("natural") == "tree_row" else None)
                or ("water" if t.get("natural") == "water" else None)
                or ("fountain" if t.get("amenity") == "fountain" else None)
                or ("steps" if t.get("highway") == "steps" else None)
                or ("subway_entrance" if t.get("railway") == "subway_entrance" else None)
                or ("barrier" if "barrier" in t and el["type"] != "node" else None)
                or ("grass" if t.get("landuse") in ("grass", "flowerbed") else None)
                or ("garden" if t.get("leisure") in ("garden", "playground") else None)
                or ("building" if "building" in t else None))
        if kind is None:
            continue
        if el["type"] == "node":
            geoms.append(Point(el["lon"], el["lat"]))
        elif el["type"] == "way" and el.get("geometry"):
            pts_ = [(p["lon"], p["lat"]) for p in el["geometry"]]
            if len(pts_) < 2:
                continue
            closed = pts_[0] == pts_[-1] and len(pts_) >= 4
            geoms.append(PG(pts_) if closed else LS(pts_))
        else:
            continue
        kinds.append(kind)
    g = gpd.GeoDataFrame({"kind": kinds}, geometry=geoms, crs="EPSG:4326").to_crs(CRS_UTM)
    print(f"  {len(g)} obstacle features")
    g.to_file(OBSTACLES, driver="GPKG")
    return g


def obstacle_union(obs, poly):
    """Buffered union of the obstacles standing on this surface. Gates and
    entrances punch passages back OUT of the union (a fence with a gate is
    passable there)."""
    if len(obs) == 0:
        return None
    hits = obs[obs.geometry.intersects(poly)]
    if len(hits) == 0:
        return None
    from shapely.ops import unary_union
    geoms = [r.geometry.buffer(OBSTACLE_BUF.get(r.kind, 0.5))
             for r in hits.itertuples() if r.kind != "gate"]
    if not geoms:
        return None
    ou = unary_union(geoms)
    gates = [r.geometry.buffer(1.8) for r in hits.itertuples() if r.kind == "gate"]
    if gates:
        ou = ou.difference(unary_union(gates))
    return ou


def main():
    configure_osmnx()
    areas = fetch_areas()
    n_polys = int(sum(len(g.geoms) if g.geom_type == "MultiPolygon" else 1
                      for g in areas.geometry))
    # A broad plausibility band, not Frankfurt's count: Paris has 1,843
    # pedestrianised surfaces against Frankfurt's few hundred, and cities
    # differ enormously in how much they pedestrianise. What this catches is
    # a query that returned nothing or the whole country (2026-09-01).
    check(10 < n_polys < 20_000, f"{n_polys} pedestrian polygons implausible")

    H = ox.load_graphml(GRAPH)
    if any(str(d.get("is_ped_area", False)) == "True"
           for _, _, d in H.edges(data=True)):
        print("graph already has ped-area edges — rerun 01b to refresh; skipping")
        return
    check(CRS_UTM.split(":")[-1] in str(H.graph.get("crs")),
          f"graph CRS {H.graph.get('crs')} is not {CRS_UTM}")

    node_ids = list(H.nodes)
    nodes_xy = np.array([[H.nodes[n]["x"], H.nodes[n]["y"]] for n in node_ids])
    pts = gpd.GeoSeries([Point(x, y) for x, y in nodes_xy], crs=CRS_UTM)
    sindex = pts.sindex

    # merge touching polygons FIRST (Rossmarkt 2026-08-21): a square is
    # often mapped as a patchwork of adjacent pedestrian polygons (surface
    # splits); per-polygon meshing forces every route through the seam
    # nodes — dog-legs instead of one diagonal. Union with a 0.75 m
    # buffer bridge fuses shared edges and hairline seams but can never
    # bridge a real carriageway (>= 5 m). Name/surface come from the
    # largest original constituent.
    from shapely.ops import unary_union
    parts = []  # (poly, name, surface, osmid)
    for row in areas.itertuples():
        geoms = row.geometry.geoms if row.geometry.geom_type == "MultiPolygon" \
            else [row.geometry]
        nm0 = first(getattr(row, "name", None))
        sf0 = first(getattr(row, "surface", None))
        for p in geoms:
            if p.area > MIN_AREA_M2:
                parts.append((p, nm0, sf0, int(row.osmid)))
    fused = unary_union([p.buffer(0.75) for p, _, _, _ in parts]).buffer(-0.75)
    fused_polys = list(fused.geoms) if fused.geom_type == "MultiPolygon" else [fused]
    merged = []
    for poly in fused_polys:
        inside = [t for t in parts if t[0].representative_point().within(poly.buffer(1))]
        if not inside:
            continue
        big = max(inside, key=lambda t: t[0].area)
        merged.append((poly, big[1], big[2], big[3]))
    print(f"{len(parts)} polygons fused into {len(merged)} walk surfaces")

    # punch out the street furniture: what remains is actually rollable
    obs = fetch_obstacles([m[0] for m in merged])
    work = []
    cut = 0
    for poly, nm, surf, oid in merged:
        if not (MIN_AREA_M2 < poly.area < MAX_AREA_M2):
            continue
        ou = obstacle_union(obs, poly) if poly.area > OBST_MIN_SURFACE_M2 else None
        w = poly.difference(ou) if ou is not None else poly
        if ou is not None:
            cut += 1
        pieces = list(w.geoms) if w.geom_type == "MultiPolygon" else [w]
        for piece in pieces:
            if piece.area > MIN_AREA_M2:
                work.append((piece, nm, surf, oid))
    print(f"obstacles punched out of {cut} surfaces -> {len(work)} walkable pieces")

    # ---- visibility mesh (rewritten 2026-08-28) -----------------------
    # Was: farthest-point-thinned "entry" nodes + thinned obstacle-corner
    # vias, joined by the SHORTEST 300 visible pairs. The thinning dropped
    # 516 of 1,904 graph nodes inside surfaces (27 %) from the mesh
    # ENTIRELY, so a node 4 m from a meshed one could only be reached by a
    # 50 m detour through a hub (Hauptwache 2026-08-28), and the shortest-N
    # pair rule selected by DISTANCE, which is not our cost.
    #
    # Now, following Project-OSRM/osrm-backend#7161 (merged): the vertex set
    # is every graph node in the piece plus the corners of its simplified
    # boundary, and we keep RING EDGES (each ring's consecutive corners, so
    # the perimeter of a plaza and the sides of an obstacle are walkable in
    # their own right) plus EVERY visible chord.
    #
    # OSRM prunes the chords to the shortest-path tree from each entry,
    # which is exact for a distance cost and wrong for ours: our cost is a
    # shade field that is not even known at build time (rule 4, arrival
    # time). So we keep the unpruned graph — the mode OSRM exposes as
    # area_emit_visibility_graph — and bound the size with the boundary
    # tolerance instead, because visibility edges grow as V^2 and OSM
    # boundaries carry ~1 vertex per 17 m2. Measured over Frankfurt:
    # no simplification 1,743,840 directed edges (~29 MB brotli, 7x the
    # budget); at 2 m, 109,644 (~1.8 MB). Density is bounded, never
    # membership.
    SIMPLIFY_M = 1.5     # boundary tolerance before taking corners
    V_CAP = 160          # vertices per piece; tolerance escalates to hold it
    MESH_MIN_AREA_M2 = 400   # smaller squares keep their perimeter only
    MERGE_M = 0.5        # vertices closer than this are the same vertex
    MIN_CHORD_M = 1.0    # shorter than this is not worth an edge
    next_id = max(int(x) for x in H.nodes) + 1
    added, used_polys, ring_edges = 0, 0, 0
    skipped_small = 0

    def _emit(a, b, line, oid, nm, surf):
        attrs = {"osmid": oid, "highway": "pedestrian",
                 "length": float(line.length), "oneway": False,
                 "is_carfree": True, "is_ped_area": True,
                 # full 01b attribute set so downstream astype() never meets
                 # NaN on these synthetic edges
                 "is_sidewalk": False, "sidewalk_tier": 0,
                 "has_sidewalk": False, "no_sidewalk": False,
                 "sw_left": "-", "sw_right": "-",
                 "is_crossing": False, "is_cycle_crossing": False,
                 "is_cycleway": False, "is_jaywalk": False,
                 "geometry": line}
        if isinstance(nm, str) and nm:
            attrs["name"] = nm
        if isinstance(surf, str) and surf:
            attrs["surface"] = surf
        H.add_edge(a, b, 0, **attrs)
        H.add_edge(b, a, 0, **dict(attrs))

    max_diag = 0.0
    for poly, nm, surf, oid in work:
        b = poly.bounds
        max_diag = max(max_diag, ((b[2] - b[0]) ** 2 + (b[3] - b[1]) ** 2) ** 0.5)
        if poly.area < MESH_MIN_AREA_M2:
            skipped_small += 1
            continue
        # NOT ported from Valhalla PR #6195: "leave areas that already have
        # pedestrian ways mapped inside untouched". That rule guards against
        # duplicating mapper work, and it is wrong for us — Hauptwache HAS
        # mapped ways inside and still had two nodes 4.2 m apart with a 50 m
        # detour between them (2026-08-28). Our defect is mapped ways that do
        # not interconnect, so the mesh has to complement them, not defer to
        # them. Chords that duplicate an existing edge are skipped below by
        # the has_edge test, which is the part that actually matters.
        # vertices: every graph node in the piece + simplified ring corners
        verts = []          # (x, y, existing node id or None)
        for i in sindex.query(poly.buffer(BUFFER_M), predicate="intersects"):
            verts.append((float(nodes_xy[i][0]), float(nodes_xy[i][1]), node_ids[i]))
        tol = SIMPLIFY_M
        for _ in range(6):
            q = poly.simplify(tol)
            if q.is_empty or q.geom_type != "Polygon" or not q.is_valid:
                q = poly
            rings = [list(q.exterior.coords)[:-1]] + [list(r.coords)[:-1] for r in q.interiors]
            if len(verts) + sum(len(r) for r in rings) <= V_CAP:
                break
            tol *= 2
        corner_start = len(verts)
        for ring in rings:
            for (vx, vy) in ring:
                verts.append((float(vx), float(vy), None))
        # merge coincident vertices (a ring corner sitting on a graph node)
        kept = []
        for vx, vy, nid in verts:
            dup = False
            for kx, ky, _k in kept:
                if (vx - kx) ** 2 + (vy - ky) ** 2 < MERGE_M ** 2:
                    dup = True
                    break
            if not dup:
                kept.append((vx, vy, nid))
        if len(kept) < 2:
            continue
        # materialise the corners as nodes, remembering ring order
        ids, ring_ids = [], []
        for vx, vy, nid in kept:
            if nid is None:
                H.add_node(next_id, x=vx, y=vy)
                ids.append(next_id)
                next_id += 1
            else:
                ids.append(nid)
        idx_of = {(round(vx, 3), round(vy, 3)): ids[k] for k, (vx, vy, _n) in enumerate(kept)}
        inside = prep(poly.buffer(BUFFER_M))
        new_here = 0
        # ring edges: consecutive corners of every ring
        for ring in rings:
            rid = [idx_of.get((round(vx, 3), round(vy, 3))) for vx, vy in ring]
            rid = [r for r in rid if r is not None]
            for k in range(len(rid)):
                a, b = rid[k], rid[(k + 1) % len(rid)]
                if a == b or H.has_edge(a, b) or H.has_edge(b, a):
                    continue
                line = LineString([(H.nodes[a]["x"], H.nodes[a]["y"]),
                                   (H.nodes[b]["x"], H.nodes[b]["y"])])
                if line.length < MIN_CHORD_M:
                    continue
                _emit(a, b, line, oid, nm, surf)
                new_here += 2
                ring_edges += 2
        # every visible chord, unpruned
        for ii in range(len(ids)):
            for jj in range(ii + 1, len(ids)):
                a, b = ids[ii], ids[jj]
                if H.has_edge(a, b) or H.has_edge(b, a):
                    continue
                line = LineString([(H.nodes[a]["x"], H.nodes[a]["y"]),
                                   (H.nodes[b]["x"], H.nodes[b]["y"])])
                if line.length < MIN_CHORD_M or not inside.contains(line):
                    continue
                _emit(a, b, line, oid, nm, surf)
                new_here += 2
        if new_here:
            used_polys += 1
            added += new_here
    print(f"mesh: {added} ped-area edges ({ring_edges} ring) over {used_polys} pieces; "
          f"skipped {skipped_small} below {MESH_MIN_AREA_M2} m2")
    check(added > 0, "no ped-area edges added — fetch or matching broken")
    # Relative to the network, not an absolute: visibility edges grow as V^2
    # per piece, so what matters is whether the mesh has run away, and the
    # network is the natural yardstick. Measured 2026-09-01 — hamburg 0.22x,
    # sf 0.30x, munich 0.31x, paris 1.71x. Paris is a real outlier because it
    # pedestrianises 1,843 surfaces, many of them long thin streets that
    # generate chords while adding little (you walk along such a street, not
    # across it). It passes, but it is the city to watch when the artifact
    # budget is fitted.
    n_net = H.number_of_edges() - added
    check(added < 2.0 * n_net,
          f"{added} ped-area edges = {added / max(n_net, 1):.1f}x the "
          f"{n_net}-edge network — visibility explosion")
    lens = [d["length"] for _, _, d in H.edges(data=True)
            if d.get("is_ped_area") is True]
    # A chord cannot be longer than the diagonal of the piece it spans —
    # that is the actual invariant, and it holds in any city. The old fixed
    # 500 m cap was Frankfurt's largest plaza in disguise: San Francisco has
    # a 98 x 489 m pedestrian way whose legitimate chords reach 526 m
    # (2026-08-31).
    check(max(lens) <= max_diag + 1.0,
          f"ped-area edge of {max(lens):.0f} m exceeds the largest piece "
          f"diagonal ({max_diag:.0f} m) — geometry is wrong")
    ox.save_graphml(H, GRAPH)
    print(f"OK: {added} ped-area edges across {used_polys} polygons "
          f"({n_polys} fetched), {ring_edges} ring, max {max(lens):.0f} m, "
          f"graph now {H.number_of_edges()} edges")


if __name__ == "__main__":
    main()
