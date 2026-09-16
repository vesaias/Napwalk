// The design tokens, generated — `npm run tokens` (2026-09-06, compact UI
// slice 1).
//
// `docs/design/handoff/tokens.json` is the design system's own file; this
// script turns it into `web/src/tokens.css`. Nothing else in the app may
// carry a hex, a radius or a size, and nobody may hand-edit tokens.css:
// src/tokens.test.ts regenerates it into a string and fails if the file on
// disk differs.
//
// Three things the JSON does not carry, and this file adds:
//
//   SIZES    — lengths the boards draw that `tokens.size` does not name (the
//              R4 header's 30 px chip row).
//   ALIASES  — variables the CSS uses that the design system has no token
//              for: the focus ring and its geometry. The ring is a browser
//              affordance, not a drawn element, so it never appeared on a
//              board; it still needs a colour that passes 3:1 on both the
//              card and the map (scripts/contrast.mjs measures it).
//   A11Y     — the one colour whose published value fails WCAG AA. See below.
//   theme    — the dark palette is `:root[data-theme="dark"]`, never
//              `prefers-color-scheme`: the theme is a decision the reader
//              makes (Settings) or the sun over their city makes
//              (ui/theme.ts), and `data-theme` is always written
//              (ui/useTheme.ts, DECISIONS.md 2026-09-06).
//
// The basemap, overlay and map-pin sections of tokens.json are deliberately
// NOT emitted: maplibre paints those, from src/mapTheme.ts, and a CSS
// variable a canvas cannot read would be a second source of truth.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SOURCE = join(HERE, "..", "..", "docs", "design", "handoff", "tokens.json");
export const TARGET = join(HERE, "..", "src", "tokens.css");

/** Colours whose published value does not reach WCAG AA on its own surface.
 *  Each one would be darkened here by the smallest step that gets there, and
 *  measured by `npm run contrast` on every run — so the list cannot rot
 *  silently.
 *
 *  It is EMPTY, and should stay that way (slice 9, 2026-09-07). It held one
 *  entry: light `warn` shipped as #c26b2a, 3.87:1 on --c-card, and it labels
 *  an out-of-city search result and the note under a worse alternative —
 *  ordinary 12–14 px text. An override here meant the app painted a colour
 *  the design system did not have, and a designer opening tokens.json saw a
 *  value the build never used. So #af6026 (the same hue at 4.64:1) went
 *  UPSTREAM into docs/design/handoff/tokens.json, and the correction is
 *  written down in docs/design/handoff/ERRATA.md.
 *
 *  The table and its guard in check() stay: the next colour the design
 *  system publishes below AA needs somewhere to be fixed on the day it is
 *  found, before the JSON can be changed. */
export const A11Y = {
  light: {},
  dark: {},
};

/** Variables the CSS uses that tokens.json has no token for. Values may be
 *  `var(...)` references into the palette above them.
 *
 *  `c-focus` lived here through B10 (2026-09-09) as `var(--c-accent)` — the
 *  ring was a browser affordance with no board to draw it, chosen on
 *  contrast alone (see ERRATA 17). CR-04 ruling 4 (2026-09-10) promotes it,
 *  and its halo, to real published tokens — `color.*.focus` /
 *  `color.*.focusHalo` in tokens.json, both still the accent — so the alias
 *  is gone; check() below would refuse to run with an alias shadowing a
 *  token the JSON now actually publishes. */
export const ALIASES = {
  light: {},
  dark: {},
};

/** Ring geometry — not a colour, so it lives outside the theme blocks.
 *  `ringOffset` is the gap between a control's edge and its focus ring;
 *  `ringOffsetTight` is the one place that gap is smaller — a control that
 *  already draws a border of its own (the report textarea), where the full
 *  2 px reads as a gap rather than as a ring. Both are here rather than
 *  written into index.css so that "how far off the control" is one decision
 *  in one file. */
const RING = {
  "sz-ring": "2px",
  "sz-ringOffset": "2px",
  "sz-ringOffsetTight": "1px",
};

