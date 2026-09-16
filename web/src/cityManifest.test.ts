// The manifest, both ends: what the build script writes and what the app
// reads back. They are one contract in two files, so they are tested
// together — a change to the script's key shape that the reader cannot
// resolve fails here rather than in the city sheet.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error — a plain .mjs build script with no types
import { bytesByArtifact, listPublic, render, TARGET } from "../scripts/cities-manifest.mjs";
import { CITIES, getCity } from "./cities";
import { __testing, artifactBytes, loadCityManifest, mb, parseManifest } from "./cityManifest";

const listing = [
  { name: "graph.bin.gz", size: 7_312_487 },
  { name: "graph.bin.br", size: 5_614_296 },
  { name: "graph-berlin.bin.gz.0", size: 20_971_520 },
  { name: "graph-berlin.bin.gz.1", size: 12_610_338 },
  { name: "graph-sf.bin.gz", size: 5_409_214 },
  { name: "favicon.svg", size: 9_522 },
];

describe("the build script", () => {
  it("keys sizes by the path the registry spells, and sums the parts", () => {
    expect(bytesByArtifact(listing)).toEqual({
      "/graph-berlin.bin.gz": 33_581_858,
      "/graph-sf.bin.gz": 5_409_214,
      "/graph.bin.gz": 7_312_487,
    });
  });

  it("ignores the brotli twin and everything that is not an artifact", () => {
    const keys = Object.keys(bytesByArtifact(listing));
    expect(keys.some((k) => k.endsWith(".br"))).toBe(false);
    expect(keys).not.toContain("/favicon.svg");
  });

  it("is deterministic — a rerun on an unchanged public/ writes the same bytes", () => {
    const a = render(bytesByArtifact(listing));
    const b = render(bytesByArtifact([...listing].reverse()));
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
  });

  it("names every city in the registry when every artifact is present", () => {
    const files = CITIES.flatMap((c) => {
      const base = c.artifact.replace(/^\//, "");
      return c.parts && c.parts > 1
        ? Array.from({ length: c.parts }, (_, i) => ({ name: `${base}.${i}`, size: 1_000_000 }))
        : [{ name: base, size: 1_000_000 }];
    });
    const bytes = bytesByArtifact(files);
    for (const c of CITIES) expect(bytes[c.artifact], c.id).toBeGreaterThan(0);
  });
});

// The one thing the pure halves above cannot catch: a pipeline rerun that
// reshapes an artifact and never runs `npm run manifest`. The committed
// cities.json would then ship a wrong MB for a city, silently — the same
// failure mode tokens.test.ts exists for, and the same cure (review B-3).
//
// `web/public/graph*.bin.gz*` is gitignored (rule 6), so this can only run
// on a machine that has synced them. It SKIPS on a fresh clone rather than
// failing there.
describe("the committed manifest", () => {
  const onDisk = bytesByArtifact(listPublic());
  const present = Object.keys(onDisk).length > 0;

  it("matches the artifacts in web/public — rerun `npm run manifest`", (ctx) => {
    if (!present) {
      ctx.skip("no graph artifacts in web/public (run scripts/sync-artifacts.ps1)");
      return;
    }
    expect(render(onDisk)).toBe(readFileSync(TARGET, "utf8"));
  });
});

describe("the reader", () => {
  afterEach(() => {
    __testing.reset();
    vi.unstubAllGlobals();
  });

  it("resolves a city's download size through its artifact path", () => {
    const m = parseManifest(JSON.parse(render(bytesByArtifact(listing))));
    expect(artifactBytes(m, getCity("berlin"))).toBe(33_581_858);
    expect(artifactBytes(m, getCity("frankfurt"))).toBe(7_312_487);
  });

  it("answers null for a city the manifest does not carry, and for no manifest", () => {
    const m = parseManifest({ bytes: { "/graph.bin.gz": 10 } });
    expect(artifactBytes(m, getCity("nyc"))).toBeNull();
    expect(artifactBytes(null, getCity("frankfurt"))).toBeNull();
  });

  it("reads a 404 page, a wrong shape or a bad number as an empty manifest", () => {
    expect(parseManifest(null).bytes).toEqual({});
    expect(parseManifest("<!doctype html>").bytes).toEqual({});
    expect(parseManifest({ bytes: [1, 2] }).bytes).toEqual({});
    expect(parseManifest({ bytes: { a: "12", b: 0, c: NaN, d: 3 } }).bytes).toEqual({ d: 3 });
  });

  it("rounds to whole decimal MB, and never to zero", () => {
    expect(mb(33_581_858)).toBe(34);
    expect(mb(7_312_487)).toBe(7);
    expect(mb(400_000)).toBe(1);
  });

  it("fetches /cities.json once, however many times it is asked", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ bytes: { "/x": 5 } }) }));
    vi.stubGlobal("fetch", fetchMock);
    const [a, b] = await Promise.all([loadCityManifest(), loadCityManifest()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a?.bytes).toEqual({ "/x": 5 });
    expect(b).toBe(a);
  });

  it("survives a missing file: null, not a rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    await expect(loadCityManifest()).resolves.toBeNull();
  });
});
