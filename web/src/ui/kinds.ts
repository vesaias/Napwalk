// What a candidate's kind is called, and what colour its badge wears
// (UI redesign Task 13, 2026-09-05 — lifted out of Routes.tsx when the
// Wander cards wanted the same two tables). The card SENTENCES moved on to
// plan/cardCopy.ts with the spec's copy rules (slice 3, 2026-09-07); what
// is left here is the naming and the selection bookkeeping.
//
// The recommended and the shadier walk are green, the quieter one blue,
// anything else neutral.
import type { CandidateKind, PlanResult } from "../plan/plan";
import type { TagVariant } from "./kit/Tag";

export const KIND_KEY: Record<CandidateKind, string> = {
  recommended: "card.recommended",
  faster: "card.faster",
  shadier: "card.shadier",
  quieter: "card.quieter",
  parkLoop: "card.parkLoop",
};

export const KIND_VARIANT: Record<CandidateKind, TagVariant> = {
  recommended: "acc",
  faster: "well",
  shadier: "acc",
  quieter: "quiet",
  parkLoop: "well",
};

/** Where the walk of this kind sits in a plan's candidate list, or 0 — the
 *  recommendation — when the plan has no such walk (or nothing was asked
 *  for). The FIRST match: a loop plan can carry two `parkLoop` candidates
 *  (plan.ts labels every lap walk that way), so this alone cannot tell them
 *  apart — `restoreSelected` handles that case by position. */
export function indexOfKind(plan: PlanResult | null, kind: CandidateKind | null): number {
  if (!plan || kind === null) return 0;
  const i = kindsOf(plan).findIndex((k) => k === kind);
  return i < 0 ? 0 : i;
}

export function kindsOf(plan: PlanResult | null): CandidateKind[] {
  return plan ? [plan.recommended, ...plan.alternatives].map((c) => c.kind) : [];
}

/** Which candidate of a NEW plan is the one the reader had picked in the old
 *  one. Used across the Start rebase, which replans for the current clock
 *  and would otherwise drop the pick back to the recommendation — on Wander
 *  that changes which walk you are on, not just which variant of it.
 *
 *  An index alone is meaningless between two answers and a kind alone cannot
 *  separate two park loops, so: when the new plan offers the same kinds in
 *  the same order (which a clock-only replan almost always does) the index
 *  stands; otherwise the first walk of the same kind; otherwise the
 *  recommendation. */
export function restoreSelected(
  plan: PlanResult | null,
  was: { kinds: CandidateKind[]; selected: number }
): number {
  if (!plan) return 0;
  const next = kindsOf(plan);
  if (next.length === 0) return 0;
  const same = next.length === was.kinds.length && next.every((k, i) => k === was.kinds[i]);
  if (same) return Math.min(Math.max(0, was.selected), next.length - 1);
  return indexOfKind(plan, was.kinds[was.selected] ?? null);
}
