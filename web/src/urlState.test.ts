import { describe, expect, it } from "vitest";
import { decodeState, encodeState, type ShareState } from "./urlState";

const FULL: ShareState = {
  city: "frankfurt",
  mode: "loop",
  minutes: 615,
  preset: "maxShade",
  access: "stroller",
  duration: 45,
  start: [8.68215, 50.11092],
  dest: null,
  selected: 1,
};

describe("urlState", () => {
  it("roundtrips loop state", () => {
    const back = decodeState(encodeState(FULL));
    expect(back.mode).toBe("loop");
    expect(back.minutes).toBe(615);
    expect(back.preset).toBe("maxShade");
    expect(back.duration).toBe(45);
    expect(back.start).toEqual([8.68215, 50.11092]);
    expect(back.selected).toBe(1);
  });

  it("roundtrips ab state with destination", () => {
    const s: ShareState = { ...FULL, mode: "ab", dest: [8.7, 50.12], selected: 0 };
    const back = decodeState(encodeState(s));
    expect(back.mode).toBe("ab");
    expect(back.dest).toEqual([8.7, 50.12]);
    expect(back.selected).toBeUndefined(); // 0 omitted -> default
  });

  it("rejects junk, and keeps an out-of-town pin for the planner to refuse", () => {
    const back = decodeState("m=evil&t=9999&p=turbo&d=17&s=13.4,52.5&e=abc&r=9");
    // every junk parameter is dropped; the Berlin pin under no c= is not
    // (QA F1-01 — dropping it left the shell on Home with no message)
    expect(back).toEqual({ start: [13.4, 52.5] });
  });

  it("snaps minutes to the 15-min grid", () => {
    expect(decodeState("t=617").minutes).toBe(615);
  });
});

describe("urlState city", () => {
  // S7 review F1: it used to be OMITTED for the default city, which left
  // every Frankfurt share link carrying pins and no city — and B1's boot
  // could not then tell it from a link that named no city at all.
  it("always writes the city, the default one included", () => {
    expect(encodeState(FULL)).toContain("c=frankfurt");
    expect(decodeState(encodeState(FULL)).city).toBe("frankfurt");
  });

  it("still reads a link written before that, city and all", () => {
    const old = "m=ab&t=840&p=maxShade&s=8.65000,50.11000&e=8.70000,50.12000";
    expect(decodeState(old).city).toBeUndefined();
    expect(decodeState(old).start).toEqual([8.65, 50.11]);
  });

  it("roundtrips a non-default city", () => {
    const s: ShareState = { ...FULL, city: "berlin", start: [13.405, 52.52], dest: null };
    const qs = encodeState(s);
    expect(qs).toContain("c=berlin");
    const back = decodeState(qs);
    expect(back.city).toBe("berlin");
    expect(back.start).toEqual([13.405, 52.52]);
  });

  it("keeps pins that do not belong to the named city, for the planner to refuse", () => {
    // Frankfurt coordinates under c=berlin. Dropping them here (as this
    // parser used to) left the shell on Home with nothing to say — QA
    // F1-01/F2-03. The pin survives; planJob refuses the job and the
    // routes screen shows the "outside the city" card.
    const back = decodeState("c=berlin&m=loop&t=600&p=balanced&d=30&s=8.68215,50.11092");
    expect(back.city).toBe("berlin");
    expect(back.start).toEqual([8.68215, 50.11092]);
  });

  it("keeps pins outside every city's bounds, and with no c= at all", () => {
    // The F1-01 link: ~30 km south-west of Frankfurt, no c=
    const back = decodeState("s=8.2,49.9&e=8.21,49.91");
    expect(back.city).toBeUndefined();
    expect(back.start).toEqual([8.2, 49.9]);
    expect(back.dest).toEqual([8.21, 49.91]);
  });

  it("still refuses a coordinate that is not on the globe", () => {
    // MapLibre throws on these (QA F6-01); nothing downstream should see one
    expect(decodeState("s=999,-999").start).toBeUndefined();
    expect(decodeState("e=8.68,91").dest).toBeUndefined();
    expect(decodeState("s=181,50").start).toBeUndefined();
    expect(decodeState("s=180,90").start).toEqual([180, 90]);
  });

  it("falls back to the default for an unknown city", () => {
    expect(decodeState("c=atlantis").city).toBeUndefined();
    expect(encodeState({ ...FULL, city: "atlantis" as never })).toContain("c=frankfurt");
  });

  it("leaves minutes unset when the link carries no t (so the shell uses the clock)", () => {
    expect(decodeState("").minutes).toBeUndefined();
    expect(decodeState("c=frankfurt&s=8.68,50.11").minutes).toBeUndefined();
    expect(decodeState("t=").minutes).toBeUndefined();
    expect(decodeState("t=0").minutes).toBe(0);
  });
});

