// Client-side graph: parse the SWG1 v2 artifact into typed arrays with a
// CSR adjacency, a local meter frame, and a coarse spatial grid.

// Shade buckets are SEASONAL since v7 (2026-08-28): 10_sun_shade derives the
// window from the modelled month's sunrise/sunset, so June has 66 buckets and
// December 33. The header carries the window; nothing may hardcode it.
export const BUCKETS = 48; // fallback for synthetic graphs in tests
const LAT0 = 50.1109;
const LNG0 = 8.6821;
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const CELL_M = 250;
const MICRO = 1e-6;

export type Circuit = {
  id: number;
  pocket: number;
  eids: number[]; // ordered, closed: target of last = source of first
  length: number; // meters
  iq: number; // isoperimetric quotient, 1 = circle
  shade: number[]; // 48 buckets, 0..255 (shadier sidewalk)
  green: number;
  deep: number; // share of length deep inside green (park proper, not the rim path)
  noise: number;
  surface: number;
  score: number;
  street: number; // share of circuit length on street edges (rim lanes)
  modes: number;  // bit0 walk, bit1 stroller, bit2 wheelchair (14_circuits)
  cx: number; // centroid, EPSG:25832 meters
  cy: number;
};

/** One contiguous run of shade buckets, shipped as its own gzip file
 *  (`graph.shade.<k>.bin.gz`, artifact v8 — backlog B11). */
export type ShadeBand = {
  k: number;
  bucket0: number;   // first bucket index of the whole window
  buckets: number;   // how many buckets this band carries
  startMin: number;  // clock minute of `bucket0`
  endMin: number;    // clock minute of the band's LAST bucket
  file: string;      // the file name the core header names, for the assert
};

/** The shade bytes, in bands that arrive separately.
 *
 *  A v7 artifact has exactly ONE band covering the whole window, already
 *  loaded — so every band question below answers "yes" and nothing above
 *  the router can tell the two layouts apart.
 *
 *  `data[k]` is `nEdges * bands[k].buckets` bytes, edge-major: the v7 rows
 *  sliced on the bucket axis, nothing reordered. `null` means the band has
 *  not arrived; a lookup into it returns SHADE_PENDING rather than a
 *  substitute, because a substituted shade byte is a wrong route at a wrong
 *  time and CLAUDE.md rule 4 does not bend. */
export type ShadeStore = {
  bands: ShadeBand[];
  data: (Uint8Array | null)[];
  /** 16 hex chars, stamped into every band file's prefix. "" for v7. */
  hash: string;
  nEdges: number;
  buckets: number;
  /** Bumped whenever a band lands. A hook watching this number re-renders
   *  when new minutes become priceable — the graph object itself never
   *  changes identity, deliberately (GraphContext's note). */
  version: number;
};

export type Graph = {
  nNodes: number;
  nEdges: number;
  lat: Float32Array;
  lng: Float32Array;
  x: Float32Array;
  y: Float32Array;
  firstEdge: Uint32Array;
  edgeSource: Uint32Array;
  edgeTarget: Uint32Array;
  lenDm: Uint16Array;
  surfaceQ: Uint8Array;
  noiseQ: Uint8Array;
  greenQ: Uint8Array;
  shade: ShadeStore; // shade of the SHADIER sidewalk, in time bands (v8) or one block (v7)
  buckets: number;         // shade samples per edge (seasonal)
  bucketStartMin: number;  // minute-of-day of bucket 0
  bucketStepMin: number;   // minutes between buckets
  sideBytes: number;       // bytes of side bits per edge
  flags: Uint8Array; // bit0 street class (drawn on a sidewalk), bit1 OSM sidewalk collapsed, bit2 crossing, bit3 sidewalk, bit4 strong sidewalk, bit5 major road, bit6 cycle crossing
  sides: Uint8Array; // 6 bytes per edge, bit per bucket: 1 = LEFT sidewalk shadier
  geoCounts: Uint8Array;
  geoOffsets: Uint32Array;
  geoPoints: Int16Array;
  grid: Map<number, number[]>;
  circuits: Circuit[];
  circuitsAtNode: Map<number, number[]>; // node -> circuit indices passing through
  // v6.2, turn-aware router (docs/turn-router.md)
  acc: Uint8Array; // v6.3 accessibility flags2 (docs/accessibility-modes.md)
  slope: Int8Array; // v6.3 signed forward gradient, 0.5 % steps
  nodeXing: Uint8Array; // 1 = node has an incident crossing edge (bit2)
  nodeMajor: Uint8Array; // 1 = node lies on a major carriageway (bit0+bit5)
  revEdge: Int32Array; // eid of the reverse edge, -1 if none
  enDx: Float32Array; // unit entry direction at the edge's SOURCE (meter frame)
  enDy: Float32Array;
  exDx: Float32Array; // unit exit direction at the edge's TARGET
  exDy: Float32Array;
};

