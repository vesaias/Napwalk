import { describe, expect, it } from "vitest";
import { nearestNode, snapToEdge, toXY, type Graph } from "./graph";
import { realGraph } from "./realGraph.fixture";
const g: Graph | null = realGraph();
describe.skipIf(!g)("snapToEdge", () => {
  it("snapped point is closer than the nearest node (Grüneburgweg click)", () => {
    const [lng, lat] = [8.66961, 50.12164];
    const s = snapToEdge(g!, lng, lat);
    const n = nearestNode(g!, lng, lat);
    const [qx, qy] = toXY(lng, lat);
    const dSnap = Math.hypot(...(() => { const [x, y] = toXY(s.point[0], s.point[1]); return [x - qx, y - qy]; })());
    const dNode = Math.hypot(g!.x[n] - qx, g!.y[n] - qy);
    expect(dSnap).toBeLessThanOrEqual(dNode + 0.01);
    expect(dSnap).toBeLessThan(30); // the click is on a building, 18 m from the nearest walkway
    // tail ends at the routing node
    const last = s.tail[s.tail.length - 1];
    expect(Math.abs(last[0] - g!.lng[s.node])).toBeLessThan(1e-6);
    expect(Math.abs(last[1] - g!.lat[s.node])).toBeLessThan(1e-6);
  });
});
