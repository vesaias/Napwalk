// Artifact v8: the shade block arrives in time bands, and a minute whose
// band is not in yet has NO price (backlog B11). The rule these tests hold
// down is CLAUDE.md rule 4 — never a substituted shade value, ever.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptShadeBand,
  bandLoaded,
  bandOfBucket,
  bandsForMinutes,
  bandsReady,
  bucketOfMinute,
  dropShadeBands,
  loadShadeBand,
  parseGraph,
  SHADE_PENDING,
  loadGraph,
} from "./graph";
import { packGraph, packGraphV8, packBandBuffer } from "./packGraph";
import { edgeCost, PRESETS, shadeAt, shadeAtOrThrow, ShadePendingError } from "./astar";
import { routeStats } from "./stats";
import { sunMinutes } from "../plan/hours";
import { shadeAhead } from "../ui/nav";
import { shadeAround } from "../plan/hours";

const NODES: [number, number][] = [
  [50.1109, 8.6821],
  [50.1119, 8.6821],
  [50.1129, 8.6821],
];

/** 24 buckets from 08:00, 15 min apart: 08:00 … 13:45. Three bands of 8
 *  (two hours each), which is the shipped width. */
const BUCKETS = 24;
const WIDTH = 8;
const START = 8 * 60;

/** A shade curve that is different in every bucket, so a lookup that read
 *  the wrong bucket — or the wrong band — cannot pass by luck. */
const RAMP = Array.from({ length: BUCKETS }, (_, b) => b * 10);

const EDGES = [
  { u: 0, v: 1, lenDm: 1000, shade: RAMP },
  { u: 1, v: 2, lenDm: 1000, shade: RAMP.map((v) => 255 - v) },
];

function v8() {
  return packGraphV8(NODES, EDGES, [], { buckets: BUCKETS, bandBuckets: WIDTH, startMin: START });
}

function v7() {
  return parseGraph(packGraph(NODES, EDGES.map((e) => ({ ...e, shade: padded(e.shade) }))));
}

/** packGraph writes the default 48-bucket header, so a v7 comparison graph
 *  needs the same curve padded out to 48. Only the first 24 are compared. */
function padded(shade: number[]): number[] {
  return [...shade, ...new Array(48 - BUCKETS).fill(0)];
}

afterEach(() => vi.unstubAllGlobals());

describe("a v7 artifact is one band that is always loaded", () => {
  it("answers every band question yes and prices every minute", () => {
    const g = v7();
    expect(g.shade.bands.length).toBe(1);
    expect(g.shade.hash).toBe("");
    expect(bandLoaded(g.shade, 0)).toBe(true);
    expect(bandsReady(g, 0, 24 * 60)).toBe(true);
    expect(shadeAt(g, 0, START)).toBeCloseTo(0);
    expect(shadeAt(g, 0, START + 15)).toBeCloseTo(10 / 255);
  });

  it("has no bands to drop", () => {
    const g = v7();
    expect(dropShadeBands(g.shade, [])).toBe(0);
    expect(bandLoaded(g.shade, 0)).toBe(true);
  });
});