export function toXY(lng: number, lat: number): [number, number] {
  return [(lng - LNG0) * M_PER_DEG_LNG, (lat - LAT0) * M_PER_DEG_LAT];
}

const EDGE_BYTES = 13; // u4 + u4 + u2 + u1 + u1 + u1

export function parseGraph(buf: ArrayBuffer): Graph {
  const magic = new Uint8Array(buf, 0, 4);
  if (String.fromCharCode(...magic) !== "SWG1") throw new Error("bad magic");
  const hlen = new DataView(buf).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hlen)));
  const version = header.version as number;
  if (version !== 7 && version !== 8) throw new Error(`unsupported version ${version}`);
  const n = header.n_nodes as number;
  const e = header.n_edges as number;
  const g = header.n_geo_points as number;
  let o = 8 + hlen;

  const nodesF = new Float32Array(buf.slice(o, o + 8 * n));
  o += 8 * n;
  const lat = new Float32Array(n);
  const lng = new Float32Array(n);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lat[i] = nodesF[2 * i];
    lng[i] = nodesF[2 * i + 1];
    x[i] = (lng[i] - LNG0) * M_PER_DEG_LNG;
    y[i] = (lat[i] - LAT0) * M_PER_DEG_LAT;
  }

  const edgeBytes = new Uint8Array(buf, o, e * EDGE_BYTES);
  const dv = new DataView(buf, o, e * EDGE_BYTES);
  o += e * EDGE_BYTES;
  const edgeSource = new Uint32Array(e);
  const edgeTarget = new Uint32Array(e);
  const lenDm = new Uint16Array(e);
  const surfaceQ = new Uint8Array(e);
  const noiseQ = new Uint8Array(e);
  const greenQ = new Uint8Array(e);
  for (let i = 0; i < e; i++) {
    const b = i * EDGE_BYTES;
    edgeSource[i] = dv.getUint32(b, true);
    edgeTarget[i] = dv.getUint32(b + 4, true);
    lenDm[i] = dv.getUint16(b + 8, true);
    surfaceQ[i] = edgeBytes[b + 10];
    noiseQ[i] = edgeBytes[b + 11];
    greenQ[i] = edgeBytes[b + 12];
  }

  const geoCounts = new Uint8Array(buf.slice(o, o + e));
  o += e;
  const geoPoints = new Int16Array(buf.slice(o, o + 4 * g));
  o += 4 * g;
  // Shade of the shadier sidewalk. v7 carries the whole block here; v8
  // carries none of it and the header says where the bands went (B11).
  const buckets = header.buckets as number;
  let shade: ShadeStore;
  if (version === 7) {
    const nb = e * buckets;
    shade = oneBandStore(new Uint8Array(buf.slice(o, o + nb)), e, buckets,
                         (header.bucket_start_min as number) ?? 8 * 60,
                         (header.bucket_step_min as number) ?? 15);
    o += nb;
  } else {
    shade = bandedStore(header, e, buckets);
  }
  const flags = new Uint8Array(buf.slice(o, o + e));
  o += e;
  const sideBytes = (header.side_bytes as number) ?? 3;
  const sides = new Uint8Array(buf.slice(o, o + e * sideBytes));
  o += e * sideBytes;
  const wayBytes = (header.way_bytes as number) ?? 0; // v6.2 leftover, skipped
  o += e * wayBytes;
  const accBytes = (header.acc_bytes as number) ?? 0;
  const acc = accBytes ? new Uint8Array(buf.slice(o, o + e)) : new Uint8Array(e);
  const slope = accBytes >= 2 ? new Int8Array(buf.slice(o + e, o + 2 * e)) : new Int8Array(e);
  o += e * accBytes;
  // circuit catalog (compact JSON)
  const cbytes = (header.circuits_bytes as number) ?? 0;
  const raw = cbytes ? JSON.parse(new TextDecoder().decode(new Uint8Array(buf, o, cbytes))) : [];
  const circuits: Circuit[] = raw.map((c: Record<string, unknown>) => ({
    id: c.id as number, pocket: c.p as number, eids: c.e as number[], length: c.L as number,
    iq: c.iq as number, shade: c.s as number[], green: c.g as number, deep: (c.d as number) ?? 0, noise: c.n as number,
    surface: c.u as number, score: c.sc as number, street: (c.st as number) ?? 0,
    cx: ((c.c as number[]) ?? [0, 0])[0], cy: ((c.c as number[]) ?? [0, 0])[1],
    modes: (c.m as number) ?? 7,
  }));

  // edges arrive sorted by source (eid ordering, W2 contract) -> CSR
  const firstEdge = new Uint32Array(n + 1);
  for (let i = 0; i < e; i++) firstEdge[edgeSource[i] + 1]++;
  for (let i = 0; i < n; i++) firstEdge[i + 1] += firstEdge[i];
  for (let i = 1; i < e; i++) {
    if (edgeSource[i] < edgeSource[i - 1]) throw new Error("edges not sorted by source");
  }

  const geoOffsets = new Uint32Array(e + 1);
  for (let i = 0; i < e; i++) geoOffsets[i + 1] = geoOffsets[i] + geoCounts[i];

  const grid = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const key = cellKey(x[i], y[i]);
    const arr = grid.get(key);
    if (arr) arr.push(i);
    else grid.set(key, [i]);
  }

  const circuitsAtNode = new Map<number, number[]>();
  circuits.forEach((c, ci) => {
    for (const eid of c.eids) {
      const n = edgeSource[eid];
      const arr = circuitsAtNode.get(n);
      if (arr) {
        if (!arr.includes(ci)) arr.push(ci);
      } else circuitsAtNode.set(n, [ci]);
    }
  });

  // --- turn-aware router derivations (docs/turn-router.md) ---
  const nodeXing = new Uint8Array(n);
  const nodeMajor = new Uint8Array(n);
  for (let i = 0; i < e; i++) {
    if ((flags[i] & 4) !== 0) { nodeXing[edgeSource[i]] = 1; nodeXing[edgeTarget[i]] = 1; }
    if ((flags[i] & 33) === 33) { nodeMajor[edgeSource[i]] = 1; nodeMajor[edgeTarget[i]] = 1; }
  }
  // reverse edge: the directed twin (v->u, same length); -1 for oneway-only
  const revEdge = new Int32Array(e).fill(-1);
  for (let i = 0; i < e; i++) {
    const u = edgeTarget[i];
    for (let k = firstEdge[u]; k < firstEdge[u + 1]; k++) {
      if (edgeTarget[k] === edgeSource[i] && lenDm[k] === lenDm[i]) { revEdge[i] = k; break; }
    }
  }
  // unit entry/exit directions from the decoded geometry (meter frame)
  const enDx = new Float32Array(e);
  const enDy = new Float32Array(e);
  const exDx = new Float32Array(e);
  const exDy = new Float32Array(e);
  for (let i = 0; i < e; i++) {
    const sLat = lat[edgeSource[i]], sLng = lng[edgeSource[i]];
    const tLat = lat[edgeTarget[i]], tLng = lng[edgeTarget[i]];
    const cnt = geoCounts[i], off = geoOffsets[i];
    let aLat = tLat, aLng = tLng; // first point after the source
    if (cnt > 0) { aLat = sLat + geoPoints[2 * off] * MICRO; aLng = sLng + geoPoints[2 * off + 1] * MICRO; }
    let bLat = sLat, bLng = sLng; // last point before the target
    if (cnt > 0) {
      let cl = sLat, cg = sLng;
      for (let k = 0; k < cnt; k++) { cl += geoPoints[2 * (off + k)] * MICRO; cg += geoPoints[2 * (off + k) + 1] * MICRO; }
      bLat = cl; bLng = cg;
    }
    let dx = (aLng - sLng) * M_PER_DEG_LNG, dy = (aLat - sLat) * M_PER_DEG_LAT;
    let d = Math.hypot(dx, dy) || 1;
    enDx[i] = dx / d; enDy[i] = dy / d;
    dx = (tLng - bLng) * M_PER_DEG_LNG; dy = (tLat - bLat) * M_PER_DEG_LAT;
    d = Math.hypot(dx, dy) || 1;
    exDx[i] = dx / d; exDy[i] = dy / d;
  }

  return { nNodes: n, nEdges: e, lat, lng, x, y, firstEdge, edgeSource,
           edgeTarget, lenDm, surfaceQ, noiseQ, greenQ, shade, flags, sides, geoCounts,
           geoOffsets, geoPoints, grid, circuits, circuitsAtNode,
           acc, slope, nodeXing, nodeMajor, revEdge, enDx, enDy, exDx, exDy,
           buckets: (header.buckets as number),
           bucketStartMin: (header.bucket_start_min as number) ?? 8 * 60,
           bucketStepMin: (header.bucket_step_min as number) ?? 15,
           sideBytes };
}

