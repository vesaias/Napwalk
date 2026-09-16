// The graph artifacts, kept in the Cache API so a second visit does not
// download them again (backlog B11, step 5).
//
// The Cache API needs NO service worker — `caches` is available to the
// window — so this does not put "offline mode / service worker caching" back
// on the table (CLAUDE.md's v1 cut list, and the ruling on B4 that kept it
// off). Nothing here intercepts a request; the loader simply asks the cache
// before it asks the network, and stores what it gets.
//
// Every call is BEST EFFORT. A private window, a browser with site data
// blocked, a phone that refuses a `put` over quota — each of those throws,
// and each of them must leave a working app that downloads its graph the
// ordinary way. So the whole file is a thin layer of try/catch over a
// fetcher, and its failure mode is "no cache", never "no graph".

/** Bumped when the artifact layout changes: v8's files have different names
 *  and different contents, and a stale v7 body under a v8 URL would be a
 *  wrong graph rather than a slow one. */
export const GRAPH_CACHE = "sw-graph-v8";

/** How many cities' artifacts stay on disk. Two: the one being used and the
 *  one before it, which is the switch a reader actually repeats (home city
 *  and the city they are visiting). A third is 8–34 MB for a city nobody has
 *  opened in two switches. */
export const KEEP_CITIES = 2;

const RECENT_KEY = "sw.graphCities";

/** The artifact stem a URL belongs to: "graph", "graph-berlin". It is what
 *  groups a city's core and its eight bands into one thing to evict. */
export function stemOf(url: string): string | null {
  const path = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0];
  const m = /^\/(graph[a-z-]*)\./.exec(path);
  return m ? m[1] : null;
}

type CacheLike = {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
  keys(): Promise<readonly { url: string }[]>;
  delete(request: string): Promise<boolean>;
};

type CachesLike = { open(name: string): Promise<CacheLike>; };

function store(): CachesLike | null {
  try {
    const c = (globalThis as unknown as { caches?: CachesLike }).caches;
    return c ?? null;
  } catch {
    return null; // some browsers THROW on the property itself in a sandbox
  }
}

/** A request more than one caller asked for.
 *
 *  `subs` is how many joined, `taken` how many have been handed a body, and
 *  `open` how many have not aborted. */
type Flight = {
  resp: Promise<Response>;
  ctrl: AbortController;
  subs: number;
  taken: number;
  open: number;
};

/** Requests started and not yet settled, by URL. */
const inflight = new Map<string, Flight>();

/**
 * `fetch`, with the Cache API in front of it and one request per URL behind
 * it.
 *
 * A hit is returned as it comes out of the cache — the loader reads it the
 * same way it reads a network response, so the streaming inflate and the
 * progress row work unchanged (a cached response reports its own
 * Content-Length, so the row still counts).
 *
 * A miss is fetched and stored. The clone happens BEFORE the body is read,
 * which is the only order that works: a response body can be consumed once,
 * and the loader is about to consume this one.
 *
 * **One request per URL.** React's StrictMode double-invokes an effect on a
 * dev server, so `useCityGraph` runs twice and BOTH runs miss a cache entry
 * the first has not finished writing: 3.96 MB of core, twice, on every dev
 * page load, which is what `graph.spec:37` saw (backlog-R, 2026-09-09).
 * Production has one effect run and one fetch, so this is invisible to a
 * reader — but two asks for one URL is one too many wherever it happens, and
 * a city switch that races a background band walk is the same shape without
 * StrictMode. A second caller joins the request already in flight instead.
 *
 * The joiner's `init` is DROPPED: the request is already on the wire with
 * the first caller's headers and `priority`, and the only field that differs
 * between callers here is that hint. Its `signal` is not dropped — see
 * `join`.
 */
export function graphFetch(url: string, init?: RequestInit): Promise<Response> {
  const live = inflight.get(url);
  if (live) return join(live, init?.signal);

  // One controller for the shared request, so no single subscriber's signal
  // can cancel it out from under the others.
  const ctrl = new AbortController();
  const f: Flight = { resp: null as unknown as Promise<Response>, ctrl, subs: 0, taken: 0, open: 0 };
  f.resp = fetchOnce(url, { ...init, signal: ctrl.signal });
  inflight.set(url, f);
  // The FIRST reaction registered on the promise, so the entry is gone
  // before any subscriber's own reaction runs and `subs` is final by the
  // time the bodies are handed out below.
  const clear = () => {
    if (inflight.get(url) === f) inflight.delete(url);
  };
  void f.resp.then(clear, clear);
  return join(f, init?.signal);
}

/** Wait on a request someone else started, and take one body from it.
 *
 *  The subscription outlives the RESPONSE: an artifact is megabytes and the
 *  caller streams it, counting the bytes into a progress row, long after the
 *  headers are in. So the abort listener stays attached until the signal
 *  fires or is collected — take it off when the response resolves and the
 *  city sheet's ✕, which is pressed half way down a 21 MB core, reaches
 *  nothing at all: the download ran to the end, the row never cleared and no
 *  toast was raised (B19). */
