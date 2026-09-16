// What a result card SAYS (SPEC §1.1, compact-UI slice 3, 2026-09-07).
//
// Three pure functions and one predicate, all of them thresholds the spec
// fixes as numbers: the recommended card's reason line, which axis an
// alternative may claim, what that alternative costs, and the warning that
// replaces the cost line. Nothing here reads the graph — the caller hands
// in the candidates the planner already measured — so every rule is a unit
// test rather than a screenshot.
import { t } from "../i18n/t";
import type { RouteStats } from "../router/stats";
import { deltaLabel, fmtTime, int } from "../ui/kit/format";
import type { Preference } from "./preference";

// --- the reason line: "<preference> · <why>" ------------------------------

/** The hour windows §1.1 names for the automatic pick. They are the same
 *  boundaries `autoPreference` routes by (preference.ts), repeated here
 *  because the copy rule is written in hours, not in preferences: at 16:30
 *  the rule picks "balanced" and names no reason for it. */
const SHADE_FROM = 11 * 60; // 11:00
const SHADE_TO = 16 * 60; // 16:00 (exclusive)
const QUIET_FROM = 18 * 60; // 18:00

const PREF_KEY: Record<Preference, string> = {
  shade: "pref.shadeLow",
  quiet: "pref.quietLow",
  balanced: "pref.balancedLow",
};

export type ReasonInput = {
  pref: Preference;
  /** The clock picked the preference, not the reader. */
  auto: boolean;
  /** Departure, minutes since local midnight. */
  startMin: number;
  /** Sunset for the day and city, minutes since local midnight. */
  sunsetMin: number;
  /** The reader has not set a departure — "leave now". */
  leaveNow: boolean;
};

/** The `<why>` half, or null when no rule matches (§1.1: then the line is
 *  the preference alone). Sunset is tested before the evening window: in
 *  December the sun is down well before 18:00, and "evening quiet" would
 *  be naming a reason the router did not use. */
function why(i: ReasonInput): string | null {
  if (i.auto) {
    if (i.startMin >= i.sunsetMin || i.startMin < SHADE_FROM) return t("card.whyLowSun");
    if (i.startMin < SHADE_TO) return t("card.whyAfternoon");
    if (i.startMin >= QUIET_FROM) return t("card.whyEvening");
    return null; // 16:00–17:59: balanced, and the rule names no hours for it
  }
  return t("card.whyYourPick");
}

/** The muted line beside the *Recommended* tag: `shade first · afternoon
 *  sun`, `quiet first · your pick · at 19:30`, or `balanced`. */
export function reasonLine(i: ReasonInput): string {
  const parts = [t(PREF_KEY[i.pref])];
  const w = why(i);
  if (w !== null) parts.push(w);
  if (!i.leaveNow) parts.push(t("card.whyAt", { time: fmtTime(i.startMin) }));
  return parts.reduce((a, b) => t("card.reason", { a, b }));
}

// --- which axis an alternative may claim ----------------------------------

export type AltTag = "faster" | "shadier" | "quieter";

/** §1.1: an alternative earns a tag only by beating the recommendation on
 *  one of these — two minutes, ten points, ten points. Below them the
 *  difference is noise and the card is dropped. */
export const FASTER_MIN = -2;
export const AXIS_PP = 10;

/** What a tag needs to read: the minutes against the recommendation, the
 *  two percentages, and the axis the planner was ASKING for (`kind`). */
type TaggableCandidate = {
  kind: string;
  deltaMin: number;
  stats: Pick<RouteStats, "shadePct" | "quietPct">;
};

const AXES: AltTag[] = ["faster", "shadier", "quieter"];

/** The axis this alternative beats the recommendation on, or null — drop
 *  the card. The preset it came from gets first refusal (a leg routed for
 *  quiet should say "Quieter" when it is quieter), and only when that axis
 *  falls short does another one it happens to win take the tag: a walk that
 *  is four minutes faster is worth showing under the name of what it does.
 *
 *  `night` withholds the shade axis: after sunset the shade figures are not
 *  a measurement anyone took (plan.ts zeroes the shade weight too). */
