import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { __testing } from "./GraphContext";
import type { Graph } from "../router/graph";

const { publish, peek } = __testing;
const fake = (n: number) => ({ nEdges: n }) as unknown as Graph;

describe("the graph box", () => {
  // The stamp is the whole invalidation signal: if it did not move when the
  // graph arrived, no consumer would re-render and the app would sit on an
  // empty map with a loaded graph behind it.
  it("bumps the version when the graph changes", () => {
    const a = fake(1);
    const b = fake(2);
    const v1 = publish(a);
    const v2 = publish(b);
    expect(v2).toBeGreaterThan(v1);
  });

  // StrictMode renders twice in development, and useMemo is not a guarantee.
  it("gives the same graph the same version twice running", () => {
    const g = fake(3);
    expect(publish(g)).toBe(publish(g));
  });

  it("treats a return to null as a change", () => {
    const g = fake(4);
    const loaded = publish(g);
    const cleared = publish(null);
    expect(cleared).toBeGreaterThan(loaded);
    expect(peek()).toBeNull();
  });

  it("hands back exactly the graph it was given", () => {
    const g = fake(5);
    publish(g);
    expect(peek()).toBe(g);
  });
});

// S8 review F2. The place card's shade tag is a `useMemo` over the graph —
// and a shade band landing mutates the store INSIDE the graph rather than
// replacing it, so a memo keyed on `[graph, …]` alone never runs again and a
// tag that came back null once stayed missing until the place or the
// departure changed. The dependency is the stamp, and nothing in this suite
// can render a component (no DOM), so it is pinned the way where.test.ts
// pins the endpoint's headers: by reading the file that must carry it.
describe("who depends on the stamp", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

  it("RouteTab's place-shade memo takes the graph revision", () => {
    const src = read("screens/route/RouteTab.tsx");
    expect(src).toContain("useGraphRevision()");
    // the memo's dependency array, wherever the comments put it
    const body = src.slice(src.indexOf("const placeShade = useMemo"));
    const deps = body.slice(body.indexOf("}, ["), body.indexOf("]", body.indexOf("}, [")));
    expect(deps).toContain("graph");
    expect(deps).toContain("graphRev");
  });

  it("...and the hook it needs is exported", () => {
    expect(read("GraphContext.tsx")).toContain("export function useGraphRevision(): number");
  });
});
