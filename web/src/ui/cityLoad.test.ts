// The download machine (CR-03 Q5, review B-8): one artifact at a time, a
// replace-in-flight path, and an abort landing between the last chunk and
// the parse. Its only coverage was four e2e tests; this is the half that can
// be driven a transition at a time.
//
// Since 2026-09-15 it is the app's ONLY graph download — a city tap switches
// at once and this is what streams the new city's core under the map
// (ui/useCity.ts) — so "the second tap wins" is a transition of the city
// switch itself, not of a sheet. Later the same day the pill over the map
// went (Viktor's ruling, DECISIONS.md), and with it the byte count, the
// manifest total, the emit throttle and the ✕: a download can no longer be
// stopped by hand, so every abort left here is quiet and none is reported.
//
// `createCityLoad` takes its network and its React by injection, so nothing
// here mounts anything or fetches anything.
import { describe, expect, it, vi } from "vitest";
import type { CityId } from "../cities";
import { loadGraph, type Graph, type LoadProgress } from "../router/graph";
import { graphFetch } from "../router/graphCache";
import { createCityLoad, type CityLoadHandlers } from "./cityLoad";

/** A graph is an opaque object to this machine — it hands it to `onLoaded`
 *  and never looks inside. */
const GRAPH = { nNodes: 2 } as unknown as Graph;

type Pending = {
  id: CityId;
  opts: LoadProgress;
  resolve: (g: Graph) => void;
  reject: (e: unknown) => void;
};

/** A machine with every dependency recorded, and a hand crank for the
 *  network. */