export function altTag(
  rec: TaggableCandidate,
  alt: TaggableCandidate,
  opts: { night?: boolean } = {}
): AltTag | null {
  const beats: Record<AltTag, boolean> = {
    faster: alt.deltaMin <= FASTER_MIN,
    shadier: opts.night !== true && alt.stats.shadePct - rec.stats.shadePct >= AXIS_PP,
    quieter: alt.stats.quietPct - rec.stats.quietPct >= AXIS_PP,
  };
  const intended = AXES.find((a) => a === alt.kind);
  if (intended !== undefined && beats[intended]) return intended;
  return AXES.find((a) => beats[a]) ?? null;
}

/** The axis a card's note speaks on. The recommended walk and a park loop
 *  have no axis of their own — both fall back to shade, the figure every
 *  card in this app leads with. */
export function noteAxis(kind: string): AltTag {
  return kind === "quieter" ? "quieter" : kind === "faster" ? "faster" : "shadier";
}

// --- the peek snap's second button ----------------------------------------

/** "2 more · −4 min ▴", or null when there is nothing under the fold.
 *
 *  The peek snap shows one card, so the button beside Start has to say what
 *  a drag would buy (SPEC §3b). N is the alternatives that survived §1.1 —
 *  the planner has already dropped the rest — and the delta is the best
 *  TIME saving among them, formatted the way every other card formats one
 *  (U+2212, not a hyphen).
 *
 *  When none of them is quicker, the button names the non-time win instead:
 *  "+2 min quieter" is an honest trade and "0 min" is not one at all. The
 *  axis comes from `altTag`, so the button and the card the reader finds
 *  under it agree on what that alternative is FOR. And when nothing can be
 *  claimed — no axis clears its threshold, or the win costs nothing — the
 *  button falls back to the count alone rather than inventing a number. */
/** The candidates a peeking sheet is NOT showing, with their minutes
 *  re-based on the one it is (CR-01 review, F5).
 *
 *  `deltaMin` is written against the recommendation (plan.ts), which is the
 *  right frame for the alternative CARDS — they are read next to it. The
 *  peek button is read next to whichever card the reader selected, so once
 *  that is an alternative both halves of "2 more · −4 min" are wrong: the
 *  count includes the walk on screen, and the saving is measured from a
 *  walk that is not. Subtracting the selected card's own delta gives the
 *  minutes a drag would actually buy. A no-op while the recommendation is
 *  selected, which is what every plan opens on. */
export function others<T extends { deltaMin: number }>(cands: T[], i: number): T[] {
  const base = cands[i]?.deltaMin ?? 0;
  const rest = cands.filter((_, k) => k !== i);
  return base === 0 ? rest : rest.map((c) => ({ ...c, deltaMin: c.deltaMin - base }));
}

export function moreLabel(
  rec: TaggableCandidate,
  alts: TaggableCandidate[],
  opts: { night?: boolean } = {}
): string | null {
  const n = alts.length;
  if (n === 0) return null;
  const quickest = alts.reduce((a, b) => (b.deltaMin < a.deltaMin ? b : a));
  if (quickest.deltaMin < 0) {
    return t("routes.more", { n, delta: deltaLabel(quickest.deltaMin) });
  }
  for (const alt of alts) {
    const min = Math.round(alt.deltaMin);
    if (min <= 0) continue; // a win that costs nothing has no "+n min" to name
    const axis = altTag(rec, alt, opts);
    if (axis === "quieter") {
      return t("routes.more", { n, delta: t("routes.moreQuiet", { min }) });
    }
    if (axis === "shadier") {
      return t("routes.more", { n, delta: t("routes.moreShade", { min }) });
    }
  }
  return t("routes.moreOnly", { n });
}

// --- what the alternative costs -------------------------------------------

/** §1.1's cost thresholds. `loudPct` and `climbM` are optional on the input
 *  because the artifact carries neither today (see the report): the rules
 *  are written and tested, and stay silent until a graph feeds them. */
export const SUN_MIN = 5;
export const SUN_RATIO = 1.5;
export const COBBLE_M = 100;
export const LOUD_PP = 15;
export const CLIMB_M = 15;