describe("urlState coordinate precision", () => {
  // encodeState writes toFixed(5); parseLngLat rounds to 1e-5. Five decimals
  // is ~1.1 m of latitude — finer than any fix, coarse enough that a link
  // stays short and stable.
  const AB = (start: [number, number], dest: [number, number], city = "frankfurt"): ShareState => ({
    city: city as ShareState["city"],
    mode: "ab",
    minutes: 840,
    preset: "balanced",
    access: "stroller",
    duration: 45,
    start,
    dest,
    selected: 0,
  });

  it("writes exactly five decimals, padding a round number", () => {
    const qs = encodeState(AB([8.7, 50.12], [8.68215, 50.11092]));
    expect(qs).toContain("s=8.70000%2C50.12000");
    expect(qs).toContain("e=8.68215%2C50.11092");
  });

  it("rounds a six-decimal link down to the five it keeps", () => {
    expect(decodeState("s=8.682153,50.110921").start).toEqual([8.68215, 50.11092]);
    expect(decodeState("s=8.682156,50.110926").start).toEqual([8.68216, 50.11093]);
  });

  it("round-trips a five-decimal pin unchanged, and is idempotent after that", () => {
    const s = AB([8.68215, 50.11092], [8.70271, 50.12913]);
    const once = decodeState(encodeState(s));
    expect(once.start).toEqual([8.68215, 50.11092]);
    expect(once.dest).toEqual([8.70271, 50.12913]);
    // a link that has been through the app twice is byte-identical
    const twice = encodeState({ ...s, start: once.start!, dest: once.dest! });
    expect(twice).toBe(encodeState(s));
  });

  it("loses at most ~1 m of a six-decimal pin", () => {
    const back = decodeState("s=8.682153,50.110921").start!;
    expect(Math.abs(back[0] - 8.682153)).toBeLessThan(1e-5);
    expect(Math.abs(back[1] - 50.110921)).toBeLessThan(1e-5);
  });

  it("keeps a western longitude negative, rounding half away from zero the way Math.round does", () => {
    // Math.round(-x.5) goes toward +∞, so -73.985715 → -73.98571 (not …72)
    expect(decodeState("c=nyc&s=-73.985715,40.74844").start).toEqual([-73.98571, 40.74844]);
    const qs = encodeState(AB([-73.98571, 40.74844], [-73.9787, 40.7681], "nyc"));
    expect(qs).toContain("c=nyc");
    expect(qs).toContain("s=-73.98571%2C40.74844");
    expect(decodeState(qs).start).toEqual([-73.98571, 40.74844]);
  });

  it("survives a pin written with no decimals at all", () => {
    expect(decodeState("s=8.7,50.12").start).toEqual([8.7, 50.12]);
    // No city box any more: a whole-degree pin well past Frankfurt still
    // decodes, and the routes screen is what says it is out of town.
    expect(decodeState("s=9,50").start).toEqual([9, 50]);
    expect(decodeState("s=9.01,50").start).toEqual([9.01, 50]);
  });
});

