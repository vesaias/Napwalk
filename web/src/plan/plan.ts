// The planning layer (UI redesign Task 6, 2026-09-05): one recommended
// route plus up to two alternatives, each with its card numbers. planAB
// runs the A→B leg the debug App has used since 2026-08-28 under three
// presets (the preference, FASTEST, and the other axis) and keeps the
// legs that differ enough to be worth a second card; planLoops labels
// what the loop planner returns. Pure over the graph — the caller owns
// the pins, the clock and the settings.
import type { LngLat } from "../components/MapView";
import {
  edgeCost,
  route,
  SPEED_M_PER_MIN,
  type Daylight,
  type Preset,
  type RouteLeg,
} from "../router/astar";
import { snapEnds, snapToEdge, toXY, type Graph, type Snap } from "../router/graph";
import { inPark } from "../router/composer";
import { loops } from "../router/loops";
import { COBBLE_Q, routeStats, type RouteStats } from "../router/stats";
import { altTag, type AltTag } from "./cardCopy";
import { sunMinutes } from "./hours";
import { FASTEST, presetFor, type Preference } from "./preference";
import { hardFilter, type Settings } from "./settings";

export type CandidateKind = "recommended" | "faster" | "shadier" | "quieter" | "parkLoop";
export type Candidate = {
  kind: CandidateKind;
  eids: number[];
  nodes: number[];
  meters: number;
  stats: RouteStats; // minutes/km over the full walk; shade/quiet/cobble over eids
  sunMin: number;
  deltaMin: number; // minutes relative to the recommended route
  tail?: [number, number][]; // last routing node → destination snap point (A→B only)
  laps?: number;
  walkKind?: string;
  park?: number;
  /** Share of the loop's length inside a park (composer.ts `parkShare`),
   *  when the walk came from the composer. Undefined for A→B legs and for
   *  the PSP / quiet-street loops, which measure no park. */
  parkShare?: number;
};
export type PlanResult = {
  recommended: Candidate;
  alternatives: Candidate[];
  pref: Preference;
  startMin: number;
  head: [number, number][]; // start pin's snap point → first routing node
  tail: [number, number][]; // last routing node → destination snap point
  connectors: [number, number][][]; // pin → snap point, when the pin is off the graph
};

/** Two legs closer than this (Jaccard over edge sets) are the same walk. */
const SAME_WALK_JACCARD = 0.85;
/** A pin further than this from its snap point gets a drawn connector. */
const CONNECTOR_M = 4;
const MAX_ALTERNATIVES = 2;
/** Half the length inside a park makes a loop a "Park loop" (SPEC §1.1).
 *  Only the composer measures it; a street loop never reaches it. */
const PARK_LOOP_SHARE = 0.5;

/** A routed leg plus the piece of the destination edge walked from the
 *  last routing node to the pin: its polyline (`tail`) and its metres. */
type Leg = RouteLeg & { tail: [number, number][]; alongM: number };

/** One A→B leg. Routes to whichever END of the destination's snapped edge
 *  is cheaper once the walk back along that edge to the pin is counted —
 *  snapToEdge picks its node by geometry alone and sent the router past
 *  the pin and back on 38.6 % of pins (Ammelburgstraße, 2026-08-28). */
export function abLeg(
  g: Graph,
  s: number,
  snapD: Snap,
  startMin: number,
  preset: Preset,
  extra: ((eid: number) => number) | undefined
): Leg | null {
  let best: Leg | null = null;
  let bestTotal = Infinity;
  for (const end of snapEnds(g, snapD)) {
    const leg = route(g, s, end.node, startMin, preset, extra);
    if (!leg) continue;
    const eLen = g.lenDm[snapD.eid] / 10;
    const full = snapD.eid >= 0
      ? edgeCost(g, snapD.eid, startMin + leg.meters / SPEED_M_PER_MIN, preset, 0)
      : 0;
    const partial = isFinite(full) && eLen > 0 ? full * (end.alongM / eLen) : 0;
    const total = leg.cost + partial;
    if (total < bestTotal) {
      bestTotal = total;
      best = { ...leg, tail: [...end.tail].reverse(), alongM: end.alongM };
    }
  }
  return best;
}

/** Metres between two lng/lat points in the graph's metre frame. */
function farM(a: [number, number], b: [number, number]): number {
  const [ax, ay] = toXY(a[0], a[1]);
  const [bx, by] = toXY(b[0], b[1]);
  return Math.hypot(ax - bx, ay - by);
}

