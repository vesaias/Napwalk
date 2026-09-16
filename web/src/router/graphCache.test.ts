// The Cache API layer (backlog B11 step 5). Its two jobs: a second visit
// must not re-download a city, and a browser with no storage at all must
// still get its graph.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GRAPH_CACHE,
  graphCached,
  graphFetch,
  KEEP_CITIES,
  forgetGraph,
  noteCityStem,
  pruneGraphCache,
  stemOf,
  storageEstimate,
} from "./graphCache";

/** A `caches` good enough to hold Responses, and rude enough to be worth
 *  testing against: `put` may be told to fail the way a phone over quota
 *  does. */
function fakeCaches(opts: { putThrows?: boolean; openThrows?: boolean } = {}) {
  const entries = new Map<string, Response>();
  const cache = {
    match: async (url: string) => entries.get(url),
    put: async (url: string, resp: Response) => {
      if (opts.putThrows) throw new Error("QuotaExceededError");
      entries.set(url, resp);
    },
    keys: async () => [...entries.keys()].map((url) => ({ url })),
    delete: async (url: string) => entries.delete(url),
  };
  const opened: string[] = [];
  return {
    entries,
    opened,
    api: {
      open: async (name: string) => {
        opened.push(name);
        if (opts.openThrows) throw new Error("no storage here");
        return cache;
      },
    },
  };
}

function body(text: string): Response {
  return new Response(text, { status: 200, headers: { "content-length": String(text.length) } });
}

/** The unit tests run in node, not jsdom (vitest.config.ts), so storage is
 *  a stub like every other test in this repo. */
function storageStub(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", storageStub());
});
afterEach(() => vi.unstubAllGlobals());

describe("stemOf", () => {
  it("groups a city's core and its bands under one name", () => {
    expect(stemOf("/graph.core.bin.gz?v=abc")).toBe("graph");
    expect(stemOf("/graph.shade.3.bin.gz?v=abc&h=deadbeefdeadbeef")).toBe("graph");
    expect(stemOf("/graph-berlin.bin.gz.1?v=abc")).toBe("graph-berlin");
    expect(stemOf("https://example.test/graph-nyc.core.bin.gz?v=1")).toBe("graph-nyc");
  });

  it("is null for anything that is not an artifact", () => {
    expect(stemOf("/basemap/frankfurt.pmtiles")).toBe(null);
    expect(stemOf("/cities.json")).toBe(null);
  });
});

describe("graphFetch", () => {
  it("goes to the network once and serves the second call from the cache", async () => {
    const c = fakeCaches();
    vi.stubGlobal("caches", c.api);
    const net = vi.fn(async () => body("SWG1..."));
    vi.stubGlobal("fetch", net);

    const first = await graphFetch("/graph.core.bin.gz?v=1");
    expect(await first.text()).toBe("SWG1...");
    expect(net).toHaveBeenCalledTimes(1);
    expect(c.opened).toEqual([GRAPH_CACHE]);

    const second = await graphFetch("/graph.core.bin.gz?v=1");
    expect(await second.text()).toBe("SWG1...");
    expect(net).toHaveBeenCalledTimes(1); // no second request
    expect(await graphCached("/graph.core.bin.gz?v=1")).toBe(true);
  });

  it("keys on the whole URL, so a re-export is a different entry", async () => {
    vi.stubGlobal("caches", fakeCaches().api);
    const net = vi.fn(async () => body("bytes"));
    vi.stubGlobal("fetch", net);
    await graphFetch("/graph.shade.0.bin.gz?v=1&h=aaaaaaaaaaaaaaaa");
    await graphFetch("/graph.shade.0.bin.gz?v=1&h=bbbbbbbbbbbbbbbb");
    expect(net).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed response", async () => {
    vi.stubGlobal("caches", fakeCaches().api);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    const resp = await graphFetch("/graph.core.bin.gz?v=1");
    expect(resp.status).toBe(404);
    expect(await graphCached("/graph.core.bin.gz?v=1")).toBe(false);
  });

  it("still loads the graph when the cache cannot be opened at all", async () => {
    vi.stubGlobal("caches", fakeCaches({ openThrows: true }).api);
    const net = vi.fn(async () => body("SWG1..."));
    vi.stubGlobal("fetch", net);
    const resp = await graphFetch("/graph.core.bin.gz?v=1");
    expect(await resp.text()).toBe("SWG1...");
  });

  it("...and when there is no `caches` at all", async () => {
    vi.stubGlobal("caches", undefined);
    vi.stubGlobal("fetch", vi.fn(async () => body("SWG1...")));
    const resp = await graphFetch("/graph.core.bin.gz?v=1");
    expect(await resp.text()).toBe("SWG1...");
    expect(await graphCached("/graph.core.bin.gz?v=1")).toBe(false);
  });

  it("...and when the phone refuses the write", async () => {
    vi.stubGlobal("caches", fakeCaches({ putThrows: true }).api);
    const net = vi.fn(async () => body("SWG1..."));
    vi.stubGlobal("fetch", net);
    expect(await (await graphFetch("/graph.core.bin.gz?v=1")).text()).toBe("SWG1...");
    expect(await (await graphFetch("/graph.core.bin.gz?v=1")).text()).toBe("SWG1...");
    expect(net).toHaveBeenCalledTimes(2); // no cache, so both go to the wire
  });
});

