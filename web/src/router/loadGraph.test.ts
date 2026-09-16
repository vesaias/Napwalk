// The download half of the loader: byte counting and cancellation (CR-03 Q5).
// The parse is graph.test.ts's subject; these tests are about what the city
// sheet's progress row is fed and what its ✕ actually stops.
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadGraph } from "./graph";
import { packGraph } from "./packGraph";

const NODES: [number, number][] = [
  [50.1109, 8.6821],
  [50.1119, 8.6821],
];
const ARTIFACT = packGraph(NODES, [{ u: 0, v: 1, lenDm: 1000 }]);

/** A response whose body arrives in `n` equal chunks, so a test can watch a
 *  download the way the row does. */
function chunked(buf: ArrayBuffer, n: number, headers: Record<string, string> = {}) {
  const bytes = new Uint8Array(buf);
  const size = Math.ceil(bytes.length / n);
  return {
    ok: true,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    body: {
      getReader() {
        let i = 0;
        return {
          read: async () =>
            i >= bytes.length
              ? { done: true, value: undefined }
              : { done: false, value: bytes.slice(i, (i += size)) },
        };
      },
    },
    arrayBuffer: async () => buf,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("loadGraph progress", () => {
  it("counts the bytes against the total it was given, and lands on it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => chunked(ARTIFACT, 4)));
    const seen: [number, number][] = [];
    const g = await loadGraph("/graph.bin.gz", {
      total: ARTIFACT.byteLength,
      onProgress: (loaded, total) => seen.push([loaded, total]),
    });
    expect(g.nNodes).toBe(2);
    expect(seen.length).toBe(4);
    expect(seen.every(([, total]) => total === ARTIFACT.byteLength)).toBe(true);
    // monotonic, and it reaches the end
    expect(seen.map(([l]) => l)).toEqual([...seen.map(([l]) => l)].sort((a, b) => a - b));
    expect(seen.at(-1)?.[0]).toBe(ARTIFACT.byteLength);
  });

  it("falls back to Content-Length when nothing passed a total", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => chunked(ARTIFACT, 2, { "content-length": String(ARTIFACT.byteLength) })),
    );
    const seen: number[] = [];
    await loadGraph("/graph.bin.gz", { onProgress: (_l, total) => seen.push(total) });
    expect(new Set(seen)).toEqual(new Set([ARTIFACT.byteLength]));
  });

  it("reports no total at all when the server content-encodes the body", async () => {
    // Vite dev does exactly this: it inflates graph.bin.gz on the way out,
    // so neither the manifest's bytes nor Content-Length describe the stream.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => chunked(ARTIFACT, 2, { "content-encoding": "gzip" })),
    );
    const seen: number[] = [];
    await loadGraph("/graph.bin.gz", {
      total: 99,
      onProgress: (_l, total) => seen.push(total),
    });
    expect(new Set(seen)).toEqual(new Set([0]));
  });

  it("prefers an accurate Content-Length over a stale manifest total", async () => {
    // Pages serves the .gz as-is, so Content-Length IS the stream. A
    // manifest measured before a pipeline rerun is not, and a too-LARGE
    // stale total is the one the overrun guard cannot catch — the bar would
    // stall short of 100 % and then jump (review B-2).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => chunked(ARTIFACT, 4, { "content-length": String(ARTIFACT.byteLength) })),
    );
    const seen: [number, number][] = [];
    await loadGraph("/graph.bin.gz", {
      total: ARTIFACT.byteLength * 3, // a stale manifest, three times too big
      onProgress: (loaded, total) => seen.push([loaded, total]),
    });
    expect(new Set(seen.map(([, t]) => t))).toEqual(new Set([ARTIFACT.byteLength]));
    expect(seen.at(-1)?.[0]).toBe(ARTIFACT.byteLength);
  });

  it("ignores a partial Content-Length sum, and takes the manifest instead", async () => {
    // One part declares a length and the other does not: half a sum is a
    // total the stream overruns half way through, so it is not a total.
    const half = ARTIFACT.byteLength >> 1;
    const a = ARTIFACT.slice(0, half);
    const b = ARTIFACT.slice(half);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith(".0")
          ? chunked(a, 2, { "content-length": String(a.byteLength) })
          : chunked(b, 2),
      ),
    );
    const seen: number[] = [];
    await loadGraph(["/g.bin.gz.0", "/g.bin.gz.1"], {
      total: ARTIFACT.byteLength,
      onProgress: (_l, total) => seen.push(total),
    });
    expect(new Set(seen)).toEqual(new Set([ARTIFACT.byteLength]));
  });

  it("drops a total the stream overruns, rather than pinning the bar at 100 %", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => chunked(ARTIFACT, 4)));
    const seen: [number, number][] = [];
    await loadGraph("/graph.bin.gz", {
      total: 8, // far too small: a stale manifest
      onProgress: (loaded, total) => seen.push([loaded, total]),
    });
    expect(seen.at(-1)?.[1]).toBe(0);
    expect(seen.at(-1)?.[0]).toBe(ARTIFACT.byteLength);
  });

  it("sums the parts of a chunked artifact into one running count", async () => {
    const half = ARTIFACT.byteLength >> 1;
    const a = ARTIFACT.slice(0, half);
    const b = ARTIFACT.slice(half);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => chunked(url.endsWith(".0") ? a : b, 2)),
    );
    const seen: number[] = [];
    const g = await loadGraph(["/g.bin.gz.0", "/g.bin.gz.1"], {
      total: ARTIFACT.byteLength,
      onProgress: (loaded) => seen.push(loaded),
    });
    expect(g.nNodes).toBe(2);
    expect(Math.max(...seen)).toBe(ARTIFACT.byteLength);
  });

  it("passes the signal to fetch, so a cancel never reaches the parser", async () => {
    const ctrl = new AbortController();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return chunked(ARTIFACT, 2);
    });
    vi.stubGlobal("fetch", fetchMock);
    ctrl.abort();
    await expect(loadGraph("/graph.bin.gz", { signal: ctrl.signal })).rejects.toThrow();
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(ctrl.signal);
  });

  // Was "still takes the plain arrayBuffer path when nobody is watching"
  // until 2026-09-10 (B11). A single-URL artifact is now always read chunk
  // by chunk, whether or not anybody is counting, because that is what lets
  // it be INFLATED as it arrives — the core's typed arrays are built while
  // the wire is still busy. Nothing about the parsed graph changes.
  it("reads a single artifact through the body reader even with no onProgress", async () => {
    const resp = chunked(ARTIFACT, 4);
    const spy = vi.spyOn(resp.body, "getReader");
    vi.stubGlobal("fetch", vi.fn(async () => resp));
    const g = await loadGraph("/graph.bin.gz");
    expect(g.nNodes).toBe(2);
    expect(spy).toHaveBeenCalled();
  });

  // The parts of a chunked .gz are byte-slices of ONE gzip stream, so they
  // only mean anything concatenated: those still inflate at the end.
  it("still buffers the parts of a chunked artifact before inflating", async () => {
    const half = Math.floor(ARTIFACT.byteLength / 2);
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      chunked(url.endsWith(".0") ? ARTIFACT.slice(0, half) : ARTIFACT.slice(half), 2)));
    const g = await loadGraph(["/g.bin.gz.0", "/g.bin.gz.1"]);
    expect(g.nNodes).toBe(2);
  });
});
