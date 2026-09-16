import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n/t";
import {
  altNote,
  altTag,
  barLabels,
  cardSet,
  moreLabel,
  others,
  noteAxis,
  reasonLine,
  warning,
} from "./cardCopy";

const SUNSET = 20 * 60 + 7; // Frankfurt, 2026-09-02

beforeEach(() => setLocale("en"));

/** A candidate as the copy rules see it: minutes against the recommendation,
 *  the three percentages, the minutes in the sun. */
function cand(o: {
  kind?: string;
  deltaMin?: number;
  shadePct?: number;
  quietPct?: number;
  cobbleM?: number;
  sunMin?: number;
  loudPct?: number;
  climbM?: number;
}) {
  return {
    kind: o.kind ?? "recommended",
    deltaMin: o.deltaMin ?? 0,
    sunMin: o.sunMin ?? 0,
    loudPct: o.loudPct,
    climbM: o.climbM,
    stats: {
      minutes: 21,
      km: 1.7,
      shadePct: o.shadePct ?? 50,
      quietPct: o.quietPct ?? 50,
      cobbleM: o.cobbleM ?? 0,
    },
  };
}

describe("reasonLine (SPEC §1.1)", () => {
  // The three examples the spec prints, reproduced exactly.
  it("writes the spec's first example: shade first · afternoon sun", () => {
    expect(
      reasonLine({ pref: "shade", auto: true, startMin: 14 * 60, sunsetMin: SUNSET, leaveNow: true })
    ).toBe("shade first · afternoon sun");
  });

  it("writes the spec's second example: quiet first · your pick · at 19:30", () => {
    expect(
      reasonLine({
        pref: "quiet",
        auto: false,
        startMin: 19 * 60 + 30,
        sunsetMin: SUNSET,
        leaveNow: false,
      })
    ).toBe("quiet first · your pick · at 19:30");
  });

  it("writes the spec's third example: balanced, alone", () => {
    // 16:30: the automatic rule picks balanced and names no hours for it
    expect(
      reasonLine({ pref: "balanced", auto: true, startMin: 16 * 60 + 30, sunsetMin: SUNSET, leaveNow: true })
    ).toBe("balanced");
  });

  it("names the evening only between 18:00 and sunset", () => {
    const at = (m: number) =>
      reasonLine({ pref: "quiet", auto: true, startMin: m, sunsetMin: SUNSET, leaveNow: true });
    expect(at(18 * 60)).toBe("quiet first · evening quiet");
    expect(at(20 * 60)).toBe("quiet first · evening quiet");
    // past sunset the sun is the reason, not the evening
    expect(at(SUNSET)).toBe("quiet first · low sun");
  });

  it("calls it low sun before 11:00 and after sunset", () => {
    expect(
      reasonLine({ pref: "balanced", auto: true, startMin: 9 * 60, sunsetMin: SUNSET, leaveNow: true })
    ).toBe("balanced · low sun");
    expect(
      reasonLine({ pref: "balanced", auto: true, startMin: 22 * 60, sunsetMin: SUNSET, leaveNow: true })
    ).toBe("balanced · low sun");
  });

  it("appends the departure whenever it is not now, with or without a why", () => {
    expect(
      reasonLine({ pref: "shade", auto: true, startMin: 14 * 60, sunsetMin: SUNSET, leaveNow: false })
    ).toBe("shade first · afternoon sun · at 14:00");
    expect(
      reasonLine({ pref: "balanced", auto: true, startMin: 17 * 60, sunsetMin: SUNSET, leaveNow: false })
    ).toBe("balanced · at 17:00");
  });

  it("speaks German from the German catalog", () => {
    setLocale("de");
    expect(
      reasonLine({ pref: "shade", auto: true, startMin: 14 * 60, sunsetMin: SUNSET, leaveNow: false })
    ).toBe("Schatten zuerst · Nachmittag · um 14:00");
  });
});