/** Card numbers for a leg. `alongM` is the partial destination edge (not
 *  in `eids`): it counts towards metres, minutes and km, while shade,
 *  quiet and cobble percentages stay over the routed edges. `recMinutes`
 *  is the recommended route's duration; omitted for the recommended
 *  route itself (delta 0). */
function candidate(g: Graph, kind: CandidateKind, leg: RouteLeg, alongM: number, startMin: number, recMinutes?: number, day?: Daylight): Candidate {
  const meters = leg.meters + alongM;
  const stats = routeStats(g, leg.eids, startMin, day);
  stats.minutes = Math.round(meters / SPEED_M_PER_MIN);
  stats.km = Math.round(meters / 100) / 10;
  return {
    kind,
    eids: leg.eids,
    nodes: leg.nodes,
    meters,
    stats,
    sunMin: sunMinutes(g, leg.eids, startMin, day),
    deltaMin: recMinutes === undefined ? 0 : stats.minutes - recMinutes,
  };
}

function jaccard(a: number[], b: Set<number>): number {
  let inter = 0;
  for (const e of a) if (b.has(e)) inter++;
  const union = a.length + b.size - inter;
  return union > 0 ? inter / union : 1;
}

/** Presets for the alternatives (SPEC §1): the FASTEST leg, and the best
 *  leg on the axis the reader did NOT ask for — shade → quiet, quiet →
 *  shade, balanced → both, since balanced asked for neither. */
function alternativePresets(pref: Preference, s: Settings, night: boolean, day?: Daylight): { kind: CandidateKind; preset: Preset }[] {
  const out: { kind: CandidateKind; preset: Preset }[] = [{ kind: "faster", preset: { ...FASTEST, access: s.access, day } }];
  if (pref !== "quiet") out.push({ kind: "quieter", preset: presetFor("quiet", s, night, day) });
  // no shade to gain after dark
  if (pref !== "shade" && !night) out.push({ kind: "shadier", preset: presetFor("shade", s, night, day) });
  return out;
}

export function planAB(g: Graph, start: LngLat, dest: LngLat, startMin: number, pref: Preference, s: Settings, night = false, day?: Daylight): PlanResult | null {
  const snapS = snapToEdge(g, start[0], start[1]);
  const snapD = snapToEdge(g, dest[0], dest[1]);
  const extra = hardFilter(g, s);
  const recLeg = abLeg(g, snapS.node, snapD, startMin, presetFor(pref, s, night, day), extra);
  if (!recLeg) return null;
  const recommended = candidate(g, "recommended", recLeg, recLeg.alongM, startMin, undefined, day);
  recommended.tail = recLeg.tail;
  const recSet = new Set(recLeg.eids);

  // The badge names what the walk BUYS, and SPEC §1.1 fixes the price:
  // −2 min, +10 points of shade, +10 points of quiet. Below that the
  // difference is noise and the card is dropped rather than mislabelled
  // ("Quieter · 48 % quiet" beside a recommendation at 49 %, live
  // 2026-09-06). Two cards never wear the same tag.
  const alternatives: Candidate[] = [];
  const tagged = new Set<AltTag>();
  // Every walk already on the sheet, the recommendation included: two
  // presets can return the SAME path (balanced asks both axes, and a street
  // that is quiet is often the shaded one), and shipping it twice under two
  // tags is the same lie the thresholds were meant to stop. The tag set
  // alone does not catch it — the second copy is offered a different tag.
  const shown = [recSet];
  for (const { kind, preset } of alternativePresets(pref, s, night, day)) {
    if (alternatives.length === MAX_ALTERNATIVES) break;
    const leg = abLeg(g, snapS.node, snapD, startMin, preset, extra);
    if (!leg) continue;
    if (shown.some((seen) => jaccard(leg.eids, seen) > SAME_WALK_JACCARD)) continue;
    const c = candidate(g, kind, leg, leg.alongM, startMin, recommended.stats.minutes, day);
    const tag = altTag(recommended, c, { night });
    if (tag === null || tagged.has(tag)) continue;
    c.kind = tag;
    tagged.add(tag);
    c.tail = leg.tail;
    alternatives.push(c);
    shown.push(new Set(leg.eids));
  }

  const connectors: [number, number][][] = [];
  if (farM(start, snapS.point) > CONNECTOR_M) connectors.push([start, snapS.point]);
  if (farM(dest, snapD.point) > CONNECTOR_M) connectors.push([dest, snapD.point]);
  return { recommended, alternatives, pref, startMin, head: snapS.tail, tail: recLeg.tail, connectors };
}

/** The composer's walks (composer.ts Walk) carry their kind, park and
 *  lap count; PSP/quiet loops carry none of it. */