// ---------------------------------------------------------------------------
// Shade bands (artifact v8, backlog B11)
// ---------------------------------------------------------------------------

/** What a shade lookup returns when the band holding that minute has not
 *  arrived. An impossible shade fraction, so no caller can mistake it for
 *  data — and nothing in the router ever substitutes a value for it
 *  (CLAUDE.md rule 4: every cost uses the real shade at the arrival time,
 *  or the caller waits). */
export const SHADE_PENDING = -1;

/** The 16-byte prefix on every `graph.shade.<k>.bin.gz`. */
export const BAND_MAGIC = "SWGB";
const BAND_PREFIX = 16;

/** A v7 artifact's shade, wrapped so the rest of the code never branches:
 *  one band, the whole window, already loaded. */
function oneBandStore(
  data: Uint8Array,
  nEdges: number,
  buckets: number,
  startMin: number,
  stepMin: number
): ShadeStore {
  return {
    bands: [{ k: 0, bucket0: 0, buckets, startMin,
              endMin: startMin + stepMin * (buckets - 1), file: "" }],
    data: [data],
    hash: "",
    nEdges,
    buckets,
    version: 1,
  };
}

/** A v8 core's `shade_bands`, with nothing loaded yet.
 *
 *  The header's clock span is re-derived from `bucket_start_min` and checked
 *  rather than trusted: a hand-edited or mis-generated header that put a
 *  band an hour off would price a walk against another hour's sun, which is
 *  exactly the failure rule 4 exists to prevent, and it would be invisible. */
