import { describe, expect, it } from "vitest";
import { PRESETS, route } from "./astar";
import { parseGraph } from "./graph";
import { packGraph } from "./packGraph";

// a street (0->1) with a mapped sidewalk (2->3) beside it, joined at both ends
const NODES: [number, number][] = [
  [50.1109, 8.6821], [50.1129, 8.6821], // road ends
  [50.1109, 8.68215], [50.1129, 8.68215], // sidewalk ends
];
describe("carriageway penalty", () => {
  it("walks the sidewalk, not the road, when the road has a mapped sidewalk", () => {
    const g = parseGraph(packGraph(NODES, [
      { u: 0, v: 1, lenDm: 2200, street: true, hasSidewalk: true },
      { u: 1, v: 0, lenDm: 2200, street: true, hasSidewalk: true },
      { u: 0, v: 2, lenDm: 40 }, { u: 2, v: 0, lenDm: 40 },
      { u: 2, v: 3, lenDm: 2200 }, { u: 3, v: 2, lenDm: 2200 }, // sidewalk (footway)
      { u: 3, v: 1, lenDm: 40 }, { u: 1, v: 3, lenDm: 40 },
    ]));
    const r = route(g, 0, 1, 600, PRESETS.balanced)!;
    expect(r.nodes).toEqual([0, 2, 3, 1]);
  });
});
