import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BREAKPOINTS, isPhone, isWeb, layoutFor, sideways, type Layout } from "./breakpoints";

describe("layoutFor", () => {
  it("is the phone frame below 768", () => {
    for (const w of [320, 390, 430, 767]) {
      expect(layoutFor(w, false)).toBe("phone");
      // a list does not buy a panel on a phone
      expect(layoutFor(w, true)).toBe("phone");
    }
  });

  it("is the tablet card from 768 to 1439, list or not", () => {
    for (const w of [768, 1024, 1280, 1439]) {
      expect(layoutFor(w, false)).toBe("tablet");
      expect(layoutFor(w, true)).toBe("tablet");
    }
  });

  it("is the desktop card at 1440 with no list", () => {
    expect(layoutFor(1440, false)).toBe("desktop-card");
    expect(layoutFor(2560, false)).toBe("desktop-card");
  });

  it("is the full-height panel at 1440 once a list is showing", () => {
    expect(layoutFor(1440, true)).toBe("desktop-panel");
    expect(layoutFor(2560, true)).toBe("desktop-panel");
  });

  it("switches exactly on the breakpoint, not a pixel either side", () => {
    expect(layoutFor(BREAKPOINTS.web - 1, false)).toBe("phone");
    expect(layoutFor(BREAKPOINTS.web, false)).toBe("tablet");
    expect(layoutFor(BREAKPOINTS.desktop - 1, true)).toBe("tablet");
    expect(layoutFor(BREAKPOINTS.desktop, true)).toBe("desktop-panel");
  });

  it("calls everything but the two phones web", () => {
    const all: Layout[] = [
      "phone",
      "phone-landscape",
      "tablet",
      "desktop-card",
      "desktop-panel",
    ];
    expect(all.filter(isWeb)).toEqual(["tablet", "desktop-card", "desktop-panel"]);
    expect(all.filter(isPhone)).toEqual(["phone", "phone-landscape"]);
  });
});

describe("the phone on its side (CR-03 Q4, SPEC §3b)", () => {
  it("is the landscape frame once the viewport is short, at ANY width", () => {
    // The phones people actually hold sideways, measured in css px:
    //   667 × 375  iPhone SE / 6 / 7 / 8
    //   744 × 390  the board's own frame
    //   812 × 375  iPhone X / 11 Pro / 12 mini
    //   844 × 390  iPhone 12 / 13 / 14
    // The last two are ≥ 768 WIDE and used to reach the tablet card, whose
    // Start button then sat 121 px below a 375 px fold (S5 review F3).
    for (const w of [667, 744, 812, 844, 852, 896, 932]) {
      expect(layoutFor(w, false, true), `${w} × short`).toBe("phone-landscape");
      expect(layoutFor(w, true, true), `${w} × short, wants a panel`).toBe("phone-landscape");
    }
  });

  it("does not follow a screen asking for a panel — there is only one panel", () => {
    expect(layoutFor(744, true, true)).toBe(layoutFor(744, false, true));
  });

  it("takes a squashed desktop window with it — accepted collateral (F3)", () => {
    // The ruling is a HEIGHT and nothing else, so a 1024 × 480 browser
    // window is a landscape frame too. That is the answer we want there:
    // 480 px of height cannot hold a floating card with its buttons at the
    // bottom, and a 300 px panel beside a map can.
    expect(layoutFor(1024, false, true)).toBe("phone-landscape");
    expect(layoutFor(1440, true, true)).toBe("phone-landscape");
  });

  it("leaves every TALL viewport exactly where it was", () => {
    // The ruling moved one boundary and no other: nothing that is not short
    // changed answer.
    expect(layoutFor(768, false, false)).toBe("tablet");
    expect(layoutFor(1024, false, false)).toBe("tablet");
    expect(layoutFor(1440, true, false)).toBe("desktop-panel");
    expect(layoutFor(1440, false, false)).toBe("desktop-card");
  });

  it("gives a short viewport the phone's own defaults (CR-03 A2)", () => {
    // plan/settings.ts turns shade OFF for `isPhone`. A first run at
    // 844 × 390 is an iPhone 14 on its side and must get that default; it
    // read as a tablet before the ruling and turned shade on.
    expect(isPhone(layoutFor(844, false, true))).toBe(true);
    expect(isPhone(layoutFor(844, false, false))).toBe(false);
  });

  it("is not a portrait phone with the soft keyboard up", () => {
    // Android Chrome resizes the LAYOUT viewport for the keyboard by
    // default, so a 390 x 844 phone typing into the report sheet reports
    // 390 x 444: short, and still upright. It kept its bottom sheets and
    // its modal card before CR-03 Q4 and must keep them after it — the
    // landscape panel put Send off the bottom of the screen (found by the
    // CR-03 regression run, e2e/report-states.spec.ts).
    expect(sideways(390, 444)).toBe(false);
    expect(sideways(390, 400)).toBe(false);
    expect(layoutFor(390, false, sideways(390, 444))).toBe("phone");
    // ...and the same viewport turned over is the frame Q4 is about
    expect(sideways(444, 390)).toBe(true);
    expect(layoutFor(444, false, sideways(444, 390))).toBe("phone-landscape");
  });

  it("states the rule as a height AND an orientation", () => {
    // Every phone from the list above, on its side and upright.
    for (const [w, h] of [[667, 375], [744, 390], [812, 375], [844, 390], [932, 430]] as const) {
      expect(sideways(w, h), `${w} x ${h}`).toBe(true);
      expect(sideways(h, w), `${h} x ${w}`).toBe(false);
    }
    // Tall is never sideways, whichever way round it is.
    expect(sideways(1440, 900)).toBe(false);
    expect(sideways(900, 1440)).toBe(false);
    // The squashed desktop window is still collateral: it is wider than it
    // is tall, so it stays in the landscape frame (F3's accepted answer).
    expect(sideways(1024, 480)).toBe(true);
    // A square viewport counts as on its side: `>=`, so 500 x 500 is the
    // last one in and 499 x 500 the first one out.
    expect(sideways(500, 500)).toBe(true);
    expect(sideways(499, 500)).toBe(false);
    expect(sideways(600, 501)).toBe(false);
  });

  it("is the upright phone at exactly one pixel taller than short", () => {
    // The rule is the media query `(max-height: 500px)`, which the caller
    // has already evaluated: what is pinned here is that nothing else in
    // layoutFor moves when it flips.
    expect(layoutFor(390, false, true)).toBe("phone-landscape");
    expect(layoutFor(390, false, false)).toBe("phone");
    expect(BREAKPOINTS.short).toBe(500);
  });

  it("defaults to upright when no height is offered", () => {
    expect(layoutFor(390, false)).toBe("phone");
  });
});