function bandedStore(
  header: Record<string, unknown>,
  nEdges: number,
  buckets: number
): ShadeStore {
  const raw = header.shade_bands as Record<string, unknown>[] | undefined;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("v8 core has no shade_bands");
  const hash = (header.shade_hash as string) ?? "";
  if (!/^[0-9a-f]{16}$/.test(hash)) throw new Error(`v8 core has no shade_hash (${hash})`);
  const startMin = (header.bucket_start_min as number) ?? 8 * 60;
  const stepMin = (header.bucket_step_min as number) ?? 15;
  const bands: ShadeBand[] = raw.map((b, i) => {
    if (b.k !== i) throw new Error(`shade band ${i} says k=${b.k as number}`);
    return {
      k: b.k as number,
      bucket0: b.bucket0 as number,
      buckets: b.buckets as number,
      startMin: b.start_min as number,
      endMin: b.end_min as number,
      file: (b.file as string) ?? "",
    };
  });
  let want = 0;
  for (const b of bands) {
    if (b.bucket0 !== want) throw new Error(`shade band ${b.k} starts at ${b.bucket0}, expected ${want}`);
    if (b.buckets < 1) throw new Error(`shade band ${b.k} carries ${b.buckets} buckets`);
    if (b.startMin !== startMin + b.bucket0 * stepMin ||
        b.endMin !== startMin + (b.bucket0 + b.buckets - 1) * stepMin) {
      throw new Error(`shade band ${b.k} clock span does not match its buckets`);
    }
    want += b.buckets;
  }
  if (want !== buckets) throw new Error(`shade bands cover ${want} of ${buckets} buckets`);
  return { bands, data: bands.map(() => null), hash, nEdges, buckets, version: 0 };
}

/** Which band holds a bucket; -1 for a bucket outside the window. */
export function bandOfBucket(store: ShadeStore, bucket: number): number {
  for (const b of store.bands) {
    if (bucket >= b.bucket0 && bucket < b.bucket0 + b.buckets) return b.k;
  }
  return -1;
}

/** Is this band's file in memory? */
export function bandLoaded(store: ShadeStore, k: number): boolean {
  return k >= 0 && k < store.data.length && store.data[k] !== null;
}

/** One edge's shade byte at one bucket, or SHADE_PENDING when its band has
 *  not arrived. The bucket is assumed to be inside the window — callers
 *  clamp first (astar's `lerpShade`), because clamping is a decision about
 *  daylight and this is a decision about bytes. */
export function shadeByte(store: ShadeStore, eid: number, bucket: number): number {
  for (const b of store.bands) {
    if (bucket < b.bucket0 || bucket >= b.bucket0 + b.buckets) continue;
    const data = store.data[b.k];
    if (data === null) return SHADE_PENDING;
    return data[eid * b.buckets + (bucket - b.bucket0)];
  }
  return SHADE_PENDING;
}

/** The bands covering a span of buckets, clamped to the window. */
export function bandsForBuckets(store: ShadeStore, from: number, to: number): number[] {
  const last = store.buckets - 1;
  const lo = Math.max(0, Math.min(last, Math.min(from, to)));
  const hi = Math.max(0, Math.min(last, Math.max(from, to)));
  const out: number[] = [];
  for (const b of store.bands) {
    if (b.bucket0 + b.buckets > lo && b.bucket0 <= hi) out.push(b.k);
  }
  return out;
}

/** The bucket a clock minute falls in, clamped into the window.
 *
 *  FLOOR, not round, because that is what `lerpShade` does (astar.ts): it
 *  reads `floor(b)` and `floor(b) + 1` and blends them. Rounding disagreed
 *  with it at both ends of a span — at 07:16, `bandsForMinutes(07:01,
 *  10:16)` asked for bands [0, 1] and `bandsReady` said GO while
 *  `shadeAt(…, 10:16)` was still `SHADE_PENDING`, because 10:16 rounds down
 *  to bucket 15 (band 1) and `lerpShade` also reads bucket 16, which is
 *  band 2's first (S8 review F3). Not reachable on a 60-minute walk, and
 *  reachable the moment the Wander slider asks for three hours.
 *
 *  Clamping is what makes this agree with `lerpShade`'s daylight rule: a
 *  minute before the export's first bucket is priced at that first bucket
 *  while the sun is up (backlog B14), so it needs the FIRST band — and a
 *  minute after dark needs no band at all, but asking for the last one costs
 *  nothing and keeps this function total. */
