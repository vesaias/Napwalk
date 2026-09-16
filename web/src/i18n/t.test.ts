import { describe, expect, it } from "vitest";
import en from "./strings.en.json";
import de from "./strings.de.json";
import { t, setLocale } from "./t";

describe("i18n", () => {
  it("switches locale", () => {
    setLocale("de");
    expect(t("tab.wander")).toBe("Losziehen");
    setLocale("en");
    expect(t("card.inShade", { pct: 68 })).toBe("68 % in shade");
  });

  it("catalogs have identical keys", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });

  // The space before a % is U+202F (narrow no-break space) in both catalogs,
  // matching format.ts pct(). A plain space would let a line break there,
  // and no space at all is the other half of the same rule — card.stats read
  // "{shade}% shade" until Task 16. `npm run contrast` checks it too, so the
  // rule holds whether the catalogs are edited from a test run or a build.
  it("puts U+202F, and only U+202F, before every percent sign", () => {
    const offenders = [...Object.entries(en), ...Object.entries(de)].filter(([, v]) =>
      /(?<! )%/.test(v)
    );
    expect(offenders).toEqual([]);
  });
});