function withLoopMeta(c: Candidate, l: RouteLeg): Candidate {
  const w = l as RouteLeg & { kind?: string; laps?: number; park?: number; parkShare?: number };
  if (w.kind !== undefined) c.walkKind = w.kind;
  if (w.parkShare !== undefined) c.parkShare = w.parkShare;
  if (w.kind === "laps") {
    c.laps = w.laps;
    c.park = w.park;
  }
  return c;
}

/** What a return leg pays for a street the outbound leg already walked: a
 *  rate addend, in the units `edgeCost` adds `extra` in (a plain sidewalk
 *  rates about 1). A discouragement, never a wall — a place at the end of a
 *  cul-de-sac has to be walked back out of, and psp.ts learned the same
 *  lesson the expensive way (FORBID_FLOOR). */
const RETRACE_RATE = 2;

/** One way round the via's own edge: the node the walk arrives at, the node
 *  it leaves from, and the edge between them. `eid` −1 is a via that snapped
 *  to a junction, which has no edge to cross. */
type Crossing = { eid: number; from: number; to: number };

/** The preset pairs a loop-via is planned from: out under one axis, home
 *  under the other, so the two halves are different streets by intent and
 *  not only by the retrace price. */
function viaCombos(pref: Preference, s: Settings, night: boolean, day?: Daylight): { out: Preset; back: Preset }[] {
  const main = presetFor(pref, s, night, day);
  const other = presetFor(pref === "shade" ? "quiet" : "shade", s, night, day);
  const fast: Preset = { ...FASTEST, access: s.access };
  return [
    { out: main, back: other },
    { out: other, back: main },
    { out: fast, back: main },
  ];
}

/** The same street, whichever way it is walked. Reverse edges have their own
 *  ids, so two walks that use the identical streets in opposite directions
 *  share NO edge id and look, to `jaccard`, like two different walks. That is
 *  exactly what the loop-via combos produce: "out on the shaded axis, home on
 *  the quiet one" and its mirror are the same loop walked backwards.
 *  Canonicalising each id to the lower of the pair collapses them.
 *
 *  Only planLoopsVia uses it. planAB and planLoops compare walks that share a
 *  direction of travel, and folding direction there would change what two
 *  shipped screens offer, for no case anyone has reported. */
function canonEids(g: Graph, eids: number[]): number[] {
  return eids.map((e) => {
    const rev = g.revEdge[e];
    return rev >= 0 && rev < e ? rev : e;
  });
}

/** How much of a walk is spent inside a park, as a share of its length — what
 *  SPEC §1.1's `Park loop` tag is read off. The composer measures it for the
 *  walks IT builds; a stitched loop-via is built by `route()`, which knows
 *  nothing about parks, so it is measured here from the same per-edge test
 *  (`composer.inPark`: green AND off the roadway — the rim street beside a
 *  park is not the park). */
function parkShareOf(g: Graph, eids: number[], meters: number): number {
  if (meters <= 0) return 0;
  let parkM = 0;
  for (const e of eids) if (inPark(g, e)) parkM += g.lenDm[e] / 10;
  return parkM / meters;
}

/** W3, "Loop via a place": a walk that starts and ends where you are and
 *  passes through a place you picked.
 *
 *  The router has no via constraint — `loops()` composes walks from a start
 *  node and nothing else, and neither the composer nor the PSP planner can be
 *  told to go through a point — so this is a there-and-back: the leg out under
 *  one preference axis, the leg home under the other, with every street the
 *  outbound leg used priced up on the way back, stitched into one candidate.
 *  Recorded in DECISIONS.md 2026-09-07; the day the router grows a via
 *  constraint this becomes a call into it.
 *
 *  The walk REACHES the place rather than the nearest junction to it: the
 *  via's own snapped edge is WALKED, end to end, between the two legs (fix
 *  round 1, finding 2 — the line used to stop short by up to an edge length,
 *  and those metres went uncounted). `planAB` solves the same problem with a
 *  `tail` polyline, which only works at an END of a line: `routeLine` takes
 *  one head and one tail and has nowhere to splice a detour into the middle.
 *  Putting the edge in `eids` instead puts the place on the drawn line AND its
 *  metres, shade and surface into the stats.
 *
 *  There is no `durationMin`, deliberately: with a via the PLACE sets the
 *  length of the walk, so a duration would be a number the plan could not
 *  honour. */