function join(f: Flight, signal?: AbortSignal | null): Promise<Response> {
  f.subs += 1;
  f.open += 1;
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    f.open -= 1;
    // The request belongs to everyone waiting on it, so it is abandoned only
    // when the last of them has gone: the city sheet's ✕ must not cancel a
    // download the boot loader is still counting into its progress row.
    if (f.open === 0) f.ctrl.abort();
  };
  signal?.addEventListener("abort", leave, { once: true });
  return f.resp.then(
    (r) => {
      f.taken += 1;
      // The LAST subscriber is handed the response itself. `clone()` TEES the
      // body, and a branch nobody reads holds the whole artifact in memory
      // until it is collected — so the ordinary case, one subscriber, which
      // is every production call, must not clone at all.
      const mine = f.taken < f.subs ? r.clone() : r;
      if (signal?.aborted) {
        try {
          void mine.body?.cancel();
        } catch {
          /* nothing has read it; a throw here is nothing to act on */
        }
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return mine;
    },
    (e: unknown) => {
      signal?.removeEventListener("abort", leave);
      throw e;
    },
  );
}

async function fetchOnce(url: string, init?: RequestInit): Promise<Response> {
  const caches = store();
  if (!caches) return fetch(url, init);
  let cache: CacheLike;
  try {
    cache = await caches.open(GRAPH_CACHE);
  } catch {
    return fetch(url, init);
  }
  try {
    const hit = await cache.match(url);
    if (hit) return hit;
  } catch {
    /* fall through to the network */
  }
  const resp = await fetch(url, init);
  if (resp.ok) {
    try {
      const copy = resp.clone();
      // not awaited: the download must not wait on the disk, and a `put`
      // that fails (quota, private mode) is not a reason to fail the load
      const p = cache.put(url, copy).catch(() => {});
      // ...but it IS tracked, so `forgetGraph` below cannot lose the race
      // with it (S8 review F5).
      writes.set(url, p);
      void p.then(() => {
        if (writes.get(url) === p) writes.delete(url);
      });
    } catch {
      /* clone can throw on an already-disturbed body; nothing to do */
    }
  }
  return resp;
}

/** Writes `graphFetch` has started and not yet finished, by URL. */
const writes = new Map<string, Promise<void>>();

/**
 * Take a URL back out of the cache: the bytes arrived, and turned out not to
 * be usable.
 *
 * A shade band is validated AFTER it is downloaded (`acceptShadeBand` checks
 * its magic, index, width and hash against this core), and `graphFetch` has
 * already stored it by then — so a band refused for belonging to another
 * export was persisted and served from disk on every later visit, healed
 * only by a new build stamp or by eviction (S8 review F5). It waits for the
 * write it is undoing, because that write is deliberately not awaited.
 */
export async function forgetGraph(url: string): Promise<void> {
  const caches = store();
  if (!caches) return;
  await writes.get(url);
  try {
    const cache = await caches.open(GRAPH_CACHE);
    await cache.delete(url);
  } catch {
    /* no cache, or nothing to delete */
  }
}

/** Is this URL already on disk? Only the measurement and the tests ask. */
export async function graphCached(url: string): Promise<boolean> {
  const caches = store();
  if (!caches) return false;
  try {
    const cache = await caches.open(GRAPH_CACHE);
    return (await cache.match(url)) !== undefined;
  } catch {
    return false;
  }
}

/** Record that a city was opened, and return the stems worth keeping —
 *  most recent first, at most KEEP_CITIES.
 *
 *  In localStorage rather than in memory: the point of the cache is the
 *  SECOND visit, and a list that resets with the page would evict on every
 *  boot the city the reader is about to open again. */
export function noteCityStem(stem: string): string[] {
  let recent: string[] = [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw) recent = (JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === "string");
  } catch {
    recent = [];
  }
  const next = [stem, ...recent.filter((s) => s !== stem)].slice(0, KEEP_CITIES);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode: the list is a convenience, not state anything needs */
  }
  return next;
}

/** Drop every cached artifact that does not belong to one of `keep`.
 *  Returns how many entries went. */
export async function pruneGraphCache(keep: string[]): Promise<number> {
  const caches = store();
  if (!caches) return 0;
  try {
    const cache = await caches.open(GRAPH_CACHE);
    const keys = await cache.keys();
    let gone = 0;
    for (const req of keys) {
      const stem = stemOf(req.url);
      // an entry whose stem we cannot read is not an artifact of ours at
      // all, and it goes: this cache is dedicated to graph artifacts, so
      // anything else in it is something an older build left behind
      // (S8 review F10 — the comment used to say the opposite of the code)
      if (stem !== null && keep.includes(stem)) continue;
      if (await cache.delete(req.url)) gone += 1;
    }
    return gone;
  } catch {
    return 0;
  }
}

/** What the browser says is on disk for this origin, in bytes. Null where
 *  the API is missing — it is a measurement, not a decision. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const nav = navigator as Navigator & { storage?: { estimate?: () => Promise<StorageEstimate> } };
    const est = await nav.storage?.estimate?.();
    if (!est) return null;
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return null;
  }
}