// P2, 2026-09-10 (backlog-R "Open"). StrictMode double-invokes `useCityGraph`
// on a dev server, so two calls for the same URL start before either has
// written a cache entry, and both go to the wire: 3.96 MB of core, twice, on
// every dev page load (`graph.spec:37`).
describe("graphFetch — one request per URL in flight", () => {
  /** A fetch that answers only when the test says so, and remembers the
   *  signal it was given. */
  function heldFetch(text: string) {
    const seen: (AbortSignal | undefined)[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const net = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(init?.signal ?? undefined);
      await gate;
      return body(text);
    });
    return { net, seen, release };
  }

  /** Let the microtasks run: `graphFetch` reaches the network only after the
   *  cache has been opened and asked, which is two awaits deep. */
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("joins a second caller to the request already on the wire", async () => {
    const c = fakeCaches();
    vi.stubGlobal("caches", c.api);
    const h = heldFetch("SWG1...");
    vi.stubGlobal("fetch", h.net);

    const a = graphFetch("/graph.core.bin.gz?v=1");
    const b = graphFetch("/graph.core.bin.gz?v=1");
    h.release();
    const [ra, rb] = await Promise.all([a, b]);

    expect(h.net).toHaveBeenCalledTimes(1);
    // ...and BOTH get readable bytes: the body is teed, not shared
    expect(await ra.text()).toBe("SWG1...");
    expect(await rb.text()).toBe("SWG1...");
  });

  it("keys the sharing on the URL, so two artifacts still go in parallel", async () => {
    vi.stubGlobal("caches", fakeCaches().api);
    const h = heldFetch("bytes");
    vi.stubGlobal("fetch", h.net);
    const a = graphFetch("/graph.shade.0.bin.gz?v=1&h=aaaaaaaaaaaaaaaa");
    const b = graphFetch("/graph.shade.1.bin.gz?v=1&h=aaaaaaaaaaaaaaaa");
    h.release();
    await Promise.all([a, b]);
    expect(h.net).toHaveBeenCalledTimes(2);
  });

  it("releases the entry when the request settles, so the next call is a cache read", async () => {
    const c = fakeCaches();
    vi.stubGlobal("caches", c.api);
    const h = heldFetch("SWG1...");
    vi.stubGlobal("fetch", h.net);
    const a = graphFetch("/graph.core.bin.gz?v=1");
    h.release();
    expect(await (await a).text()).toBe("SWG1...");
    expect(await (await graphFetch("/graph.core.bin.gz?v=1")).text()).toBe("SWG1...");
    expect(h.net).toHaveBeenCalledTimes(1); // the second is the cache, not the flight
  });

  // The abort semantics the join has to get right: the request is shared, so
  // it is abandoned only when EVERY subscriber has abandoned it. The city
  // sheet's ✕ and the boot loader can be waiting on the same band.
  it("keeps the download alive while one subscriber remains", async () => {
    vi.stubGlobal("caches", fakeCaches().api);
    const h = heldFetch("SWG1...");
    vi.stubGlobal("fetch", h.net);
    const mine = new AbortController();

    const a = graphFetch("/graph.core.bin.gz?v=1", { signal: mine.signal });
    const b = graphFetch("/graph.core.bin.gz?v=1");
    await tick();
    mine.abort();
    expect(h.seen).toHaveLength(1);
    expect(h.seen[0]?.aborted).toBe(false); // the wire never heard about it
    h.release();

    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    expect(await (await b).text()).toBe("SWG1...");
    expect(h.net).toHaveBeenCalledTimes(1);
  });

  // B19: the RESPONSE resolving is not the end of the request. An artifact is
  // megabytes and the caller streams it, so a ✕ pressed half way down the
  // body is the ordinary case, not an edge one — and the listener that
  // carries it was being removed the moment the headers landed.
  it("carries an abort that lands while the body is still streaming", async () => {
    vi.stubGlobal("caches", fakeCaches().api);
    const seen: (AbortSignal | undefined)[] = [];
    let feed!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(init?.signal ?? undefined);
      return new Response(
        new ReadableStream<Uint8Array>({ start: (c) => void (feed = c) }),
        { status: 200, headers: { "content-length": "1000000" } },
      );
    }));
    const mine = new AbortController();

    const resp = await graphFetch("/graph.core.bin.gz?v=1", { signal: mine.signal });
    const reader = resp.body!.getReader();
    feed.enqueue(new Uint8Array(8));
    expect((await reader.read()).value).toHaveLength(8);
    expect(seen[0]?.aborted).toBe(false);

    mine.abort();
    expect(seen[0]?.aborted, "the wire hears it, mid-body").toBe(true);
  });

  it("...and abandons it when the last one goes", async () => {
    vi.stubGlobal("caches", fakeCaches().api);
    const h = heldFetch("SWG1...");
    vi.stubGlobal("fetch", h.net);
    const one = new AbortController();
    const two = new AbortController();

    const a = graphFetch("/graph.core.bin.gz?v=1", { signal: one.signal });
    const b = graphFetch("/graph.core.bin.gz?v=1", { signal: two.signal });
    await tick();
    one.abort();
    expect(h.seen[0]?.aborted).toBe(false);
    two.abort();
    expect(h.seen[0]?.aborted).toBe(true);

    h.release();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    await expect(b).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("eviction", () => {
  it("keeps the last two cities, most recent first", () => {
    expect(noteCityStem("graph")).toEqual(["graph"]);
    expect(noteCityStem("graph-berlin")).toEqual(["graph-berlin", "graph"]);
    expect(noteCityStem("graph-nyc")).toEqual(["graph-nyc", "graph-berlin"]);
    // re-opening one already in the list moves it up rather than duplicating
    expect(noteCityStem("graph-berlin")).toEqual(["graph-berlin", "graph-nyc"]);
    expect(KEEP_CITIES).toBe(2);
  });

  it("survives a localStorage that refuses to answer", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    });
    expect(noteCityStem("graph")).toEqual(["graph"]);
  });

  it("ignores a stored list that is not a list of strings", () => {
    vi.stubGlobal("localStorage", storageStub({ "sw.graphCities": '{"not":"an array"}' }));
    expect(noteCityStem("graph")).toEqual(["graph"]);
    vi.stubGlobal("localStorage", storageStub({ "sw.graphCities": "{not json" }));
    expect(noteCityStem("graph")).toEqual(["graph"]);
  });

  it("drops every file of a city that is not in the keep list", async () => {
    const c = fakeCaches();
    vi.stubGlobal("caches", c.api);
    vi.stubGlobal("fetch", vi.fn(async () => body("x")));
    for (const url of [
      "/graph.core.bin.gz?v=1",
      "/graph.shade.0.bin.gz?v=1",
      "/graph.shade.1.bin.gz?v=1",
      "/graph-berlin.bin.gz.0?v=1",
      "/graph-nyc.core.bin.gz?v=1",
    ]) await graphFetch(url);
    expect(c.entries.size).toBe(5);

    const gone = await pruneGraphCache(["graph", "graph-berlin"]);
    expect(gone).toBe(1);
    expect([...c.entries.keys()].some((u) => u.includes("nyc"))).toBe(false);
    expect(c.entries.size).toBe(4);
  });

  it("evicts nothing, and throws nothing, with no storage", async () => {
    vi.stubGlobal("caches", undefined);
    expect(await pruneGraphCache(["graph"])).toBe(0);
  });
});

