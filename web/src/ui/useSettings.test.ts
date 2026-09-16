import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../plan/settings";
import { bootSettings, defaultCitySettings, patchSettings, relaxSettings } from "./useSettings";

/** What localStorage held before the link was opened. */
const STORED: Settings = { ...DEFAULT_SETTINGS, city: "frankfurt", access: "stroller" };

describe("bootSettings", () => {
  it("lays a link's overrides over the stored record without touching it", () => {
    const pair = bootSettings(STORED, { city: "nyc", access: "wheelchair" });
    expect(pair.session.city).toBe("nyc");
    expect(pair.session.access).toBe("wheelchair");
    expect(pair.persisted).toEqual(STORED);
  });

  // review B-3: `ac=` is a link parameter now, and `false` is a value
  it("lays the link's cobble wall over the stored one, in both directions", () => {
    const walled: Settings = { ...STORED, avoidCobbles: true };
    expect(bootSettings(walled, { avoidCobbles: false }).session.avoidCobbles).toBe(false);
    expect(bootSettings(walled, { avoidCobbles: false }).persisted.avoidCobbles).toBe(true);
    expect(bootSettings(STORED, { avoidCobbles: true }).session.avoidCobbles).toBe(true);
    // and a link that carries none leaves the setting alone
    expect(bootSettings(walled, {}).session.avoidCobbles).toBe(true);
  });

  it("is the stored record twice over without a link", () => {
    const pair = bootSettings(STORED, {});
    expect(pair.session).toEqual(STORED);
    expect(pair.persisted).toEqual(STORED);
  });
});

describe("patchSettings", () => {
  it("changes both records", () => {
    const pair = patchSettings(bootSettings(STORED, {}), { theme: "dark" });
    expect(pair.persisted.theme).toBe("dark");
    expect(pair.session.theme).toBe("dark");
  });

  // review B1: this is the bug. One record, merged from whatever was last
  // rendered, meant a theme tap wrote someone else's city into your storage.
  it("never writes back a link's city or access", () => {
    const boot = bootSettings(STORED, { city: "nyc", access: "wheelchair" });
    const after = patchSettings(boot, { theme: "dark" });
    expect(after.persisted.city).toBe("frankfurt");
    expect(after.persisted.access).toBe("stroller");
    // and the session keeps showing the link's city while it is open
    expect(after.session.city).toBe("nyc");
    expect(after.session.access).toBe("wheelchair");
    expect(after.session.theme).toBe("dark");
  });

  it("never writes back a relax", () => {
    let pair = bootSettings({ ...STORED, avoidCobbles: true }, {});
    pair = relaxSettings(pair, { avoidCobbles: false, access: "walk" });
    pair = patchSettings(pair, { locale: "de" });
    expect(pair.persisted.avoidCobbles).toBe(true);
    expect(pair.persisted.access).toBe("stroller");
    expect(pair.persisted.locale).toBe("de");
    expect(pair.session.avoidCobbles).toBe(false);
    expect(pair.session.access).toBe("walk");
  });

  it("does write back the city the reader picked in the city sheet", () => {
    const boot = bootSettings(STORED, { city: "nyc" });
    const after = patchSettings(boot, { city: "hamburg" });
    expect(after.persisted.city).toBe("hamburg");
    expect(after.session.city).toBe("hamburg");
  });
});

describe("relaxSettings", () => {
  it("returns the persisted record by identity, so it cannot drift", () => {
    const boot = bootSettings(STORED, {});
    const after = relaxSettings(boot, { avoidCobbles: false });
    expect(after.persisted).toBe(boot.persisted);
  });
});

describe("the invariant applySettings rests on", () => {
  // The hook hands saveSettings the PERSISTED record, which also applies the
  // locale, the pace and the theme. That is only sound while those three are
  // patch-only — a link and a relax may set city, access and avoidCobbles and
  // nothing else.
  it("leaves locale, pace and theme identical in both records", () => {
    let pair = bootSettings(STORED, { city: "nyc", access: "wheelchair" });
    pair = relaxSettings(pair, { avoidCobbles: false, access: "walk" });
    for (const k of ["locale", "pace", "theme"] as const) {
      expect(pair.session[k]).toBe(pair.persisted[k]);
    }
  });
});

// backlog B1: the edge's late answer to "which city is this?"
describe("defaultCitySettings", () => {
  it("moves the city in BOTH records, so the two cannot disagree", () => {
    const boot = bootSettings({ ...DEFAULT_SETTINGS, city: "frankfurt" }, {});
    const after = defaultCitySettings(boot, "paris");
    expect(after.session.city).toBe("paris");
    expect(after.persisted.city).toBe("paris");
  });

  // S7 review F2: the guess must not become a choice on the reader's next
  // unrelated settings change. `cityChosen` is what saveSettings reads.
  it("leaves the city a GUESS, so an unrelated settings change stores none", () => {
    const boot = bootSettings({ ...DEFAULT_SETTINGS, city: "frankfurt" }, {}, false);
    const after = defaultCitySettings(boot, "paris");
    expect(after.cityChosen).toBe(false);
    expect(patchSettings(after, { theme: "dark" }).cityChosen).toBe(false);
  });

  it("...and picking a city IS a choice, for that patch and every one after", () => {
    const boot = bootSettings({ ...DEFAULT_SETTINGS, city: "frankfurt" }, {}, false);
    const picked = patchSettings(defaultCitySettings(boot, "paris"), { city: "hamburg" });
    expect(picked.cityChosen).toBe(true);
    expect(picked.persisted.city).toBe("hamburg");
    expect(patchSettings(picked, { theme: "dark" }).cityChosen).toBe(true);
    // a session override laid on afterwards changes neither
    expect(relaxSettings(picked, { access: "walk" }).cityChosen).toBe(true);
  });

  it("a reader who already had a stored city is chosen from the start", () => {
    const boot = bootSettings(STORED, {}, true);
    expect(boot.cityChosen).toBe(true);
    // ...and a link's city is still only a session override
    expect(bootSettings(STORED, { city: "nyc" }, true).persisted.city).toBe("frankfurt");
  });

  it("touches nothing else", () => {
    const boot = bootSettings({ ...DEFAULT_SETTINGS, access: "walk", pace: "brisk" }, {});
    const after = defaultCitySettings(boot, "sf");
    for (const k of ["access", "pace", "theme", "locale", "autoPref"] as const) {
      expect(after.persisted[k]).toBe(boot.persisted[k]);
      expect(after.session[k]).toBe(boot.session[k]);
    }
  });
});