export function planLoopsVia(
  g: Graph,
  start: LngLat,
  via: LngLat,
  startMin: number,
  pref: Preference,
  s: Settings,
  night = false,
  day?: Daylight
): PlanResult | null {
  const snapS = snapToEdge(g, start[0], start[1]);
  const snapV = snapToEdge(g, via[0], via[1]);
  // A via on the doorstep is not a loop; say so rather than return a walk of
  // no length at all.
  if (snapS.node === snapV.node) return null;
  const wall = hardFilter(g, s);

  // The crossing of the via's own edge, either way round: which end the walk
  // arrives at is a choice. A pin that snapped to a node rather than an edge
  // has no crossing to make.
  const crossings: Crossing[] = [];
  if (snapV.eid >= 0) {
    const a = g.edgeSource[snapV.eid];
    const b = g.edgeTarget[snapV.eid];
    crossings.push({ eid: snapV.eid, from: a, to: b });
    const rev = g.revEdge[snapV.eid];
    if (rev >= 0) crossings.push({ eid: rev, from: b, to: a });
  } else {
    crossings.push({ eid: -1, from: snapV.node, to: snapV.node });
  }

  /** One preset combo over one crossing: there, across, and home again. */
  const legFor = (x: Crossing, out: Preset, back: Preset): RouteLeg | null => {
    const there = route(g, snapS.node, x.from, startMin, out, wall);
    if (!there) return null;
    const crossM = x.eid >= 0 ? g.lenDm[x.eid] / 10 : 0;
    // A cobbled via edge is a wall like any other: `hardFilter` returns
    // Infinity for it and the crossing is refused, so "avoid cobbles" is
    // obeyed on the one edge no search costed.
    const crossCost =
      x.eid >= 0
        ? edgeCost(g, x.eid, startMin + there.meters / SPEED_M_PER_MIN, out, wall ? wall(x.eid) : 0)
        : 0;
    if (!Number.isFinite(crossCost)) return null;
    // Rule 4: the way home is costed from the minute the walker LEAVES the
    // place — the outbound leg's elapsed plus the crossing itself.
    const atVia = startMin + (there.meters + crossM) / SPEED_M_PER_MIN;
    const used = new Set<number>();
    const remember = (e: number) => {
      used.add(e);
      // both directions of a street are the same street to walk down twice
      const rev = g.revEdge[e];
      if (rev >= 0) used.add(rev);
    };
    for (const e of there.eids) remember(e);
    if (x.eid >= 0) remember(x.eid);
    const home = route(g, x.to, snapS.node, atVia, back, (eid) =>
      (wall ? wall(eid) : 0) + (used.has(eid) ? RETRACE_RATE : 0)
    );
    if (!home) return null;
    return {
      nodes:
        x.eid >= 0
          ? [...there.nodes, x.to, ...home.nodes.slice(1)]
          : [...there.nodes, ...home.nodes.slice(1)],
      eids: x.eid >= 0 ? [...there.eids, x.eid, ...home.eids] : [...there.eids, ...home.eids],
      meters: there.meters + crossM + home.meters,
      cost: there.cost + crossCost + home.cost,
    };
  };

  // Which way round the edge is crossed used to be settled per COMBO, by
  // routing both and keeping the cheaper: three combos x two crossings x two
  // legs = up to twelve `route()` calls for one tap on "Loop via", half of
  // them thrown away, and ~950 ms of frozen main thread on Frankfurt (final
  // review I3). It is settled ONCE now, by the combo the recommendation is
  // built from; the other two reuse the crossing it picked. Eight calls
  // where there were twelve, and the recommended walk is bit-identical to
  // what searching everything returned — it IS that search.
  //
  // Not by geometry, which is the cheaper fix (six calls) and was tried:
  // d(start, a) + the edge + d(b, start) is the same sum whichever way round
  // the edge is walked, so a straight line cannot tell the two orders apart.
  // Measured on Frankfurt it took an Ostpark loop from 99 minutes to 130.
  // Recorded in DECISIONS.md 2026-09-07.
  const combos = viaCombos(pref, s, night, day);
  let chosen: Crossing | null = null;
  let first: RouteLeg | null = null;
  for (const x of crossings) {
    const leg = legFor(x, combos[0].out, combos[0].back);
    if (leg && (first === null || leg.cost < first.cost)) {
      first = leg;
      chosen = x;
    }
  }
  const legs: RouteLeg[] = [];
  if (first !== null && chosen !== null) {
    legs.push(first);
    for (const { out, back } of combos.slice(1)) {
      const leg = legFor(chosen, out, back);
      if (leg) legs.push(leg);
    }
  } else {
    // The first combo found no walk either way round — its outbound axis is
    // walled off. The rest still get the full search rather than no loop at
    // all; this is the rare path, and it is the old cost.
    for (const { out, back } of combos.slice(1)) {
      let best: RouteLeg | null = null;
      for (const x of crossings) {
        const leg = legFor(x, out, back);
        if (leg && (best === null || leg.cost < best.cost)) best = leg;
      }
      if (best) legs.push(best);
    }
  }
  if (legs.length === 0) return null;

  const withPark = (c: Candidate): Candidate => {
    c.parkShare = parkShareOf(g, c.eids, c.meters);
    return c;
  };
  const recommended = withPark(candidate(g, "recommended", legs[0], 0, startMin));
  // The same thresholds every other card obeys (SPEC §1.1), and the same park
  // rule the composer's loops get: half the length inside a park is a Park
  // loop whatever else the walk is.
  const alternatives: Candidate[] = [];
  const tagged = new Set<AltTag>();
  // `Park loop` is a tag like any other, and two cards never wear the same
  // one (final review M6): a second walk over the threshold takes its axis
  // tag instead, or gets no card at all.
  // Only among the ALTERNATIVES: the recommendation wears `recommended`,
  // never `Park loop`, so it does not spend the tag.
  let parkTaken = false;
  const shown = [new Set(canonEids(g, legs[0].eids))];
  for (const leg of legs.slice(1)) {
    if (alternatives.length === MAX_ALTERNATIVES) break;
    const canon = canonEids(g, leg.eids);
    if (shown.some((seen) => jaccard(canon, seen) > SAME_WALK_JACCARD)) continue;
    const c = withPark(candidate(g, "shadier", leg, 0, startMin, recommended.stats.minutes));
    if (!parkTaken && (c.parkShare ?? 0) >= PARK_LOOP_SHARE) {
      c.kind = "parkLoop";
      parkTaken = true;
      alternatives.push(c);
      shown.push(new Set(canon));
      continue;
    }
    const tag = altTag(recommended, c, { night });
    if (tag === null || tagged.has(tag)) continue;
    c.kind = tag;
    tagged.add(tag);
    alternatives.push(c);
    shown.push(new Set(canon));
  }

  const connectors: [number, number][][] = [];
  if (farM(start, snapS.point) > CONNECTOR_M) connectors.push([start, snapS.point]);
  if (farM(via, snapV.point) > CONNECTOR_M) connectors.push([via, snapV.point]);
  return {
    recommended,
    alternatives,
    pref,
    startMin,
    head: snapS.tail,
    tail: [...snapS.tail].reverse(),
    connectors,
  };
}

