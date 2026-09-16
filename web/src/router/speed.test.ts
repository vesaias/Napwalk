import { afterEach, describe, expect, it } from "vitest";
import { setSpeedKmh, SPEED_M_PER_MIN } from "./astar";
import { parseGraph } from "./graph";
import { packGraph } from "./packGraph";
import { routeStats } from "./stats";

const NODES: [number, number][] = [
  [50.1109, 8.6821],
  [50.1118, 8.6821],
];

afterEach(() => setSpeedKmh(4));

describe("setSpeedKmh", () => {
  it("updates the live binding seen by routeStats", () => {
    const g = parseGraph(packGraph(NODES, [{ u: 0, v: 1, lenDm: 1000 }]));
    expect(routeStats(g, [0], 600).minutes).toBe(Math.round(100 / (4000 / 60)));
    setSpeedKmh(8);
    expect(SPEED_M_PER_MIN).toBeCloseTo(8000 / 60);
    expect(routeStats(g, [0], 600).minutes).toBe(Math.round(100 / (8000 / 60)));
  });
});
