// tokens.css is generated (scripts/tokens.mjs) — this test is what makes
// that true. It re-renders the file from docs/design/handoff/tokens.json and
// compares it, byte for byte, with what is on disk: a hand-edit of the CSS
// fails here, and so does a change to the JSON that nobody regenerated.
//
// Beyond the drift check it pins the four things the generator adds on top
// of the JSON, because those are decisions rather than data.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error — a plain .mjs script with no types
import { A11Y, ALIASES, generate, render, SOURCE } from "../scripts/tokens.mjs";

const onDisk = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const generated: string = render();

/** Line endings, normalised. `.gitattributes` pins tokens.css to LF so this
 *  is belt and braces: `core.autocrlf=true` is the Git for Windows default,
 *  and a checkout that predates the .gitattributes — or a clone made with a
 *  config that overrides it — would otherwise fail the drift gate for a
 *  reason that has nothing to do with drift. The gate is about the tokens,
 *  not about which byte a line ends on. */
const lf = (s: string) => s.replace(/\r\n/g, "\n");

describe("tokens.css", () => {
  it("is exactly what scripts/tokens.mjs generates (run `npm run tokens`)", () => {
    expect(lf(onDisk)).toBe(lf(generated));
  });

  it("carries the light palette on :root", () => {
    const root = /:root \{([\s\S]*?)\n\}/.exec(generated);
    expect(root).not.toBeNull();
    expect(root![1]).toContain("--c-accent: #3f6b4b");
    // the page ground follows the basemap's (Meadow v2, CR-01 edit 11)
    expect(root![1]).toContain("--c-page: #eef1e9");
  });

  it("puts the dark palette behind an explicit data-theme, never a media query", () => {
    const dark = /:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/.exec(generated);
    expect(dark).not.toBeNull();
    expect(dark![1]).toContain("--c-accent: #7fb58a");
    expect(generated).not.toContain("prefers-color-scheme:");
  });

  it("carries the compact sizes the redesign moved to", () => {
    expect(generated).toContain("--sz-button: 46px");
    expect(generated).toContain("--sz-buttonSmall: 36px");
    expect(generated).toContain("--sz-iconButton: 46px");
    expect(generated).toContain("--sz-chipCompact: 32px");
    expect(generated).toContain("--sz-tabbar: 56px");
    expect(generated).toContain("--sz-searchBar: 52px");
    expect(generated).toContain("--r-pill: 23px");
  });

  it("takes the accessible warn straight from the design system", () => {
    // Slice 9 moved the correction upstream: tokens.json used to publish
    // #c26b2a (3.87:1 on white) and the generator's A11Y table darkened it.
    // Now the JSON carries #af6026 itself (ERRATA.md), the table is empty,
    // and the app paints only colours the design system actually has.
    expect(generated).toContain("--c-warn: #af6026");
    expect(generated).not.toContain("#c26b2a");
    expect(A11Y).toEqual({ light: {}, dark: {} });
  });

  it("publishes the focus ring and its halo as real tokens", () => {
    // They were a generator ALIAS through B10 — the ring had never appeared
    // on a board, so the design system had no token for it. CR-04 ruling 4
    // put `focus` and `focusHalo` in tokens.json, both still the accent and
    // the card, so the alias table is empty and these are literals now.
    expect(ALIASES).toEqual({ light: {}, dark: {} });
    expect(generated).toContain("--c-focus: #3f6b4b");
    expect(generated).toContain("--c-focusHalo: #ffffff");
    expect(generated).toContain("--c-focus: #7fb58a");
    expect(generated).toContain("--c-focusHalo: #262b29");
    expect(generated).not.toContain("--c-focus: var(");
  });
});

// The generator adds two tables on top of the JSON. Both are a lie the moment
// the JSON moves under them, and a generator that invents a token silently is
// worse than none: these are the asserts that make it fail loud instead
// (CLAUDE.md, "each script asserts basic sanity of its output").
describe("scripts/tokens.mjs — the source it is checked against", () => {
  /** tokens.json, deep-copied so a test can break one thing in it. */
  const source = () => JSON.parse(readFileSync(SOURCE as string, "utf8"));

  it("generates from an untouched tokens.json", () => {
    expect(() => generate(source())).not.toThrow();
  });

  // The A11Y table is empty today, so the guard has nothing to catch. It is
  // exercised with a temporary entry rather than deleted: the next colour the
  // design system publishes below AA will be written into that table on the
  // day it is found, and the guard has to still be there — and still work —
  // when it is.
  it("throws when an A11Y override names a token the design system dropped", () => {
    const t = source();
    delete t.color.light.warn;
    delete t.color.dark.warn;
    A11Y.light.warn = "#af6026";
    try {
      expect(() => generate(t)).toThrow(/A11Y override "warn"/);
    } finally {
      delete A11Y.light.warn;
    }
  });

  // ALIASES is empty since CR-04 r4 promoted `focus`/`focusHalo` into
  // tokens.json — which is exactly the day this guard fired. It is exercised
  // with a temporary entry, the way the A11Y one above is: the next variable
  // the CSS needs and the design system has no name for goes in that table,
  // and the guard has to still work when it does.
  it("throws when an alias would shadow a real token", () => {
    ALIASES.light["c-focus"] = "var(--c-accent)";
    try {
      expect(() => generate(source())).toThrow(/shadows the real token "focus"/);
    } finally {
      delete ALIASES.light["c-focus"];
    }
  });

  it("throws when the two palettes have different keys", () => {
    const t = source();
    delete t.color.dark.quietSoft;
    expect(() => generate(t)).toThrow(/color\.dark has no "quietSoft"/);
  });
});