export type NoteCandidate = {
  /** Minutes walked in full sun (plan.ts, `sunMinutes`). */
  sunMin: number;
  stats: Pick<RouteStats, "shadePct" | "quietPct" | "cobbleM">;
  /** Share of the walk on loud streets. No stat supplies it today. */
  loudPct?: number;
  /** Metres climbed. The graph carries no elevation today. */
  climbM?: number;
};

/** The one line under an alternative's tag: the first cost that applies,
 *  else the gain in numbers (§1.1). `wander` opens the climb rule, which
 *  the spec limits to loops. */
export function altNote(
  rec: NoteCandidate,
  alt: NoteCandidate,
  tag: AltTag,
  opts: { wander?: boolean; night?: boolean } = {}
): string {
  if (alt.sunMin >= SUN_MIN && alt.sunMin >= SUN_RATIO * rec.sunMin) {
    return t("card.sunMin", { min: alt.sunMin });
  }
  const moreCobbles = alt.stats.cobbleM - rec.stats.cobbleM;
  if (moreCobbles >= COBBLE_M) {
    return rec.stats.cobbleM > 0
      ? t("card.cobblesMore", { m: int(moreCobbles) })
      : t("card.cobbles", { m: int(alt.stats.cobbleM) });
  }
  if (
    alt.loudPct !== undefined &&
    rec.loudPct !== undefined &&
    alt.loudPct - rec.loudPct >= LOUD_PP
  ) {
    return t("card.loudPct", { pct: int(alt.loudPct) });
  }
  if (
    opts.wander === true &&
    alt.climbM !== undefined &&
    rec.climbM !== undefined &&
    alt.climbM - rec.climbM >= CLIMB_M
  ) {
    return t("card.climb", { m: int(alt.climbM - rec.climbM) });
  }
  if (tag === "quieter") return t("card.quietPct", { pct: alt.stats.quietPct });
  return opts.night === true
    ? t("card.afterSunset")
    : t("card.shadePct", { pct: alt.stats.shadePct });
}

// --- the bars -------------------------------------------------------------

/** The two labels beside the meters: "68 % shade" and "74 % quiet".
 *
 *  Only the LABEL changes after sunset. The bars are never hidden (§1.1)
 *  and the meters keep the walk's real shade share, which is arithmetically
 *  true — but the WORD is withheld, because with the sun below the horizon
 *  every edge is trivially unlit and "100 % shade" stops measuring the
 *  thing this app sells (a card boasting it at 22:00 is the bug
 *  e2e/edges.spec.ts guards). Nothing here scales a meter. */
export function barLabels(
  c: { stats: Pick<RouteStats, "shadePct" | "quietPct"> },
  night: boolean
): { shade: string; quiet: string } {
  return {
    shade: night ? t("card.afterSunset") : t("card.shadePct", { pct: c.stats.shadePct }),
    quiet: t("card.quietPct", { pct: c.stats.quietPct }),
  };
}

// --- the warning that replaces the cost line ------------------------------

/** Below this the walk is in the sun, whatever the bar says (§1.1). */
export const NO_SHADE_PCT = 20;
/** The crossing is reported on a ten-minute step: the profile is hourly and
 *  a minute-exact "no shade after 17:43" would be false precision. */
const STEP_MIN = 10;

/** "no shade after 17:40", or null.
 *
 *  Method. `hourPct[i]` is the recommended walk's shade share if it LEFT at
 *  `hours[i]`:00 — the one pass per daylight hour `useWalk` already makes
 *  for the leave-at bars. Read as a curve over the departure hour it says when this walk
 *  stops being shaded. So: find the first pair of neighbouring hours where
 *  the curve falls from at or above 20 % to below it, interpolate linearly
 *  between them for the minute it crosses, and floor that to ten minutes.
 *  The warning fires only when the crossing falls INSIDE the walk —
 *  between the departure and the arrival (§1.1: "makes shade % drop below
 *  20 within the walk"). A walk that is already below 20 % when it leaves
 *  is not dropping; its bar says so and the card does not repeat it. */
