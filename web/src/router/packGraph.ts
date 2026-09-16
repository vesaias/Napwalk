// Test-only mirror of pipeline/08_export_graph.py pack(): builds SWG1 v2
// buffers for unit tests and toy graphs. Kept beside the parser so layout
// changes break loudly in one place.
import { BUCKETS } from "./graph";

export type ToyEdge = {
  u: number;
  v: number;
  lenDm: number;
  surfaceQ?: number;
  noiseQ?: number;
  greenQ?: number;
  shade?: number[]; // 48 bytes, defaults to 0
  shadeL?: number[]; // toy: artifact stores max(L,R)
  shadeR?: number[];
  street?: boolean; // flags bit0
  hasSidewalk?: boolean; // flags bit1: carriageway with a mapped sidewalk (penalised)
  crossing?: boolean; // flags bit2: street crossing (fixed cost)
  geo?: [number, number][]; // intermediate (dlatMicro, dlngMicro) deltas
};

export type ToyCircuit = { id: number; p: number; e: number[]; L: number; iq: number; s?: number[]; g?: number; d?: number; n?: number; u?: number; sc?: number; st?: number; c?: [number, number] };

export function packGraph(nodes: [number, number][], edges: ToyEdge[], circuits: ToyCircuit[] = []): ArrayBuffer {
  const sorted = [...edges].sort((a, b) => a.u - b.u || a.v - b.v);
  const geoTotal = sorted.reduce((s, e) => s + (e.geo?.length ?? 0), 0);
  const cb = new TextEncoder().encode(JSON.stringify(circuits.map((c) => ({
    id: c.id, p: c.p, e: c.e, L: c.L, iq: c.iq, s: c.s ?? new Array(BUCKETS).fill(0),
    g: c.g ?? 1, d: c.d ?? 1, n: c.n ?? 0, u: c.u ?? 0, sc: c.sc ?? 1, st: c.st ?? 0, c: c.c ?? [0, 0],
  }))));
  const header = new TextEncoder().encode(JSON.stringify({
    version: 7, n_nodes: nodes.length, n_edges: sorted.length,
    buckets: BUCKETS, bucket_start_min: 8 * 60, bucket_step_min: 15,
    n_geo_points: geoTotal, len_unit: "dm",
    coord: "latlng-f32", flags: 1, side_bytes: 3,
    circuits_bytes: cb.length, n_circuits: circuits.length,
  }));
  const size = 8 + header.length + nodes.length * 8 + sorted.length * 13 +
    sorted.length + geoTotal * 4 + sorted.length * BUCKETS + sorted.length * 4 + cb.length; // flags 1 + sides 3
  const buf = new ArrayBuffer(size);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  u8.set([0x53, 0x57, 0x47, 0x31], 0); // SWG1
  dv.setUint32(4, header.length, true);
  u8.set(header, 8);
  let o = 8 + header.length;
  for (const [lat, lng] of nodes) {
    dv.setFloat32(o, lat, true);
    dv.setFloat32(o + 4, lng, true);
    o += 8;
  }
  for (const e of sorted) {
    dv.setUint32(o, e.u, true);
    dv.setUint32(o + 4, e.v, true);
    dv.setUint16(o + 8, e.lenDm, true);
    u8[o + 10] = e.surfaceQ ?? 0;
    u8[o + 11] = e.noiseQ ?? 0;
    u8[o + 12] = e.greenQ ?? 0;
    o += 13;
  }
  for (const e of sorted) u8[o++] = e.geo?.length ?? 0;
  for (const e of sorted) {
    for (const [dlat, dlng] of e.geo ?? []) {
      dv.setInt16(o, dlat, true);
      dv.setInt16(o + 2, dlng, true);
      o += 4;
    }
  }
  for (const e of sorted) {
    for (let b = 0; b < BUCKETS; b++) {
      const l = (e.shadeL ?? e.shade)?.[b] ?? 0;
      const r = (e.shadeR ?? e.shade)?.[b] ?? 0;
      u8[o++] = Math.max(l, r);
    }
  }
  for (const e of sorted) u8[o++] = (e.street ? 1 : 0) | (e.hasSidewalk ? 2 : 0) | (e.crossing ? 4 : 0); // flags
  for (const e of sorted) {
    // side bits: 1 = left shadier; 24 half-hour buckets (v6.1) sampled from
    // the even 15-min buckets, matching 08_export_graph
    for (let byte = 0; byte < 3; byte++) {
      let v = 0;
      for (let bit = 0; bit < 8; bit++) {
        const b = (byte * 8 + bit) * 2;
        const l = (e.shadeL ?? e.shade)?.[b] ?? 0;
        const r = (e.shadeR ?? e.shade)?.[b] ?? 0;
        if (l > r) v |= 1 << bit;
      }
      u8[o++] = v;
    }
  }
  u8.set(cb, o);
  return buf;
}

