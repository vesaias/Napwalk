// public/cities.json, generated — `npm run manifest` (CR-03 Q5, 2026-09-09).
//
// The city sheet shows what a city costs to download before the reader taps
// Load, and the progress row needs a total to count against. That number is
// a property of the FILE, not of the city, so it does not belong in the
// registry (CLAUDE.md rule 2: only what genuinely differs between cities
// lives there, and a byte count is derived). This script reads the artifacts
// in `web/public` and writes their sizes to `web/public/cities.json`.
//
// Keyed by the artifact path exactly as `web/src/cities.ts` spells it
// ("/graph-berlin.bin.gz"), so the script never needs the city list: it
// discovers the files, the registry names them, and neither has to parse the
// other. A chunked artifact (`.gz.0` … `.gz.N-1`, CLAUDE.md rule 2) is summed
// under its base path — that is what the browser downloads in total.
//
// Committed output. `web/public/graph*.bin.gz*` is gitignored (rule 6), so a
// clone has the manifest but not the files it measured; a dev server serves
// the committed numbers and the sheet reads correctly before anybody runs
// `scripts/sync-artifacts.ps1`. `npm run build` regenerates it first, which
// is where the deploy's real sizes come from (docs/DEPLOY.md).
//
// Fails SOFT, deliberately: a tree with no artifacts in `public/` keeps the
// committed manifest rather than overwriting it with an empty one. The
// pipeline's "assert and fail loud" rule is about producing data; this
// script only measures files that may legitimately not be there yet.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PUBLIC = join(HERE, "..", "public");
export const TARGET = join(PUBLIC, "cities.json");

/** `graph.bin.gz`, `graph-berlin.bin.gz.0`, and since 2026-09-10 (B11) the
 *  v8 pair `graph.core.bin.gz` and `graph.shade.3.bin.gz` — and nothing
 *  else. `.br` is a second encoding of the same graph that no city entry
 *  points at, and the basemaps are not artifacts the loader streams. */
const ARTIFACT = /^(graph[a-z-]*)((?:\.core|\.shade\.\d+)?\.bin\.gz)(?:\.(\d+))?$/;

/**
 * Sum the sizes of the artifact files. `files` is `[{ name, size }]` — the
 * directory listing, so this half is pure and testable.
 *
 * TWO kinds of key, because the sheet asks two questions:
 *
 *   `/graph.bin.gz`        what the whole city costs — the number the row
 *                          shows before you tap Load, parts and (since v8)
 *                          shade bands summed. Keyed by the path the
 *                          REGISTRY spells, which is still the v7 name even
 *                          for a v8 city: it is the city's identity here,
 *                          not a file that has to exist.
 *   `/graph.core.bin.gz`   what one FILE is, so a progress row can count
 *   `/graph.shade.3.bin.gz`  against the bytes actually being fetched.
 *
 * Keys are sorted, and nothing carries a timestamp: re-running on an
 * unchanged `public/` must produce a byte-identical file, or every build
 * would dirty the working tree.
 */
export function bytesByArtifact(files) {
  const bytes = {};
  for (const f of files) {
    const m = ARTIFACT.exec(f.name);
    if (!m) continue;
    const city = `/${m[1]}.bin.gz`;
    bytes[city] = (bytes[city] ?? 0) + f.size;
    if (m[2] !== ".bin.gz") {
      const file = `/${m[1]}${m[2]}`;
      bytes[file] = (bytes[file] ?? 0) + f.size;
    }
  }
  const out = {};
  for (const k of Object.keys(bytes).sort()) out[k] = bytes[k];
  return out;
}

/** `web/public` as `[{ name, size }]`. Exported so the vitest can measure the
 *  same files this script does and catch a manifest a pipeline rerun left
 *  stale (review B-3); `[]` when the directory is not there at all. */
export function listPublic() {
  try {
    return readdirSync(PUBLIC, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => ({ name: e.name, size: statSync(join(PUBLIC, e.name)).size }));
  } catch {
    return [];
  }
}

/** The file's exact contents for a given size table. */
export function render(bytes) {
  return `${JSON.stringify({ bytes }, null, 2)}\n`;
}

function main() {
  const bytes = bytesByArtifact(listPublic());
  const found = Object.keys(bytes).length;
  if (found === 0) {
    console.warn(
      "cities-manifest: no graph artifacts in web/public — keeping the committed " +
        "cities.json (run scripts/sync-artifacts.ps1 to measure the real ones)",
    );
    return;
  }
  const next = render(bytes);
  let prev = "";
  try {
    prev = readFileSync(TARGET, "utf8");
  } catch {
    /* first run */
  }
  if (prev === next) {
    console.log(`cities-manifest: ${found} artifacts, unchanged`);
    return;
  }
  writeFileSync(TARGET, next);
  console.log(`cities-manifest: wrote ${found} artifacts to public/cities.json`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