describe("altTag thresholds (SPEC §1.1)", () => {
  const rec = cand({ shadePct: 60, quietPct: 60 });

  it("gives Faster only at two minutes or more", () => {
    expect(altTag(rec, cand({ kind: "faster", deltaMin: -2 }))).toBe("faster");
    expect(altTag(rec, cand({ kind: "faster", deltaMin: -5 }))).toBe("faster");
    expect(altTag(rec, cand({ kind: "faster", deltaMin: -1 }))).toBeNull();
    expect(altTag(rec, cand({ kind: "faster", deltaMin: 3 }))).toBeNull();
  });

  it("gives Shadier and Quieter only at ten points", () => {
    expect(altTag(rec, cand({ kind: "shadier", shadePct: 70 }))).toBe("shadier");
    expect(altTag(rec, cand({ kind: "shadier", shadePct: 69 }))).toBeNull();
    expect(altTag(rec, cand({ kind: "quieter", quietPct: 70 }))).toBe("quieter");
    expect(altTag(rec, cand({ kind: "quieter", quietPct: 69 }))).toBeNull();
  });

  it("takes another axis when the one it was routed for falls short", () => {
    // routed for quiet, not quieter — but four minutes faster
    expect(altTag(rec, cand({ kind: "quieter", deltaMin: -4, quietPct: 61 }))).toBe("faster");
  });

  it("keeps the axis it was routed for when both qualify", () => {
    expect(altTag(rec, cand({ kind: "quieter", deltaMin: -4, quietPct: 80 }))).toBe("quieter");
  });

  it("withholds the shade axis after sunset", () => {
    expect(altTag(rec, cand({ kind: "shadier", shadePct: 90 }), { night: true })).toBeNull();
    expect(altTag(rec, cand({ kind: "shadier", shadePct: 90 }))).toBe("shadier");
  });
});

describe("altNote costs (SPEC §1.1)", () => {
  it("leads with sun at five minutes and one and a half times the recommendation", () => {
    const rec = cand({ sunMin: 4 });
    expect(altNote(rec, cand({ sunMin: 9 }), "faster")).toBe("9 min in full sun");
    // 5 min but only 1.25x: not the story
    expect(altNote(cand({ sunMin: 4 }), cand({ sunMin: 5 }), "faster")).not.toContain("full sun");
    // 3x but under five minutes: not worth a line either
    expect(altNote(cand({ sunMin: 1 }), cand({ sunMin: 4 }), "faster")).not.toContain("full sun");
  });

  it("names cobbles at a hundred metres more, and adds the + when the walk already has some", () => {
    expect(altNote(cand({}), cand({ cobbleM: 120 }), "quieter")).toBe("120 m cobbles");
    expect(altNote(cand({ cobbleM: 50 }), cand({ cobbleM: 150 }), "quieter")).toBe("+100 m cobbles");
    expect(altNote(cand({}), cand({ cobbleM: 90, quietPct: 88 }), "quieter")).toBe("88 % quiet");
  });

  it("names loud streets at fifteen points, when a stat carries them", () => {
    const rec = cand({ loudPct: 10 });
    expect(altNote(rec, cand({ loudPct: 31 }), "quieter")).toBe("31 % loud streets");
    expect(altNote(rec, cand({ loudPct: 20, quietPct: 88 }), "quieter")).toBe("88 % quiet");
    // no loud share on either side: the rule stays silent
    expect(altNote(cand({}), cand({ quietPct: 88 }), "quieter")).toBe("88 % quiet");
  });

  it("names the climb at fifteen metres, on Wander only and only with elevation", () => {
    const rec = cand({ climbM: 5 });
    expect(altNote(rec, cand({ climbM: 27 }), "shadier", { wander: true })).toBe("+22 m climb");
    expect(altNote(rec, cand({ climbM: 27, shadePct: 71 }), "shadier")).toBe("71 % shade");
    expect(altNote(cand({}), cand({ shadePct: 71 }), "shadier", { wander: true })).toBe("71 % shade");
  });

  it("falls back to the gain on the tag's own axis", () => {
    expect(altNote(cand({}), cand({ quietPct: 88 }), "quieter")).toBe("88 % quiet");
    expect(altNote(cand({}), cand({ shadePct: 71 }), "shadier")).toBe("71 % shade");
    expect(altNote(cand({}), cand({ shadePct: 71 }), "faster")).toBe("71 % shade");
    expect(altNote(cand({}), cand({ shadePct: 71 }), "shadier", { night: true })).toBe("after sunset");
  });

  it("routes recommended and park loops onto the shade axis", () => {
    expect(noteAxis("recommended")).toBe("shadier");
    expect(noteAxis("parkLoop")).toBe("shadier");
    expect(noteAxis("faster")).toBe("faster");
    expect(noteAxis("quieter")).toBe("quieter");
  });
});

