import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CITIES, artifactUrls, type City } from "./cities";

const base: City = {
  id: "frankfurt", center: [8.68, 50.11], bounds: [8.4, 50.0, 8.9, 50.2],
  timeZone: "Europe/Berlin", artifact: "/graph.bin.gz",
  basemap: "/basemap/frankfurt.pmtiles", available: true,
};

describe("artifactUrls", () => {
  it("is one URL for an unchunked artifact — Frankfurt's stays byte-identical", () => {
    expect(artifactUrls(base, "b1")).toEqual(["/graph.bin.gz?v=b1"]);
  });
  it("names the parts .0 … .N-1 the way 08_export_graph writes them", () => {
    expect(artifactUrls({ ...base, artifact: "/graph-london.bin.gz", parts: 3 }, "b1"))
      .toEqual(["/graph-london.bin.gz.0?v=b1", "/graph-london.bin.gz.1?v=b1", "/graph-london.bin.gz.2?v=b1"]);
  });
});


// CLAUDE.md rule 2: one registry each side, kept equal by hand. The failure
// mode is silent — pipeline/cities.py's own comment says a mismatched
// `bounds` shows up as a blank strip at one edge of the map, not as an error
// — so nothing but a test can catch it (final review M11).
describe("the two city registries agree", () => {
  const py = readFileSync(new URL("../../pipeline/cities.py", import.meta.url), "utf8");

  /** The `key: { ... }` blocks of CITIES, in file order. Cheap on purpose:
   *  the file is a flat dict of literals and is meant to stay one. */
  const blocks = [...py.matchAll(/^    "([a-z]+)": \{$([\s\S]*?)^    \},$/gm)].map(
    ([, id, body]) => ({ id, body })
  );
  const tuple = (body: string, field: string): number[] => {
    const m = new RegExp(`"${field}": \\(([^)]*)\\)`).exec(body);
    if (!m) throw new Error(`no ${field} in that block`);
    return m[1].split(",").map((n) => Number(n.trim()));
  };
  const str = (body: string, field: string): string => {
    const m = new RegExp(`"${field}": "([^"]*)"`).exec(body);
    if (!m) throw new Error(`no ${field} in that block`);
    return m[1];
  };
  /** An OPTIONAL integer field — `shade_year` is absent for the four cities
   *  with no DSM of their own, and the web twin leaves `shadeYear` off for
   *  exactly those. Absent on one side must mean absent on the other. */
  const optInt = (body: string, field: string): number | undefined => {
    const m = new RegExp(`"${field}": ([0-9]+)`).exec(body);
    return m ? Number(m[1]) : undefined;
  };

  // The ORDER is each list's own — the web registry reads as a menu, the
  // pipeline's as the order the cities were built in — but the ids are not.
  it("lists the same eight cities", () => {
    expect(blocks.length).toBe(8);
    expect(blocks.map((b) => b.id).sort()).toEqual(CITIES.map((c) => c.id).sort());
  });

  it("copies bounds, centre and timezone value for value", () => {
    for (const { id, body } of blocks) {
      const web = CITIES.find((c) => c.id === id)!;
      expect(tuple(body, "bounds"), `${id} bounds`).toEqual(web.bounds);
      expect(tuple(body, "center"), `${id} center`).toEqual(web.center);
      expect(str(body, "tz"), `${id} tz`).toBe(web.timeZone);
    }
  });

  // The survey years joined both registries with CR-03 Q5 (the city sheet
  // writes "Shade 2020 · Noise 2012" under each row) and are hand-copied the
  // same way everything else here is. Their failure mode is quieter still
  // than `bounds`: a wrong year is a sentence that reads perfectly and
  // attributes the data to the wrong flight (review B-1).
  it("copies the shade and noise survey years, absences included", () => {
    for (const { id, body } of blocks) {
      const web = CITIES.find((c) => c.id === id)!;
      expect(optInt(body, "shade_year"), `${id} shade_year`).toBe(web.shadeYear);
      expect(optInt(body, "noise_year"), `${id} noise_year`).toBe(web.noiseYear);
    }
  });
});