describe("storageEstimate", () => {
  it("reports what the browser says", async () => {
    vi.stubGlobal("navigator", { storage: { estimate: async () => ({ usage: 12, quota: 34 }) } });
    expect(await storageEstimate()).toEqual({ usage: 12, quota: 34 });
  });

  it("is null where the API is missing — it is a measurement, not a decision", async () => {
    vi.stubGlobal("navigator", {});
    expect(await storageEstimate()).toBe(null);
  });
});

// S8 review F5. A band is validated AFTER it is downloaded, and `graphFetch`
// has already stored it by then: a band refused for belonging to another
// export was persisted, and came back off disk on every later visit.
describe("forgetGraph", () => {
  it("takes a stored URL back out", async () => {
    const c = fakeCaches();
    vi.stubGlobal("caches", c.api);
    vi.stubGlobal("fetch", async () => body("bytes"));
    const url = "/graph.shade.3.bin.gz?v=1&h=deadbeef";
    await graphFetch(url);
    expect(await graphCached(url)).toBe(true);
    await forgetGraph(url);
    expect(await graphCached(url)).toBe(false);
    expect(c.entries.size).toBe(0);
  });

  it("cannot lose the race with the write it is undoing", async () => {
    // `graphFetch`'s `put` is deliberately not awaited, so the delete has
    // to wait for it — this cache takes its time.
    const c = fakeCaches();
    const slow = { ...c.api };
    vi.stubGlobal("caches", {
      open: async (n: string) => {
        const cache = await slow.open(n);
        return {
          ...cache,
          put: async (url: string, resp: Response) => {
            await new Promise((r) => setTimeout(r, 20));
            return cache.put(url, resp);
          },
        };
      },
    });
    vi.stubGlobal("fetch", async () => body("bytes"));
    const url = "/graph.shade.3.bin.gz?v=1&h=deadbeef";
    await graphFetch(url);
    await forgetGraph(url); // returns only once the put has landed
    expect(c.entries.size).toBe(0);
  });

  it("is a no-op for a URL that was never stored, and with no storage", async () => {
    const c = fakeCaches();
    vi.stubGlobal("caches", c.api);
    await forgetGraph("/graph.shade.9.bin.gz?v=1");
    expect(c.entries.size).toBe(0);
    vi.stubGlobal("caches", undefined);
    await expect(forgetGraph("/graph.core.bin.gz?v=1")).resolves.toBeUndefined();
  });
});
