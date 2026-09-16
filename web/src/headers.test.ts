// web/public/_headers is the whole of the production security posture and
// the whole of the caching policy: it is a static file nothing else checks,
// and before the pre-release round (QA F6-04) it held one Cache-Control
// rule and nothing else. These assertions are the file's contract with
// docs/DEPLOY.md's "Verify" table.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
const lines = raw.split(/\r?\n/).map((l) => l.trim());
const header = (name: string): string | undefined =>
  lines.find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`))?.slice(name.length + 1).trim();

/** The Cache-Control value declared for a path glob. */
function cacheFor(path: string): string {
  const i = lines.indexOf(path);
  expect(i, `no rule for ${path}`).toBeGreaterThan(-1);
  const v = lines.slice(i + 1, i + 3).find((l) => l.startsWith("Cache-Control:"));
  expect(v, `no Cache-Control under ${path}`).toBeDefined();
  return v!.slice("Cache-Control:".length).trim();
}

describe("_headers — security (QA F6-04)", () => {
  const csp = header("Content-Security-Policy");

  it("ships a CSP at all", () => {
    expect(csp).toBeDefined();
  });

  it("allows exactly the origins the app contacts, and no script but its own", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'"); // index.html has no inline script
    // Photon is the geocoder; *.r2.dev is VITE_TILE_BASE (docs/DEPLOY.md)
    expect(csp).toMatch(/connect-src 'self' https:\/\/photon\.komoot\.io https:\/\/\*\.r2\.dev/);
    // the debug page's raster reference basemap is not in the production build
    expect(csp).not.toContain("tile.openstreetmap.org");
  });

  it("leaves MapLibre the two things it genuinely needs", () => {
    expect(csp).toContain("style-src 'self' 'unsafe-inline'"); // inline canvas styles
    expect(csp).toContain("worker-src 'self' blob:");
  });

  it("closes the directives nothing here uses", () => {
    for (const d of ["object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) {
      expect(csp).toContain(d);
    }
  });

  it("sets the three headers Pages does not add on its own", () => {
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    // a prompt, not the default free-for-all
    expect(header("Permissions-Policy")).toContain("geolocation=(self)");
  });
});

describe("_headers — caching tiers (QA F6-04)", () => {
  const YEAR = "public, max-age=31536000, immutable";

  it("caches the content-addressed classes for a year", () => {
    for (const p of ["/graph*.bin.gz*", "/assets/*", "/tiles/*"]) {
      expect(cacheFor(p), p).toBe(YEAR);
    }
  });

  it("gives the unversioned classes an hour, stale for a day", () => {
    for (const p of ["/basemap/*", "/basemap-assets/*", "/fonts/*"]) {
      expect(cacheFor(p), p).toBe("public, max-age=3600, stale-while-revalidate=86400");
    }
  });

  it("never caches the document that points at all of them", () => {
    expect(cacheFor("/")).toBe("no-cache");
    expect(cacheFor("/index.html")).toBe("no-cache");
    expect(cacheFor("/manifest.webmanifest")).toBe("no-cache");
  });
});

describe("web/public/fonts (QA F6-06)", () => {
  it("ships the OFL text beside the faces it covers", () => {
    const ofl = readFileSync(new URL("../public/fonts/LICENSE-SourceSans3.txt", import.meta.url), "utf8");
    expect(ofl).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(ofl).toContain("Adobe");
    expect(ofl).toContain("Reserved Font Name 'Source'");
  });
});