describe("altNote rule order (§1.1: 'the first that applies')", () => {
  // Every fixture below trips TWO rules at once. Each assertion names the
  // EARLIER rule, so swapping that pair in altNote turns the test red — the
  // order is the claim, and testing each rule alone cannot make it.
  it("sun comes before cobbles", () => {
    const rec = cand({ sunMin: 2, cobbleM: 0 });
    const alt = cand({ sunMin: 9, cobbleM: 300 });
    expect(altNote(rec, alt, "faster")).toBe("9 min in full sun");
  });

  it("cobbles come before loud streets", () => {
    // sun disarmed on both sides so only rules 2 and 3 are live
    const rec = cand({ sunMin: 0, cobbleM: 0, loudPct: 5 });
    const alt = cand({ sunMin: 0, cobbleM: 300, loudPct: 40 });
    expect(altNote(rec, alt, "quieter")).toBe("300 m cobbles");
  });

  it("loud streets come before the climb", () => {
    const rec = cand({ sunMin: 0, cobbleM: 0, loudPct: 5, climbM: 0 });
    const alt = cand({ sunMin: 0, cobbleM: 0, loudPct: 40, climbM: 30 });
    expect(altNote(rec, alt, "shadier", { wander: true })).toBe("40 % loud streets");
  });

  it("the climb comes before the gain", () => {
    const rec = cand({ climbM: 0, shadePct: 40 });
    const alt = cand({ climbM: 22, shadePct: 71 });
    expect(altNote(rec, alt, "shadier", { wander: true })).toBe("+22 m climb");
  });
});

describe("moreLabel (SPEC §3b, the peek snap's second button)", () => {
  const rec = cand({ shadePct: 68, quietPct: 74 });
  const MINUS = "−";

  it("is nothing at all when there is nothing under the fold", () => {
    expect(moreLabel(rec, [])).toBeNull();
  });

  it("names the best time saving, with a real minus sign", () => {
    const alts = [cand({ kind: "faster", deltaMin: -4 }), cand({ deltaMin: 2 })];
    expect(moreLabel(rec, alts)).toBe(`2 more · ${MINUS}4 min ▴`);
  });

  it("counts every surviving alternative, not the ones that are quicker", () => {
    const alts = [cand({ deltaMin: -1 }), cand({ deltaMin: -3 }), cand({ deltaMin: 5 })];
    expect(moreLabel(rec, alts)).toBe(`3 more · ${MINUS}3 min ▴`);
  });

  it("falls back to the non-time win when nothing is quicker", () => {
    const alts = [cand({ kind: "quieter", deltaMin: 2, quietPct: 90 })];
    expect(moreLabel(rec, alts)).toBe("1 more · +2 min quieter ▴");
    const shadier = [cand({ kind: "shadier", deltaMin: 3, shadePct: 90 })];
    expect(moreLabel(rec, shadier)).toBe("1 more · +3 min shadier ▴");
  });

  // after sunset the shade axis is not a measurement anyone took — the same
  // withholding `altTag` makes
  it("does not claim shade after sunset", () => {
    const alts = [cand({ kind: "shadier", deltaMin: 3, shadePct: 90 })];
    expect(moreLabel(rec, alts, { night: true })).toBe("1 more ▴");
  });

  it("says only the count when no axis clears its threshold", () => {
    const alts = [cand({ deltaMin: 1, shadePct: 70, quietPct: 75 })];
    expect(moreLabel(rec, alts)).toBe("1 more ▴");
  });

  it("says only the count when the win costs nothing to take", () => {
    // §1.1 would badge it "Quieter", but "+0 min quieter" is not a trade
    const alts = [cand({ kind: "quieter", deltaMin: 0, quietPct: 90 })];
    expect(moreLabel(rec, alts)).toBe("1 more ▴");
  });
});

