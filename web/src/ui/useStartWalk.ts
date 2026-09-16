// Starting a walk (UI redesign Task 12, fix round 1 — lifted out of
// AppShell in Task 13, when Wander became a second caller).
//
// A card computed for a departure that has come and gone describes a
// different sun than the one the walker is standing under: rebase the clock
// to now and let the plan land before navigating. The route may come back
// slightly different from the one that was tapped — but the plan on the map,
// the Arrived tags and Navigate's own clock then all agree, which is worth
// more. If no plan lands for the new clock the screen stays where it is,
// where NoRoute explains why.
//
// Two things have to survive that rebase (Task 13 fix round 1). The silent
// `leave` goes through the reducer's `replan`, which resets `selected` to
// the recommendation — on the routes screen that swaps one A→B variant for
// another, but on Wander it changes WHICH WALK you are on, so a reader who
// tapped "Park loop" and then Start walked the recommended loop instead.
// The pick is therefore remembered as the kinds the plan offered and the
// one that was chosen (kinds.ts, restoreSelected) and re-selected when the
// next answer arrives — a bare index means nothing between two plans, and a
// bare kind cannot separate two park loops. And the tab is remembered too:
// `start` means "navigate" on whichever tab is showing when the plan lands,
// so a pending Start from the routes screen must not launch a Wander walk if
// the reader switched tabs inside the debounce.
import { useEffect, useRef } from "react";
import type { CandidateKind } from "../plan/plan";
import { kindsOf, restoreSelected } from "./kinds";
import type { Action, PlanResult, ShellState, Tab } from "./shellState";
import { nowClamped, nowMinutes, STEP_MIN } from "./time";

type Pending = { tab: Tab; kinds: CandidateKind[]; selected: number };

export function useStartWalk(
  s: ShellState,
  dispatch: (a: Action) => void,
  plan: PlanResult | null,
  /** Re-centre the map on the walker as the walk begins. */
  onFollow: () => void
): () => void {
  const pending = useRef<Pending | null>(null);
  const tab = s.tab;

  useEffect(() => {
    const p = pending.current;
    if (p === null || s.computing) return;
    pending.current = null;
    if (p.tab !== tab) return; // the reader left; their Start left with them
    if (!s.plan) return; // no plan for the new clock: NoRoute explains
    const i = restoreSelected(s.plan, p);
    if (i !== s.selected) dispatch({ type: "select", i });
    dispatch({ type: "start" });
  }, [s.computing, s.plan, s.selected, tab, dispatch]);

  return () => {
    onFollow();
    if (plan && Math.abs(nowMinutes() - plan.startMin) > STEP_MIN) {
      pending.current = { tab, kinds: kindsOf(plan), selected: s.selected };
      dispatch({ type: "leave", startMin: nowClamped(), now: true, silent: true });
      return;
    }
    dispatch({ type: "start" });
  };
}
