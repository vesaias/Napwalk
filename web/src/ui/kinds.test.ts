import { describe, expect, it } from "vitest";
import type { CandidateKind, PlanResult } from "../plan/plan";
import { KIND_KEY, KIND_VARIANT, indexOfKind, kindsOf, restoreSelected } from "./kinds";

/** A plan of the given kinds — only the shape `indexOfKind` reads. */
function plan(...kinds: CandidateKind[]): PlanResult {
  const [rec, ...alts] = kinds.map((kind) => ({ kind }));
  return { recommended: rec, alternatives: alts } as unknown as PlanResult;
}

describe("indexOfKind", () => {
  it("finds the walk the reader picked in the next answer", () => {
    // the rebase on Start replans, and the new plan may order its
    // alternatives differently — the KIND is what the reader chose
    expect(indexOfKind(plan("recommended", "parkLoop", "quieter"), "parkLoop")).toBe(1);
    expect(indexOfKind(plan("recommended", "quieter", "parkLoop"), "parkLoop")).toBe(2);
    expect(indexOfKind(plan("recommended", "quieter"), "recommended")).toBe(0);
  });

  it("falls back to the recommendation when the new plan has no such walk", () => {
    expect(indexOfKind(plan("recommended", "quieter"), "parkLoop")).toBe(0);
    expect(indexOfKind(plan("recommended"), "shadier")).toBe(0);
  });

  it("asks for nothing when there is nothing to ask about", () => {
    expect(indexOfKind(null, "parkLoop")).toBe(0);
    expect(indexOfKind(plan("recommended", "parkLoop"), null)).toBe(0);
  });
});

describe("restoreSelected", () => {
  const P = plan("recommended", "parkLoop", "parkLoop");

  it("keeps the index when the new plan offers the same walks", () => {
    // a clock-only replan almost always does, and two park loops cannot be
    // told apart by kind — position is the only thing that separates them
    expect(restoreSelected(P, { kinds: kindsOf(P), selected: 2 })).toBe(2);
    expect(restoreSelected(P, { kinds: kindsOf(P), selected: 0 })).toBe(0);
  });

  it("follows the kind when the new plan offers different walks", () => {
    const next = plan("recommended", "quieter", "parkLoop");
    expect(restoreSelected(next, { kinds: kindsOf(P), selected: 1 })).toBe(2);
    // and gives up on the recommendation when that kind is gone
    expect(restoreSelected(plan("recommended", "quieter"), { kinds: kindsOf(P), selected: 1 })).toBe(0);
  });

  it("clamps to a shorter plan, and has nothing to restore without one", () => {
    const short = plan("recommended");
    expect(restoreSelected(short, { kinds: kindsOf(short), selected: 2 })).toBe(0);
    expect(restoreSelected(null, { kinds: kindsOf(P), selected: 2 })).toBe(0);
  });
});

describe("the kind tables", () => {
  it("name and colour every kind the planner can build", () => {
    const kinds: CandidateKind[] = ["recommended", "faster", "shadier", "quieter", "parkLoop"];
    for (const k of kinds) {
      expect(KIND_KEY[k]).toMatch(/^card\./);
      expect(KIND_VARIANT[k]).toBeTruthy();
    }
  });
});