export function warning(
  rec: { stats: Pick<RouteStats, "minutes"> },
  hourPct: number[],
  leaveMin: number,
  hours: number[]
): string | null {
  if (hours.length === 0 || hourPct.length !== hours.length) return null;
  const endMin = leaveMin + rec.stats.minutes;
  for (let i = 0; i + 1 < hours.length; i++) {
    const a = hourPct[i];
    const b = hourPct[i + 1];
    if (a < NO_SHADE_PCT || b >= NO_SHADE_PCT) continue;
    const span = (hours[i + 1] - hours[i]) * 60;
    const at = hours[i] * 60 + (span * (a - NO_SHADE_PCT)) / (a - b);
    if (at < leaveMin || at > endMin) continue;
    return t("card.warnNoShade", { time: fmtTime(Math.floor(at / STEP_MIN) * STEP_MIN) });
  }
  return null;
}

// --- the whole card set, read from the SELECTED card ----------------------

/** What every card on the sheet says once one of them is the one selected.
 *
 *  `deltaMin`, `altNote` and the reason line are all written against the
 *  RECOMMENDATION by the planner (plan.ts) and the shell — which is right
 *  for the first look, and wrong the moment the reader taps an alternative.
 *  The promoted walk then wore the recommendation's reason ("shade first ·
 *  afternoon sun" on a card the shade-first search did not pick), the
 *  demoted one read "0 min", and the third card's delta was still measured
 *  from a walk no longer on top (UX sweep U1).
 *
 *  So the set is recomputed here, from whichever card is selected:
 *  - the big card's reason line is the preference's only while the
 *    recommendation IS the selection. An alternative is by definition not
 *    the argmax of that preference, so it has NO reason line: it wore
 *    "Your pick for this route" from UX sweep U1 until Viktor asked for the
 *    subtitle to go (backlog B8, CR-03 A5) — a card the reader tapped does
 *    not need telling who tapped it. The sentence stays in the catalog for
 *    the preference sheet, which still uses it for a manual choice.
 *  - every other card's minutes are re-based on the selection (`others`,
 *    the peek button's own arithmetic since CR-01 F5), so "+5 min" is what
 *    that walk costs FROM HERE.
 *  - and its note is the cost of taking it from here too, which is
 *    `altNote` against the selected card rather than against cands[0].
 *
 *  Tags are untouched: `kind` is what a walk IS — the preset that found it,
 *  or the axis it won on — not where it sits in the list, and the
 *  recommendation stays the recommendation after it is demoted. */
export type CardSetEntry<T> = {
  /** Position in the ORIGINAL list — what `onSelect` is given. */
  index: number;
  /** The candidate with `deltaMin` re-based on the selection. */
  cand: T;
  /** The cost of taking this one instead of the selected one (§1.1). */
  note: string;
};

export type CardSet<T> = {
  /** The selection, clamped to the list. */
  index: number;
  /** The card on top. Untouched — its own delta is not drawn. */
  big: T;
  /** The line beside its tag: the reason the CLOCK or the preference gives,
   *  or null on a card the reader promoted themselves (CR-03 A5). */
  why: string | null;
  /** The delta cards, in list order, without the selected one. */
  rest: CardSetEntry<T>[];
};

type SetCandidate = NoteCandidate & { kind: string; deltaMin: number };

export function cardSet<T extends SetCandidate>(
  cands: T[],
  selected: number,
  reason: string,
  opts: { night?: boolean; wander?: boolean } = {}
): CardSet<T> | null {
  const index = selected >= 0 && selected < cands.length ? selected : 0;
  const big = cands[index];
  if (big === undefined) return null;
  const rebased = others(cands, index);
  const rest: CardSetEntry<T>[] = [];
  let k = 0;
  for (let i = 0; i < cands.length; i++) {
    if (i === index) continue;
    const cand = rebased[k++];
    rest.push({ index: i, cand, note: altNote(big, cand, noteAxis(cand.kind), opts) });
  }
  return { index, big, why: index === 0 ? reason : null, rest };
}