/** The boolean AppShell hands `layoutFor` (`wantsPanel`), named per screen so
 *  the rule reads the way the boards state it. */
const PANEL = true;
const CARD = false;

describe("which screens earn the full-height panel (SPEC §7, boards W-*)", () => {
  it("gives Routes and Loops the panel on a desktop", () => {
    // W-routes and W-wander: 408 px, left edge, floor to ceiling.
    expect(layoutFor(1440, PANEL)).toBe("desktop-panel");
    expect(layoutFor(1920, PANEL)).toBe("desktop-panel");
  });

  it("keeps the walk on the card while Steps is out (review F2)", () => {
    // SPEC §7 hangs the navigate banner at `left: 428` = 408 + a 20 px
    // gutter, which only a panel at x=0 leaves — but it draws that panel
    // around the STEPS LIST, and Steps is out by the 2026-09-06 ruling.
    // Slice 8 gave the walk the panel anyway and shipped 780 px of empty
    // white; the walk is a card, and the banner is offset from the card.
    expect(layoutFor(1440, CARD)).toBe("desktop-card");
    expect(layoutFor(1024, CARD)).toBe("tablet");
  });

  it("keeps Settings a content-height card at every width (slice 1, W-settings)", () => {
    // A page of short rows in a 900 px panel was 500 px of empty white.
    expect(layoutFor(1024, CARD)).toBe("tablet");
    expect(layoutFor(1440, CARD)).toBe("desktop-card");
    expect(layoutFor(2560, CARD)).toBe("desktop-card");
  });

  it("grows the card rather than a panel on a tablet, whatever is showing", () => {
    // W-tablet draws the routes RESULTS inside the 360 px card: the panel is
    // a desktop affordance, and 768–1439 never gets one.
    expect(layoutFor(768, PANEL)).toBe("tablet");
    expect(layoutFor(1439, PANEL)).toBe("tablet");
  });
});

describe("the breakpoint the stylesheet repeats", () => {
  // Only the task-15 block: everything before it is the phone frame and the
  // debug page, whose own breakpoints are none of this rule's business.
  const MARKER = "/* ---- web layout (task 15) ---- */";
  const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf(MARKER));

  it("has a block to check", () => {
    expect(css).toContain(MARKER);
  });

  it("writes the desktop breakpoint verbatim — a media query cannot read a constant", () => {
    // Moved here and left there, and the frame switches its chrome at one
    // width and its CSS at another.
    expect(block).toContain(`@media (min-width: ${BREAKPOINTS.desktop}px)`);
  });

  it("needs no query for the web breakpoint: the card exists only where WebLayout drew it", () => {
    expect(block).not.toContain(`min-width: ${BREAKPOINTS.web}px`);
  });

  it("has no third breakpoint hiding in the block", () => {
    const found = [...block.matchAll(/@media \(min-width:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect([...new Set(found)]).toEqual([BREAKPOINTS.desktop]);
  });
});