describe("the parameters the compact rework added (2026-09-06)", () => {
  it("accepts the new preset spellings and still writes the old ones", () => {
    // SPEC/handover 3.3 renames the presets; links made before it must open
    expect(decodeState("p=shade").preset).toBe("maxShade");
    expect(decodeState("p=quiet").preset).toBe("maxQuiet");
    expect(decodeState("p=balanced").preset).toBe("balanced");
    expect(decodeState("p=maxShade").preset).toBe("maxShade");
    expect(decodeState("p=sideways").preset).toBeUndefined();
    // and an inherited key is not a preset: `in` would have said yes to both
    expect(decodeState("p=toString").preset).toBeUndefined();
    expect(decodeState("p=__proto__").preset).toBeUndefined();
    expect(decodeState("p=constructor").preset).toBeUndefined();
    expect(encodeState(FULL)).toContain("p=maxShade");
  });

  it("names the Settings screen, which m cannot", () => {
    expect(decodeState("sc=settings").screen).toBe("settings");
    expect(decodeState("sc=nowhere").screen).toBeUndefined();
    expect(decodeState("").screen).toBeUndefined();
    // and it is only written when it is asked for
    expect(encodeState(FULL)).not.toContain("sc=");
    const qs = encodeState({ ...FULL, screen: "settings" });
    expect(qs).toContain("sc=settings");
    expect(decodeState(qs).screen).toBe("settings");
  });
});

// slice 6: W3's via and W2's "be back by" (handover 3.3, v= and bb=)
describe("a loop via a place, and the hour it comes back", () => {
  it("roundtrips v= and bb=", () => {
    const s: ShareState = { ...FULL, via: [8.7027, 50.1291], backBy: 15 * 60 + 30 };
    const qs = encodeState(s);
    expect(qs).toContain("v=8.70270%2C50.12910");
    expect(qs).toContain("bb=1530");
    const back = decodeState(qs);
    expect(back.via).toEqual([8.7027, 50.1291]);
    expect(back.backBy).toBe(15 * 60 + 30);
  });

  it("writes neither when there is neither, nor on an A→B link", () => {
    expect(encodeState(FULL)).not.toContain("v=");
    expect(encodeState(FULL)).not.toContain("bb=");
    // an A→B walk has a destination, not a via: `e=` carries it
    const ab = encodeState({ ...FULL, mode: "ab", dest: [8.7, 50.12], via: [8.7027, 50.1291], backBy: 900 });
    expect(ab).not.toContain("v=");
    expect(ab).not.toContain("bb=");
    expect(ab).toContain("e=8.70000%2C50.12000");
  });

  it("refuses an hour that is not one, and a via that is not a coordinate", () => {
    expect(decodeState("bb=2599").backBy).toBeUndefined();
    expect(decodeState("bb=1560").backBy).toBeUndefined();
    expect(decodeState("bb=930").backBy).toBeUndefined(); // not HHMM
    expect(decodeState("bb=soon").backBy).toBeUndefined();
    expect(decodeState("bb=0000").backBy).toBe(0); // midnight is an hour of the day
    expect(decodeState("v=999,-999").via).toBeUndefined();
    expect(decodeState("v=8.7").via).toBeUndefined();
    // ...and it lands on the five-minute grid the clock moves on
    expect(decodeState("bb=1532").backBy).toBe(15 * 60 + 30);
  });
});

// review B-3: a link reproduces the WALK, so the two settings that decide
// which routes exist are always pinned — never omitted because they happened
// to match some default.
describe("urlState — access and the cobble wall", () => {
  it("always writes a=, whatever the value", () => {
    expect(encodeState(FULL)).toContain("a=stroller");
    expect(encodeState({ ...FULL, access: "walk" })).toContain("a=walk");
    expect(encodeState({ ...FULL, access: "wheelchair" })).toContain("a=wheelchair");
  });

  it("writes ac= both ways, and only when the caller has the control", () => {
    expect(encodeState({ ...FULL, avoidCobbles: true })).toContain("ac=1");
    expect(encodeState({ ...FULL, avoidCobbles: false })).toContain("ac=0");
    // the debug page has no cobble switch and passes nothing
    expect(encodeState(FULL)).not.toContain("ac=");
  });

  it("round-trips both", () => {
    for (const access of ["walk", "stroller", "wheelchair"] as const) {
      for (const avoidCobbles of [true, false]) {
        const back = decodeState(encodeState({ ...FULL, access, avoidCobbles }));
        expect(back.access).toBe(access);
        expect(back.avoidCobbles).toBe(avoidCobbles);
      }
    }
  });

  it("ignores an ac= that is not a flag", () => {
    expect(decodeState("ac=yes").avoidCobbles).toBeUndefined();
    expect(decodeState("ac=").avoidCobbles).toBeUndefined();
    expect(decodeState("").avoidCobbles).toBeUndefined();
  });
});