export function bucketOfMinute(g: Graph, minuteOfDay: number): number {
  const b = Math.floor((minuteOfDay - g.bucketStartMin) / g.bucketStepMin);
  return Math.max(0, Math.min(g.buckets - 1, b));
}

/** The bands a walk leaving at `fromMin` and arriving by `toMin` reads.
 *
 *  `+ 1` on the upper end is `lerpShade`'s NEIGHBOUR bucket: it reads
 *  `floor(b)` and `floor(b) + 1` unconditionally, so the last minute of the
 *  span can need one bucket more than it falls in — and that bucket can be
 *  the first of the next band. `bandsForBuckets` clamps, so asking past the
 *  window is free (S8 review F3). */
export function bandsForMinutes(g: Graph, fromMin: number, toMin: number): number[] {
  const lo = bucketOfMinute(g, Math.min(fromMin, toMin));
  const hi = bucketOfMinute(g, Math.max(fromMin, toMin)) + 1;
  return bandsForBuckets(g.shade, lo, hi);
}

/** Can every minute of [fromMin, toMin] be priced right now? */
export function bandsReady(g: Graph, fromMin: number, toMin: number): boolean {
  return bandsForMinutes(g, fromMin, toMin).every((k) => bandLoaded(g.shade, k));
}

/** Install a downloaded band, after checking its 16-byte prefix.
 *
 *  Every check here is a refusal, never a repair: a band whose magic, index,
 *  width or hash does not match this core belongs to another export, and
 *  using it would price a walk with another day's sun without anything
 *  downstream being able to tell. */
export function acceptShadeBand(store: ShadeStore, k: number, buf: ArrayBuffer): void {
  const spec = store.bands[k];
  if (!spec) throw new Error(`no shade band ${k} in this graph`);
  if (buf.byteLength < BAND_PREFIX) throw new Error(`shade band ${k}: ${buf.byteLength} bytes`);
  const head = new Uint8Array(buf, 0, BAND_PREFIX);
  if (String.fromCharCode(head[0], head[1], head[2], head[3]) !== BAND_MAGIC) {
    throw new Error(`shade band ${k}: bad magic`);
  }
  const dv = new DataView(buf, 0, BAND_PREFIX);
  const gotK = dv.getUint16(4, true);
  const gotBuckets = dv.getUint16(6, true);
  if (gotK !== k) throw new Error(`shade band ${k}: file says band ${gotK}`);
  if (gotBuckets !== spec.buckets) {
    throw new Error(`shade band ${k}: ${gotBuckets} buckets, core says ${spec.buckets}`);
  }
  let hash = "";
  for (let i = 8; i < 16; i++) hash += head[i].toString(16).padStart(2, "0");
  if (store.hash !== "" && hash !== store.hash) {
    throw new Error(`shade band ${k}: hash ${hash} is not this graph's ${store.hash}`);
  }
  const want = store.nEdges * spec.buckets;
  if (buf.byteLength - BAND_PREFIX !== want) {
    throw new Error(`shade band ${k}: ${buf.byteLength - BAND_PREFIX} bytes, expected ${want}`);
  }
  store.data[k] = new Uint8Array(buf, BAND_PREFIX);
  store.version += 1;
}

/** Forget a band's bytes. Backgrounding a tab is the case that matters
 *  (backlog B4): 2.5 MB per band adds up, and a band is one small fetch
 *  away — but the bands the current departure needs are never dropped, so
 *  this takes the set to keep. */
export function dropShadeBands(store: ShadeStore, keep: number[]): number {
  if (store.hash === "") return 0; // v7: there is nothing to re-fetch
  let dropped = 0;
  for (let k = 0; k < store.data.length; k++) {
    if (store.data[k] !== null && !keep.includes(k)) {
      store.data[k] = null;
      dropped += 1;
    }
  }
  if (dropped > 0) store.version += 1;
  return dropped;
}

function cellKey(xm: number, ym: number): number {
  return (Math.floor(xm / CELL_M) + 200) * 4096 + (Math.floor(ym / CELL_M) + 200);
}

