import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../plan/settings";
import { initialShell, NO_TRIP, reduce, type ShellState } from "./shellState";
import { planJob, planKey, planPhase } from "./usePlanner";

const JOB = "ab|8.6821,50.1109|8.7027,50.1291";
const S: ShellState = initialShell(14 * 60, "shade");
const base = planKey(JOB, S, DEFAULT_SETTINGS);

/** Every settings field, and whether changing it must ask the planner a new
 *  question. The four that do are the four the planner is handed:
 *  the city picks the graph, access and the cobble wall pick the cost, the
 *  pace picks the clock every arrival time is read at (CLAUDE.md rule 4). */
const CASES: { patch: Partial<Settings>; replans: boolean }[] = [
  { patch: { city: "hamburg" }, replans: true },
  { patch: { access: "walk" }, replans: true },
  { patch: { avoidCobbles: true }, replans: true },
  { patch: { pace: "brisk" }, replans: true },
  { patch: { theme: "dark" }, replans: false },
  { patch: { locale: "de" }, replans: false },
  { patch: { layers: { shade: false, noise: true } }, replans: false },
  { patch: { autoPref: false }, replans: false },
];

describe("planKey — which settings replan", () => {
  for (const { patch, replans } of CASES) {
    const name = Object.keys(patch)[0];
    it(`${name} ${replans ? "asks a new question" : "leaves the plan alone"}`, () => {
      const key = planKey(JOB, S, { ...DEFAULT_SETTINGS, ...patch });
      expect(key === base).toBe(!replans);
    });
  }

  it("carries the clock and the preference, which the settings do not", () => {
    expect(planKey(JOB, { ...S, startMin: 17 * 60 }, DEFAULT_SETTINGS)).not.toBe(base);
    expect(planKey(JOB, { ...S, pref: "quiet" }, DEFAULT_SETTINGS)).not.toBe(base);
  });

  it("changes with the walk itself", () => {
    expect(planKey("loop|8.6821,50.1109|45", S, DEFAULT_SETTINGS)).not.toBe(base);
  });

  it("changes after sunset, when the shade term is dropped", () => {
    const s = initialShell(22 * 60, "balanced");
    expect(planKey("ab|x|y", s, DEFAULT_SETTINGS, true)).not.toBe(planKey("ab|x|y", s, DEFAULT_SETTINGS, false));
  });
});

// R4's access chip changes the walk without changing the settings, so the
// key has to read the pair through tripSettings — an override the key did
// not carry would leave the previous answer on screen.
describe("planKey — the per-trip access override", () => {
  it("asks a new question for an access the settings do not have", () => {
    const s: ShellState = { ...S, trip: { ...NO_TRIP, access: "wheelchair" } };
    expect(planKey(JOB, s, DEFAULT_SETTINGS)).not.toBe(base);
    // and it is the same question as that access IN the settings
    expect(planKey(JOB, s, DEFAULT_SETTINGS)).toBe(
      planKey(JOB, S, { ...DEFAULT_SETTINGS, access: "wheelchair" })
    );
  });

  it("asks a new question for the cobble wall the no-route card drops", () => {
    const walled: Settings = { ...DEFAULT_SETTINGS, avoidCobbles: true };
    const s: ShellState = { ...S, trip: { ...NO_TRIP, avoidCobbles: false } };
    expect(planKey(JOB, s, walled)).not.toBe(planKey(JOB, S, walled));
    expect(planKey(JOB, s, walled)).toBe(base);
  });

  it("is the settings' own question when the override says what they say", () => {
    const s: ShellState = { ...S, trip: { ...NO_TRIP, access: "stroller", avoidCobbles: false } };
    expect(planKey(JOB, s, DEFAULT_SETTINGS)).toBe(base);
  });
});

// slice 6: W3. A loop via a place is a different job from the same loop
// without one — the job key carries the via, so the loops recompute the
// moment "↻ Loop via" is tapped (and the moment the ✕ undoes it).
describe("planJob — the loop via", () => {
  const HERE: [number, number] = [8.6821, 50.1109];
  const PARK: [number, number] = [8.7027, 50.1291];
  const base: ShellState = {
    ...S,
    tab: "wander",
    wander: { k: "loops", origin: { kind: "gps" } },
    gps: HERE,
  };

  it("is null on W1 and the place on W3", () => {
    expect(planJob(base)).toEqual({ k: "loop", start: HERE, dur: 45, via: null });
    const w3 = reduce(base, { type: "loopVia", via: { at: PARK, name: "park" } });
    expect(planJob(w3)).toEqual({ k: "loop", start: HERE, dur: 45, via: PARK });
  });

  it("is dropped when the place is outside the city's data", () => {
    // a border that contains the start and nothing else
    const border = {
      type: "Polygon",
      coordinates: [
        [
          [8.68, 50.11],
          [8.69, 50.11],
          [8.69, 50.115],
          [8.68, 50.115],
          [8.68, 50.11],
        ],
      ],
    } as unknown as Parameters<typeof planJob>[1];
    const w3 = reduce(base, { type: "loopVia", via: { at: PARK, name: "park" } });
    expect(planJob(w3, border)).toEqual({ k: "loop", start: HERE, dur: 45, via: null });
  });
});

// 2026-09-15. A city tap switches the map at once and the graph follows in
// the background, so there is an ordinary stretch of seconds in which the
// question on screen has no graph to answer it. Viktor: "if the user is too
// fast and the graph is not yet loaded, we just wait longer for computing."
describe("planPhase — waiting for a graph that is still downloading", () => {
  const asked = { hasJob: true, wanted: true, hasGraph: true, graphFailed: false, bandsIn: true };

  it("runs when the graph and the departure's bands are in", () => {
    expect(planPhase(asked)).toBe("run");
  });

  it("waits — not 'no route' — while the core is on the wire", () => {
    expect(planPhase({ ...asked, hasGraph: false })).toBe("wait");
  });

  it("waits for the departure's shade bands too (B11)", () => {
    expect(planPhase({ ...asked, bandsIn: false })).toBe("wait");
  });

  it("asks nothing when there is nothing to plan, or it is already planned", () => {
    expect(planPhase({ ...asked, hasJob: false })).toBe("none");
    expect(planPhase({ ...asked, wanted: false })).toBe("none");
    // …and neither of those becomes a wait just because the graph is out
    expect(planPhase({ ...asked, hasJob: false, hasGraph: false })).toBe("none");
  });

  it("asks for the artifact again when it did not arrive", () => {
    // Not a wait: a skeleton over a download that failed is a wait with no
    // end (shellState `replan` keeps the same rule). Not "none" either, as
    // it was until the loader pill went — the pill's Retry was the one
    // control that could ask again from the screen the reader is on, so the
    // asking moved here. The hook spends this exactly once per failure
    // (usePlanner), after which the cityFailed card's Retry is the way back.
    expect(planPhase({ ...asked, hasGraph: false, graphFailed: true })).toBe("retry");
    expect(planPhase({ ...asked, graphFailed: true })).toBe("retry");
    // …and only when a walk is actually being asked for.
    expect(planPhase({ ...asked, hasJob: false, graphFailed: true })).toBe("none");
    expect(planPhase({ ...asked, wanted: false, graphFailed: true })).toBe("none");
  });
});