/** Lengths the boards draw that `tokens.size` has no name for. Same rule as
 *  ALIASES: a name here must NOT exist in the JSON, or it would silently
 *  shadow the real token (check() below).
 *
 *  Both belong to the R4 routes header (SPEC §3 R4 / §4). `abField` is its
 *  two From / To fields: 36 px, not the 40 px `field` of the search page.
 *  `chipHeader` is the chip row under them: 30 px, neither `chip` (36, the
 *  chips floating over the map) nor `chipCompact` (32). The header's
 *  published height — 127 px in a browser tab — is
 *  8 + 36 + 3 + 36 + 6 + 30 + 8, and does not close without both.
 *  `swapGlyph` is the ⇅ in that header: SPEC §4 draws it at 19, one step
 *  above `font.size.button` (17, which the ✕ beside it uses). It is an
 *  arrow rather than type, so it is a size and not a font size. */
const SIZES = {
  "sz-abField": "36px",
  "sz-chipHeader": "30px",
  "sz-swapGlyph": "19px",
};

/** The two LEGEND colours, derived from `tokens.overlay` (SPEC §6.2).
 *
 *  The overlay section is otherwise not emitted — maplibre paints it from
 *  src/mapTheme.ts and a custom property a canvas cannot read would be a
 *  second source of truth. The layers sheet's legend is the exception: it is
 *  ordinary CSS, drawn beside the switch, and it is legending the overlay,
 *  so its colours must BE the overlay's rather than two hexes typed into
 *  index.css beside them (CR-02 slice B review, finding 5).
 *
 *  `--c-shadeSwatch` is the shade overlay's real paint — `#000 @ 0.43`,
 *  `overlay.shade` — over the card behind it, rather than the invented grey
 *  the swatch used to carry.
 *
 *  `--g-noiseRamp` takes its five hues from `overlay.noise.stops`, so a
 *  designer moving a stop moves the legend with it. The ALPHA is the
 *  legend's own and lives here: the raster's (`overlay.noise.alpha`, 40-110
 *  of 255) is tuned to sit translucently over a map, and a 8 px bar on a
 *  white card painted at those values is barely visible. The ramp still
 *  climbs, so the bar still reads quiet → loud. */
const LEGEND_ALPHA = ["66", "99", "bb", "dd", ""];

function legend(tokens) {
  const { shade, noise } = tokens.overlay;
  const rgb = shade.color.slice(1).match(/../g).map((h) => parseInt(h, 16));
  const stops = noise.stops.map((hex, i) => `${hex}${LEGEND_ALPHA[i]}`).join(", ");
  return {
    "c-shadeSwatch": `rgba(${rgb.join(",")},${shade.opacity})`,
    "g-noiseRamp": `linear-gradient(90deg, ${stops})`,
  };
}

const FONT_FACES = ["400", "600", "700"]
  .map(
    (w) =>
      `@font-face { font-family: "Source Sans 3"; font-weight: ${w}; ` +
      `font-display: swap; src: url(/fonts/SourceSans3-${w}.woff2) format("woff2"); }`
  )
  .join("\n");

/** `--prefix-name: value;` lines, indented two spaces. */
function decls(prefix, obj, unit = "") {
  return Object.entries(obj)
    .map(([k, v]) => `  --${prefix}${k}: ${v}${unit};`)
    .join("\n");
}

/** A generator that silently invents a token is worse than no generator: the
 *  CSS would carry a colour the design system does not have, and nothing
 *  would say so. So both tables are checked against the source palette
 *  before a byte is written (CLAUDE.md — scripts assert their output and
 *  fail loud):
 *
 *   - an A11Y override must name a token that EXISTS. If tokens.json renames
 *     or drops `warn`, the override would otherwise conjure a `--c-warn`
 *     out of nothing.
 *   - an ALIAS (or a SIZES entry) must name a token that does NOT exist, or it
 *     silently shadows the real one.
 *   - the dark palette must have exactly the light one's keys, or a missing
 *     dark key silently inherits the light value at runtime.
 */