// CR-01 review F5. The peek button is read beside the card the sheet is
// showing, so both halves of it are relative to that card — not to the
// recommendation, which may not be on screen at all.
describe("others (what a drag would buy, from the card on screen)", () => {
  const MINUS = "−";
  const cands = [
    cand({ shadePct: 68, quietPct: 74 }), // the recommendation, deltaMin 0
    cand({ kind: "faster", deltaMin: -4 }),
    cand({ kind: "quieter", deltaMin: 3, quietPct: 90 }),
  ];

  it("is a no-op while the recommendation is the card on screen", () => {
    expect(others(cands, 0)).toEqual(cands.slice(1));
    expect(moreLabel(cands[0], others(cands, 0))).toBe(`2 more · ${MINUS}4 min ▴`);
  });

  it("drops the selected card from the count", () => {
    expect(others(cands, 1)).toHaveLength(2);
    expect(others(cands, 2)).toHaveLength(2);
  });

  it("re-bases the minutes on the selected card, sign and all", () => {
    // The 4-minutes-quicker alternative is showing: the other two are now
    // 4 and 7 minutes SLOWER than what the reader is looking at, so the
    // button stops promising a saving and names what the extra minutes buy
    // — measured against the card on screen, whose 50 % shade the
    // recommendation's 68 beats. Before the fix it read "2 more · −4 min",
    // a saving over a walk that had left the screen.
    expect(others(cands, 1).map((c) => c.deltaMin)).toEqual([4, 7]);
    expect(moreLabel(cands[1], others(cands, 1))).toBe("2 more · +4 min shadier ▴");
  });

  it("leaves the candidates it was given untouched", () => {
    const before = cands.map((c) => c.deltaMin);
    others(cands, 1);
    expect(cands.map((c) => c.deltaMin)).toEqual(before);
  });

  it("is empty, and so is the button, when the plan found only one walk", () => {
    const one = [cands[0]];
    expect(others(one, 0)).toEqual([]);
    expect(moreLabel(one[0], others(one, 0))).toBeNull();
  });
});

describe("bars", () => {
  it("prints both percentages by day and names the dark by night", () => {
    const c = cand({ shadePct: 68, quietPct: 74 });
    expect(barLabels(c, false)).toEqual({ shade: "68 % shade", quiet: "74 % quiet" });
    expect(barLabels(c, true)).toEqual({ shade: "after sunset", quiet: "74 % quiet" });
  });

  // Review F2: only the LABEL changes after sunset. barLabels is the whole
  // of the night rule — it reads nothing that could scale a meter, so the
  // fill the card draws stays the walk's real share, which is true.
  it("does not touch the numbers the meters are drawn from", () => {
    const c = cand({ shadePct: 100, quietPct: 40 });
    expect(barLabels(c, true).shade).toBe("after sunset");
    expect(c.stats.shadePct).toBe(100);
  });

  // CR-01 edit 3 gave the compact card a bare "68 %"; CR-03 Q7 gives the
  // words back, so both cards now read the same pair and `shortBarLabels`
  // is gone. Which half of it is bold is kit/Bars.tsx's business — it
  // splits at the % — and e2e/sheets.spec.ts is where that is checked.
  it("gives the peek snap's compact card the same labelled pair", () => {
    const c = cand({ shadePct: 68, quietPct: 74 });
    expect(barLabels(c, false)).toEqual({ shade: "68 % shade", quiet: "74 % quiet" });
  });
});

const SHADE_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

