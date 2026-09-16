import { describe, it, expect, afterEach } from "vitest";
import { fmtTime, deltaLabel, pct, num1, int } from "./format";
import { setLocale } from "../../i18n/t";
import { km } from "../time";

// U+2212 MINUS SIGN — the typographic minus the design uses, never a hyphen.
const MINUS = "−";
// U+202F NARROW NO-BREAK SPACE — DIN 5008 / SI spacing before the % sign.
const NNBSP = " ";

describe("fmtTime", () => {
  it("formats minutes since midnight as HH:MM", () => {
    expect(fmtTime(840)).toBe("14:00");
    expect(fmtTime(1259)).toBe("20:59");
  });

  it("pads both fields to two digits", () => {
    expect(fmtTime(0)).toBe("00:00");
    expect(fmtTime(9)).toBe("00:09");
    expect(fmtTime(540)).toBe("09:00");
  });

  it("wraps at and past midnight", () => {
    expect(fmtTime(1439)).toBe("23:59");
    expect(fmtTime(1440)).toBe("00:00");
    expect(fmtTime(1500)).toBe("01:00");
    expect(fmtTime(2880)).toBe("00:00");
  });

  it("wraps negative minutes back into the day", () => {
    expect(fmtTime(-60)).toBe("23:00");
    expect(fmtTime(-1)).toBe("23:59");
  });

  it("rounds fractional minutes", () => {
    expect(fmtTime(845.4)).toBe("14:05");
    expect(fmtTime(845.6)).toBe("14:06");
    expect(fmtTime(1439.6)).toBe("00:00");
  });

  it("falls back to midnight for non-finite input", () => {
    expect(fmtTime(NaN)).toBe("00:00");
    expect(fmtTime(Infinity)).toBe("00:00");
  });
});

describe("deltaLabel", () => {
  it("prefixes a typographic minus for a saving", () => {
    expect(deltaLabel(-4)).toBe(`${MINUS}4 min`);
    expect(deltaLabel(-13)).toBe(`${MINUS}13 min`);
  });

  it("prefixes a plus for a cost", () => {
    expect(deltaLabel(2)).toBe("+2 min");
    expect(deltaLabel(3)).toBe("+3 min");
  });

  it("uses no sign at all for zero", () => {
    expect(deltaLabel(0)).toBe("0 min");
    expect(deltaLabel(-0)).toBe("0 min");
  });

  it("never emits an ASCII hyphen", () => {
    expect(deltaLabel(-4)).not.toContain("-");
  });

  it("rounds to whole minutes, dropping a rounded-away sign", () => {
    expect(deltaLabel(-2.6)).toBe(`${MINUS}3 min`);
    expect(deltaLabel(2.4)).toBe("+2 min");
    expect(deltaLabel(-0.4)).toBe("0 min");
    expect(deltaLabel(0.4)).toBe("0 min");
  });

  it("falls back to zero for non-finite input", () => {
    expect(deltaLabel(NaN)).toBe("0 min");
  });
});

describe("pct", () => {
  it("renders a rounded percentage with a narrow no-break space", () => {
    expect(pct(68)).toBe(`68${NNBSP}%`);
    expect(pct(67.6)).toBe(`68${NNBSP}%`);
    expect(pct(0)).toBe(`0${NNBSP}%`);
    expect(pct(100)).toBe(`100${NNBSP}%`);
  });

  it("uses a narrow no-break space, not a plain one", () => {
    expect(pct(68)).not.toBe("68 %");
    expect(pct(68)).not.toBe("68%");
  });

  it("clamps out-of-range values", () => {
    expect(pct(-3)).toBe(`0${NNBSP}%`);
    expect(pct(140)).toBe(`100${NNBSP}%`);
  });

  it("falls back to zero for non-finite input", () => {
    expect(pct(NaN)).toBe(`0${NNBSP}%`);
  });
});

describe("num1 / int (QA F4-01: numbers follow the catalog's language)", () => {
  afterEach(() => setLocale("en"));

  it("writes one decimal with the English point", () => {
    setLocale("en");
    expect(num1(2.3)).toBe("2.3");
    expect(num1(3)).toBe("3.0");
    expect(num1(0)).toBe("0.0");
  });

  it("writes one decimal with the German comma", () => {
    setLocale("de");
    expect(num1(2.3)).toBe("2,3");
    expect(num1(3)).toBe("3,0");
  });

  it("groups whole numbers the way each language does", () => {
    setLocale("en");
    expect(int(1200)).toBe("1,200");
    expect(int(940)).toBe("940");
    setLocale("de");
    expect(int(1200)).toBe("1.200");
    expect(int(940)).toBe("940");
  });

  it("rounds and survives non-finite input", () => {
    setLocale("en");
    expect(int(940.6)).toBe("941");
    expect(num1(NaN)).toBe("0.0");
    expect(int(Infinity)).toBe("0");
  });

  it("keeps percentages whole in both languages", () => {
    setLocale("de");
    expect(pct(68)).toBe(`68${NNBSP}%`);
  });
});

describe("km (QA F4-01)", () => {
  afterEach(() => setLocale("en"));

  it("rounds metres to one decimal of a kilometre, in the reader's language", () => {
    setLocale("en");
    expect(km(2340)).toBe("2.3");
    expect(km(3000)).toBe("3.0");
    setLocale("de");
    expect(km(2340)).toBe("2,3");
    expect(km(3000)).toBe("3,0");
  });
});
