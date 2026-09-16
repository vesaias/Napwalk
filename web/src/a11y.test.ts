import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The a11y rules of Task 16 are CSS, and CSS has no type checker. These read
// the stylesheet the way the browser does — by selector — and assert the two
// invariants that are easy to break by adding a rule somewhere else: one ring
// colour, and a hit-area pseudo-element that is positioned against its own
// control rather than against the page.
const cssRaw = readFileSync(new URL("./index.css", import.meta.url), "utf8");
const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

// The forced-colors fallback (CR-04 review H1) is the one place the app draws
// focus with an `outline` on purpose: forced colours throw `box-shadow` away,
// so a shadow ring is no ring at all there. It is lifted out before the sweeps
// below, which are about the shadow ring and would read it as a rule drawing an
// outline of its own. Its own guards — that it exists, and that it covers
// exactly the selector list the ring rule draws — are in src/css.test.ts.
const forcedColors = cssRaw.match(/@media \(forced-colors: active\) \{[\s\S]*?\r?\n\}/);
const css = forcedColors === null ? cssRaw : cssRaw.replace(forcedColors[0], "");

/** Every rule block whose selector list mentions :focus-visible. */
const focusBlocks = [...css.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)];

/** A rule's selector list, comments dropped — the block regex above reaches
 *  back to the previous `}`, so a rule with a note over it carries the note
 *  in its selector capture. */
const strip = (sel: string): string[] =>
  sel
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** The one rule that defines the ring: the block that declares `--sh-ring`. */
const ringBlock = focusBlocks.find(([, , body]) => /--sh-ring\s*:/.test(body));