// ---------------------------------------------------------------------------
// v8: core + shade bands (backlog B11) — the twin of pipeline/08's pack_core,
// pack_band and split_bands.
// ---------------------------------------------------------------------------

/** The shade block a toy graph carries: max(L, R) per edge and bucket. */
function toyShadeBlock(sorted: ToyEdge[], buckets: number): Uint8Array {
  const out = new Uint8Array(sorted.length * buckets);
  sorted.forEach((e, i) => {
    for (let b = 0; b < buckets; b++) {
      const l = (e.shadeL ?? e.shade)?.[b] ?? 0;
      const r = (e.shadeR ?? e.shade)?.[b] ?? 0;
      out[i * buckets + b] = Math.max(l, r);
    }
  });
  return out;
}

/** 16 hex chars over the block. Not sha256 — this is a test helper, and all
 *  the client asks of the hash is that it identifies THESE bytes. */
export function toyShadeHash(block: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < block.length; i++) {
    h1 = Math.imul(h1 ^ block[i], 16777619) >>> 0;
    h2 = Math.imul(h2 + block[i] + i, 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function splitBands(nBuckets: number, width: number): { bucket0: number; buckets: number }[] {
  const out = [];
  for (let b = 0; b < nBuckets; b += width) {
    out.push({ bucket0: b, buckets: Math.min(width, nBuckets - b) });
  }
  return out;
}

export type PackedV8 = { core: ArrayBuffer; bands: ArrayBuffer[]; hash: string };

/** A v8 artifact for a toy graph: the core, and one buffer per shade band.
 *
 *  Same section order as v7 with the shade block lifted out, so a test that
 *  loads the core and then feeds the bands in must produce exactly the graph
 *  `packGraph` would have produced. */
export function packGraphV8(
  nodes: [number, number][],
  edges: ToyEdge[],
  circuits: ToyCircuit[] = [],
  opts: { buckets?: number; bandBuckets?: number; startMin?: number; stepMin?: number } = {},
): PackedV8 {
  const buckets = opts.buckets ?? BUCKETS;
  const width = opts.bandBuckets ?? 8;
  const startMin = opts.startMin ?? 8 * 60;
  const stepMin = opts.stepMin ?? 15;
  const sorted = [...edges].sort((a, b) => a.u - b.u || a.v - b.v);
  const e = sorted.length;
  const geoTotal = sorted.reduce((s, x) => s + (x.geo?.length ?? 0), 0);
  const block = toyShadeBlock(sorted, buckets);
  const hash = toyShadeHash(block);
  const specs = splitBands(buckets, width);
  const cb = new TextEncoder().encode(JSON.stringify(circuits.map((c) => ({
    id: c.id, p: c.p, e: c.e, L: c.L, iq: c.iq, s: c.s ?? new Array(buckets).fill(0),
    g: c.g ?? 1, d: c.d ?? 1, n: c.n ?? 0, u: c.u ?? 0, sc: c.sc ?? 1, st: c.st ?? 0, c: c.c ?? [0, 0],
  }))));
  const header = new TextEncoder().encode(JSON.stringify({
    version: 8, n_nodes: nodes.length, n_edges: e,
    buckets, bucket_start_min: startMin, bucket_step_min: stepMin,
    n_geo_points: geoTotal, len_unit: "dm", coord: "latlng-f32",
    flags: 1, side_bytes: 3, circuits_bytes: cb.length, n_circuits: circuits.length,
    shade_hash: hash,
    shade_bands: specs.map((s, k) => ({
      k, bucket0: s.bucket0, buckets: s.buckets,
      start_min: startMin + s.bucket0 * stepMin,
      end_min: startMin + (s.bucket0 + s.buckets - 1) * stepMin,
      file: `graph.shade.${k}.bin.gz`,
    })),
  }));
  const size = 8 + header.length + nodes.length * 8 + e * 13 + e + geoTotal * 4 + e * 4 + cb.length;
  const core = new ArrayBuffer(size);
  const u8 = new Uint8Array(core);
  const dv = new DataView(core);
  u8.set([0x53, 0x57, 0x47, 0x31], 0);
  dv.setUint32(4, header.length, true);
  u8.set(header, 8);
  let o = 8 + header.length;
  for (const [lat, lng] of nodes) {
    dv.setFloat32(o, lat, true);
    dv.setFloat32(o + 4, lng, true);
    o += 8;
  }
  for (const x of sorted) {
    dv.setUint32(o, x.u, true);
    dv.setUint32(o + 4, x.v, true);
    dv.setUint16(o + 8, x.lenDm, true);
    u8[o + 10] = x.surfaceQ ?? 0;
    u8[o + 11] = x.noiseQ ?? 0;
    u8[o + 12] = x.greenQ ?? 0;
    o += 13;
  }
  for (const x of sorted) u8[o++] = x.geo?.length ?? 0;
  for (const x of sorted) {
    for (const [dlat, dlng] of x.geo ?? []) {
      dv.setInt16(o, dlat, true);
      dv.setInt16(o + 2, dlng, true);
      o += 4;
    }
  }
  for (const x of sorted) u8[o++] = (x.street ? 1 : 0) | (x.hasSidewalk ? 2 : 0) | (x.crossing ? 4 : 0);
  for (const x of sorted) {
    for (let byte = 0; byte < 3; byte++) {
      let v = 0;
      for (let bit = 0; bit < 8; bit++) {
        const b = (byte * 8 + bit) * 2;
        const l = (x.shadeL ?? x.shade)?.[b] ?? 0;
        const r = (x.shadeR ?? x.shade)?.[b] ?? 0;
        if (l > r) v |= 1 << bit;
      }
      u8[o++] = v;
    }
  }
  u8.set(cb, o);
  const bands = specs.map((s, k) => packBandBuffer(block, e, buckets, k, s.bucket0, s.buckets, hash));
  return { core, bands, hash };
}

/** One band file: the 16-byte prefix, then the column slice, edge-major. */
export function packBandBuffer(
  block: Uint8Array,
  nEdges: number,
  buckets: number,
  k: number,
  bucket0: number,
  width: number,
  hash: string,
): ArrayBuffer {
  const buf = new ArrayBuffer(16 + nEdges * width);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  u8.set([0x53, 0x57, 0x47, 0x42], 0); // SWGB
  dv.setUint16(4, k, true);
  dv.setUint16(6, width, true);
  for (let i = 0; i < 8; i++) u8[8 + i] = parseInt(hash.slice(i * 2, i * 2 + 2), 16);
  for (let i = 0; i < nEdges; i++) {
    for (let b = 0; b < width; b++) u8[16 + i * width + b] = block[i * buckets + bucket0 + b];
  }
  return buf;
}
