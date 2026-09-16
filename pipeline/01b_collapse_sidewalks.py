"""P1b: mark sidewalks and the streets that have them (no longer collapsed).

History: 2026-08-15 collapsed separately-mapped sidewalks into their street
(the router had walked out on the road and back on the sidewalk). 2026-08-17
(Viktor: "OSM has the walkway, use it"): sidewalks are KEPT as edges; the
street edge that has a parallel mapped sidewalk is marked has_sidewalk and
the router charges a carriageway penalty on it, so pedestrians walk the
sidewalk and only step onto the road to cross. Streets without mapped
sidewalks (most of Frankfurt) stay walkable as before; the client draws
them offset onto the shady side.

Rule: a highway=footway or highway=path edge (tagged footway=sidewalk or
not — 70 % of Frankfurt sidewalks carry no subtag, and many walkways
beside streets are mapped as path) that runs parallel (bearing within
25°) to a street edge within 18 m (25 m if tagged sidewalk) is a sidewalk:
is_sidewalk on it, has_sidewalk on the street. Crossings stay.

Idempotent: reads graph_raw.graphml (the untouched fetch), writes
graph.graphml and edges.gpkg. Downstream (06, 07, 13, 10, 14, 08) must
rerun after this.
"""
import numpy as np
import osmnx as ox
import geopandas as gpd
from shapely.strtree import STRtree

from common import WORK, check

OSM = WORK / "osm"
PAR_DIST_M = 18.0        # a walkway this close and parallel to a street is its sidewalk
PAR_DIST_TAGGED_M = 25.0 # tagged footway=sidewalk: believe it even across a wide street
STREET_SW_DIST_M = 25.0  # street -> "has a sidewalk" reach (wide streets)
PAR_ANGLE_DEG = 25.0
# has_sidewalk is a COVERAGE test, not a proximity test (2026-08-27). The
# old rule asked "is a parallel footway within 25 m of this sample point",
# which a footway passes by merely ENDING near the street and running away
# on the far side of a junction: 28 % of all has_sidewalk edges had a
# footway beside them for 0 m of their length, and carried a 12-20 /m
# carriageway penalty for nothing. A sidewalk must now run ALONG the edge.
COVER_SAMPLE_M = 2.0     # sidewalk geometry is sampled this finely
COVER_FRAC = 0.30        # ...and must cover this share of the street edge
COVER_MIN_M = 20.0       # ...or this many metres, whichever comes first
INHERIT_SW_M = 40.0      # junction-piece inheritance needs a sidewalk this close


def bearing(geom):
    (x0, y0), (x1, y1) = geom.coords[0], geom.coords[-1]
    return np.degrees(np.arctan2(y1 - y0, x1 - x0)) % 180.0


def first(v):
    return v[0] if isinstance(v, list) else v


def _samples(geom, step=COVER_SAMPLE_M):
    """Points along a line every `step` m, with each point's local bearing."""
    c = np.asarray(geom.coords)
    pts, brs = [], []
    for i in range(len(c) - 1):
        d = c[i + 1] - c[i]
        seg = float(np.hypot(*d))
        n = max(1, int(round(seg / step)))
        b = np.degrees(np.arctan2(d[1], d[0])) % 180.0
        for k in range(n + 1):
            pts.append(c[i] + d * (k / n))
            brs.append(b)
    if not pts:
        return np.zeros((0, 2)), np.zeros(0)
    return np.asarray(pts), np.asarray(brs)


def covered_metres(street_geom, sw_tree, sw_samples, reach=STREET_SW_DIST_M):
    """Metres of `street_geom` that a parallel mapped sidewalk runs along.

    Each nearby sidewalk sample is projected onto the street edge's OWN
    axis; samples projecting outside the edge's extent are discarded, so a
    footway that merely ends near the edge and heads off across a junction
    contributes nothing. Bins of COVER_SAMPLE_M are marked covered when a
    sample lands in them within `reach` and PAR_ANGLE_DEG of parallel.
    """
    c = np.asarray(street_geom.coords)
    a, b = c[0], c[-1]
    d = b - a
    L = float(np.hypot(*d))
    if L < 1.0:
        return 0.0
    u = d / L
    nrm = np.array([-u[1], u[0]])
    b0 = np.degrees(np.arctan2(d[1], d[0])) % 180.0
    nbins = max(1, int(np.ceil(L / COVER_SAMPLE_M)))
    covered = np.zeros(nbins, dtype=bool)
    for j in sw_tree.query(street_geom.buffer(reach)):
        pts, brs = sw_samples[j]
        if len(pts) == 0:
            continue
        da = np.abs(brs - b0)
        da = np.minimum(da, 180.0 - da)
        m = da <= PAR_ANGLE_DEG
        if not m.any():
            continue
        r = pts[m] - a
        along = r @ u
        perp = np.abs(r @ nrm)
        ok = (along >= 0.0) & (along <= L) & (perp <= reach)
        if ok.any():
            covered[np.clip((along[ok] / COVER_SAMPLE_M).astype(int), 0, nbins - 1)] = True
    return float(covered.mean() * L)


def covering_sidewalks(street_geom, sw_tree, sw_samples, reach=STREET_SW_DIST_M):
    """Indices (into sw_tree's input) of sidewalks that run ALONG this edge."""
    c = np.asarray(street_geom.coords)
    a, b = c[0], c[-1]
    d = b - a
    L = float(np.hypot(*d))
    if L < 1.0:
        return []
    u = d / L
    nrm = np.array([-u[1], u[0]])
    b0 = np.degrees(np.arctan2(d[1], d[0])) % 180.0
    out = []
    for j in sw_tree.query(street_geom.buffer(reach)):
        pts, brs = sw_samples[j]
        if len(pts) == 0:
            continue
        da = np.abs(brs - b0)
        da = np.minimum(da, 180.0 - da)
        m = da <= PAR_ANGLE_DEG
        if not m.any():
            continue
        r = pts[m] - a
        along = r @ u
        perp = np.abs(r @ nrm)
        if ((along >= 0.0) & (along <= L) & (perp <= reach)).any():
            out.append(int(j))
    return out


def has_parallel_sidewalk(street_geom, sw_tree, sw_samples):
    """COVER_FRAC of the edge, or COVER_MIN_M metres, whichever comes first."""
    c = np.asarray(street_geom.coords)
    L = float(np.hypot(*(c[-1] - c[0])))
    if L < 1.0:
        return False
    m = covered_metres(street_geom, sw_tree, sw_samples)
    # OR, not AND: a long edge passes on 20 m of sidewalk even though that is
    # under 30 %, and a short edge passes on 30 % even though that is under
    # 20 m. Erring toward KEEPING the flag keeps the carriageway penalty.
    return m >= COVER_MIN_M or m >= COVER_FRAC * L


