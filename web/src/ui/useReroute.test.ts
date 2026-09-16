import { describe, expect, it } from "vitest";
import { OFF_ROUTE_M, OFF_ROUTE_MS, offRoute, type OffSample } from "./nav";
import { rerouteHelps, rerouteMin } from "./useReroute";
import { DAY_END_MIN } from "./time";

// The two pure halves of the silent reroute, and the loop they bound
// (fix round 1, B-1 and B-3).

describe("rerouteHelps", () => {
  it("accepts a replan that puts the walker on the line", () => {
    expect(rerouteHelps(60, 0)).toBe(true);
    expect(rerouteHelps(60, OFF_ROUTE_M - 1)).toBe(true);
  });

  it("accepts one that at least brings the line closer", () => {
    expect(rerouteHelps(300, 120)).toBe(true);
  });

  it("refuses one that leaves the walker exactly as far off", () => {
    expect(rerouteHelps(60, 60)).toBe(false);
    expect(rerouteHelps(60, 61)).toBe(false);
    // 40 m is the tolerance, so landing exactly ON it is not "inside" it —
    // it counts here only because it is closer than the 60 it replaced
    expect(rerouteHelps(60, OFF_ROUTE_M)).toBe(true);
    expect(rerouteHelps(OFF_ROUTE_M, OFF_ROUTE_M)).toBe(false);
  });
});

/** The hook's loop, with the clock and the planner replaced by arguments:
 *  a walker whose distance from the drawn line is `offM(t)`, sampled once a
 *  second, and a planner whose new line leaves them `plannedOffM` away.
 *  Mirrors `useReroute`'s effect step for step — the guard, the buffer, the
 *  ten-second predicate and the off-network flag. */
function driveWalk(seconds: number, offM: number, plannedOffM: number): number {
  let samples: OffSample[] = [];
  let offNetwork = false;
  let reroutes = 0;
  for (let t = 0; t <= seconds * 1000; t += 1000) {
    const m = reroutes === 0 ? offM : plannedOffM;
    if (m <= OFF_ROUTE_M) offNetwork = false;
    if (offNetwork) continue;
    samples = [...samples, { t, m }].filter((x) => t - x.t <= 30_000);
    if (!offRoute(samples)) continue;
    samples = [];
    reroutes++;
    offNetwork = !rerouteHelps(m, plannedOffM);
  }
  return reroutes;
}

describe("the reroute terminates", () => {
  it("replans a walker 60 m off the graph exactly once, then leaves them alone", () => {
    // The planner can do nothing for them — every new line is 60 m away too
    // (the middle of a square, a courtyard, an indoor fix). One recompute,
    // then the walk is off-network for the next minute of samples.
    expect(driveWalk(60, 60, 60)).toBe(1);
    // ...and for ten minutes, and an hour: the flag does not time out.
    expect(driveWalk(600, 60, 60)).toBe(1);
    expect(driveWalk(3600, 60, 60)).toBe(1);
  });

  it("replans once when the new line reaches the walker's own feet", () => {
    // The ordinary case: `planAB` draws a connector from the fix to the edge
    // it snapped to, so the drawn line passes through the walker (B-1).
    expect(driveWalk(600, 60, 0)).toBe(1);
  });

  it("gives progress a second chance, and stops when it runs out", () => {
    // 300 m off, and the replan gets them to 120: that IS progress, so the
    // guard lets the next ten seconds earn another try. The second one moves
    // nothing (120 → 120), and that is where it ends — bounded, not blocked.
    expect(driveWalk(60, 300, 120)).toBe(2);
    expect(driveWalk(3600, 300, 120)).toBe(2);
  });

  it("never replans a walker who is on the line", () => {
    expect(driveWalk(3600, OFF_ROUTE_M - 1, 0)).toBe(0);
  });

  it("waits the ten seconds before the first one", () => {
    expect(OFF_ROUTE_MS).toBe(10_000);
    expect(driveWalk(9, 60, 0)).toBe(0);
    expect(driveWalk(10, 60, 0)).toBe(1);
  });
});

describe("rerouteMin (rule 4)", () => {
  const NOW = 15 * 60 + 22; // 15:22 on the wall clock

  it("uses the wall clock under 'leave now'", () => {
    expect(rerouteMin(true, 14 * 60, 82, NOW)).toBe(NOW);
  });

  it("adds the walk so far to a departure the walker actually left at", () => {
    // left at 17:00, twenty minutes in: the sun to price is 17:20's
    expect(rerouteMin(false, 17 * 60, 20, NOW)).toBe(17 * 60 + 20);
  });

  it("never prices a rerouted walk at a departure that has been and gone", () => {
    // the bug this replaces: `s.startMin`, frozen at the leave-at minute
    expect(rerouteMin(false, 17 * 60, 20, NOW)).not.toBe(17 * 60);
  });

  it("rounds to a whole minute and stays inside the day", () => {
    expect(rerouteMin(false, 600, 2.6, NOW)).toBe(603);
    expect(rerouteMin(false, DAY_END_MIN, 90, NOW)).toBe(DAY_END_MIN);
    expect(rerouteMin(false, 600, -5, NOW)).toBe(600); // a clock that went backwards
  });
});