export function planLoops(g: Graph, start: LngLat, durationMin: number, startMin: number, pref: Preference, s: Settings, night = false, day?: Daylight): PlanResult | null {
  const snapS = snapToEdge(g, start[0], start[1]);
  // loops() has no extraCost hook (settings.ts hardFilter): post-filter instead
  let found = loops(g, snapS.node, durationMin, startMin, presetFor(pref, s, night, day));
  if (s.avoidCobbles) found = found.filter((l) => l.eids.every((e) => g.surfaceQ[e] < COBBLE_Q));
  if (found.length === 0) return null;

  const recommended = withLoopMeta(candidate(g, "recommended", found[0], 0, startMin), found[0]);
  // SPEC §1.1 loop cards: a walk that spends half its length in a park is
  // a "Park loop" whatever else it is; the rest earn the same axis tags —
  // and the same thresholds — as an A->B alternative, or no card at all.
  const alternatives: Candidate[] = [];
  const tagged = new Set<AltTag>();
  // ...and one Park loop card, for the reason above: two cards both reading
  // `Park loop` say nothing about either of them, which is what this file's
  // own "two cards never wear the same tag" was written against. Live on W1
  // (final review M6).
  // Only among the ALTERNATIVES: the recommendation wears `recommended`,
  // never `Park loop`, so it does not spend the tag.
  let parkTaken = false;
  for (const l of found.slice(1, 1 + MAX_ALTERNATIVES)) {
    const c = withLoopMeta(candidate(g, "shadier", l, 0, startMin, recommended.stats.minutes), l);
    if (!parkTaken && (c.parkShare ?? 0) >= PARK_LOOP_SHARE) {
      c.kind = "parkLoop";
      parkTaken = true;
      alternatives.push(c);
      continue;
    }
    const tag = altTag(recommended, c, { night });
    if (tag === null || tagged.has(tag)) continue;
    c.kind = tag;
    tagged.add(tag);
    alternatives.push(c);
  }

  const connectors: [number, number][][] = [];
  if (farM(start, snapS.point) > CONNECTOR_M) connectors.push([start, snapS.point]);
  return { recommended, alternatives, pref, startMin, head: snapS.tail, tail: [...snapS.tail].reverse(), connectors };
}