function harness(
  /** What `deps.fetch` does. The default is a hand-cranked promise; the B19
   *  suite below passes the real loader instead. */
  net?: (opts: LoadProgress) => Promise<Graph>,
) {
  const calls = { loaded: [] as CityId[], failed: [] as CityId[] };
  const kept: [CityId, Graph][] = [];
  const pending: Pending[] = [];

  const handlers: CityLoadHandlers = {
    onLoaded: (id, g) => {
      calls.loaded.push(id);
      kept.push([id, g]);
    },
    onFailed: (id) => calls.failed.push(id),
  };

  const core = createCityLoad({
    handlers: () => handlers,
    fetch: (id, opts) =>
      net?.(opts) ??
      new Promise<Graph>((resolve, reject) => {
        pending.push({ id, opts, resolve, reject });
        // The real loadGraph rejects on abort; so does this one.
        opts.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  });

  return {
    core,
    calls,
    kept,
    /** The download the machine last started. */
    last: () => pending[pending.length - 1],
    fetches: () => pending.length,
    /** Let the promise chain run. */
    settle: () => new Promise<void>((r) => setTimeout(r, 0)),
  };
}

describe("the city download machine", () => {
  it("starts one download, with an abort signal on it", () => {
    const h = harness();
    h.core.start("hamburg");
    expect(h.fetches()).toBe(1);
    expect(h.last().id).toBe("hamburg");
    expect(h.last().opts.signal?.aborted).toBe(false);
  });

  it("hands the parsed graph to its owner", async () => {
    const h = harness();
    h.core.start("sf");
    h.last().resolve(GRAPH);
    await h.settle();
    expect(h.kept).toEqual([["sf", GRAPH]]);
    expect(h.calls.loaded).toEqual(["sf"]);
    expect(h.calls.failed).toEqual([]);
  });

  it("an owner going away aborts, and says nothing", async () => {
    // The two aborts left are this and the replacement below, and neither is
    // a thing the reader asked about — the ✕ that was went with the pill.
    const h = harness();
    h.core.start("hamburg");
    h.core.dispose();
    await h.settle();
    expect(h.last().opts.signal?.aborted).toBe(true);
    expect(h.calls.loaded).toEqual([]);
    expect(h.calls.failed, "an unmount is not a failure to report").toEqual([]);
  });

  it("drops a graph whose abort landed between the last chunk and the parse", async () => {
    // loadGraph re-checks `signal.aborted` and can still RESOLVE: every byte
    // was in before the abort. The graph is dropped, not adopted — whoever
    // aborted it is not looking at that city any more.
    const h = harness();
    h.core.start("hamburg");
    const job = h.last();
    h.core.dispose();
    expect(job.opts.signal?.aborted).toBe(true);
    job.resolve(GRAPH);
    await h.settle();
    expect(h.kept).toEqual([]);
    expect(h.calls.loaded).toEqual([]);
    expect(h.calls.failed).toEqual([]);
  });

  it("a failed download is reported, and nothing is switched", async () => {
    const h = harness();
    h.core.start("hamburg");
    h.last().reject(new Error("graph fetch failed: 500"));
    await h.settle();
    expect(h.calls.failed).toEqual(["hamburg"]);
    expect(h.kept).toEqual([]);
  });

  it("a second city replaces the first without a word, and only it finishes", async () => {
    const h = harness();
    h.core.start("hamburg");
    const first = h.last();
    h.core.start("sf");
    const second = h.last();
    expect(h.fetches()).toBe(2);
    expect(first.opts.signal?.aborted).toBe(true);
    second.resolve(GRAPH);
    await h.settle();
    expect(h.calls.failed, "a change of mind is not a failure").toEqual([]);
    expect(h.kept).toEqual([["sf", GRAPH]]);
  });

  it("tapping the city already downloading changes nothing", () => {
    const h = harness();
    h.core.start("hamburg");
    h.core.start("hamburg");
    expect(h.fetches()).toBe(1);
  });

  it("…but a start after an abort of the SAME city is a real start", async () => {
    // StrictMode, in DEV: the effect that starts the download is cleaned up
    // and run again, and `live` is only cleared a microtask later, in the
    // rejection. "Already downloading this one" was true of a job that had
    // been aborted, so the remount returned early and the city never loaded
    // at all (2026-09-15).
    const h = harness();
    h.core.start("frankfurt");
    const first = h.last();
    h.core.dispose();
    h.core.start("frankfurt");
    expect(h.fetches()).toBe(2);
    expect(first.opts.signal?.aborted).toBe(true);
    expect(h.last().opts.signal?.aborted).toBe(false);
    h.last().resolve(GRAPH);
    await h.settle();
    expect(h.calls.loaded).toEqual(["frankfurt"]);
  });

  it("a retry after a failure downloads the same city again", async () => {
    // `useCityGraph`'s `reload`: the cityFailed card's Retry, and — since the
    // pill went — the planner's own single retry when a walk is asked for in
    // a city whose artifact did not arrive (ui/usePlanner.ts).
    const h = harness();
    h.core.start("berlin");
    h.last().reject(new Error("graph fetch failed: 500"));
    await h.settle();
    expect(h.calls.failed).toEqual(["berlin"]);
    h.core.start("berlin");
    expect(h.fetches()).toBe(2);
    h.last().resolve(GRAPH);
    await h.settle();
    expect(h.calls.loaded).toEqual(["berlin"]);
    expect(h.kept).toEqual([["berlin", GRAPH]]);
  });

  it("survives an abort with nothing in flight", () => {
    const h = harness();
    expect(() => h.core.dispose()).not.toThrow();
    expect(h.fetches()).toBe(0);
  });
});

// B19, 2026-09-10. The tests above drive the machine with an injected
// `fetch` that rejects the moment its signal aborts — which is what the real
// one does when it is asked to, and the real one had stopped being asked.
// This one wires the machine to the loader and the cache layer it actually
// runs on, so the abort lands where a reader's second city tap lands: half
// way down the body, with the responses long since resolved.
describe("the city download machine, over the real loader", () => {
  /** Two files, the way a v8 core over 25 MiB ships (Berlin, `parts: 2`). */
  const URLS = ["/graph-x.core.bin.gz.0?v=t", "/graph-x.core.bin.gz.1?v=t"];

  /** A `fetch` that answers at once and then trickles, and a cache that only
   *  keeps what it could read to the end — which is what the Cache API does,
   *  and the whole point of the assertion below. */
  function wire() {
    const seen: { url: string; signal?: AbortSignal | null }[] = [];
    const feeds: ReadableStreamDefaultController<Uint8Array>[] = [];
    const entries = new Map<string, unknown>();
    const net = (url: string, init?: RequestInit) => {
      seen.push({ url, signal: init?.signal });
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          feeds.push(c);
          init?.signal?.addEventListener("abort", () => {
            try {
              c.error(new DOMException("aborted", "AbortError"));
            } catch {
              /* already closed */
            }
          });
        },
      });
      return Promise.resolve(
        new Response(body, { status: 200, headers: { "content-length": "1000000" } }),
      );
    };
    const cache = {
      match: async () => undefined,
      put: async (url: string, resp: Response) => {
        // reading it is what fails on an aborted body
        entries.set(url, await resp.arrayBuffer());
      },
      keys: async () => [...entries.keys()].map((url) => ({ url })),
      delete: async (url: string) => entries.delete(url),
    };
    return { seen, feeds, entries, net, caches: { open: async () => cache } };
  }

  it("an abort half way down a multi-file core kills EVERY file, and caches none", async () => {
    const w = wire();
    vi.stubGlobal("fetch", w.net);
    vi.stubGlobal("caches", w.caches);
    try {
      const h = harness((opts) => loadGraph(URLS, { ...opts, fetcher: graphFetch }));
      h.core.start("berlin");
      await h.settle();
      // both files are on the wire and both responses have RESOLVED: what is
      // still running is the read of their bodies
      expect(w.seen.map((s) => s.url)).toEqual(URLS);
      expect(w.seen.every((s) => s.signal?.aborted === false)).toBe(true);
      for (const f of w.feeds) {
        f.enqueue(new Uint8Array(64_000));
        await h.settle();
      }

      h.core.dispose();
      await h.settle();

      expect(w.seen.every((s) => s.signal?.aborted === true), "every file of it").toBe(true);
      expect(h.calls.failed, "an abort is not a failure to report").toEqual([]);
      expect(h.kept).toEqual([]);
      expect([...w.entries.keys()], "nothing half-written on disk").toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
