import { describe, expect, it } from "vitest";
import { locateFor } from "./locate";
import { GPS_ORIGIN, initialShell, type Action, type ShellState } from "./shellState";

/** The shell as the Locate button sees it: which screen each tab is on, and
 *  whether the reader's ONE start point is a pin or the live fix (CR-03 A8
 *  — there is no per-tab origin any more). */
function shell(o: {
  route?: ShellState["route"];
  wander?: ShellState["wander"];
  origin?: ShellState["origin"];
}): ShellState {
  const s = initialShell(600, "shade");
  return {
    ...s,
    route: o.route ?? s.route,
    origin: o.origin ?? s.origin,
    wander: o.wander ?? s.wander,
  };
}

const PIN = { kind: "point", at: [8.68, 50.11], label: "Dropped pin" } as const;
const ROUTES = { k: "routes", dest: [8.69, 50.13], from: null } as unknown as ShellState["route"];

function run(s: ShellState, scope: "route" | "wander") {
  const sent: Action[] = [];
  let asked = 0;
  locateFor(s, (a) => sent.push(a), () => {
    asked += 1;
  })(scope)();
  return { sent, asked };
}

// CR-C review C6: the file was named for a hook, exported a plain function
// and had no test at all, which made the extraction read as a line-count
// move rather than a seam. These are the three cases it was hiding.
describe("locateFor (the Locate button, per tab)", () => {
  it("takes a pinned start back to the fix on the screen that shows it", () => {
    const route = run(shell({ route: ROUTES, origin: PIN }), "route");
    expect(route.asked).toBe(1);
    expect(route.sent).toEqual([{ type: "origin", origin: GPS_ORIGIN }]);

    const wander = run(shell({ wander: { k: "loops" }, origin: PIN }), "wander");
    expect(wander.asked).toBe(1);
    expect(wander.sent).toEqual([{ type: "origin", origin: GPS_ORIGIN }]);
  });

  // Backlog B3's ruling: one "here", so one reset. The button on either tab
  // sends the same scopeless action, and both tabs are back on the fix.
  it("resets the one start point, whichever tab's button was pressed", () => {
    const fromWander = run(shell({ wander: { k: "loops" }, route: ROUTES, origin: PIN }), "wander");
    const fromRoute = run(shell({ wander: { k: "loops" }, route: ROUTES, origin: PIN }), "route");
    expect(fromWander.sent).toEqual(fromRoute.sent);
  });

  it("only asks when the screen does not show the origin", () => {
    // Home: nothing on screen says the start is pinned, so silently dropping
    // a shared `s=` would be a surprise.
    const home = run(shell({ origin: PIN }), "route");
    expect(home.asked).toBe(1);
    expect(home.sent).toEqual([]);
  });

  it("only asks when the start is already the fix", () => {
    const route = run(shell({ route: ROUTES }), "route");
    expect(route.asked).toBe(1);
    expect(route.sent).toEqual([]);

    const wander = run(shell({ wander: { k: "loops" } }), "wander");
    expect(wander.asked).toBe(1);
    expect(wander.sent).toEqual([]);
  });
});