export function nearestNode(g: Graph, lngQ: number, latQ: number): number {
  const [qx, qy] = toXY(lngQ, latQ);
  const cx = Math.floor(qx / CELL_M);
  const cy = Math.floor(qy / CELL_M);
  let best = -1;
  let bestD = Infinity;
  for (let ring = 0; ring <= 8; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const nodes = g.grid.get((cx + dx + 200) * 4096 + (cy + dy + 200));
        if (!nodes) continue;
        for (const i of nodes) {
          const d = (g.x[i] - qx) ** 2 + (g.y[i] - qy) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    // one extra ring after the first hit guarantees true nearest
    if (best >= 0 && ring > Math.sqrt(bestD) / CELL_M) break;
  }
  return best;
}

/** Full polyline of an edge as [lng, lat] pairs, including both endpoints. */
export function edgeLatLngs(g: Graph, eid: number): [number, number][] {
  const out: [number, number][] = [[g.lng[g.edgeSource[eid]], g.lat[g.edgeSource[eid]]]];
  let curLat = g.lat[g.edgeSource[eid]];
  let curLng = g.lng[g.edgeSource[eid]];
  const start = g.geoOffsets[eid];
  for (let k = 0; k < g.geoCounts[eid]; k++) {
    curLat += g.geoPoints[2 * (start + k)] * MICRO;
    curLng += g.geoPoints[2 * (start + k) + 1] * MICRO;
    out.push([curLng, curLat]);
  }
  out.push([g.lng[g.edgeTarget[eid]], g.lat[g.edgeTarget[eid]]]);
  return out;
}

/** What a caller who is WATCHING a download passes in (CR-03 Q5): the city
 *  sheet counts the bytes into a progress row, and its ✕ aborts them.
 *
 *  `total` is the manifest's byte count (cityManifest.ts) — a FALLBACK, for
 *  the proxy that omits `Content-Length`. The response's own length wins
 *  wherever every part declares one (review B-2): it measures exactly the
 *  bytes this loader counts, where the manifest measured a file at build
 *  time and can be stale. A total of 0 is the loader saying "no idea", and
 *  the row draws an indeterminate bar rather than a wrong one.
 *
 *  There is one server that makes every total a lie, and it is our own dev
 *  one: Vite serves `graph.bin.gz` with `Content-Encoding: gzip`, so the
 *  browser inflates it and `body` hands over ~30 MB where the file is 7
 *  (measured 2026-09-09). Cloudflare Pages does not — which is why this
 *  loader has always had a gunzip fallback for the raw case. Both are
 *  handled without asking which server it is: a declared `Content-Encoding`
 *  drops the total up front, and a stream that OVERRUNS its total drops it
 *  the moment it does. Either way the row stops counting against a number
 *  that was never about these bytes. */
export type LoadProgress = {
  signal?: AbortSignal;
  total?: number;
  /** `fetchPriority` for the request. The background band walk sends
   *  "low" so a band that nobody is waiting for cannot get in the way of a
   *  basemap tile or the next city's core (backlog B11). */
  priority?: "high" | "low" | "auto";
  /** What actually performs the request. `router/graphCache.ts` passes a
   *  fetcher with the Cache API in front of it; the default is the plain
   *  one, so the loader has no opinion about storage and every test that
   *  stubs `fetch` keeps working. */
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  /** `loaded` never exceeds `total` when a total is known, and never goes
   *  backwards: the parts are counted into one running sum. */
  onProgress?: (loaded: number, total: number) => void;
};

/** Fetch an artifact — one URL, or the byte-slices of one .gz in order
 *  (cities.ts artifactUrls) — and hand back its decompressed bytes.
 *
 *  Parts are fetched in PARALLEL, as they always were: a chunked city is two
 *  requests and serialising them would double its cold boot. Progress is
 *  still monotonic because every chunk of every part adds to one counter.
 *
 *  A SINGLE url is inflated as it arrives (`DecompressionStream` in the
 *  read loop) rather than after the download finishes, which is what the
 *  chunked graph is for: the core's 8.6 MB of typed arrays are being built
 *  while the wire is still busy. Parts cannot be — they are byte-slices of
 *  one gzip stream and only make sense concatenated — so those still inflate
 *  at the end, exactly as before.
 *
 *  Whether the bytes need inflating at all is decided by SNIFFING the first
 *  chunk for gzip's magic, not by trusting a header: our own dev server
 *  serves `graph.bin.gz` with `Content-Encoding: gzip` (so the browser has
 *  already inflated it) and Cloudflare Pages does not (so we must). */
async function fetchArtifact(urls: string | string[], opts: LoadProgress = {}): Promise<Uint8Array> {
  const list = typeof urls === "string" ? [urls] : urls;
  const { signal, onProgress, priority } = opts;
  const doFetch = opts.fetcher ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const init: RequestInit = { signal };
  // `fetchPriority` is not in every lib.dom yet; the cast keeps the hint
  // without pulling a DOM lib version bump into the build.
  if (priority) (init as RequestInit & { priority?: string }).priority = priority;
  const parts = await Promise.all(list.map(async (url) => {
    const resp = await doFetch(url, init);
    if (!resp.ok) throw new Error(`graph fetch failed: ${resp.status} ${url}`);
    return resp;
  }));
  let loaded = 0;
  // Every response's headers are in by now, so the total is a fixed number
  // from the first callback rather than one that grows as the second part's
  // headers land. A chunked artifact needs EVERY part to declare a length —
  // a partial sum would be a total the stream overruns half way through.
  const lengths = parts.map((r) => Number(r.headers.get("content-length")));
  const declared = lengths.every((n) => Number.isFinite(n) && n > 0)
    ? lengths.reduce((a, b) => a + b, 0)
    : 0;
  // A content-encoded response is inflated before we see it, and nothing
  // declares the inflated size — so there is no total to count against.
  const encoded = parts.some((r) => (r.headers.get("content-encoding") ?? "") !== "");
  // Content-Length FIRST (review B-2): it describes the very bytes `loaded`
  // is counting, and on Cloudflare Pages it is the same number the manifest
  // holds. The manifest is a build-time measurement that a pipeline rerun
  // can leave stale, and a stale total that is too LARGE is the one kind the
  // overrun guard below cannot catch — the bar would stall short of 100 %
  // and then jump. So it is the fallback, for the server that omits the
  // header, and the pre-Load "34 MB" label is its real job.
  let total = encoded ? 0 : declared || opts.total || 0;
  const count = (n: number) => {
    loaded += n;
    // ...and the belt to that braces, for a server that hides the header
    if (total > 0 && loaded > total) total = 0;
    onProgress?.(loaded, total);
  };

  if (parts.length === 1 && parts[0].body) {
    return await inflateStream(parts[0].body, count);
  }

  const bodies = await Promise.all(parts.map(async (resp) => {
    if (!onProgress || !resp.body) return new Uint8Array(await resp.arrayBuffer());
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      n += value.length;
      count(value.length);
    }
    return concat(chunks, n);
  }));
  const all = bodies.length === 1 ? bodies[0] : concat(bodies, bodies.reduce((n, p) => n + p.length, 0));
  if (!isGzip(all)) return all;
  const ds = new DecompressionStream("gzip");
  const out = await new Response(new Blob([all as BlobPart]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}

function concat(chunks: Uint8Array[], n: number): Uint8Array {
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Does this start with gzip's own two magic bytes?
 *
 *  The question the loader has to answer is "did the server hand me the file
 *  or the inflated file", and gzip's magic answers it for EVERY artifact —
 *  the core (SWG1) and a shade band (SWGB) alike. Sniffing for SWG1 instead
 *  worked until v8 arrived and the first band was fed to the inflater. */
function isGzip(head: Uint8Array): boolean {
  return head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
}

/** Read a body, counting the bytes ON THE WIRE, and inflate on the way if
 *  the first chunk is not already a raw SWG1 buffer.
 *
 *  The peek is what makes the sniff possible in a stream: the first chunk is
 *  read, inspected, then put back at the head of a stream that re-emits it
 *  before draining the rest. */
async function inflateStream(body: ReadableStream<Uint8Array>, count: (n: number) => void): Promise<Uint8Array> {
  const reader = body.getReader();
  const first = await reader.read();
  if (first.done || !first.value) return new Uint8Array(0);
  count(first.value.length);
  const head = first.value;
  const src = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(head);
    },
    async pull(c) {
      const { done, value } = await reader.read();
      if (done) { c.close(); return; }
      count(value.length);
      c.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  // the cast is lib.dom's: DecompressionStream is typed as writing
  // BufferSource, which is wider than the Uint8Array chunks a body yields
  const stream: ReadableStream<Uint8Array> = !isGzip(head)
    ? src
    : (src as unknown as ReadableStream<BufferSource>).pipeThrough(new DecompressionStream("gzip")) as ReadableStream<Uint8Array>;
  const out = stream.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await out.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
  }
  return concat(chunks, n);
}

export async function loadGraph(urls: string | string[], opts: LoadProgress = {}): Promise<Graph> {
  const bytes = await fetchArtifact(urls, opts);
  return parseGraph(bytes.buffer as ArrayBuffer);
}

/** Download one shade band and install it (artifact v8, backlog B11).
 *
 *  Idempotent: a band already in memory resolves without a request, which is
 *  what lets the background walk and the planner's own "I need this one now"
 *  ask for the same band without coordinating.
 *
 *  A v7 graph has no bands to load and every k is already there, so this is
 *  a no-op for the seven cities that have not been re-exported. */
export async function loadShadeBand(
  g: Graph,
  k: number,
  urls: string | string[],
  opts: LoadProgress = {}
): Promise<void> {
  if (bandLoaded(g.shade, k)) return;
  const bytes = await fetchArtifact(urls, opts);
  acceptShadeBand(g.shade, k, bytes.buffer as ArrayBuffer);
}

/** Which sidewalk the walker takes on this edge at this time: -1 = left
 *  of the direction of travel, +1 = right (the shadier one; right when
 *  equal), 0 = not a street (a park path has no sides). */
export function walkSide(g: Graph, eid: number, minuteOfDay: number): -1 | 0 | 1 {
  // bit7 without bit0 = car-free road: walk it centred. bit7 WITH bit0 =
  // sidewalk=no street: walk on the road border, so it draws offset like
  // any street (wish 2026-08-19).
  if ((g.flags[eid] & 1) === 0) return 0;
  // a crossing piece (bit2) is walked ACROSS the road — no side, drawn
  // centred on its geometry (street-typed crossing/jaywalk pieces would
  // otherwise pick a shade side, 2026-08-20)
  if ((g.flags[eid] & 4) !== 0) return 0;
  // side bits are every OTHER shade bucket (08_export takes [:, ::2]), so the
  // step is 2x the shade step and the count follows the seasonal window
  const nSide = Math.ceil(g.buckets / 2);
  const step = g.bucketStepMin * 2;
  const b = Math.max(0, Math.min(nSide - 1,
    Math.round((minuteOfDay - g.bucketStartMin) / step)));
  const left = (g.sides[eid * g.sideBytes + (b >> 3)] >> (b & 7)) & 1;
  return left ? -1 : 1;
}

/** Snap a point to the nearest EDGE (not node): the closer endpoint is
 *  the routing node, `tail` is the piece of the edge between the snapped
 *  point and that node, for drawing (2026-08-17: a click on Grüneburgweg
 *  snapped to a vertex 40 m away because the block edge is long). */
export type Snap = { node: number; eid: number; point: [number, number]; tail: [number, number][] };

/** Both endpoints of a snapped edge, each with the tail from the snapped
 *  point to that endpoint, and the metres of edge that tail covers.
 *
 *  snapToEdge picks its node by which HALF of the edge the point falls in —
 *  pure geometry, blind to where the walker is coming from. On a long edge
 *  that node can sit well past the pin, so the router walks there and back;
 *  trimOvershoot only hides the drawn part. Measured over 223 random pins:
 *  38.6 % snapped to the costlier end, average 17.2 m wasted, worst 162 m
 *  (2026-08-28). The caller should price both and keep the cheaper. */
export function snapEnds(g: Graph, snap: Snap): { node: number; tail: [number, number][]; alongM: number }[] {
  if (snap.eid < 0) return [{ node: snap.node, tail: snap.tail, alongM: 0 }];
  const pts = edgeLatLngs(g, snap.eid) as [number, number][];
  const xy = pts.map(([lng, lat]) => toXY(lng, lat));
  const [px, py] = toXY(snap.point[0], snap.point[1]);
  // the segment the snapped point sits on, and how far along the edge it is
  let acc = 0, along = 0, cut = 1, bestD = Infinity;
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1], [bx, by] = xy[i];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < bestD) { bestD = d; cut = i; along = acc + t * Math.hypot(dx, dy); }
    acc += Math.hypot(dx, dy);
  }
  const total = acc || 1;
  return [
    { node: g.edgeSource[snap.eid], tail: [snap.point, ...pts.slice(0, cut).reverse()], alongM: along },
    { node: g.edgeTarget[snap.eid], tail: [snap.point, ...pts.slice(cut)], alongM: total - along },
  ];
}