describe("the focus ring", () => {
  // CR-04 ruling 4: ONE ring, on every focusable control, drawn as a 1 px
  // halo the colour of the control's card and 2 px of accent outside it. It
  // was a 2 px outline at a 2 px offset until 2026-09-10, which on an
  // accent-filled control (Start, the picked duration tile) was the accent
  // ringing itself across two pixels of card.
  it("is defined once, as the halo and the accent", () => {
    expect(ringBlock, "exactly one :focus-visible rule declares --sh-ring").toBeDefined();
    expect(focusBlocks.filter(([, , b]) => /--sh-ring\s*:/.test(b))).toHaveLength(1);
    expect(ringBlock![2]).toContain(
      "--sh-ring: 0 0 0 1px var(--c-focusHalo), 0 0 0 3px var(--c-focus);",
    );
    // ...and the rule that defines it also draws it, so a control that is in
    // the list and nowhere else still gets a ring
    expect(ringBlock![2]).toContain("box-shadow: var(--sh-ring)");
    // the browser's own outline is off: the ring is the box-shadow now
    expect(ringBlock![2]).toContain("outline: none");
  });

  // The ONE exemption, and it is written out so that adding a second is a
  // deliberate act: the search pill takes no ring from a TAP (round 3 item
  // 10, ui/focusSource.ts). Every such rule is gated on `body:not([data-kbd])`
  // — with the keyboard the pill rings like everything else — and gates on
  // nothing else in the app.
  const POINTER_EXEMPT = [".kit-search--button", ".kit-search-value", ".kit-search-input"];
  const gated = (selector: string) =>
    strip(selector).every((sel) => sel.startsWith("body:not([data-kbd])"));

  it("is drawn by every :focus-visible rule, and by no other means", () => {
    expect(focusBlocks.length).toBeGreaterThan(0);
    for (const [, selector, body] of focusBlocks) {
      const where = selector.trim().slice(0, 60);
      // nothing draws its own ring with an outline any more
      expect(body, where).not.toMatch(/outline:(?!\s*none\s*;)/);
      if (gated(selector)) {
        // the exemption: it may drop the ring, but only for these three, and
        // only the ring — the pill's own float shadow is not a focus style
        for (const sel of strip(selector)) {
          const bare = sel.replace("body:not([data-kbd])", "").replace(":focus-visible", "").trim();
          expect(POINTER_EXEMPT, `${where} is an agreed exemption`).toContain(bare);
        }
        expect(body, where).not.toContain("var(--sh-ring)");
        continue;
      }
      // ...and a rule that touches box-shadow at all must include the ring,
      // or it would erase it on the way past (the compose block below)
      if (/box-shadow\s*:/.test(body)) expect(body, where).toContain("var(--sh-ring)");
    }
  });

  it("rings the search pill for the keyboard, at every one of its three faces", () => {
    const list = ringBlock![1];
    for (const sel of POINTER_EXEMPT) {
      expect(list, `${sel} is still in the ring rule`).toContain(`${sel}:focus-visible`);
    }
    // …and each one is turned off again for the pointer, once
    for (const sel of POINTER_EXEMPT) {
      const off = focusBlocks.filter(
        ([, s2]) => gated(s2) && s2.includes(`${sel}:focus-visible`),
      );
      expect(off, `${sel} has one pointer rule`).toHaveLength(1);
    }
  });

  it("hard-codes no colour anywhere it is drawn", () => {
    for (const [, selector, body] of focusBlocks) {
      expect(body, selector.trim().slice(0, 60)).not.toMatch(/var\(--c?-?sun\)/);
      expect(body, selector.trim().slice(0, 60)).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    }
  });

  // The controls whose SHAPE is a shadow. Setting `box-shadow` for the ring
  // would take that shape away exactly while the keyboard is on them, so
  // each re-declares its own shadow with `--sh-ring` on the end. The list is
  // written out because the mapping is not mechanical — .kit-search--button
  // wears .kit-search's `--sh-float`, and .shell-layers--chip overrides
  // .shell-layers' — and it is checked both ways: each pair is present, and
  // no rule in the sweep above drops the ring while touching box-shadow.
  it("adds to a control's own shadow rather than replacing it", () => {
    const compose: [string, string][] = [
      [".kit-search--button", "var(--sh-float)"],
      [".shell-locate", "var(--sh-float)"],
      [".shell-layers", "var(--sh-float)"],
      [".kit-chip", "var(--sh-chip)"],
      ['.kit-segment-item[aria-checked="true"]', "var(--sh-chip)"],
      [".shell-layers--chip", "var(--sh-chip)"],
    ];
    for (const [selector, own] of compose) {
      const block = focusBlocks.find(
        ([, sel, body]) =>
          strip(sel).some((s) => s === `${selector}:focus-visible`) &&
          body.includes(`box-shadow: ${own}`),
      );
      expect(block, `${selector} composes its own shadow with the ring`).toBeDefined();
      expect(block![2], selector).toContain(`box-shadow: ${own}`);
      expect(block![2], selector).toContain("var(--sh-ring)");
    }
  });

  // ...and the three buttons the app does not own. maplibre-gl.css draws its
  // own #0096ff ring with a `box-shadow` too, at a weight that ties our
  // attribution selector and beats our `.maplibregl-ctrl button` one — so
  // from 2026-09-10 the attribution toggle and both zoom buttons wore
  // maplibre's blue instead of this app's ring (CR-04 review H2). The fix is
  // specificity, and a doubled `:focus-visible` is the whole of it; the live
  // proof is e2e/a11y-motion.spec.ts, which measures the cascade the browser
  // actually resolves rather than this file's text.
  it("out-specifies maplibre's own ring on the three buttons it draws", () => {
    for (const selector of [
      // (0,3,0) against maplibre's (0,2,0) `:focus`
      ".shell .maplibregl-ctrl-attrib-button:focus-visible",
      // (0,4,1) against maplibre's (0,3,1) `:focus:focus-visible` — the
      // second class is what buys the step, and it is why this selector
      // names the group twice
      ".shell .maplibregl-ctrl.maplibregl-ctrl-group button:focus-visible",
    ]) {
      const block = focusBlocks.find(([, sel]) => strip(sel).includes(selector));
      expect(block, selector).toBeDefined();
      expect(block![2], selector).toContain("box-shadow: var(--sh-ring)");
      // ...and it does NOT repeat `outline: none`, which would out-rank the
      // forced-colours fallback on the only three controls it cannot reach
      // by weight (both live at (0,2,x) there)
      expect(block![2], selector).not.toContain("outline");
    }
  });

  // The ring was the ACCENT in both themes from B10 (2026-09-09) as a
  // generator ALIAS — it had never appeared on a board, so the design system
  // had no token for it. CR-04 ruling 4 promotes it and its halo to real
  // published tokens, both still the accent and the card, so the alias table
  // is empty and the values are literals per theme. scripts/contrast.mjs
  // measures the ring against both grounds (6.15:1 light, 6.08:1 dark).
  it("and its halo are published tokens, in both themes", () => {
    const root = tokens.match(/:root \{([\s\S]*?)\n\}/);
    const dark = tokens.match(/\[data-theme="dark"\]\s*{([^}]*)}/);
    for (const block of [root?.[1], dark?.[1]]) {
      expect(block).toMatch(/--c-focus:\s*#[0-9a-f]{6}/);
      expect(block).toMatch(/--c-focusHalo:\s*#[0-9a-f]{6}/);
    }
    // the halo is the CARD, so the ring reads on an accent-filled control
    expect(root?.[1]).toMatch(/--c-focusHalo:\s*#ffffff/);
    expect(dark?.[1]).toMatch(/--c-focusHalo:\s*#262b29/);
    expect(tokens).not.toMatch(/--c-focus:\s*var\(--c-(warn|end|sun)\)/);
  });

  // 2026-09-06: the device's night mode is no longer a theme. The dark
  // palette lives in exactly one place, and the cascade cannot reach it
  // without `data-theme` — which ui/useTheme.ts always writes.
  it("has no prefers-color-scheme branch left to leak the system setting in", () => {
    expect(tokens).not.toMatch(/@media\s*\(prefers-color-scheme/);
  });
});

describe("reduced motion", () => {
  const block = css.match(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/);

  it("stops every surface that moves", () => {
    expect(block).not.toBeNull();
    const body = block![1];
    for (const sel of [
      ".kit-sheet", // the phone sheet's slide
      ".kit-sheet--dialog", // the web dialog's fade
      ".kit-scrim",
      ".kit-bar-fill",
      ".kit-hour-fill",
      ".kit-toggle-knob",
    ]) {
      expect(body, sel).toContain(sel);
    }
    expect(body).toContain(".kit-skeleton--shimmer");
    expect(body).toContain("animation: none");
  });
});

// Slice 9. Everything that moves is already listed above; these are the two
// surfaces the web layout added, which are animated by rules of their own and
// were not in Task 16's list.
describe("reduced motion — the web surfaces", () => {
  const block = css.match(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/);

  it("stops the side card, which fades like the dialog", () => {
    // .kit-sheet--side carries .kit-sheet too, and the reduce block's
    // `.kit-sheet` rule is written AFTER it at equal specificity — so the
    // cascade already turns it off. This asserts the ORDER that makes that
    // true, because moving the block up the file would silently undo it.
    expect(css.indexOf("@media (prefers-reduced-motion: reduce)")).toBeGreaterThan(
      css.indexOf(".kit-sheet--side {")
    );
    expect(block![1]).toContain(".kit-sheet,");
  });

  it("leaves the GPS pulse behind a no-preference query as well as stopping it", () => {
    // Belt and braces: the keyframes never start for a reader who asked for
    // stillness, and the animation is cleared again in the reduce block.
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)[\s\S]*?gps-pulse/);
    expect(block![1]).toContain(".gps-dot::before");
  });
});

describe("44 px hit targets", () => {
  // An absolutely positioned ::before is measured against its nearest
  // POSITIONED ancestor. A control that grows a hit area without first being
  // positioned itself grows a 44 px box somewhere else entirely, and the bug
  // is invisible until someone taps beside the control. `relative` is what
  // almost every one of them uses (it moves no paint); `absolute` counts
  // too, and does for the 30 px Layers chip, which is pinned over the header
  // chip row and is therefore already a containing block (CR-03 Q2).
  it("gives every grown control a containing block of its own", () => {
    // matchAll, not match: a second multi-class `position: relative` rule
    // added anywhere above this one would silently retarget the assertion.
    const grown = [...css.matchAll(/((?:\.[\w-]+::before,\s*)+\.[\w-]+::before)\s*{\s*content: ""/g)];
    expect(grown.length, "the ::before hit-area rules").toBeGreaterThan(0);
    const relativeRules = [
      ...css.matchAll(/((?:\.[\w-]+,\s*)+\.[\w-]+)\s*{\s*position: relative;\s*}/g),
      ...css.matchAll(/(\.[\w-]+)\s*{[^}]*position: (?:relative|absolute);/g),
    ];
    const names = (s: string) => s.match(/\.[\w-]+/g) ?? [];
    const positioned = new Set(relativeRules.flatMap((m) => names(m[1])));
    for (const m of grown) {
      for (const cls of names(m[1].replaceAll("::before", ""))) {
        expect(positioned, cls).toContain(cls);
      }
    }
  });

  it("never shrinks a control that is already big enough", () => {
    expect(css).toMatch(/width: max\(100%, var\(--sz-target\)\)/);
    expect(css).toMatch(/height: max\(100%, var\(--sz-target\)\)/);
  });
});
