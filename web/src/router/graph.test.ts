import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { edgeLatLngs, loadGraph, nearestNode, parseGraph } from "./graph";
import { packGraph } from "./packGraph";

// three nodes around Frankfurt center, ~100 m apart
const NODES: [number, number][] = [
  [50.1109, 8.6821],
  [50.1118, 8.6821],
  [50.1109, 8.6835],
];

describe("parseGraph", () => {
  it("builds CSR over sorted edges", () => {
    const g = parseGraph(packGraph(NODES, [
      { u: 0, v: 1, lenDm: 1000 },
      { u: 0, v: 2, lenDm: 1000 },
      { u: 1, v: 0, lenDm: 1000 },
    ]));
    expect(g.nNodes).toBe(3);
    expect(Array.from(g.firstEdge)).toEqual([0, 2, 3, 3]);
    expect(g.edgeTarget[0]).toBe(1);
    expect(g.edgeTarget[2]).toBe(0);
  });

  it("rejects wrong magic", () => {
    expect(() => parseGraph(new ArrayBuffer(64))).toThrow();
  });
});

describe("nearestNode", () => {
  it("finds the closest node", () => {
    const g = parseGraph(packGraph(NODES, [{ u: 0, v: 1, lenDm: 1000 }]));
    expect(nearestNode(g, 8.6821, 50.111)).toBe(0);
    expect(nearestNode(g, 8.6836, 50.1108)).toBe(2);
  });
});

describe("edgeLatLngs", () => {
  it("decodes delta geometry between endpoints", () => {
    const g = parseGraph(packGraph(NODES, [
      { u: 0, v: 1, lenDm: 1000, geo: [[300, 100], [300, -100]] },
    ]));
    const line = edgeLatLngs(g, 0);
    expect(line.length).toBe(4);
    expect(line[0][0]).toBeCloseTo(8.6821, 4);
    expect(line[1][1]).toBeCloseTo(50.1109 + 0.0003, 4);
    expect(line[2][0]).toBeCloseTo(8.6821 + 0.0001 - 0.0001, 4);
    expect(line[3][1]).toBeCloseTo(50.1118, 4);
  });
});

describe("loadGraph", () => {
  // Cloudflare Pages caps one asset at 25 MiB; NYC, Berlin and London are
  // over it, so 08_export_graph slices their .gz into parts and the loader
  // concatenates before inflating (2026-09-01).
  const toy = () => new Uint8Array(packGraph(NODES, [{ u: 0, v: 1, lenDm: 1000 }]));

  it("concatenates chunked parts before inflating", async () => {
    const gz = gzipSync(toy());
    const cut = [0, 7, 20, gz.length];
    const urls = ["/g.bin.gz.0?v=1", "/g.bin.gz.1?v=1", "/g.bin.gz.2?v=1"];
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      fetched.push(u);
      const i = urls.indexOf(u);
      return i < 0 ? new Response(null, { status: 404 }) : new Response(gz.subarray(cut[i], cut[i + 1]));
    });
    const g = await loadGraph(urls);
    expect(g.nNodes).toBe(3);
    expect(fetched.sort()).toEqual([...urls].sort());
    vi.unstubAllGlobals();
  });

  it("fails loud when a part is missing", async () => {
    const gz = gzipSync(toy());
    vi.stubGlobal("fetch", async (u: string) =>
      u.endsWith(".1") ? new Response(null, { status: 404 }) : new Response(gz.subarray(0, 10)));
    await expect(loadGraph(["/g.bin.gz.0", "/g.bin.gz.1"])).rejects.toThrow(/404/);
    vi.unstubAllGlobals();
  });

  it("still takes a single whole artifact", async () => {
    vi.stubGlobal("fetch", async () => new Response(toy()));
    const g = await loadGraph("/graph.bin.gz");
    expect(g.nEdges).toBe(1);
    vi.unstubAllGlobals();
  });
});
