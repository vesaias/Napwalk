// The real Frankfurt artifact, read off disk for the tests that need a real
// city rather than a toy one (snap, sinai, the two scan spikes).
//
// It lives in one file because the artifact layout is now two SHAPES: v7's
// single `graph.bin.gz`, and v8's `graph.core.bin.gz` plus one
// `graph.shade.K.bin.gz` per band (backlog B11). A test that means "the
// Frankfurt graph, fully priced" should not have to know which of them is
// on this machine.
//
// `web/public/graph*` is gitignored (CLAUDE.md rule 6), so a clone has
// neither shape and every caller skips — which is what they already did.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { acceptShadeBand, parseGraph, type Graph } from "./graph";

const PUBLIC = new URL("../../public/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function read(name: string): ArrayBuffer {
  const b = gunzipSync(readFileSync(PUBLIC + name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** Frankfurt with every shade band loaded, or null when the artifacts have
 *  not been synced into `web/public` on this machine. */
export function realGraph(): Graph | null {
  if (existsSync(PUBLIC + "graph.core.bin.gz")) {
    const g = parseGraph(read("graph.core.bin.gz"));
    const bands = readdirSync(PUBLIC).filter((n: string) => /^graph\.shade\.\d+\.bin\.gz$/.test(n));
    for (const name of bands) {
      const k = Number(/\.(\d+)\.bin\.gz$/.exec(name)![1]);
      acceptShadeBand(g.shade, k, read(name));
    }
    return g;
  }
  if (existsSync(PUBLIC + "graph.bin.gz")) return parseGraph(read("graph.bin.gz"));
  return null;
}

/** Is there an artifact to read at all? For the `describe.skipIf` guards. */
export function haveRealGraph(): boolean {
  return existsSync(PUBLIC + "graph.core.bin.gz") || existsSync(PUBLIC + "graph.bin.gz");
}