describe("a v8 core", () => {
  it("parses the graph without any shade at all", () => {
    const g = parseGraph(v8().core);
    expect(g.nEdges).toBe(2);
    expect(g.buckets).toBe(BUCKETS);
    expect(g.bucketStartMin).toBe(START);
    expect(g.shade.bands.map((b) => [b.bucket0, b.buckets])).toEqual([[0, 8], [8, 8], [16, 8]]);
    expect(g.shade.data).toEqual([null, null, null]);
    expect(g.shade.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("carries the same edges and geometry a v7 artifact would", () => {
    const g8 = parseGraph(v8().core);
    const g7 = v7();
    expect([...g8.lenDm]).toEqual([...g7.lenDm]);
    expect([...g8.edgeSource]).toEqual([...g7.edgeSource]);
    expect([...g8.edgeTarget]).toEqual([...g7.edgeTarget]);
    expect([...g8.firstEdge]).toEqual([...g7.firstEdge]);
    expect([...g8.sides]).toEqual([...g7.sides]);
  });

  it("prices nothing until a band lands, and says so rather than guessing", () => {
    const g = parseGraph(v8().core);
    expect(shadeAt(g, 0, START + 30)).toBe(SHADE_PENDING);
    expect(bandsReady(g, START, START + 60)).toBe(false);
    expect(() => shadeAtOrThrow(g, 0, START + 30)).toThrow(ShadePendingError);
    expect(() => edgeCost(g, 0, START + 30, PRESETS.balanced, 0)).toThrow(ShadePendingError);
    expect(() => routeStats(g, [0, 1], START + 30)).toThrow(ShadePendingError);
  });

  it("reads exactly what v7 reads once every band is in", () => {
    const { core, bands } = v8();
    const g = parseGraph(core);
    bands.forEach((b, k) => acceptShadeBand(g.shade, k, b));
    const ref = v7();
    for (let b = 0; b < BUCKETS; b++) {
      const m = START + b * 15;
      expect(shadeAt(g, 0, m), `bucket ${b}`).toBeCloseTo(shadeAt(ref, 0, m), 9);
      expect(shadeAt(g, 1, m), `bucket ${b}`).toBeCloseTo(shadeAt(ref, 1, m), 9);
    }
    // and between buckets, where the lerp has to reach across a boundary
    expect(shadeAt(g, 0, START + 7 * 15 + 7.5)).toBeCloseTo(shadeAt(ref, 0, START + 7 * 15 + 7.5), 9);
  });

  it("prices the minutes of a band as soon as THAT band lands", () => {
    const { core, bands } = v8();
    const g = parseGraph(core);
    acceptShadeBand(g.shade, 1, bands[1]);
    expect(g.shade.version).toBe(1);
    // band 1 is buckets 8..15 = 10:00 … 11:45
    expect(bandsReady(g, 10 * 60, 11 * 60)).toBe(true);
    expect(shadeAt(g, 0, 10 * 60)).toBeCloseTo(80 / 255);
    // its neighbours are still unpriceable
    expect(bandsReady(g, 9 * 60, 11 * 60)).toBe(false);
    expect(shadeAt(g, 0, 9 * 60)).toBe(SHADE_PENDING);
    // and a lerp that straddles the far edge of the band needs the next one
    expect(shadeAt(g, 0, 11 * 60 + 50)).toBe(SHADE_PENDING);
  });
});

describe("which bands a departure needs", () => {
  it("maps minutes to buckets and clamps into the window", () => {
    const g = parseGraph(v8().core);
    expect(bucketOfMinute(g, START)).toBe(0);
    expect(bucketOfMinute(g, START + 15)).toBe(1);
    expect(bucketOfMinute(g, 0)).toBe(0); // before the window
    expect(bucketOfMinute(g, 23 * 60)).toBe(BUCKETS - 1); // after it
    expect(bandOfBucket(g.shade, 0)).toBe(0);
    expect(bandOfBucket(g.shade, 8)).toBe(1);
    expect(bandOfBucket(g.shade, 23)).toBe(2);
    expect(bandOfBucket(g.shade, 24)).toBe(-1);
  });

  it("a walk inside one band needs one band", () => {
    const g = parseGraph(v8().core);
    expect(bandsForMinutes(g, 8 * 60, 9 * 60)).toEqual([0]);
  });

  it("a walk across a boundary needs both bands — the case B11 called out", () => {
    const g = parseGraph(v8().core);
    // 09:30 + 1 h ends at 10:30, which is bucket 10, in band 1
    expect(bandsForMinutes(g, 9 * 60 + 30, 10 * 60 + 30)).toEqual([0, 1]);
  });

  it("the 3 h 15 min prefetch window can touch three bands", () => {
    const g = parseGraph(v8().core);
    // 09:45 -> 13:00 is buckets 7..20: bands 0, 1 and 2
    expect(bandsForMinutes(g, 9 * 60 + 45, 13 * 60)).toEqual([0, 1, 2]);
  });

  // S8 review F3. `lerpShade` reads floor(b) AND floor(b)+1 unconditionally,
  // so the last minute of a span can need one bucket more than it falls in —
  // and that bucket can be the first of the next band. The gate used to
  // ROUND, said GO, and `shadeAtOrThrow` would then have raised.
  it("asks for the neighbour bucket the interpolation reads", () => {
    const { core, bands } = v8();
    const g = parseGraph(core);
    // 09:45 IS bucket 7, the last of band 0 — and lerpShade reads bucket 8
    expect(bandsForMinutes(g, START, 9 * 60 + 45)).toEqual([0, 1]);
    acceptShadeBand(g.shade, 0, bands[0]);
    expect(bandsReady(g, START, 9 * 60 + 45)).toBe(false);
    expect(shadeAt(g, 0, 9 * 60 + 45)).toBe(SHADE_PENDING);
    acceptShadeBand(g.shade, 1, bands[1]);
    expect(bandsReady(g, START, 9 * 60 + 45)).toBe(true);
    expect(shadeAt(g, 0, 9 * 60 + 45)).toBeCloseTo(70 / 255);
  });

  it("the gate and the lookup agree at EVERY minute of the window", () => {
    const { core, bands } = v8();
    const g = parseGraph(core);
    for (const b of [0, 1, 2]) acceptShadeBand(g.shade, b, bands[b]);
    // the whole store in hand, walk every minute and check the two agree
    for (let m = START - 30; m <= START + 15 * BUCKETS + 30; m++) {
      const g2 = parseGraph(v8().core);
      for (const k of bandsForMinutes(g2, m, m)) acceptShadeBand(g2.shade, k, bands[k]);
      expect(bandsReady(g2, m, m)).toBe(true);
      expect(shadeAt(g2, 0, m), `minute ${m}`).not.toBe(SHADE_PENDING);
    }
  });

  it("floors rather than rounds, the way lerpShade does", () => {
    const g = parseGraph(v8().core);
    expect(bucketOfMinute(g, START + 14)).toBe(0); // Math.round would say 1
    expect(bucketOfMinute(g, START + 15)).toBe(1);
  });

  it("a dawn minute needs the FIRST band and a dusk minute the LAST", () => {
    const g = parseGraph(v8().core);
    // lerpShade clamps a sunlit minute outside the window to the nearest
    // edge bucket (B14), so the band it needs is that bucket's band
    expect(bandsForMinutes(g, 5 * 60, 5 * 60)).toEqual([0]);
    expect(bandsForMinutes(g, 22 * 60, 22 * 60)).toEqual([2]);
    // ...and the +1 neighbour clamps back into the window rather than
    // asking for a band that is not there
    expect(bandsForMinutes(g, 5 * 60, 23 * 60)).toEqual([0, 1, 2]);
  });
});

describe("a band that does not belong to this core is refused", () => {
  it("wrong hash", () => {
    const { core, bands, hash } = v8();
    const g = parseGraph(core);
    const wrong = new Uint8Array(bands[0].slice(0));
    wrong[8] ^= 0xff;
    expect(() => acceptShadeBand(g.shade, 0, wrong.buffer as ArrayBuffer)).toThrow(/hash/);
    expect(bandLoaded(g.shade, 0)).toBe(false);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("wrong band index", () => {
    const { core, bands } = v8();
    const g = parseGraph(core);
    expect(() => acceptShadeBand(g.shade, 0, bands[1])).toThrow(/band 1/);
  });

  it("wrong width", () => {
    const { core, hash } = v8();
    const g = parseGraph(core);
    const block = new Uint8Array(2 * BUCKETS);
    const bad = packBandBuffer(block, 2, BUCKETS, 0, 0, 4, hash);
    expect(() => acceptShadeBand(g.shade, 0, bad)).toThrow(/buckets/);
  });

  it("wrong magic", () => {
    const { core, bands } = v8();
    const g = parseGraph(core);
    const bad = new Uint8Array(bands[0].slice(0));
    bad[0] = 0x4e;
    expect(() => acceptShadeBand(g.shade, 0, bad.buffer as ArrayBuffer)).toThrow(/magic/);
  });

  it("a truncated body", () => {
    const { core, bands } = v8();
    const g = parseGraph(core);
    expect(() => acceptShadeBand(g.shade, 0, bands[0].slice(0, bands[0].byteLength - 1))).toThrow(/bytes/);
  });

  it("a band index this graph does not have", () => {
    const { core, bands } = v8();
    const g = parseGraph(core);
    expect(() => acceptShadeBand(g.shade, 9, bands[0])).toThrow(/no shade band 9/);
  });
});

describe("a core with a broken band map is not a graph", () => {
  function corrupt(edit: (h: Record<string, unknown>) => void): () => void {
    const { core } = v8();
    const hlen = new DataView(core).getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(core, 8, hlen)));
    edit(header);
    const next = new TextEncoder().encode(JSON.stringify(header));
    const out = new ArrayBuffer(8 + next.length + (core.byteLength - 8 - hlen));
    const u8 = new Uint8Array(out);
    u8.set(new Uint8Array(core, 0, 4), 0);
    new DataView(out).setUint32(4, next.length, true);
    u8.set(next, 8);
    u8.set(new Uint8Array(core, 8 + hlen), 8 + next.length);
    return () => parseGraph(out);
  }

  it("no bands at all", () => {
    expect(corrupt((h) => { h.shade_bands = []; })).toThrow(/shade_bands/);
  });

  it("no hash", () => {
    expect(corrupt((h) => { h.shade_hash = "nope"; })).toThrow(/shade_hash/);
  });

  it("a gap between two bands", () => {
    expect(corrupt((h) => {
      (h.shade_bands as Record<string, unknown>[])[1].bucket0 = 9;
    })).toThrow(/starts at 9/);
  });

  it("bands that do not cover the window", () => {
    expect(corrupt((h) => { (h.shade_bands as unknown[]).pop(); })).toThrow(/cover 16 of 24/);
  });

  it("a clock span that disagrees with the buckets", () => {
    expect(corrupt((h) => {
      (h.shade_bands as Record<string, unknown>[])[1].start_min = 9 * 60;
    })).toThrow(/clock span/);
  });
});

describe("loadShadeBand", () => {
  function respond(buf: ArrayBuffer) {
    const bytes = new Uint8Array(buf);
    return {
      ok: true,
      headers: { get: () => null },
      body: {
        getReader() {
          let done = false;
          return {
            read: async () => (done ? { done: true, value: undefined } : ((done = true), { done: false, value: bytes })),
          };
        },
      },
      arrayBuffer: async () => buf,
    };
  }

  it("loads a core over the wire and finds no shade in it", async () => {
    const { core } = v8();
    vi.stubGlobal("fetch", vi.fn(async () => respond(core)));
    const g = await loadGraph("/graph.core.bin.gz");
    expect(g.nEdges).toBe(2);
    expect(g.shade.data).toEqual([null, null, null]);
  });

  it("installs a band and does not ask twice", async () => {
    const { core, bands } = v8();
    const g = parseGraph(core);
    const fetchMock = vi.fn(async () => respond(bands[2]));
    vi.stubGlobal("fetch", fetchMock);
    await loadShadeBand(g, 2, "/graph.shade.2.bin.gz");
    expect(bandLoaded(g.shade, 2)).toBe(true);
    expect(shadeAt(g, 0, START + 16 * 15)).toBeCloseTo(160 / 255);
    await loadShadeBand(g, 2, "/graph.shade.2.bin.gz");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a band the server got wrong, and leaves the graph unpriced", async () => {
    const { core, bands } = v8();
    const g = parseGraph(core);
    vi.stubGlobal("fetch", vi.fn(async () => respond(bands[0])));
    await expect(loadShadeBand(g, 1, "/graph.shade.1.bin.gz")).rejects.toThrow(/band 0/);
    expect(bandLoaded(g.shade, 1)).toBe(false);
  });
});

describe("dropShadeBands", () => {
  it("keeps the ones a departure still needs and forgets the rest", () => {
    const { core, bands } = v8();
    const g = parseGraph(core);
    bands.forEach((b, k) => acceptShadeBand(g.shade, k, b));
    const before = g.shade.version;
    expect(dropShadeBands(g.shade, [1])).toBe(2);
    expect(g.shade.version).toBeGreaterThan(before);
    expect(bandLoaded(g.shade, 1)).toBe(true);
    expect(bandLoaded(g.shade, 0)).toBe(false);
    expect(shadeAt(g, 0, 8 * 60)).toBe(SHADE_PENDING);
    // and nothing to do the second time
    expect(dropShadeBands(g.shade, [1])).toBe(0);
  });
});

// S8 review F7: `SHADE_PENDING` is −1, and −1 is a number. Three sites read
// `shadeAt` raw and compared it — `< 0.5` is TRUE for −1, so a pending edge
// counted as full sun; `>= SHADED` is false, so it drew as sunny; and the
// loop composer averaged it into a park's quality score. Nothing may price a
// minute it cannot price.
describe("nothing prices a band that has not arrived", () => {
  /** The toy chain's two edges, as a candidate. */
  const CAND = { eids: [0, 1], nodes: [0, 1, 2] };

  it("sunMinutes raises rather than counting a pending edge as sun", () => {
    const g = parseGraph(v8().core);
    expect(() => sunMinutes(g, [0, 1], 10 * 60)).toThrow(ShadePendingError);
  });

  it("...and still answers once the band is in", () => {
    const { core, bands } = v8();
    const g = parseGraph(core);
    acceptShadeBand(g.shade, 1, bands[1]);
    expect(() => sunMinutes(g, [0, 1], 10 * 60)).not.toThrow();
  });

  // ...and the figure the place card's memo is built on: null before, a
  // number after. It is what the memo has to re-run to see (S8 review F2).
  it("shadeAround is null before the band and a number after", () => {
    const { core, bands } = v8();
    const g = parseGraph(core);
    const [lat, lng] = NODES[0];
    expect(shadeAround(g, lng, lat, 10 * 60)).toBe(null);
    acceptShadeBand(g.shade, 1, bands[1]);
    expect(shadeAround(g, lng, lat, 10 * 60)).not.toBe(null);
  });

  it("shadeAhead says nothing rather than drawing a pending edge as sunny", () => {
    const g = parseGraph(v8().core);
    expect(shadeAhead(g, CAND, [NODES[0][1], NODES[0][0]], 10 * 60)).toBe(null);
  });

  it("...and reports the walk once the band is in", () => {
    const { core, bands } = v8();
    const g = parseGraph(core);
    for (const k of [0, 1, 2]) acceptShadeBand(g.shade, k, bands[k]);
    const a = shadeAhead(g, CAND, [NODES[0][1], NODES[0][0]], 10 * 60);
    expect(a).not.toBe(null);
    expect(a!.remainingEids).toEqual([0, 1]);
  });
});