function check(tokens) {
  const light = Object.keys(tokens.color.light);
  const dark = Object.keys(tokens.color.dark);
  const problems = [];
  for (const theme of ["light", "dark"]) {
    for (const key of Object.keys(A11Y[theme])) {
      if (!Object.hasOwn(tokens.color[theme], key)) {
        problems.push(`A11Y override "${key}" (${theme}) names no token in tokens.json`);
      }
    }
    for (const key of Object.keys(ALIASES[theme])) {
      const name = key.replace(/^c-/, "");
      if (Object.hasOwn(tokens.color[theme], name)) {
        problems.push(`alias "--${key}" (${theme}) shadows the real token "${name}"`);
      }
    }
  }
  for (const key of Object.keys(SIZES)) {
    const name = key.replace(/^sz-/, "");
    if (Object.hasOwn(tokens.size, name)) {
      problems.push(`extra size "--${key}" shadows the real token "size.${name}"`);
    }
  }
  // the legend's alpha ramp is written per stop, so a stop added or removed
  // upstream must be noticed here rather than silently dropped
  if (tokens.overlay.noise.stops.length !== LEGEND_ALPHA.length) {
    problems.push(
      `overlay.noise.stops has ${tokens.overlay.noise.stops.length} stops, ` +
        `LEGEND_ALPHA has ${LEGEND_ALPHA.length}`
    );
  }
  if (!/^#[0-9a-f]{6}$/i.test(tokens.overlay.shade.color)) {
    problems.push(`overlay.shade.color "${tokens.overlay.shade.color}" is not a six-digit hex`);
  }
  for (const key of light) if (!dark.includes(key)) problems.push(`color.dark has no "${key}"`);
  for (const key of dark) if (!light.includes(key)) problems.push(`color.light has no "${key}"`);
  if (problems.length) {
    throw new Error(`tokens.mjs: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`);
  }
}

function colours(theme, tokens) {
  const palette = { ...tokens.color[theme], ...A11Y[theme] };
  return [decls("c-", palette), decls("", ALIASES[theme])].filter(Boolean).join("\n");
}

export function generate(tokens) {
  check(tokens);
  const f = tokens.font;
  const light = [
    colours("light", tokens),
    "",
    `  --font-ui: ${f.family.ui};`,
    `  --font-mono: ${f.family.mono};`,
    "",
    decls("fs-", f.size, "px"),
    "",
    decls("fw-", f.weight),
    "",
    decls("lh-", f.lineHeight),
    "",
    decls("tr-", f.tracking),
    "",
    decls("r-", tokens.radius, "px"),
    "",
    decls("sp-", tokens.space, "px"),
    "",
    // `handle` is a [w, h] pair the CSS writes out itself (kit-sheet-handle);
    // every other size is a single length.
    decls(
      "sz-",
      Object.fromEntries(Object.entries(tokens.size).filter(([, v]) => typeof v === "number")),
      "px"
    ),
    decls("", SIZES),
    decls("", RING),
    "",
    decls("", legend(tokens)),
    "",
    decls("sh-", tokens.shadow),
    "",
    decls(
      "m-",
      Object.fromEntries(
        Object.entries(tokens.motion).filter(([k]) => k !== "reducedMotion")
      )
    ),
  ].join("\n");

  const bp = Object.entries(tokens.breakpoints)
    .map(([name, v]) => {
      const range =
        v.min === undefined ? `≤ ${v.max}` : v.max === undefined ? `≥ ${v.min}` : `${v.min}–${v.max}`;
      return `   ${name.padEnd(8)} ${range}: ${v.layout}`;
    })
    .join("\n");

  return `/* GENERATED by scripts/tokens.mjs from docs/design/handoff/tokens.json.
   Do not edit: \`npm run tokens\` rewrites it and tokens.test.ts fails on
   any drift. Change the JSON, or the ALIASES / A11Y tables in the script. */

${FONT_FACES}

:root {
${light}
}

/* The device's own \`prefers-color-scheme\` is deliberately NOT a theme here
   (2026-09-06). The theme is a decision the reader makes (Settings) or the
   sun over their city makes (ui/theme.ts), and \`data-theme\` is always
   written — ui/useTheme.ts. */
:root[data-theme="dark"] {
${colours("dark", tokens)}
}

/* Breakpoints — src/ui/layout/breakpoints.ts owns them in code, because a
   media query cannot read a custom property:
${bp}
*/
`;
}

export function render() {
  return generate(JSON.parse(readFileSync(SOURCE, "utf8")));
}

// `node scripts/tokens.mjs` writes the file; imported, the module only
// renders (which is how the drift test reads it).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(TARGET, render());
  console.log(`wrote ${TARGET}`);
}