def main():
    raw = OSM / "graph_raw.graphml"
    src = OSM / "graph.graphml"
    if not raw.exists():
        src.replace(raw)
    G = ox.load_graphml(raw)
    # walkers ignore oneway: the fetch (custom filter, not network_type=walk)
    # kept car one-way streets one-directional, so a pedestrian could not
    # walk Falkensteiner Straße "against" traffic (found 2026-08-17). Add the
    # reverse edge wherever a street has none.
    from shapely.geometry import LineString
    added = 0
    for u, v, k, d in list(G.edges(keys=True, data=True)):
        if G.has_edge(v, u):
            continue
        d2 = dict(d)
        if "geometry" in d2 and d2["geometry"] is not None:
            d2["geometry"] = LineString(list(d2["geometry"].coords)[::-1])
        d2["reversed"] = True
        # left/right are relative to the way's drawn direction: swap for the
        # reverse copy (side-aware model, 2026-08-18)
        sl, sr = d2.get("sidewalk:left"), d2.get("sidewalk:right")
        if sl is not None or sr is not None:
            d2["sidewalk:left"], d2["sidewalk:right"] = sr, sl
        if d2.get("sidewalk") == "left":
            d2["sidewalk"] = "right"
        elif d2.get("sidewalk") == "right":
            d2["sidewalk"] = "left"
        G.add_edge(v, u, **d2)
        added += 1
    print(f"{added} reverse edges added (walkers ignore oneway)")
    edges = ox.graph_to_gdfs(G, nodes=False).reset_index()
    for col in ("footway", "highway"):
        if col not in edges.columns:
            edges[col] = None
        edges[col] = edges[col].apply(first)
    n0 = len(edges)

    # A mapped footway=crossing longer than XING_MAX_M is not a crossing.
    # osmnx simplification fuses a short crossing with the sidewalk either
    # side of it into ONE edge, and `first(footway)` then reads "crossing"
    # for the whole chain: Frankenallee at Galluswarte became a 210 m
    # "crossing" whose footway tag is literally ['crossing', 'sidewalk']
    # (2026-08-28). The router prices a MAPPED crossing proportionally and
    # uncapped -- the cap in edgeCost() only covers inferred street-piece
    # crossings -- so that edge billed 14 crossings, 1,259 of its 1,932 cost
    # (65 %), and routes detoured around the direct walkway. 1,453 mapped
    # crossings citywide are over 40 m.
    #
    # The proportional rule itself is right and must stay: OSM chops one
    # zebra into 3-6 kerb/island pieces and a per-piece cap made a chopped
    # zebra cost twice an unchopped one (DECISIONS 2026-08-18). Those pieces
    # are short, so this threshold never touches them.
    XING_MAX_M = 40.0
    _lens0 = edges["length"].to_numpy()
    _xing_tag = edges["footway"].isin(["crossing", "traffic_island"])
    _too_long = _xing_tag & (_lens0 > XING_MAX_M)
    if int(_too_long.sum()):
        print(f"{int(_too_long.sum())} mapped crossings over {XING_MAX_M:.0f} m "
              f"reclassified as walkway (merged ways, not crosswalks)")
    # footway OR path (Frankfurt maps many walkways beside streets as highway=path)
    is_crossing = _xing_tag & ~_too_long
    is_sidewalk = edges["highway"].isin(["footway", "path"]) & ~is_crossing
    tagged = edges["footway"].eq("sidewalk")
    # "streets" = carriageways with traffic. A track, or any road with
    # access=no/private (Kirschwaldstraße), is car-free: a walker uses it like
    # a promenade — no sidewalk flag, no carriageway penalty, no crossings
    if "access" not in edges.columns:
        edges["access"] = None
    edges["access"] = edges["access"].apply(first)
    # linear highway=pedestrian is a car-free surface (Fußgängerzone):
    # walked freely, never a crossing (Roßmarkt 2026-08-21: a 40 m
    # pedestrian-zone piece was inferred as a crossing and walled the
    # square off with a 400-cost barrier)
    carfree = (edges["highway"].eq("track") | edges["highway"].eq("pedestrian")
               | edges["access"].isin(["no", "private"]))
    # side-aware sidewalk tags (OSM wiki Key:sidewalk, fetched 2026-08-18):
    # sidewalk=both/left/right/no/none/lane/yes/separate and the
    # sidewalk:left/:right/:both=yes/no/separate refinements. Left/right are
    # relative to the way's direction (reverse copies swapped above).
    for col in ("sidewalk", "sidewalk:left", "sidewalk:right", "sidewalk:both", "foot", "segregated", "shoulder"):
        if col not in edges.columns:
            edges[col] = None
        edges[col] = edges[col].apply(first)

    def _tag(col, i):
        x = edges[col].iat[i]
        # graphml -> gdf yields NaN for missing values, and NaN is TRUTHY —
        # `x or y` silently skipped the bare sidewalk tag on almost every
        # street (found 2026-08-20, Feuerbachstraße)
        if x is None or (isinstance(x, float) and x != x):
            return None
        return x

    def side_state(i, side):
        v = _tag(f"sidewalk:{side}", i) or _tag("sidewalk:both", i)
        if v is None:
            b = _tag("sidewalk", i)
            if b in ("both", "yes", "lane"):
                v = "yes"
            elif b == side:
                v = "yes"
            elif b in ("left", "right"):
                v = "no"  # the tag names only the other side
            elif b in ("no", "none"):
                v = "no"
            elif b == "separate":
                v = "separate"
        if v in ("yes", "lane"):
            return "yes"
        if v == "separate":
            return "sep"
        if v in ("no", "none"):
            return "no"
        return "?"
    streets = edges[~edges["highway"].isin(["footway", "path", "steps", "cycleway"]) & ~carfree].copy()
    streets["bear"] = streets.geometry.apply(bearing)
    tree = STRtree(list(streets.geometry))
    sgeoms = list(streets.geometry)
    sbear = streets["bear"].to_numpy()
    sidx = streets.index.to_numpy()

    is_sw = np.zeros(n0, dtype=bool)
    mapped_left = np.zeros(n0, dtype=bool)
    mapped_right = np.zeros(n0, dtype=bool)
    # tier 2 = clearly a sidewalk (footway within 12 m, or tagged): not a park
    # path, excluded from park faces; tier 1 = a path beside a street or a
    # walkway 12-18 m out — flags the street for the router but may still be
    # a linear park's own path (Schwarzhaupt-Anlage, 2026-08-17)
    sw_tier = np.zeros(n0, dtype=np.int8)
    has_sidewalk = np.zeros(n0, dtype=bool)
    sw = edges[is_sidewalk]
    for i, geom in zip(sw.index, sw.geometry):
        b = bearing(geom)
        mid = geom.interpolate(0.5, normalized=True)
        lim = PAR_DIST_TAGGED_M if tagged[i] else PAR_DIST_M
        cands = tree.query(mid.buffer(lim))
        best, bestd = -1, lim
        for j in cands:
            d = sgeoms[j].distance(mid)
            da = abs(sbear[j] - b)
            da = min(da, 180 - da)
            if d <= bestd and da <= PAR_ANGLE_DEG:
                best, bestd = j, d
        if best >= 0:
            is_sw[i] = True
            strong = bool(tagged[i]) or (edges.at[i, "highway"] == "footway" and bestd <= 12.0)
            sw_tier[i] = 2 if strong else 1
            # NOTE: this loop no longer sets has_sidewalk (2026-08-27). Being
            # the street nearest a sidewalk's MIDPOINT says nothing about
            # whether that sidewalk runs along this edge — the coverage pass
            # below is the single authority. The loop still establishes
            # is_sw / sw_tier and the mapped_left / mapped_right side, which
            # the side clamp needs.
            # which side of the street is this footway on (left of the
            # street's drawn direction = positive cross product)
            sg = sgeoms[best]
            q = sg.project(mid)
            a = sg.interpolate(max(0.0, q - 1.0))
            bpt = sg.interpolate(min(sg.length, q + 1.0))
            cross = (bpt.x - a.x) * (mid.y - a.y) - (bpt.y - a.y) * (mid.x - a.x)
            (mapped_left if cross > 0 else mapped_right)[sidx[best]] = True

    # A footway is classified PER PIECE, by that piece's own bearing against a
    # nearby street. The corner fragments of a continuous sidewalk turn away
    # from the street, fail the PAR_ANGLE_DEG test, and lose sidewalk status
    # while the long straight pieces of the SAME OSM way keep it (way
    # 1551563523: 193 m and 12 m pieces tier 2, the 6 m and 8 m pieces tier 0
    # — 2026-08-28). Anything keyed on is_sidewalk then sees a broken chain.
    #
    # Propagate along the way itself: a short unclassified piece that shares a
    # node with a classified piece of the SAME osmid inherits its tier. Bounded
    # by length so a long way that genuinely leaves the street (a park path
    # continuing off the end of a sidewalk) cannot be dragged along with it.
    INHERIT_PIECE_M = 40.0
    first_id = lambda o: (o[0] if isinstance(o, list) else o)
    ways = {}
    for i, o in enumerate(edges["osmid"]):
        oid = first_id(o)
        if oid is None:
            continue
        ways.setdefault(oid, []).append(i)
    us, vs = edges["u"].to_numpy(), edges["v"].to_numpy()
    piece_len = edges["length"].to_numpy()
    inherited = 0
    for oid, idxs in ways.items():
        if len(idxs) < 2 or not any(is_sw[i] for i in idxs):
            continue
        for _ in range(4):                      # short chains settle quickly
            grew = False
            for i in idxs:
                if is_sw[i] or piece_len[i] >= INHERIT_PIECE_M:
                    continue
                for j in idxs:
                    if not is_sw[j] or i == j:
                        continue
                    if us[i] in (us[j], vs[j]) or vs[i] in (us[j], vs[j]):
                        is_sw[i] = True
                        sw_tier[i] = max(sw_tier[i], sw_tier[j])
                        inherited += 1
                        grew = True
                        break
            if not grew:
                break
    print(f"sidewalk status propagated to {inherited} junction fragments of already-classified ways")
    is_xing = is_crossing.to_numpy().copy()
    lengths = edges["length"].to_numpy()
    # has_sidewalk must cover EVERY street edge that has a sidewalk beside it,
    # not just the one nearest a sidewalk's midpoint (a street is many short
    # edges, a sidewalk one long one -> the rest stayed unflagged and the
    # router walked the carriageway between two mapped sidewalks; 2026-08-17)
    #
    # 2026-08-27: this was three sample points at 0.25/0.5/0.75 asking "is a
    # parallel footway within 25 m of this POINT". A footway that ends near
    # the edge and runs away across a junction passed, so 28 % of flagged
    # streets had a sidewalk beside them for 0 m of their length. It is now
    # a coverage test — see covered_metres().
    cov_geoms = list(edges.geometry[is_sw])
    cov_tree = STRtree(cov_geoms)
    cov_samples = [_samples(g) for g in cov_geoms]
    cov_idx = list(np.where(is_sw)[0])   # cov_geoms[j] is edge cov_idx[j]
    covered_by = {}
    for si, geom in zip(sidx, streets.geometry):
        if has_parallel_sidewalk(geom, cov_tree, cov_samples):
            has_sidewalk[si] = True
            covered_by[si] = covering_sidewalks(geom, cov_tree, cov_samples)

    # NOT DONE: gating bit1 on the mapped sidewalk being reachable
    # off-carriageway from both endpoints. The idea is right — the 12 /m
    # penalty is an anti-duplication device, not a hazard model, so it only
    # makes sense where the duplicate is actually usable — but a union-find
    # over the non-street network is far too blunt a test: it dropped 26,473
    # of 36,985 flags (2026-08-28). Sidewalk chains connect to the street
    # graph at junction nodes that often carry no mapped crossing, so their
    # component never reaches the street endpoint even though a walker
    # plainly can. Needs a bounded-detour reachability test instead.
    # junction pieces: a street piece with no sidewalk within reach (the
    # 25 m test fails inside a wide junction) inherits has_sidewalk from an
    # adjacent piece of the same road (same name) — otherwise a walker gets
    # 20 m of free primary carriageway between two crossings (Bremer/
    # Eschersheimer 2026-08-18)
    if "name" not in edges.columns:
        edges["name"] = None
    edges["name"] = edges["name"].apply(first)
    st_by_node: dict = {}
    for si in sidx:
        for nd in (edges["u"].iat[si], edges["v"].iat[si]):
            st_by_node.setdefault(nd, []).append(si)
    # 2026-08-27: inheritance also needs a sidewalk to actually BE at the
    # junction. Unconditional name propagation carried the flag onto pieces
    # with no footway for 200 m (median 68 m to the nearest sidewalk, against
    # 15 m for the pieces the rule was written for), which is the second
    # source of penalised carriageway with nothing to walk instead.
    def _sidewalk_near(si):
        mid = edges.geometry.iat[si].interpolate(0.5, normalized=True)
        for k in cov_tree.query(mid.buffer(INHERIT_SW_M)):
            if cov_geoms[k].distance(mid) <= INHERIT_SW_M:
                return True
        return False

    inherited = 0
    for _ in range(2):
        for si in sidx:
            if has_sidewalk[si] or not edges["name"].iat[si] or lengths[si] >= 40:
                continue  # only junction-sized pieces inherit
            nm = edges["name"].iat[si]
            for nd in (edges["u"].iat[si], edges["v"].iat[si]):
                if any(has_sidewalk[sj] and edges["name"].iat[sj] == nm for sj in st_by_node.get(nd, []) if sj != si):
                    if _sidewalk_near(si):
                        has_sidewalk[si] = True
                        inherited += 1
                    break
    print(f"junction pieces inheriting has_sidewalk: {inherited}")
    # road-hop crossings: a short street piece (< 25 m) whose both ends touch a
    # sidewalk edge is how a walker crosses where no crossing edge is mapped
    sw_nodes = set(edges.loc[is_sw, "u"]) | set(edges.loc[is_sw, "v"])
    # junction crossings (2026-08-17, Bockenheimer/Freiherr-vom-Stein): a
    # short side-street piece touching a MAJOR road's node is how a walker
    # crosses the major road through the junction — cost it like a crossing,
    # else the marked crossing 40 m away never wins. Roundabout carriageway
    # pieces likewise (nobody walks the ring).
    MAJOR = {"primary", "secondary", "tertiary", "trunk", "primary_link", "secondary_link", "tertiary_link", "trunk_link"}
    major_nodes = set(edges.loc[edges["highway"].isin(MAJOR), "u"]) | set(edges.loc[edges["highway"].isin(MAJOR), "v"])
    if "junction" not in edges.columns:
        edges["junction"] = None
    edges["junction"] = edges["junction"].apply(first)
    STREETISH = ("residential", "unclassified", "living_street")
    streetish = edges["highway"].isin(STREETISH).to_numpy()
    is_jaywalk = np.zeros(n0, dtype=bool)

    def _interior_crosses(si):
        # a street piece whose geometry crosses another street's INTERIOR
        # (not at a shared node) runs over the carriageway where no junction
        # and no crosswalk exists — a fork/median link (Hügelstraße/
        # Holzhausenstraße 36877720, 2026-08-20)
        geom = edges.geometry.loc[si]
        for j in tree.query(geom):
            if sgeoms[j].crosses(geom):
                return True
        return False

    # a pedestrian-zone piece is a walking surface, never a crossing —
    # cars are guests there (Roßmarkt 2026-08-21)
    pedz = edges["highway"].eq("pedestrian").to_numpy()
    for j, si in enumerate(sidx):
        if pedz[si]:
            continue
        r = edges.loc[si]
        if r["length"] < 25 and r["u"] in sw_nodes and r["v"] in sw_nodes:
            if streetish[si] and _interior_crosses(si):
                is_jaywalk[si] = True
            else:
                is_xing[si] = True
        elif r["highway"] not in MAJOR and r["length"] < (70 if streetish[si] else 40) and (r["u"] in major_nodes or r["v"] in major_nodes):
            # minor STREETS get the longer leash: Bertramstraße's 55/64 m
            # through-pieces walked over Adickesallee for free (2026-08-20)
            is_xing[si] = True
        elif r["junction"] == "roundabout":
            is_xing[si] = True
    # cycle-crossing pieces at a major junction (Bremer Str./Hansaallee): a
    # short cycleway touching a major road's node is a crossing piece too
    cyc = np.where(edges["highway"].eq("cycleway").to_numpy() & (lengths < 40))[0]
    for i in cyc:
        if edges["u"].iat[i] in major_nodes or edges["v"].iat[i] in major_nodes:
            is_xing[i] = True
    # crossings: tagged footway=crossing OR any footway/path whose geometry
    # crosses a street centreline (many Frankfurt crossings carry no tag —
    # without the crossing cost the router hops sides for a shorter block)
    # any non-major walkable edge can be a crossing piece: footway/path, but
    # also cycleway and service/residential stubs (Bockenheimer/KfW, Bremer/
    # Hansaallee, Eschersheimer 2026-08-17 crossed on cycleway/service pieces)
    MAJOR0 = {"primary", "secondary", "tertiary", "trunk", "primary_link", "secondary_link", "tertiary_link", "trunk_link"}
    walk = ~edges["highway"].isin(MAJOR0).to_numpy()
    lengths = edges["length"].to_numpy()

    def _names(v):
        if isinstance(v, (list, tuple, set)):
            return {str(x) for x in v if isinstance(x, str)}
        return {v} if isinstance(v, str) and v else set()

    def _classes(v):
        if isinstance(v, (list, tuple, set)):
            return {str(x) for x in v}
        return {v} if isinstance(v, str) else set()

    enames = edges["name"] if "name" in edges.columns else None
    snames = streets["name"].tolist() if "name" in streets.columns else [None] * len(sgeoms)
    shws = streets["highway"].tolist()
    # only SHORT edges can be crossing pieces: a long service lane that
    # intersects a street mid-way is a road junction, not a zebra — flagged
    # whole, it cost 150 x len/15 and blocked the lane (way 4742038 area,
    # 2026-08-19). Minor STREETS get a longer leash (70 m) but only when
    # they cross a MAJOR road — Bertramstraße's 55/64 m pieces walked over
    # Adickesallee for free (2026-08-20).
    cand = walk & ~is_xing & ~pedz & ((lengths <= 40) | (streetish & (lengths <= 70)))
    for i in np.where(cand)[0]:
        geom = edges.geometry.iat[i]
        for j in tree.query(geom):
            if sgeoms[j].crosses(geom):
                if lengths[i] > 40 and not (_classes(shws[j]) & MAJOR0):
                    continue
                # a STREET piece that crosses a road's INTERIOR (no shared
                # node — real junctions are split at nodes) is roadway at a
                # fork/link, not a crosswalk: jaywalk, priced high by the
                # router (Hügelstraße fork, Holzhausenstraße 36877720,
                # 2026-08-20). Service stubs stay crossings (Bockenheimer/
                # KfW 2026-08-17 crossed on service pieces at signals).
                if streetish[i]:
                    is_jaywalk[i] = True
                else:
                    is_xing[i] = True
                break
        # the on-carriageway test only for non-street classes: a residential
        # stub split at a junction is a street piece the walker turns into, not
        # a crossing
        if is_xing[i] or lengths[i] > 30 or edges["highway"].iat[i] in ("residential", "unclassified", "living_street"):
            continue
        # half-crossing: short piece ending ON the street node, midpoint on the
        # carriageway and at an angle to it (a sidewalk piece is parallel) —
        # overrides an earlier sidewalk classification (Humserstraße, 2026-08-17)
        mid = geom.interpolate(0.5, normalized=True)
        b = bearing(geom)
        for j in tree.query(mid.buffer(5.0)):
            da = abs(sbear[j] - b)
            da = min(da, 180 - da)
            if sgeoms[j].distance(mid) <= 5.0 and da >= 45.0:
                is_xing[i] = True
                break
    # a walkway of ANY length whose geometry crosses a MAJOR road's interior
    # is a crossing whatever it is tagged (Eschersheimer 2026-08-27: a 78 m
    # footway=sidewalk drawn straight across the four lanes was walked for
    # free because it exceeded the 40 m candidate cap)
    long_x = 0
    major_geoms = [(sgeoms[j], _classes(shws[j]) & MAJOR0) for j in range(len(sgeoms))]
    for i in np.where(walk & ~is_xing & ~pedz & ~streetish & (lengths > 40))[0]:
        geom = edges.geometry.iat[i]
        for j in tree.query(geom):
            if major_geoms[j][1] and sgeoms[j].crosses(geom):
                is_xing[i] = True
                long_x += 1
                break
    print(f"long walkways crossing a major carriageway -> crossings: {long_x}")
    # a footway/path/cycleway that ENDS on a major road's centreline node has
    # walked half the carriageway to get there — a crossing whatever its
    # length (the < 30 m half-crossing test above missed a 48 m KfW driveway
    # + footway edge merged by osmnx, Bockenheimer 2026-08-18)
    nonstreet = edges["highway"].isin(["footway", "path", "cycleway"]).to_numpy()
    for i in np.where(nonstreet & ~is_xing)[0]:
        if edges["u"].iat[i] in major_nodes or edges["v"].iat[i] in major_nodes:
            is_xing[i] = True
    # a cycleway crossing piece is a bike crossing, not a zebra: walkable at a
    # price (Eschersheimer/Bremer 2026-08-18: the router took the diagonal
    # cycle crossing over the signalled zebra 20 m away). No foot=* tag in
    # the graph, so every cycleway crossing counts.
    # segregated=yes on a bare cycleway means the FOOTWAY half is mapped as
    # its own way (getrennter Geh-/Radweg) — it does NOT put walkers on the
    # bike half (Hügelstraße/Reinhardstraße 2026-08-19). Only a foot tag does.
    foot_ok = edges["foot"].isin(["yes", "designated", "permissive"]).to_numpy()
    is_cycle_x = is_xing & edges["highway"].eq("cycleway").to_numpy() & ~foot_ok
    # a pure cycleway STRETCH (no foot access signed) is bike infrastructure,
    # not a walkway — a Radweg beat the sidewalk beside it (Platenstraße
    # 932055678, 2026-08-19). Penalised per metre by the router.
    is_cycleway = edges["highway"].eq("cycleway").to_numpy() & ~foot_ok & ~is_xing
    # tagged-crossing inheritance (2026-08-21, Eschenheimer Tor): OSM chops
    # one signalled crossing into zebra pieces (footway=crossing) plus
    # island/kerb stubs with no tag. An inferred NON-STREET crossing piece
    # that touches a tagged crossing edge is part of the same organized
    # crossing — it inherits the tag (and its router discount). Two rounds
    # cover zebra-island-zebra patterns; street pieces never inherit.
    # a SHORT street piece with a mapped-away sidewalk sandwiched between
    # crossing pieces is junction-interior geometry — part of the traverse,
    # not a carriageway walk (Kaiserstraße/Roßmarkt 2026-08-22: two such
    # pieces walled off a signalled corner)
    SANDWICH_HW = {"residential", "unclassified", "living_street",
                   "tertiary", "secondary", "primary", "service"}
    xnodes = set()
    for i in np.where(is_xing)[0]:
        xnodes.add(edges["u"].iat[i]); xnodes.add(edges["v"].iat[i])
    sandwiched = 0
    for i in np.where(~is_xing & (lengths <= 15))[0]:
        if (edges["highway"].iat[i] in SANDWICH_HW and has_sidewalk[i]
                and edges["u"].iat[i] in xnodes and edges["v"].iat[i] in xnodes):
            is_xing[i] = True
            sandwiched += 1
    print(f"junction-interior pieces reclassified as crossings: {sandwiched}")
    xtag = is_crossing.to_numpy().copy()
    # an inferred crossing whose endpoint carries highway=traffic_signals or
    # highway=crossing is an ORGANIZED crossing point — only the way is
    # unmapped. Inherit the tagged discount (2026-08-22).
    signodes = {n for n, d in G.nodes(data=True)
                if d.get("highway") in ("traffic_signals", "crossing")}
    sigged = 0
    for i in np.where(is_xing & ~xtag)[0]:
        if edges["u"].iat[i] in signodes or edges["v"].iat[i] in signodes:
            xtag[i] = True
            sigged += 1
    print(f"signal-node crossings tagged: {sigged} of {int(is_xing.sum())}")
    for _ in range(2):
        tag_nodes = set(edges.loc[xtag, "u"]) | set(edges.loc[xtag, "v"])
        grew = False
        for i in np.where(is_xing & nonstreet & ~xtag)[0]:
            if edges["u"].iat[i] in tag_nodes or edges["v"].iat[i] in tag_nodes:
                xtag[i] = True
                grew = True
        if not grew:
            break
    print(f"tagged-crossing inheritance: {int(xtag.sum() - is_crossing.sum())} "
          f"stub pieces joined {int(is_crossing.sum())} tagged crossings")
    is_sw[is_xing] = False
    sw_tier[is_xing] = 0
    n_sw = int(is_sw.sum())
    check(0.05 < n_sw / n0 < 0.6, f"{n_sw}/{n0} sidewalk edges implausible")

    H = G.copy()
    import networkx as nx
    largest = max(nx.weakly_connected_components(H), key=len)
    lost = H.number_of_nodes() - len(largest)
    H = H.subgraph(largest).copy()
    # side availability per street edge: tag state resolved with the mapped
    # footways; '1' walkable, '0' explicitly none, '?' unknown (shade decides)
    sw_l = np.full(n0, "-", dtype=object)  # '-' = not a street
    sw_r = np.full(n0, "-", dtype=object)
    no_sw = np.zeros(n0, dtype=bool)
    one_sided = 0
    for si in sidx:
        ls, rs = side_state(si, "left"), side_state(si, "right")
        l_ok = ls in ("yes", "sep") or mapped_left[si]
        r_ok = rs in ("yes", "sep") or mapped_right[si]
        sw_l[si] = "1" if l_ok else ("0" if ls == "no" else "?")
        sw_r[si] = "1" if r_ok else ("0" if rs == "no" else "?")
        no_sw[si] = ls == "no" and rs == "no" and not (l_ok or r_ok)
        # one side mapped as a separate footway, the OTHER side tagged as a
        # sidewalk (sidewalk=both / sidewalk:<side>=yes) but not mapped: the
        # street edge IS that unmapped sidewalk — walkable at sidewalk rate
        # and drawn on that side. Penalising it forced two crossings to
        # reach the mapped side (Stegstraße 5109146, 2026-08-27).
        l_free = (not mapped_left[si]) and ls == "yes"
        r_free = (not mapped_right[si]) and rs == "yes"
        if has_sidewalk[si] and (mapped_left[si] or mapped_right[si]) and (l_free != r_free):
            has_sidewalk[si] = False
            sw_l[si] = "1" if l_free else "0"
            sw_r[si] = "1" if r_free else "0"
            one_sided += 1
        # foot=use_sidepath: the carriageway is not for walking at all
        if edges["foot"].iat[si] == "use_sidepath":
            has_sidewalk[si] = True
    print(f"side-aware: {int((sw_l == '1').sum())} left / {int((sw_r == '1').sum())} right walkable, "
          f"{int(no_sw.sum())} streets with NO sidewalk (centred + penalty), {int(is_cycleway.sum())} pure cycleways, "
          f"{int((edges['foot'] == 'use_sidepath').sum())} use_sidepath, {one_sided} streets walk their unmapped tagged side")
    # tagged = explicit footway=crossing/traffic_island mapping plus the
    # stub pieces that inherited it above — an organized crosswalk the
    # router prefers over inferred crossings (2026-08-21, Eschenheimer Tor)
    hs_map = {(r.u, r.v, r.key): (bool(hs), int(t), bool(x), bool(cx), str(l), str(rr), bool(ns), bool(cf), bool(cw), bool(jw), bool(xt))
              for r, hs, t, x, cx, l, rr, ns, cf, cw, jw, xt in zip(edges.itertuples(), has_sidewalk, sw_tier, is_xing, is_cycle_x, sw_l, sw_r, no_sw, carfree.to_numpy(), is_cycleway, is_jaywalk, xtag)}
    for u, v, k, d in H.edges(keys=True, data=True):
        hs, t, x, cx, l, rr, ns, cf, cw, jw, xt = hs_map.get((u, v, k), (False, 0, False, False, "-", "-", False, False, False, False, False))
        d["is_xing_tagged"] = xt
        d["has_sidewalk"] = hs
        d["is_sidewalk"] = t > 0
        d["sidewalk_tier"] = t
        d["is_crossing"] = x
        d["is_cycle_crossing"] = cx
        d["is_cycleway"] = cw
        d["sw_left"] = l
        d["sw_right"] = rr
        d["no_sidewalk"] = ns
        d["is_carfree"] = cf
        d["is_jaywalk"] = jw

    # ------------------------------------------------------------------
    # fork-tip node split (Hügelstraße merge, 2026-08-20): where a dual
    # carriageway splits/merges, OSM joins BOTH carriageways — and often
    # both SIDE WALKWAYS — at one node on the tip. A walker "crossing" the
    # whole road then costs nothing (no edge is traversed). Detect tip
    # nodes: >= 2 same-named ONEWAY street edges leaving in nearly the same
    # direction (the carriageway pair) plus a same-named continuation.
    # Split the node by road side and join the halves with a synthetic
    # jaywalk edge (priced like a 15 m unmarked crossing by the router).
    STREETY = {"residential", "unclassified", "living_street", "primary", "secondary",
               "tertiary", "trunk", "primary_link", "secondary_link", "tertiary_link", "trunk_link"}

    def _bear_from(n, d):
        geom = d.get("geometry")
        x0, y0 = H.nodes[n]["x"], H.nodes[n]["y"]
        if geom is not None:
            c = list(geom.coords)
            p = c[1] if abs(c[0][0] - x0) + abs(c[0][1] - y0) < abs(c[-1][0] - x0) + abs(c[-1][1] - y0) else c[-2]
        else:
            other = None
            p = None
        return np.arctan2(p[1] - y0, p[0] - x0) if p is not None else None

    def _ang(a, b):
        d = abs(a - b) % (2 * np.pi)
        return min(d, 2 * np.pi - d)

    split_count = 0
    next_id = max(int(x) for x in H.nodes) + 1
    for n in list(H.nodes):
        # unique incident segments (collapse the directed duplicates)
        inc = {}
        for u, v, k, d in list(H.edges(n, keys=True, data=True)) + [(v, u, k, d) for u, v, k, d in H.in_edges(n, keys=True, data=True)]:
            key = tuple(sorted((str(u), str(v)))) + (k,)
            inc[key] = (u, v, k, d)
        segs = list(inc.values())
        # a tip that IS an organized crossing point (highway=crossing /
        # traffic_signals node, or a tagged crossing edge ending here) must
        # not be split: the crossing edges already price the road, and the
        # split cut Friedberger Landstraße/Vogelsbergstraße's signalled
        # crossing in half with a x15 jaywalk between the halves
        # (2026-08-27) — the router then detoured to the next crossing.
        if H.nodes[n].get("highway") in ("crossing", "traffic_signals") or any(
                d.get("is_xing_tagged") for _, _, _, d in segs):
            continue
        by_name = {}
        for u, v, k, d in segs:
            hw = first(d.get("highway"))
            nm = first(d.get("name"))
            if hw in STREETY and isinstance(nm, str) and nm:
                by_name.setdefault(nm, []).append((u, v, k, d))
        for nm, group in by_name.items():
            if len(group) < 3:
                continue
            oneway = [g for g in group if str(first(g[3].get("oneway"))) in ("True", "yes", "-1", "1", "true")]
            if len(oneway) < 2:
                continue
            bears = [(_bear_from(n, d), (u, v, k, d)) for u, v, k, d in group]
            bears = [(b, g) for b, g in bears if b is not None]
            if len(bears) < 3:
                continue
            # carriageway pair: the two same-named edges leaving in nearly
            # the same direction
            pair = None
            for i in range(len(bears)):
                for j in range(i + 1, len(bears)):
                    if _ang(bears[i][0], bears[j][0]) < np.radians(40):
                        pair = (bears[i], bears[j])
                        break
                if pair:
                    break
            if pair is None:
                continue
            # circular mean — an arithmetic mean of two bearings straddling
            # +/-pi wraps to the OPPOSITE direction and breaks every check
            axis = np.arctan2(np.sin(pair[0][0]) + np.sin(pair[1][0]),
                              np.cos(pair[0][0]) + np.cos(pair[1][0])) + np.pi  # continuation direction
            ax, ay = np.cos(axis), np.sin(axis)
            x0, y0 = H.nodes[n]["x"], H.nodes[n]["y"]

            def _side(d):
                b = _bear_from(n, d)
                if b is None:
                    return 0.0
                px, py = np.cos(b), np.sin(b)
                return ax * py - ay * px

            # classify ALL incident segments except the continuation(s)
            pair_keys = {tuple(sorted((str(g[1][0]), str(g[1][1])))) + (g[1][2],) for g in pair}
            south = []
            ok = True
            for key, (u, v, k, d) in inc.items():
                if key in pair_keys:
                    s = _side(d)
                else:
                    b = _bear_from(n, d)
                    if b is not None and _ang(b, axis) < np.radians(50):
                        continue  # continuation stays on the original node
                    s = _side(d)
                if abs(s) < 0.05:
                    ok = False  # ambiguous — skip this node
                    break
                if s < 0:
                    south.append((u, v, k))
            if not ok or not south or len(south) == len(inc):
                continue
            # split: clone the node 1.5 m to the south side, rewire
            n2 = next_id
            next_id += 1
            nx_off = -ay * 1.5, ax * 1.5  # perpendicular, south side
            H.add_node(n2, x=x0 + nx_off[0], y=y0 + nx_off[1],
                       **{a: b for a, b in H.nodes[n].items() if a not in ("x", "y")})
            from shapely.geometry import LineString as _LS
            for u, v, k in south:
                for (a, b) in ((u, v), (v, u)):
                    if H.has_edge(a, b, k) and n in (a, b):
                        d = H.edges[a, b, k]
                        a2, b2 = (n2 if a == n else a), (n2 if b == n else b)
                        if not H.has_edge(a2, b2, k):
                            H.add_edge(a2, b2, k, **d)
                        H.remove_edge(a, b, k)
            jj = {"highway": "residential", "name": nm, "length": 15.0, "osmid": 0,
                  "is_jaywalk": True, "is_crossing": False, "is_cycle_crossing": False,
                  "is_cycleway": False, "is_sidewalk": False, "sidewalk_tier": 0,
                  "has_sidewalk": False, "sw_left": "-", "sw_right": "-",
                  "no_sidewalk": False, "is_carfree": False, "oneway": False,
                  "geometry": _LS([(x0, y0), (x0 + nx_off[0], y0 + nx_off[1])])}
            H.add_edge(n, n2, 0, **jj)
            H.add_edge(n2, n, 0, **dict(jj))
            split_count += 1
            break  # one split per node
    print(f"fork-tip splits: {split_count} nodes split with jaywalk links")

    # mid-block crossing links (2026-08-22, Kaiserstraße): once sidewalks
    # are collapsed into separate chains, the two sides of a street are
    # topologically DISCONNECTED between junctions — crossing a quiet
    # one-lane street mid-block, legal and universal in Germany, was
    # impossible and forced 300 m detours. On MINOR streets (never
    # primary/secondary/trunk — "you can't jaywalk 4 lanes" stands) with
    # walkable sidewalks on BOTH sides, link the opposite sidewalk chains
    # every LINK_STEP_M with an unmarked-crossing edge. Dual carriageways
    # are excluded naturally: each carriageway has one sidewalk side only.
    MINOR = {"residential", "unclassified", "living_street", "tertiary"}
    LINK_MIN_EDGE_M = 80.0   # one link per block (Josephskirchstraße 2026-08-27: 120 left a 110 m block uncrossable)
    LINK_END_M = 8.0         # link placed near a junction end when the block starts/ends at a T — people cross at corners
    LINK_REACH_M = 14.0
    from shapely.geometry import Point as _Pt, LineString as _LS2
    from shapely.ops import substring as _substr
    # sidewalk chains have NO mid-block nodes — the link must SPLIT the
    # sidewalk edge at the crossing point. Collect split requests first
    # (the tree would go stale), then split and connect.
    sw_edges = []  # (u, v, k, geom) one per undirected pair
    seen_pairs = set()
    for u, v, k, d in H.edges(keys=True, data=True):
        if int(d.get("sidewalk_tier", 0) or 0) > 0:
            key = tuple(sorted((str(u), str(v)))) + (k,)
            if key not in seen_pairs:
                seen_pairs.add(key)
                # straight 2-node edges carry no geometry attr — synthesize
                g = d.get("geometry") or _LS2([(H.nodes[u]["x"], H.nodes[u]["y"]),
                                               (H.nodes[v]["x"], H.nodes[v]["y"])])
                # the split walks the geometry from u to v: ORIENT it first —
                # a chain stored v->u wired its pieces to the wrong nodes and
                # produced "sidewalks" spanning Eschersheimer Landstraße
                # (2026-08-27)
                c0, c1 = g.coords[0], g.coords[-1]
                ux, uy = H.nodes[u]["x"], H.nodes[u]["y"]
                if (c0[0] - ux) ** 2 + (c0[1] - uy) ** 2 > (c1[0] - ux) ** 2 + (c1[1] - uy) ** 2:
                    g = _LS2(list(g.coords)[::-1])
                sw_edges.append((u, v, k, g))
    sw_tree = STRtree([g for _, _, _, g in sw_edges])
    requests = {}  # sw-edge index -> list of (dist_along, link_id)
    link_pts = []  # per link id: [(swidx, proj_dist), (swidx, proj_dist)]
    for u, v, k, d in list(H.edges(keys=True, data=True)):
        hw = d.get("highway")
        hw = hw[0] if isinstance(hw, list) else hw
        if hw not in MINOR or float(d.get("length", 0)) < LINK_MIN_EDGE_M:
            continue
        if str(d.get("sw_left")) != "1" or str(d.get("sw_right")) != "1":
            continue
        if str(u) > str(v):  # once per pair
            continue
        geom = d.get("geometry") or _LS2([(H.nodes[u]["x"], H.nodes[u]["y"]),
                                          (H.nodes[v]["x"], H.nodes[v]["y"])])
        L = geom.length
        # candidate positions: the junction end(s) first (>= 3 street-ish
        # neighbours = a T or cross junction), then the midpoint
        cands_dd = []
        if H.degree(u) >= 6:
            cands_dd.append(LINK_END_M)
        if H.degree(v) >= 6:
            cands_dd.append(L - LINK_END_M)
        cands_dd.append(L / 2)
        placed = False
        for dd_pos in cands_dd:
            if placed:
                break
            p = geom.interpolate(dd_pos)
            a = geom.interpolate(max(0.0, dd_pos - 2)); b = geom.interpolate(min(L, dd_pos + 2))
            dx, dy = b.x - a.x, b.y - a.y
            nrm = np.hypot(dx, dy)
            if nrm < 1e-6:
                continue
            best = {1: None, -1: None}
            for idx in sw_tree.query(p.buffer(LINK_REACH_M)):
                g = sw_edges[idx][3]
                dist = g.distance(p)
                if dist > LINK_REACH_M or dist < 1.0:
                    continue
                q = g.interpolate(g.project(p))
                side = 1 if (dx * (q.y - p.y) - dy * (q.x - p.x)) > 0 else -1
                if best[side] is None or dist < best[side][0]:
                    best[side] = (dist, idx, g.project(p))
            if best[1] and best[-1]:
                lid = len(link_pts)
                link_pts.append([(best[1][1], best[1][2]), (best[-1][1], best[-1][2])])
                for sidx, dd in link_pts[-1]:
                    requests.setdefault(sidx, []).append((dd, lid))
                placed = True
    # split the sidewalk edges and remember the node created per (link, side)
    link_nodes = {}  # (lid, sidx) -> node id
    for sidx, reqs in requests.items():
        u, v, k, geom = sw_edges[sidx]
        if not H.has_edge(u, v, k):
            continue
        d0 = dict(H.edges[u, v, k])
        cuts = sorted({round(dd, 2) for dd, _ in reqs if 1.0 < dd < geom.length - 1.0})
        if not cuts:
            continue
        chain = [u]
        for dd in cuts:
            pnt = geom.interpolate(dd)
            nid = next_id; next_id += 1
            H.add_node(nid, x=float(pnt.x), y=float(pnt.y))
            chain.append(nid)
        chain.append(v)
        marks = [0.0] + cuts + [geom.length]
        for a2, b2 in ((u, v), (v, u)):
            if H.has_edge(a2, b2, k):
                H.remove_edge(a2, b2, k)
        for i in range(len(chain) - 1):
            seg = _substr(geom, marks[i], marks[i + 1])
            dseg = dict(d0)
            dseg["geometry"] = seg
            dseg["length"] = float(seg.length)
            H.add_edge(chain[i], chain[i + 1], 0, **dseg)
            # the reverse copy must carry REVERSED geometry: the exporter
            # encodes interior vertices from the edge's source node, and an
            # unreversed piece drew a 65 m out-and-back spike (Am
            # Schwalbenschwanz / Im Mainfeld 2026-08-27)
            dseg_r = dict(dseg)
            dseg_r["geometry"] = _LS2(list(seg.coords)[::-1])
            H.add_edge(chain[i + 1], chain[i], 0, **dseg_r)
        for dd, lid in reqs:
            key = min(range(len(cuts)), key=lambda ci: abs(cuts[ci] - dd)) if cuts else None
            if key is not None:
                link_nodes[(lid, sidx)] = chain[1 + key]
    links = 0
    for lid, ((sa, da), (sb, db)) in enumerate(link_pts):
        na = link_nodes.get((lid, sa)); nb = link_nodes.get((lid, sb))
        if na is None or nb is None or na == nb:
            continue
        line = _LS2([(H.nodes[na]["x"], H.nodes[na]["y"]),
                     (H.nodes[nb]["x"], H.nodes[nb]["y"])])
        lk = {"highway": "footway", "osmid": 0,
              "length": float(line.length), "oneway": False,
              "is_crossing": True, "is_xing_tagged": False,
              "is_jaywalk": False, "is_cycle_crossing": False,
              "is_cycleway": False, "is_sidewalk": False,
              "sidewalk_tier": 0, "has_sidewalk": False,
              "no_sidewalk": False, "is_carfree": False,
              "sw_left": "-", "sw_right": "-", "geometry": line}
        H.add_edge(na, nb, 0, **lk)
        H.add_edge(nb, na, 0, **dict(lk))
        links += 1
    print(f"mid-block crossing links: {links} on minor streets ({len(requests)} sidewalk edges split)")


    # ------------------------------------------------------------------
    # accessibility derivations (2026-08-27, docs/accessibility-modes.md):
    # per-edge facts the router turns into wheelchair / stroller / walk
    # rules. Written as plain attributes; 08 packs them into flags2.
    # Node tags (kerb, barrier, ...) exist only after the 2026-08-27
    # refetch — every lookup tolerates their absence.
    # ------------------------------------------------------------------
    SMOOTH_RANK = {"excellent": 0, "good": 1, "intermediate": 2, "bad": 3,
                   "very_bad": 4, "horrible": 5, "very_horrible": 6, "impassable": 7}
    SURF_CLASS = {
        **{k: "smooth" for k in ("asphalt", "concrete", "concrete:plates", "paving_stones",
                                 "bricks", "tiles", "rubber", "wood", "metal", "paved")},
        "concrete:lanes": "compacted", "sett": "sett",
        "cobblestone": "cobble", "unhewn_cobblestone": "cobble", "cobblestone:flattened": "sett",
        "compacted": "compacted", "fine_gravel": "compacted",
        **{k: "loose" for k in ("gravel", "pebblestone", "woodchips", "unpaved", "metal_grid")},
        **{k: "soft" for k in ("ground", "dirt", "earth", "grass", "grass_paver")},
        **{k: "bad" for k in ("sand", "mud", "rock", "snow", "ice", "salt")},
    }
    SAC_RANK = {"strolling": 0, "hiking": 1, "mountain_hiking": 2, "demanding_mountain_hiking": 3,
                "alpine_hiking": 4, "demanding_alpine_hiking": 5, "difficult_alpine_hiking": 6}
    BLOCK_BARRIERS = {"turnstile", "full-height_turnstile", "stile", "kissing_gate"}
    SOFT_BARRIERS = {"cycle_barrier", "chain", "rope", "motorcycle_barrier"}

    def _t(d, key):
        v = d.get(key)
        if isinstance(v, list):
            v = v[0] if v else None
        return v if isinstance(v, str) else None

    def _num(v):
        if v is None:
            return None
        try:
            s2 = str(v).lower().replace(",", ".").replace("m", "").replace("cm", "").strip()
            x = float(s2.split()[0].split(";")[0])
            return x
        except (ValueError, IndexError):
            return None

    def _kerb_cm(nd):
        # ORS-style: explicit height wins, then semantic value; cm
        h = _num(nd.get("kerb:height"))
        if h is not None:
            return h * 100.0 if h < 0.5 else h
        k = _t(nd, "kerb")
        sc = _t(nd, "sloped_curb")
        if k is None and sc is not None:
            k = {"0": "flush", "flush": "flush", "yes": "lowered", "low": "lowered", "no": "raised"}.get(sc, None)
            if k is None:
                x = _num(sc)
                return x * 100.0 if x is not None and x < 0.5 else (x if x is not None else -1)
        if k is None:
            return -1
        if k in ("flush", "no", "at_grade", "fully_lowered"):
            return 0.0
        if k in ("lowered", "low", "dropped", "sloped", "both"):
            return 3.0
        if k in ("raised", "regular", "rolled", "one", "none"):
            return 12.0
        if k == "yes":
            return 6.0  # unknown height: cautious middle
        return -1

    nodes_data = G.nodes
    acc_n = 0
    for u, v, k, d in H.edges(keys=True, data=True):
        hw = _t(d, "highway")
        steps = hw == "steps"
        rw = _t(d, "ramp:wheelchair") in ("yes", "designated")
        rs = _t(d, "ramp:stroller") in ("yes", "designated") or _t(d, "flat_steps") == "yes"
        rb = _t(d, "ramp:bicycle") in ("yes", "designated")
        ru = _t(d, "ramp") == "yes" and not (rw or rs or rb)
        ramp = "wheelchair" if rw else "stroller" if rs else "untyped" if ru else "bicycle" if rb else "none"
        conv = _t(d, "conveying")
        wc = (_t(d, "wheelchair") or "").lower()
        wc = {"bad": "limited", "half": "limited", "partial": "limited"}.get(wc, wc)
        st = (_t(d, "stroller") or "").lower()
        sm = SMOOTH_RANK.get(_t(d, "smoothness") or "", -1)
        sc = SURF_CLASS.get(_t(d, "surface") or "", "unknown")
        sac = SAC_RANK.get(_t(d, "sac_scale") or "", -1)
        tv = _t(d, "trail_visibility")
        obstacle = _t(d, "obstacle") is not None
        tt = _t(d, "tracktype")
        ttr = int(tt[5]) if tt and tt.startswith("grade") and tt[5:].isdigit() else -1
        width = _num(_t(d, "width")) or _num(_t(d, "est_width"))
        # node facts at both ends (barrier class, kerb on crossing pieces)
        kerb_cm, barrier, narrow = -1.0, "none", None
        for n in (u, v):
            nd = nodes_data[n] if n in nodes_data else {}
            b = _t(nd, "barrier")
            if b:
                if _t(nd, "wheelchair") in ("yes", "designated"):
                    pass
                elif b in BLOCK_BARRIERS or (b in ("gate", "wicket_gate") and _t(nd, "locked") == "yes"):
                    barrier = "block"
                elif b in SOFT_BARRIERS and barrier != "block":
                    barrier = "soft"
                mw = _num(nd.get("maxwidth:physical")) or _num(nd.get("opening"))
                if mw is not None:
                    narrow = mw if narrow is None else min(narrow, mw)
            if str(d.get("is_crossing")) == "True" and _t(nd, "public_transport") is None:
                kc = _kerb_cm(nd)
                if kc >= 0:
                    kerb_cm = max(kerb_cm, kc)
        if width is not None:
            narrow = width if narrow is None else min(narrow, width)
        d["acc_steps"] = bool(steps)
        d["acc_ramp"] = ramp
        d["acc_conveying"] = bool(conv and conv != "no")
        d["acc_wc"] = wc
        d["acc_stroller"] = st
        d["acc_smooth"] = int(sm)
        d["acc_surface"] = sc
        d["acc_sac"] = int(sac)
        d["acc_trail"] = tv or ""
        d["acc_obstacle"] = bool(obstacle)
        d["acc_tracktype"] = int(ttr)
        d["acc_kerb_cm"] = float(kerb_cm)
        d["acc_barrier"] = barrier
        d["acc_narrow_m"] = float(narrow) if narrow is not None else -1.0
        if steps or ramp != "none" or wc or st or kerb_cm > 3 or barrier != "none":
            acc_n += 1
    print(f"accessibility facts: {acc_n} edges with steps/ramp/wheelchair/stroller/kerb/barrier signals")

    ox.save_graphml(H, src)
    e2 = ox.graph_to_gdfs(H, nodes=False).reset_index()
    for col in ("highway", "surface", "smoothness"):
        if col not in e2.columns:
            e2[col] = None
        e2[col] = e2[col].apply(first)
    e2[["highway", "surface", "smoothness", "length", "geometry"]].to_file(
        OSM / "edges.gpkg", driver="GPKG")
    print(f"OK: {n_sw} sidewalk edges of {n0} ({n_sw / n0:.0%}) kept and marked "
          f"({int((sw_tier == 2).sum())} strong); {int(is_xing.sum())} crossings "
          f"({int(is_crossing.sum())} tagged, {int(is_cycle_x.sum())} cycle, {int(is_jaywalk.sum())} jaywalk links); "
          f"{int(has_sidewalk.sum())} streets marked has_sidewalk; "
          f"{H.number_of_edges()} edges, {lost} orphan nodes removed")


if __name__ == "__main__":
    main()
