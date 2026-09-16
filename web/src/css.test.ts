// Three rules in index.css that a screenshot cannot hold down, all from the
// pre-release QA round (2026-09-06). Read as text, the way tokens.test.ts
// reads tokens.css: jsdom has no layout, and the point of each rule is the
// declaration, not the pixels it produces on one emulated device.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CARD_H, PEEK_CHROME } from "./ui/sheetBudget";

// normalised: a Windows checkout may hand the file over with CRLF
const css = readFileSync(new URL("./index.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** The body of the `nth` (1-based) rule whose selector list is exactly
 *  `selector`, the first one unless a later one is asked for: `:root` is
 *  written twice below the prototype palette — the tab bar's derived
 *  height, and the panel rhythm. */
function rule(selector: string, nth = 1): string {
  let i = -1;
  for (let n = 0; n < nth; n++) {
    i = css.indexOf(`\n${selector} {`, i + 1);
    expect(i, `no rule ${n + 1} for ${selector}`).toBeGreaterThan(-1);
  }
  return css.slice(i + selector.length + 3, css.indexOf("}", i));
}

describe("index.css — phone chrome (QA F2-01)", () => {
  it("lifts the map's attribution control clear of the tab bar", () => {
    // The bar is opaque and painted over the control: the OSM credit was
    // invisible and every tap on the (i) hit the Settings tab instead.
    const r = rule('.shell[data-tabbar="true"] .maplibregl-ctrl-bottom-right');
    expect(r).toMatch(/bottom:\s*calc\(/);
    // --tabbar-h is the bar's whole height, safe-area inset included
    expect(r).toContain("var(--tabbar-h)");
  });
});

describe("index.css — safe-area insets (QA F4-04, SPEC §3/§4)", () => {
  it("pads every sheet 10 16 22 above the home indicator, not above the glass", () => {
    expect(rule(".kit-sheet")).toMatch(
      /padding:\s*10px var\(--sp-4\) calc\(22px \+ env\(safe-area-inset-bottom/
    );
  });

  // A phone on its side puts the notch down a LONG edge, and iOS reports it
  // as safe-area-inset-left or -right depending on which way it was turned.
  // Chromium never reports one — Playwright cannot set an inset and there is
  // no var to shim, because `env()` reads no custom property — so the rules
  // are asserted here rather than measured (S5 review F11). Every one has a
  // 0px fallback, which is what keeps every other device where it was.
  it("keeps the landscape panel, its rail and the map's controls out of the notch", () => {
    // the panel's own left padding, on top of the board's 12
    expect(rule(".shell--landscape .web-card")).toContain(
      "calc(12px + env(safe-area-inset-left, 0px))"
    );
    // the rail's first tab starts where the notch stops
    const rail = rule(".shell-rail");
    expect(rail).toContain("padding-left: env(safe-area-inset-left, 0px)");
    // ...and it is padding INSIDE the 300 px column, not a wider column
    expect(rail).toContain("box-sizing: border-box");
    // the two right-hand controls, for the other rotation
    expect(rule(".shell--landscape .web-controls")).toContain(
      "right: calc(var(--sp-4) + env(safe-area-inset-right, 0px))"
    );
    // ...the second of which is a two-selector rule, so it is read off the
    // stylesheet rather than through `rule()`'s single-selector lookup
    const floatRule = css.slice(css.indexOf(".shell--landscape .shell-layers--float,"));
    expect(floatRule.slice(0, floatRule.indexOf("}"))).toContain(
      "right: calc(var(--sp-4) + env(safe-area-inset-right, 0px))"
    );
  });

  it("clears the tab bar with the inset counted once, not twice", () => {
    // --tabbar-h already carries max(env(safe-area-inset-bottom), 10px):
    // adding the inset again here is the double-count QA F4-04 found.
    // Since CR-01 edit 5 the box that clears the bar asks --tabbar-now,
    // which is --tabbar-h while the bar is on screen and 0 while it is
    // sliding out — the inset still arrives exactly once, through the one
    // definition below.
    const r = rule(".kit-sheet--tabbar");
    expect(r).toContain("var(--tabbar-now)");
    expect(r).not.toContain("env(safe-area-inset-bottom");
    const root = rule(":root");
    expect(root).toContain("--tabbar-now: var(--tabbar-h)");
    expect(root).toContain("max(env(safe-area-inset-bottom, 0px), 10px)");
    // and the bar's height is DERIVED from its token, so the two cannot
    // desync the day --sz-tabbar moves again
    expect(root).toContain("var(--sz-tabbar)");
    expect(root).not.toMatch(/--tabbar-h:\s*calc\(\s*\d/);
  });

  it("hangs the top chrome off the app's one top inset: env(top) + 12", () => {
    // SPEC §3 — 12 px in a browser tab, ~56 px installed. --sp-3 is 12.
    expect(rule(".shell-top")).toMatch(
      /top:\s*calc\(env\(safe-area-inset-top, 0px\) \+ var\(--sp-3\)\)/
    );
    // and the boxes measured from under the 52 px search bar follow it
    expect(rule(".route-chips")).toContain("+ 74px");
    expect(rule(".shell-page")).toContain("+ 80px");
    // the outside banner sits 4 px under the bar (board HB-outside: bar at
    // 16, banner at 72), and says so in tokens rather than in one number
    const banner = rule(".edge-banner");
    expect(banner).toContain("env(safe-area-inset-top, 0px)");
    expect(banner).toContain("var(--sz-searchBar)");
    expect(banner).toContain("var(--sp-3)");
    expect(banner).toContain("var(--sp-1)");
  });

  it("builds the R4 header out of the safe area plus 8 (SPEC §3 R4 / §4)", () => {
    // 127 px in a browser tab, 171 installed = env(top) + 8 + 36 + 3 + 36
    // + 6 + 30 + 8. The panel is the top of the phone, so it pads over the
    // inset rather than hanging 12 px below it like the floating chrome.
    const r = rule(".route-header");
    expect(r).toContain("padding: calc(env(safe-area-inset-top, 0px) + var(--sp-2)) var(--sp-3) var(--sp-2)");
    expect(r).toContain("gap: 6px");
    expect(rule(".route-header-fields")).toContain("gap: 3px");
    expect(rule(".route-header-field")).toContain("height: var(--sz-abField)");
    expect(rule(".route-chips--header .kit-chip")).toContain("height: var(--sz-chipHeader)");
    // and no back arrow: the ✕ is the way out (SPEC §4)
    expect(css).not.toContain(".route-header-back");
  });

  it("paints the connector over the fields it runs into (review B-2)", () => {
    // the fields are position: relative (the hit-slop block) and come after
    // it in the DOM, so without a z-index their --c-well covers 6 of its 9 px
    expect(rule(".route-header-link")).toContain("z-index: 1");
  });

  it("keeps the header chips' hit slop out of the To field's (review B-1)", () => {
    // the shared rule grows every chip to 44, which on a 30 px chip reaches
    // 2.5 px up into the field above it — and the chip wins on DOM order
    expect(rule(".route-chips--header .kit-chip::before")).toContain(
      "height: max(100%, var(--sz-abField))"
    );
  });

  it("sizes the header's two glyphs from tokens (review B-7)", () => {
    // the ✕ is `--sz-closeGlyph` since round 3 item 11 — one token for the
    // three exits in the app (the sheet head's, this one, the Wander pill's)
    expect(rule(".route-header-close")).toContain("font-size: var(--sz-closeGlyph)");
    expect(rule(".kit-sheet-close")).toContain("font-size: var(--sz-closeGlyph)");
    expect(rule(".wander-head-clear")).toContain("font-size: var(--sz-closeGlyph)");
    // `rule()` matches the first selector list that starts a line, and
    // `.route-header-swap` also opens the shared box rule above; match the
    // standalone one directly (\s+ so a CRLF checkout still passes)
    expect(css).toMatch(/\n\.route-header-swap \{\s+font-size: var\(--sz-swapGlyph\);/);
    expect(css).not.toMatch(/font-size: 1[79]px/);
  });

  it("caps the A/B fields' hit slop so the two never overlap (review B8)", () => {
    // 36 px of paint 3 px apart: grown to 44 the two slops would overlap by
    // 5 px and the To field would take the From field's bottom edge. 39 is
    // the field plus the gap — exactly tangent, nothing between them.
    expect(rule(".route-header-field::before")).toContain("height: max(100%, 39px)");
  });

  it("makes the tab bar 56 px with the board's own padding", () => {
    const r = rule(".kit-tabbar");
    expect(r).toContain("min-height: var(--sz-tabbar)");
    expect(r).toContain("padding: 6px var(--sp-2) max(env(safe-area-inset-bottom, 0px), 10px)");
  });
});

describe("index.css — the two scrolling pages (B9, S1 review F6)", () => {
  it("lets neither Settings nor the search screen shrink a child to fit", () => {
    // Both are `position: absolute; inset: 0; overflow-y: auto` COLUMN flex
    // boxes — a container with a DEFINITE height, which shrinks its items
    // before it lets them overflow. Settings is where Viktor met it (the
    // page could not be scrolled at all: `scrollHeight === clientHeight`);
    // the search screen has the identical shape and only escaped because
    // the suite's queries return four rows and an empty one returns none,
    // so `.shell-results` measured 0 px and the overflow case was never
    // reached. The rule covers both, and so does this.
    const r = rule([".set-page > *", ".shell-page > *"].join(",\n"));
    expect(r).toMatch(/flex:\s*none/);
    for (const sel of [".set-page", ".shell-page"]) {
      const page = rule(sel);
      expect(page, sel).toMatch(/overflow-y:\s*auto/);
      expect(page, sel).toMatch(/flex-direction:\s*column/);
    }
  });
});

describe("index.css — the header chip row and its Layers chip (CR-04 r2)", () => {
  // CR-03 Q2 pinned the chip over the row's right end and the chips scrolled
  // under it; CR-04 ruling 2 makes the two flex siblings, because a chip
  // that comes to rest under the circle answers taps with the wrong sheet.
  it("is a scroller and a chip side by side, never one over the other", () => {
    const bar = rule(".chip-bar");
    expect(bar).toMatch(/display:\s*flex/);
    // board O2's own gap between the scroller and the chip
    expect(bar).toMatch(/gap:\s*6px/);
    expect(bar).toMatch(/min-width:\s*0/);
    // nothing is stacked any more, so nothing needs a z-order
    expect(bar).not.toMatch(/z-index:/);
    expect(bar).not.toMatch(/position:\s*relative/);

    const row = rule(".chip-bar > .route-chips");
    expect(row).toMatch(/position:\s*static/);
    expect(row).toMatch(/flex:\s*1 1 auto/);
    expect(row).toMatch(/min-width:\s*0/);
    expect(row).not.toMatch(/z-index:/);

    // the chip keeps its own width and is no longer pinned anywhere
    const chip = rule(".shell-layers--chip");
    expect(chip).not.toMatch(/position:\s*absolute/);
    expect(chip).not.toMatch(/z-index:/);
    expect(chip).not.toMatch(/right:\s*0/);
    expect(chip).toMatch(/width:\s*var\(--sz-chipHeader\)/);
  });

  it("keeps ONE fade, the row's own 24, and no inset mask over the chip", () => {
    // The 54/30 px mask existed only to fade the chips as they slid under
    // the pinned circle. Nothing slides under anything now, so the only fade
    // left is the overflow state's, which kit/ChipRow.tsx measures.
    expect(css).not.toContain(".chip-bar > .chip-row--over");
    expect(css).not.toMatch(/calc\(100% - 54px\)/);
    expect(rule(".chip-row--over")).toContain("padding-right: 24px");
  });

  it("grows the chip's hit slop away from the row, never over it", () => {
    // A 44 px slop centred on a 30 px circle reaches 7 px back — one pixel
    // past the row's 6 px gap and onto the scroller, where the last chip
    // comes to rest at full scroll (S3 review, finding 1: 2 px of a 48 px
    // access chip left tappable in German). It may only grow right, up and
    // down, and that cap outlives the pinning that first needed it.
    const slop = rule(".shell-layers--chip::before");
    expect(slop).toMatch(/left:\s*0/);
    expect(slop).toMatch(/right:\s*-7px/);
    expect(slop).toMatch(/width:\s*auto/);
    // ...and it still owns the vertical axis, so 44 px of height survives
    expect(slop).toMatch(/transform:\s*translateY\(-50%\)/);
    expect(slop).not.toMatch(/translate\(-50%/);
  });
});

describe("index.css — 44 px hit targets (QA F4-03)", () => {
  it("grows the search field to the pill's height while typing", () => {
    // An <input> cannot carry the ::before hit-slop the rest of the kit uses.
    expect(rule(".kit-search-input")).toContain("align-self: stretch");
  });

  it("gives the city sheet's request link the shared hit-slop", () => {
    // Both halves are needed: the ::before is positioned against the element.
    const slop = css.slice(css.indexOf(".kit-chip,"));
    expect(slop).toContain(".set-request,");
    expect(slop).toContain(".set-request::before,");
  });
});

describe("index.css — the edge cards (SPEC §4 'Banner card', slice 7)", () => {
  it("draws the outside banner as a float card, radius 14", () => {
    const r = rule(".edge-outside");
    expect(r).toContain("border-radius: var(--r-card)");
    expect(r).toContain("box-shadow: var(--sh-float)");
    expect(r).toContain("padding: var(--sp-3) 14px");
  });

  it("draws the no-route card with a 1.5 px warn border", () => {
    // Chrome reports a used border-width of 1px for this, so no screenshot
    // and no getComputedStyle can hold the declaration down — only this.
    const r = rule(".route-noroute");
    expect(r).toContain("border: 1.5px solid var(--c-warn)");
    expect(r).toContain("border-radius: var(--r-card)");
    expect(r).toContain("padding: 14px var(--sp-4)");
  });

  it("lets the report sheet's four type chips wrap", () => {
    // Question · Wrong shade · Blocked path · Other is wider than 358 px of
    // phone, and wider still in German.
    expect(rule(".set-chips")).toContain("flex-wrap: wrap");
  });
});

describe("index.css — the compact card's meters (CR-03 Q7, board c-q7)", () => {
  it("draws 40 px tracks and never lets the pair shrink or ellipsise", () => {
    expect(rule(".kit-bars--compact .kit-bar-track")).toContain("width: 40px");
    const bars = rule(".kit-bars--compact");
    expect(bars).toContain("flex: none");
    expect(bars).toContain("font-size: 12.5px");
    expect(rule(".kit-bars--compact .kit-bar > span")).toContain("overflow: visible");
  });

  it("leads with the figure in bold ink, leaving the word muted", () => {
    // .kit-bars carries --c-muted for the row; only the value overrides it
    expect(rule(".kit-bars")).toContain("color: var(--c-muted)");
    const val = rule(".kit-bar-val");
    expect(val).toContain("font-weight: var(--fw-bold)");
    expect(val).toContain("color: var(--c-ink)");
  });

  it("gives the via or loop name the room that is left, and no more", () => {
    // …so it is the half that ellipsises when the row runs out (CR-03 Q7:
    // "overflow drops the via text first"). The meters hold the right end.
    expect(rule(".kit-card-row2 > .kit-card-via")).toContain("flex: 1 1 auto");
    expect(rule(".kit-card-row2 > .kit-bars")).toContain("margin-left: auto");
    expect(rule(".kit-card-via")).toContain("text-overflow: ellipsis");
  });

  it("paints quiet in the BAR's own token, never the tag's and never the route line's", () => {
    // CR-04 r3: --c-quietBar is the meter's fill (board c-q7's #6c7fa8, which
    // clears the bar's 3:1 against its track) and --c-quiet stays the
    // "Quieter" tag's text, where 4.5:1 rules it out. ERRATA 20.
    expect(rule(".kit-bar-fill--quiet")).toContain("background: var(--c-quietBar)");
    expect(rule(".kit-bar-fill--quiet")).not.toContain("background: var(--c-quiet)");
    expect(rule(".kit-tag--quiet")).toContain("color: var(--c-quiet)");
    expect(rule(".kit-bar-fill--shade")).toContain("background: var(--c-accent)");
  });

  it("costs the peek budget nothing: row 2 is still 16 px in a 66 px card", () => {
    expect(rule(".kit-card-row2")).toContain("height: 16px");
    expect(CARD_H.full).toBe(66);
    expect(PEEK_CHROME).toBe(84);
  });
});

describe("index.css — the web frame (board B, slice 8)", () => {
  it("floats the locate button 12 px over whatever sheet is on screen", () => {
    // One rule for all three screens that draw it: --sheet-h is the height
    // the shell measures off the sheet, --float-base only the fallback for
    // the frame before that measurement lands (and for Home, which has no
    // sheet at all — 148 + 12 is the 160 it has always sat at).
    const r = rule(".shell-float");
    expect(r).toContain("var(--sheet-h, var(--float-base, 148px)) + 12px");
    expect(rule(".route-float").trim()).toBe("--float-base: 330px;");
    expect(rule(".wander-float").trim()).toBe("--float-base: 440px;");
  });

  it("stacks locate and the zoom pill bottom right, 16/24 (boards W-*)", () => {
    // The column is 44 + 10 + 88 tall and stands on a 24 px floor, so the
    // locate button's own bottom is 122 and the pill's is 24.
    // tokenised, so the column follows if the floor moves (review F6)
    expect(rule(".web-controls")).toContain("bottom: calc(var(--sp-6) + 88px + 10px)");
    expect(rule(".shell.shell--web .maplibregl-ctrl-top-right")).toContain(
      "bottom: var(--sp-6)"
    );
    expect(rule(".shell--web .maplibregl-ctrl-top-right .maplibregl-ctrl-group")).toContain(
      "border-radius: 22px"
    );
  });

  it("puts the map's own credit flush in the corner under them", () => {
    // maplibre's 10 px margin would have the zoom pill's 24 px floor
    // standing on the attribution.
    expect(rule(".shell--web .maplibregl-ctrl-bottom-right .maplibregl-ctrl")).toContain(
      "margin: 0"
    );
  });

  it("hangs the walk's banner beside the card, on the City list's own offset", () => {
    // 16 + the card + a 20 px gutter = 444, the same sum `.kit-sheet--side`
    // uses: the two things that sit beside the card sit in one column. The
    // board's 428 is that sum for a PANEL at x=0, and the panel is out with
    // Steps (review F2).
    const r = rule('.shell--web[data-layout="desktop-card"] .web-card .route-banner');
    expect(r).toContain("position: fixed");
    expect(r).toContain("left: calc(var(--sp-4) + var(--web-card-w) + var(--sp-5))");
    expect(r).toContain("right: var(--sp-4)");
    expect(r).toContain("top: var(--sp-4)");
    // ...and it is the same expression the City list is placed with
    expect(rule(".kit-sheet--side")).toContain(
      "left: calc(var(--sp-4) + var(--web-card-w) + var(--sp-5))"
    );
  });

  it("caps the card clear of the map's credit and scrolls inside it (SPEC §7, F3)", () => {
    // SPEC §7's "viewport − 32" would have the card grow over the last 8 px
    // of "© OpenStreetMap…" once it reached its cap — an attribution the app
    // stopped honouring. The credit's own height comes off the cap.
    const r = rule(".web-card");
    expect(r).toContain("max-height: calc(100dvh - var(--sp-7) - var(--web-attrib-h))");
    expect(r).toContain("overflow-y: auto");
    expect(r).toContain("width: var(--web-card-w)");
    expect(rule(".shell--web")).toContain("--web-attrib-h: 24px");
  });
});

describe("index.css — the panel rhythm (2026-09-16)", () => {
  // One vertical scale for every surface the same components stack on: the
  // desktop panel, the tablet card and the phone's sheets. The panel had
  // five gaps and three card paddings before this, none of them a rule, so
  // the three numbers live in :root as names and every surface reads them
  // from there. The pixels are e2e/web-layout.spec.ts's; what is held down
  // here is that there is one definition of each.
  const root = rule(":root", 2);

  it("names the three numbers once", () => {
    expect(root).toContain("--web-block-gap: 14px");
    // 24 and 12 are on the --sp scale; 14 is the board's own panel gap and
    // has no token, which is why it is named here (ERRATA erratum 32)
    expect(root).toContain("--web-caption-gap: var(--sp-6)");
    expect(root).toContain("--card-pad: var(--sp-3)");
  });

  it("gives every surface the same 14 between blocks", () => {
    expect(rule(".kit-sheet")).toContain("gap: var(--web-block-gap)");
    expect(rule(".web-card")).toContain("gap: var(--web-block-gap)");
    // ...and no surface re-states it as a literal. The landscape rail's 6 is
    // the one deliberate exception — 390 px of height runs its own scale —
    // and it is declared on that panel and its inline sheet, not here.
    expect(rule(".kit-sheet--modal")).not.toMatch(/gap:/);
    const panel = css.indexOf('.shell--web[data-layout="desktop-panel"] .web-card {');
    expect(panel, "the desktop panel").toBeGreaterThan(-1);
    expect(css.slice(panel, css.indexOf("}", panel))).not.toMatch(/gap:/);
  });

  it("draws 24 before a section caption, wherever the caption stands", () => {
    // the container has already given it the block gap, so the caption asks
    // for the difference — and one rule serves the desktop panel and the
    // leave-at sheet, where the caption is a bare sibling of the blocks
    expect(rule(".route-hours-cap")).toContain(
      "margin-top: calc(var(--web-caption-gap) - var(--web-block-gap))"
    );
    // ...and the block it heads brings no second separator of its own
    const hours = rule(".route-hours");
    expect(hours).not.toMatch(/border-top/);
    expect(hours).not.toMatch(/padding-top/);
  });

  it("puts 12 inside every card, the border counted inside it", () => {
    // 2 px on the recommended card, 1.5 on an alternative: subtracting each
    // is what puts the two cards' text on the same x.
    expect(rule(".kit-card")).toContain("padding: calc(var(--card-pad) - 2px)");
    expect(rule(".kit-delta")).toContain("padding: calc(var(--card-pad) - 1.5px)");
  });

  it("hangs the A→B hairline in the 14 rather than on top of it", () => {
    // as a border with a 12 px padding under it, this one gap measured 27
    // where every other block gap in the panel was 14
    const block = rule('.web-card[data-tab="route"] > .shell-top--header');
    expect(block).toContain("padding-top: 0");
    expect(block).not.toMatch(/border-top: 1px/);
    expect(rule('.web-card[data-tab="route"] > .shell-top--header::before')).toContain(
      "top: calc(var(--web-block-gap) / -2)"
    );
  });
});

describe("index.css — the desktop panel's foot (boards W-routes / W-wander / W-steps)", () => {
  it("pins the action row to the bottom of the rail", () => {
    // Every panel board ends with `margin-top: auto` on its buttons. The
    // sheet has to be what grows, or there is no slack to push into.
    const grow = css.indexOf(
      '.shell--web[data-layout="desktop-panel"] .web-card > .kit-sheet--inline {'
    );
    expect(grow, "the inline sheet grows inside the panel").toBeGreaterThan(-1);
    expect(css.slice(grow, css.indexOf("}", grow))).toContain("flex: 1 1 auto");
    const foot = css.indexOf(
      '.shell--web[data-layout="desktop-panel"] .web-card > .kit-sheet--inline > .kit-actions:last-child'
    );
    expect(foot, "the last action row falls to the foot").toBeGreaterThan(-1);
    expect(css.slice(foot, css.indexOf("}", foot))).toContain("margin-top: auto");
    // ...and nothing pins the walk's ETA bar there any more: the walk is a
    // card again (review F2), so a panel rule for it would be dead CSS
    expect(css).not.toContain('data-layout="desktop-panel"] .web-card > .route-eta');
  });
});

describe("index.css — the paint pass (slice 9)", () => {
  it("gives the chip SPEC §4's own `chip` shadow, not the float one", () => {
    // Slice 2 shipped --sh-float (0 2px 8px / 20 %) on every chip; SPEC §4
    // draws `chip` (0 1px 3px / 20 %) and so do the boards, on the map chips
    // and on Wander's alike (slice-2 report, deviation 8).
    expect(rule(".kit-chip")).toContain("box-shadow: var(--sh-chip)");
  });

  it("marks the taken segment with aria-checked, the radio group's own state", () => {
    // kit/Segment.tsx is a radiogroup since slice 9, so the selector that
    // paints the raised card has to follow it off aria-pressed.
    expect(css).toContain('.kit-segment-item[aria-checked="true"]');
    expect(css).not.toContain('.kit-segment-item[aria-pressed="true"]');
  });

  it("scrolls the R4 chip row sideways rather than clipping the third chip", () => {
    // "Abfahrt 14:00 ▾ · Schatten zuerst ▾ · Kinderwagen ▾" is 414 px inside
    // a 366 px panel: before slice 9 the third chip ran off the phone with no
    // way to reach it. Wander's row already answered this; R4's now does too,
    // and the padding/margin pair keeps the panel's published 127 px height.
    // The padding/margin pair is what keeps a scroll container from eating
    // the chips' shadow, their dark hairline and their 36 px hit slop — on
    // both axes (review F2), and cancelling exactly, so the row paints where
    // the board draws it. Wander's row, which set the precedent, is held to
    // the same pair.
    // Since CR-01 edit 7 both rows are the same .chip-row: one place for the
    // scrolling, the fade and the pair. The trailing padding is the fade's
    // own 24, so the last chip scrolls clear of it instead of under it.
    // The fade and its 24 px of trailing room are the overflow state's
    // (kit/ChipRow.tsx measures it): a row that fits wore the fade over
    // its last chip (2026-09-08).
    const row = rule(".chip-row");
    expect(row).toContain("overflow-x: auto");
    expect(row).toMatch(/padding:\s*6px 4px/);
    expect(row).toMatch(/margin:\s*-6px -4px/);
    const over = rule(".chip-row--over");
    expect(over).toContain("padding-right: 24px");
    expect(over).toContain("mask-image: linear-gradient(90deg, #000 calc(100% - 24px), transparent)");
    expect(over, "Safari is the phone this was written on").toContain("-webkit-mask-image");
    expect(rule(".route-chips--header .kit-chip")).toContain("flex: none");
  });

  it("gives a chip an edge in the dark theme, where its shadow is invisible", () => {
    // --sh-chip is black at 20 %: on a dark card the report sheet's four type
    // chips had no shape at all.
    expect(rule(':root[data-theme="dark"] .kit-chip')).toContain(
      "box-shadow: var(--sh-chip), 0 0 0 1px var(--c-hair2)"
    );
  });

  it("paints maplibre's own credit pill from the app's tokens", () => {
    // maplibre ships it #fff with black type, which over MEADOW_DARK was the
    // one light surface left on a dark screen.
    const r = rule(
      ".shell .maplibregl-ctrl-attrib,\n.shell .maplibregl-ctrl-attrib.maplibregl-compact"
    );
    expect(r).toContain("background-color: var(--c-card)");
    expect(r).toContain("color: var(--c-ink)");
    expect(css).toContain(':root[data-theme="dark"] .shell .maplibregl-ctrl-attrib-button');
  });

  it("draws no focus ring with an outline any more", () => {
    // CR-04 r4: one ring, a box-shadow halo plus accent, so the per-control
    // offsets are gone with it — the report textarea's tight one included
    // (it drew its own border, and the halo sits inside the ring now, so
    // nothing needs pulling closer). src/a11y.test.ts owns the ring itself.
    // The forced-colors fallback is the documented exception and the only
    // one: a shadow does not survive there, so the outline is what is left
    // (CR-04 review H1, pinned in its own describe at the foot of this file).
    const shadowRing = css.replace(
      /@media \(forced-colors: active\) \{[\s\S]*?\n\}/,
      "",
    );
    expect(shadowRing).not.toMatch(/outline-offset/);
    expect(shadowRing).not.toMatch(/outline:\s*var\(--sz-ring\)/);
  });
});

// --- reduced motion, by enumeration (final review, missing test 3) ---------
//
// `@media (prefers-reduced-motion: reduce)` lists its selectors BY HAND
// (index.css, "reduced motion"). That list was right when it was written and
// has no way of staying right: nine slices appended nine blocks, two of them
// AFTER the reduced-motion block, and the day one of those animates
// something the app moves for a reader who asked it not to — silently, with
// no screenshot and no e2e able to see it.
//
// So the stylesheet is read the other way round: find every `transition` and
// `animation` the app declares, and prove each one is switched off. Two
// things make that provable from the text alone —
//   - the reduce block is the LAST rule in the file, so its `transition:
//     none` wins the cascade over any rule of equal specificity above it;
//   - the kit's class names are BEM, so `.kit-sheet--side` is worn by an
//     element that also wears `.kit-sheet`, and the block's `.kit-sheet`
//     covers it.
// Both are asserted, not assumed.

/** index.css with comments removed, so a declaration quoted in prose is not
 *  mistaken for one the browser reads. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

type Decl = { at: number; selector: string; inside: string[]; prop: string; value: string };

/** Every `transition:` / `animation:` declaration in the stylesheet, with the
 *  selector it sits under and the at-rules around it. A hand-rolled walk of
 *  the braces: index.css is flat CSS (no nesting), so a stack of heads is the
 *  whole parser. */
function motionDecls(): Decl[] {
  const out: Decl[] = [];
  const stack: string[] = [];
  let head = "";
  let decl = "";
  let declAt = 0;
  for (let i = 0; i < bare.length; i++) {
    const ch = bare[i];
    if (ch === "{") {
      stack.push(head.trim());
      head = "";
      decl = "";
      continue;
    }
    if (ch === "}") {
      stack.pop();
      head = "";
      decl = "";
      continue;
    }
    if (ch === ";") {
      const m = /^\s*(transition|animation)\s*:\s*([\s\S]*)$/.exec(decl);
      if (m && stack.length > 0) {
        out.push({
          at: declAt,
          selector: stack[stack.length - 1],
          inside: stack.slice(0, -1),
          prop: m[1],
          value: m[2].trim(),
        });
      }
      decl = "";
      continue;
    }
    if (decl === "" && !/\s/.test(ch)) declAt = i;
    if (stack.length > 0) decl += ch;
    else head += ch;
  }
  return out;
}

/** The class tokens a selector needs on the element it paints, plus the BEM
 *  base of each — `.kit-sheet--side` is only ever worn with `.kit-sheet`. */
function classesOf(selector: string): Set<string> {
  const out = new Set<string>();
  for (const m of selector.matchAll(/\.[A-Za-z0-9_-]+/g)) {
    out.add(m[0]);
    const base = m[0].split("--")[0];
    if (base !== m[0]) out.add(base);
  }
  return out;
}

describe("index.css — nothing moves under prefers-reduced-motion", () => {
  const REDUCE = "@media (prefers-reduced-motion: reduce)";
  const reduceAt = bare.indexOf(REDUCE);
  const decls = motionDecls();

  it("has exactly one reduce block, and it is the last thing in the file", () => {
    expect(reduceAt, "no reduced-motion block").toBeGreaterThan(-1);
    expect(bare.indexOf(REDUCE, reduceAt + 1), "two reduce blocks").toBe(-1);
    // Everything after it is comment or whitespace: the block's `transition:
    // none` is specificity-tied with the rules it neutralises, so being last
    // is not tidiness — it is the mechanism.
    expect(bare.slice(bare.lastIndexOf("}") + 1).trim()).toBe("");
    for (const d of decls) {
      if (d.inside.some((q) => q.startsWith(REDUCE))) continue;
      expect(d.at, `${d.selector} { ${d.prop} } is declared after the reduce block`).toBeLessThan(
        reduceAt
      );
    }
  });

  it("neutralises every selector that moves", () => {
    // what the block switches off, as sets of class tokens
    const body = bare.slice(reduceAt + REDUCE.length);
    const off: Set<string>[] = [];
    for (const m of body.slice(0, body.indexOf("\n}")).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/(transition|animation)\s*:\s*none/.test(m[2])) continue;
      for (const sel of m[1].split(",")) {
        const c = classesOf(sel);
        if (c.size > 0) off.push(c);
      }
    }
    expect(off.length, "the reduce block turns something off").toBeGreaterThan(0);

    const uncovered: string[] = [];
    for (const d of decls) {
      // already off, or only ever on for a reader who did not ask
      if (/^none\b/.test(d.value)) continue;
      if (d.inside.some((q) => q.includes("prefers-reduced-motion"))) continue;
      const worn = classesOf(d.selector);
      if (off.some((need) => [...need].every((c) => worn.has(c)))) continue;
      uncovered.push(`${d.selector} { ${d.prop}: ${d.value} }`);
    }
    expect(uncovered, "these animate for a reader who asked for no motion").toEqual([]);
  });

  it("finds the transitions it is supposed to be checking", () => {
    // A parser that silently matched nothing would make the two tests above
    // vacuous. These are the app's own moving parts, per the block's comment.
    const moving = new Set(decls.filter((d) => !/^none\b/.test(d.value)).map((d) => d.selector));
    for (const sel of [".kit-sheet", ".kit-scrim", ".kit-bar-fill", ".kit-skeleton--shimmer"]) {
      expect(moving, sel).toContain(sel);
    }
    expect(moving.size).toBeGreaterThanOrEqual(8);
  });
});

// --- the peek budget's two constants, against the CSS they were summed from
//
// CR-01 review F6. `ui/sheetBudget.ts` PREDICTS the peeking sheet's height
// from two hand-summed numbers rather than measuring it, and `--sheet-peek`
// is applied as a `max-height` with `overflow: hidden` — so a padding change
// in index.css does not resize the card, it CLIPS it, silently and only on a
// phone. Nothing pinned the constants until now.
//
// Both sides of every sum are read out of the stylesheet, so this fails when
// the CSS moves — not when someone forgets to update a copy of it.
describe("index.css — the peek budget's arithmetic (CR-01 review F6)", () => {
  const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n"
  );

  /** The `--sp-*` scale, in px, straight out of the generated tokens. */
  const SP = new Map<string, number>();
  for (const m of tokens.matchAll(/--sp-(\d):\s*(-?\d+(?:\.\d+)?)px/g)) {
    SP.set(m[1], Number(m[2]));
  }

  /** A rule body as property → value. Comments come out first — several of
   *  these rules explain themselves declaration by declaration — and no
   *  value in this file carries a semicolon, so splitting on `;` is enough
   *  after that. */
  function decls(body: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const d of body.replace(/\/\*[\s\S]*?\*\//g, "").split(";")) {
      const c = d.indexOf(":");
      if (c < 0) continue;
      out.set(d.slice(0, c).trim(), d.slice(c + 1).trim());
    }
    return out;
  }

  function value(body: string, prop: string): string {
    const v = decls(body).get(prop);
    expect(v, `no ${prop} in this rule`).toBeDefined();
    return v as string;
  }

  /** The first px length in a declaration, `calc()` and `var()` and all —
   *  `padding: 10px var(--sp-4) calc(22px + env(...))` gives 10. */
  function firstPx(body: string, prop: string): number {
    const v = value(body, prop);
    const px = /(-?\d+(?:\.\d+)?)px/.exec(v);
    expect(px, `${prop} is not a px length: ${v}`).not.toBeNull();
    return Number((px as RegExpExecArray)[1]);
  }

  /** A `gap` or `padding` written as one scale token, in px. */
  function spProp(body: string, prop: string): number {
    const v = value(body, prop);
    const m = /^var\(--sp-(\d)\)/.exec(v);
    expect(m, `${prop} is not a --sp-* token: ${v}`).not.toBeNull();
    const px = SP.get((m as RegExpExecArray)[1]);
    expect(px, `no --sp-${(m as RegExpExecArray)[1]} in tokens.css`).toBeDefined();
    return px as number;
  }

  it("sums PEEK_CHROME out of the sheet's own padding, handle, gaps and buttons", () => {
    // A peeking sheet is a column of three — the handle, the compact card,
    // the button row, so two gaps — inside the sheet's own top padding and
    // the peek snap's bottom one.
    const padTop = firstPx(rule(".kit-sheet"), "padding");
    const peek = rule('.kit-sheet[data-snap="peek"]');
    const padBottom = firstPx(peek, "padding-bottom");
    const gap = spProp(peek, "gap");
    // the handle is a 28 px hit target pulled back into the padding at both
    // ends: -10 at the top (exactly the sheet's own top padding) and -14
    const handle = rule(".kit-sheet-handle");
    const margins = [...value(handle, "margin").matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) =>
      Number(m[1])
    );
    expect(margins, "the handle's margin is a top and a bottom in px").toHaveLength(2);
    const handleBox = firstPx(handle, "height") + margins[0] + margins[1];
    // ...and a button inside a peeking sheet is 44, not the 46 it is
    // everywhere else — the two px the meters row lives or dies on
    const btn = firstPx(rule('.kit-sheet[data-snap="peek"] .kit-btn'), "height");

    expect(padTop + handleBox + 2 * gap + btn + padBottom).toBe(PEEK_CHROME);
  });

  it("sums CARD_H out of the compact card's border, padding, rows and gap", () => {
    const border = firstPx(rule(".kit-card"), "border") * 2;
    const compact = rule(".kit-card--compact");
    const pad = spProp(compact, "padding") * 2;
    const gap = spProp(compact, "gap");
    const row1 = firstPx(rule(".kit-card-row1"), "height");
    const row2 = firstPx(rule(".kit-card-row2"), "height");

    expect(border + pad + row1 + gap + row2, "both rows").toBe(CARD_H.full);
    // `bars` is the same card without row 2 — and without the gap that put
    // it there. Dropping the TAG buys no height at all (it is width), so the
    // last rung measures the same: ui/sheetBudget.ts says so in its type,
    // and this is where the two are held to it (CR-01 review, F7).
    expect(border + pad + row1, "row 1 alone").toBe(CARD_H.bars);
    expect(CARD_H.min, "the tag costs width, not height").toBe(CARD_H.bars);
  });

  it("keeps the whole peeking sheet inside the ceiling SPEC §3b sets", () => {
    // 150 on the phones the CR is written against, against a 168 ceiling.
    expect(PEEK_CHROME + CARD_H.full).toBeLessThanOrEqual(168);
  });
});

// --- CR-04 review H1: the focus ring under forced colours -----------------
//
// Windows' high contrast themes replace the page's palette with the reader's
// own and drop every `box-shadow` on the way. From 2026-09-10 the app's one
// focus ring WAS a box-shadow, so in that mode no control had a focus
// indicator at all — a WCAG 2.4.7 regression against the `outline` it
// replaced, which forced colours preserve (forced to Highlight). The fallback
// restores an outline, and these hold it to the same list the ring itself
// draws: a control added to one and forgotten in the other is a red test
// rather than a control that is unfocusable for the readers who need focus
// most. The live proof is e2e/a11y-motion.spec.ts.
describe("index.css — forced colours (CR-04 review H1)", () => {
  const forced = css.match(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/);

  /** The rules inside the media block, selector list and body apiece. */
  const rules = (): [string, string][] => {
    expect(forced, "an @media (forced-colors: active) block").not.toBeNull();
    return [...forced![1].matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => [m[1], m[2]]);
  };

  /** A selector list, comments dropped and indentation normalised. */
  const selectors = (list: string): string[] =>
    list
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

  it("gives focus an outline back, because a shadow is thrown away there", () => {
    const [, body] = rules()[0];
    // Highlight, not a token: forced colours resolve system colours only
    expect(body).toContain("outline: 2px solid Highlight;");
    expect(body).toContain("outline-offset: 2px;");
  });

  it("covers exactly the selector list the ring rule draws", () => {
    // the ring rule is the one that declares --sh-ring (src/a11y.test.ts)
    const start = css.indexOf(".kit-btn:focus-visible,");
    expect(start, "the ring rule").toBeGreaterThan(-1);
    const ring = selectors(css.slice(start, css.indexOf("{", start)));
    expect(selectors(rules()[0][0])).toEqual(ring);
    // ...and it is not two empty lists agreeing with each other
    expect(ring.length).toBeGreaterThan(20);
    expect(ring).toContain(".kit-btn:focus-visible");
  });

  it("keeps the three controls whose STATE is a fill", () => {
    // A toggle that is on, the picked report chip and the active tab differ
    // from their neighbours by a background or an accent alone, and forced
    // colours repaint both — so on/off, picked/idle and here/elsewhere all
    // collapse into one appearance unless the control opts out. It inherits,
    // so each of the three is named at the level that carries the whole
    // surface: the knob comes with the toggle, the labels with the tab bar.
    const [list, body] = rules()[1];
    expect(selectors(list)).toEqual([".kit-toggle", ".set-chips .kit-chip", ".kit-tabbar"]);
    expect(body).toContain("forced-color-adjust: none;");
  });
});