export function snapToEdge(g: Graph, lngQ: number, latQ: number): Snap {
  const [qx, qy] = toXY(lngQ, latQ);
  const cx = Math.floor(qx / CELL_M);
  const cy = Math.floor(qy / CELL_M);
  let best: Snap | null = null;
  let bestD = Infinity;
  const seen = new Set<number>();
  for (let ring = 0; ring <= 8; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const nodes = g.grid.get((cx + dx + 200) * 4096 + (cy + dy + 200));
        if (!nodes) continue;
        for (const n of nodes) {
          for (let e = g.firstEdge[n]; e < g.firstEdge[n + 1]; e++) {
            if (seen.has(e)) continue;
            seen.add(e);
            const pts = edgeLatLngs(g, e) as [number, number][];
            const xy = pts.map(([lng, lat]) => toXY(lng, lat));
            let acc = 0;
            const segs: number[] = [];
            for (let i = 1; i < xy.length; i++) { segs.push(Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1])); }
            const total = segs.reduce((a, b) => a + b, 0) || 1;
            for (let i = 1; i < xy.length; i++) {
              const [ax, ay] = xy[i - 1], [bx, by] = xy[i];
              const ddx = bx - ax, ddy = by - ay, L2 = ddx * ddx + ddy * ddy;
              const t = L2 > 0 ? Math.max(0, Math.min(1, ((qx - ax) * ddx + (qy - ay) * ddy) / L2)) : 0;
              const px = ax + t * ddx, py = ay + t * ddy;
              const d = (px - qx) ** 2 + (py - qy) ** 2;
              if (d < bestD) {
                bestD = d;
                const along = acc + t * segs[i - 1];
                const point: [number, number] = [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])];
                const toSource = along <= total / 2;
                const node = toSource ? g.edgeSource[e] : g.edgeTarget[e];
                // tail from the snapped point to the chosen node, along the edge
                const tail: [number, number][] = toSource
                  ? [point, ...pts.slice(0, i).reverse()]
                  : [point, ...pts.slice(i)];
                best = { node, eid: e, point, tail };
              }
              acc += segs[i - 1];
            }
          }
        }
      }
    }
    if (best && ring > Math.sqrt(bestD) / CELL_M) break;
  }
  if (!best) {
    const n = nearestNode(g, lngQ, latQ);
    return { node: n, eid: -1, point: [g.lng[n], g.lat[n]], tail: [] };
  }
  return best;
}