describe("warning", () => {
  const walk = (minutes: number) => ({ stats: { minutes } });
  // A ten-hour window, 10…19. The curve crosses 20 % between 17:00 (60 %) and
  // 18:00 (0 %) — two thirds of the way, 17:40.
  const profile = [80, 80, 80, 80, 80, 80, 80, 60, 0, 0];

  it("reports the ten-minute step at which the walk runs out of shade", () => {
    expect(warning(walk(60), profile, 17 * 60, SHADE_HOURS)).toBe("no shade after 17:40");
  });

  it("stays quiet when the crossing falls outside the walk", () => {
    // a twenty-minute walk leaving at 17:00 is home before 17:40
    expect(warning(walk(20), profile, 17 * 60, SHADE_HOURS)).toBeNull();
    // and one leaving at 18:00 is already in the sun — the bar says so
    expect(warning(walk(60), profile, 18 * 60, SHADE_HOURS)).toBeNull();
  });

  it("stays quiet on a walk that keeps its shade, and on a profile that never landed", () => {
    expect(warning(walk(90), [80, 80, 80, 80, 80, 80, 80, 80, 80, 80], 17 * 60, SHADE_HOURS)).toBeNull();
    expect(warning(walk(90), [], 17 * 60, SHADE_HOURS)).toBeNull();
    expect(warning(walk(90), [80, 0], 17 * 60, SHADE_HOURS)).toBeNull();
    // ...and a day with no daylight hours in it at all
    expect(warning(walk(90), [], 17 * 60, [])).toBeNull();
  });

  it("reads the crossing off the window it was given (CR-03 A3)", () => {
    // the same curve on a June window: the bars start five hours earlier, so
    // the crossing moves with them
    const june = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
    const pct = [80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 60, 0, 0, 0, 0, 0];
    expect(warning(walk(60), pct, 16 * 60, june)).toBe("no shade after 16:40");
  });
});

describe("cardSet: the whole set is read from the selected card (UX sweep U1)", () => {
  // The plan the sweep repro produced: a shade-first recommendation, a
  // faster walk five minutes under it, and a quieter one eight over.
  const REC = cand({ kind: "recommended", deltaMin: 0, shadePct: 76, quietPct: 56 });
  const FAST = cand({ kind: "faster", deltaMin: -5, shadePct: 55, quietPct: 50 });
  const QUIET = cand({ kind: "quieter", deltaMin: 8, shadePct: 60, quietPct: 88 });
  const PLAN = [REC, FAST, QUIET];
  const REASON = "shade first · afternoon sun";

  it("leaves the first look exactly as the planner wrote it", () => {
    const set = cardSet(PLAN, 0, REASON);
    expect(set?.index).toBe(0);
    expect(set?.why).toBe(REASON);
    expect(set?.rest.map((e) => e.index)).toEqual([1, 2]);
    expect(set?.rest.map((e) => e.cand.deltaMin)).toEqual([-5, 8]);
  });

  it("re-bases every other card's minutes on the promoted one", () => {
    const set = cardSet(PLAN, 1, REASON);
    expect(set?.big).toBe(FAST);
    // the demoted recommendation now costs the five minutes it saves…
    expect(set?.rest[0]).toMatchObject({ index: 0, cand: { deltaMin: 5 } });
    // …and the third card re-bases from +8 to +13, not "still +8"
    expect(set?.rest[1]).toMatchObject({ index: 2, cand: { deltaMin: 13 } });
  });

  // CR-03 A5 / backlog B8: not the preference's reason, and not a reason of
  // its own either. The card wore "Your pick for this route" from UX sweep U1
  // until Viktor asked for the subtitle to go — a card the reader tapped does
  // not need telling who tapped it.
  it("puts no reason at all on a card the reader promoted", () => {
    expect(cardSet(PLAN, 1, REASON)?.why).toBeNull();
    expect(cardSet(PLAN, 2, REASON)?.why).toBeNull();
    // ...and the recommendation keeps its own
    expect(cardSet(PLAN, 0, REASON)?.why).toBe(REASON);
  });

  it("writes each note as the cost of taking that walk INSTEAD of this one", () => {
    // from the recommendation, the quiet walk's gain is its quiet share
    expect(cardSet(PLAN, 0, REASON)?.rest[1].note).toBe("88 % quiet");
    // from the quiet walk, the recommendation's own line is its shade
    expect(cardSet(PLAN, 2, REASON)?.rest[0].note).toBe("76 % shade");
  });

  it("clamps a selection the plan no longer has, and refuses an empty plan", () => {
    expect(cardSet(PLAN, 7, REASON)?.index).toBe(0);
    expect(cardSet([], 0, REASON)).toBe(null);
  });

  it("agrees with the peek button, which re-bases the same way", () => {
    const set = cardSet(PLAN, 1, REASON);
    expect(set?.rest.map((e) => e.cand)).toEqual(others(PLAN, 1));
  });
});
