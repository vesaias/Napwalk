// WCAG contrast over the design tokens — `npm run contrast`.
//
// The palette is one file, so the check can be one file too: it reads
// tokens.css, resolves both themes (dark is the light palette with the
// [data-theme="dark"] block laid over it, exactly as the cascade does it),
// and measures the pairs the app actually paints. It fails loud rather than
// printing a table nobody reads — a token edit that makes a caption
// unreadable should break a command, not a reader.
//
// It also checks the one typographic rule the catalog has: the space before
// a % sign is U+202F, never an ASCII space and never nothing (format.ts).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(HERE, "..", "src", "tokens.css");
const CATALOGS = ["en", "de"].map((l) => join(HERE, "..", "src", "i18n", `strings.${l}.json`));

/** The declarations inside the FIRST block whose selector matches. */
function block(css, selector) {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`tokens.css has no ${selector} block`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  const out = {};
  for (const line of css.slice(open + 1, close).split("\n")) {
    const m = /^\s*(--[\w-]+)\s*:\s*([^;]+);/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** A token's value with var() indirection followed. */
function resolve(palette, name, seen = new Set()) {
  const raw = palette[name];
  if (raw === undefined) throw new Error(`no such token: ${name}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(raw);
  if (!ref) return raw;
  if (seen.has(name)) throw new Error(`token cycle at ${name}`);
  seen.add(name);
  return resolve(palette, ref[1], seen);
}

/** `#rgb`, `#rrggbb` or `rgba(r, g, b, a)` → channels 0..1 plus alpha. */
function parse(colour) {
  const c = colour.trim();
  const fn = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (fn) {
    const n = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (n.length < 3 || n.some(Number.isNaN)) throw new Error(`not a colour: ${colour}`);
    return { rgb: n.slice(0, 3).map((v) => v / 255), a: n.length > 3 ? n[3] : 1 };
  }
  const h = c.replace("#", "");
  const full = h.length === 3 ? [...h].map((x) => x + x).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a colour: ${colour}`);
  return { rgb: [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255), a: 1 };
}

/** `colour` painted over `backdrop`, as the compositor does it. The hairline
 *  tokens are translucent ink, so a bar's TRACK is not --c-hair — it is
 *  --c-hair over whatever surface it sits on, and measuring the token alone
 *  would report a contrast nobody ever sees. */
function over(colour, backdrop) {
  const f = parse(colour);
  if (f.a >= 1) return f.rgb;
  const b = parse(backdrop);
  if (b.a < 1) throw new Error(`a translucent backdrop cannot flatten: ${backdrop}`);
  return f.rgb.map((v, i) => v * f.a + b.rgb[i] * (1 - f.a));
}

function luminance(channels) {
  const [r, g, b] = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Both arguments are channel triples (0..1) — flatten first, with `over`. */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// fg, bg, the minimum, and where the pair is painted. 4.5 is WCAG AA for
// text (nothing in the app is "large" by the 18.66 px bold / 24 px rule —
// --fs-button is 17); 3.0 is AA for a UI component's own colour.
//
// A colour is either a token name or `[token, backdrop]` when the token is
// translucent — the hairlines are ink at 8 / 15 %, and what a reader sees is
// the hairline OVER the surface under it (`over`, above).
//
// Slice 9 (2026-09-07) grew this table from seven pairs to seventeen: every
// text-on-surface combination the compact UI actually paints, in BOTH
// themes, plus the meters SPEC §10 names. The rule for adding a row is that
// the app paints it somewhere — an unpainted pair that fails is noise, and
// noise is what makes a check stop being read. (--c-bannerMuted has no row
// for exactly that reason: SPEC §4 gives it to the banner's "then" line, and
// turn-by-turn was cut, so nothing paints it yet.)
const PAIRS = [
  // --- text on the card / sheet / web card --------------------------------
  ["--c-ink", "--c-card", 4.5, "body text on a card or sheet"],
  ["--c-muted", "--c-card", 4.5, "captions, row meta, the muted tab label"],
  ["--c-accent", "--c-card", 4.5, "the active tab label, accented row meta, a −N min delta"],
  ["--c-warn", "--c-card", 4.5, "an out-of-city result, a +N min delta, a cost note"],
  ["--c-end", "--c-card", 4.5, "the End button's label, the send that failed"],
  // --- text on the well: fields, tiles, the web card's search -------------
  ["--c-ink", "--c-well", 4.5, "the R4 header's From/To, a duration tile, the `well` tag"],
  ["--c-muted", "--c-well", 4.5, "the auto-preference rule note, the web search placeholder"],
  // --- text on a soft tint: tags and list avatars -------------------------
  ["--c-accent", "--c-accentSoft", 4.5, "the `acc` tag (Recommended, auto), a shady avatar"],
  ["--c-quiet", "--c-quietSoft", 4.5, "the `quiet` tag (Quieter)"],
  // --- text on a solid fill -----------------------------------------------
  ["--c-onAccent", "--c-accent", 4.5, "the primary button's label, the picked duration tile"],
  ["--c-onBanner", "--c-banner", 4.5, "the walk banner, the ink button, a dark chip, the toast"],
  // --- text over the page ground, where no card is between ----------------
  ["--c-ink", "--c-page", 4.5, "the whole-app fallback, and any page a card does not cover"],
  // --- the meters and hairlines: a component's own colour, SPEC §10 -------
  ["--c-accent", ["--c-hair", "--c-card"], 3.0, "the shade bar's fill against its track"],
  ["--c-quietBar", ["--c-hair", "--c-card"], 3.0, "the quiet bar's fill against its track"],
  // --c-hair2 on --c-card has NO row, and that is a finding rather than an
  // omission: it is 1.35:1 in the light theme, and SPEC §4 gives it to the
  // Toggle's off track (over a white card) as well as to the delta card's
  // border. A hairline is decoration and needs no ratio; a switch's off state
  // is a UI state and wants 3:1 under WCAG 1.4.11. Changing `hair2` would
  // reweigh every separator in the app, so it is written up in
  // docs/design/handoff/ERRATA.md for the designer instead of fixed here.
  // --- the focus ring ------------------------------------------------------
  ["--c-focus", "--c-card", 3.0, "the focus ring on a card or sheet"],
  // Three controls draw the ring over the MAP, not over a card: the floating
  // locate button, the route chips and the hour bars. The map's ground is not
  // a CSS token — it is mapTheme.ts's `earth`/`background`, which is set to
  // the same hex as --c-page in both themes (mapTheme.ts:159 MEADOW,
  // mapTheme.ts:173 MEADOW_DARK). So --c-page is the map ground, and the
  // assertion below is checked against mapTheme in `MAP_GROUND` too, so the
  // day the two drift apart this file says so rather than quietly measuring
  // the wrong colour.
  //
  // A chip's own text needs no row of its own, for the same reason: the chip
  // is painted --c-card, opaque, so "chip text over the map ground" is
  // exactly the ink-on-card and accent-on-card rows above, and a dark chip is
  // the onBanner-on-banner one.
  ["--c-focus", "--c-page", 3.0, "the focus ring over the map's own ground"],
  // ...and the HALO, the one new pair ruling 4 introduced and the one this
  // file did not gate until the CR-04 review (L3). It is a 1 px ring drawn
  // between a control's own edge and the 2 px of accent outside it, and its
  // whole job is the case where those two are the SAME green: Start, the
  // picked duration tile, the ink-filled Layers button. Measured against the
  // accent it separates, which is both the fill under it and the ring beside
  // it, because --c-focus and --c-accent are one colour in both themes.
  ["--c-focusHalo", "--c-accent", 3.0, "the ring's halo on an accent-filled control"],
  // --c-focusHalo on --c-banner has NO row, for the reason --c-hair2 has
  // none: it is 1.29:1 in the dark theme, where the halo is the card and the
  // banner is darker still, and it does not need to be anything else. The
  // halo exists to separate an accent ring from an accent FILL; on a dark
  // chip the ring is --c-focus over --c-banner, which is 9:1 and is the pair
  // WCAG 1.4.11 actually asks about. A halo nobody can see on an ink chip
  // costs that chip nothing.
];

// mapTheme.ts's ground colour per theme, and the token it must equal. These
// are the PALETTES — the designer's own literals — not the translated themes
// built from them, which carry no literal of their own to read.
const MAP_GROUND = { light: "MEADOW_PALETTE", dark: "MEADOW_DARK_PALETTE" };

const css = readFileSync(TOKENS, "utf8");
const mapTheme = readFileSync(join(HERE, "..", "src", "mapTheme.ts"), "utf8");

/** A named colour of a named palette in mapTheme.ts.
 *
 *  Anchored on the colon of the declaration, not on the name alone: a bare
 *  prefix match let "MEADOW" find `export const MEADOW_V1` the day the
 *  declaration order changed, and this check would then have passed against
 *  the wrong palette without saying anything (CR-01 review A, finding 9). */
function mapColour(palette, key) {
  const at = mapTheme.indexOf(`export const ${palette}: `);
  if (at < 0) throw new Error(`mapTheme.ts has no ${palette}`);
  const m = new RegExp(String.raw`\b` + key + String.raw`:\s*"(#[0-9a-f]{6})"`, "i")
    .exec(mapTheme.slice(at));
  if (!m) throw new Error(`${palette} has no ${key} colour`);
  return m[1];
}
const ground = (palette) => mapColour(palette, "earth");
const light = block(css, ":root");
const dark = { ...light, ...block(css, '[data-theme="dark"]') };

/** A pair's colour: `"--c-x"`, or `["--c-x", "--c-under"]` when --c-x is
 *  translucent and has to be flattened onto what is behind it. */
function paint(palette, spec) {
  if (Array.isArray(spec)) {
    const [name, under] = spec;
    const value = resolve(palette, name);
    const ground = resolve(palette, under);
    return { channels: over(value, ground), label: `${name} ${value} over ${under} ${ground}` };
  }
  const value = resolve(palette, spec);
  return { channels: over(value, "#ffffff"), label: `${spec} ${value}` };
}

let failed = 0;
for (const [theme, palette] of [["light", light], ["dark", dark]]) {
  console.log(`\n${theme}`);
  for (const [fg, bg, min, where] of PAIRS) {
    const a = paint(palette, fg);
    const b = paint(palette, bg);
    const r = contrast(a.channels, b.channels);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${r.toFixed(2)}:1 (needs ${min.toFixed(1)})  ` +
        `${a.label} on ${b.label} — ${where}`
    );
  }
}

// The map's ground is drawn by maplibre from mapTheme.ts, not by CSS, so the
// pair above is only honest while the two agree.
console.log("\nmap ground");
for (const [theme, palette] of Object.entries(MAP_GROUND)) {
  const token = resolve(theme === "dark" ? dark : light, "--c-page");
  const earth = ground(palette);
  const same = token.toLowerCase() === earth.toLowerCase();
  if (!same) failed++;
  console.log(
    `  ${same ? "ok  " : "FAIL"} ${theme}: --c-page ${token} ${same ? "==" : "!="} ` +
      `${palette}.earth ${earth}`
  );
}

// The two pairs the basemap paints and CSS cannot see (CR-05). A label on
// the map is not a token on a card: its ground is the basemap's own fill,
// and the palettes in mapTheme.ts are the only place either colour exists.
// Both are the CR's own numbers — 9:1 for a place name on the dark ground
// (a label at 12–15 px over a whole city has no card to sit on and no
// second chance), 4.5 for the light park label, which is AA on the park it
// names rather than on the page around it.
console.log("\nmap labels");
const MAP_PAIRS = [
  ["MEADOW_DARK_PALETTE", "city_label", "earth", 9, "a place name on the dark map's ground"],
  ["MEADOW_PALETTE", "park_label", "park_a", 4.5, "a park's name on the park itself"],
];
for (const [palette, fg, bg, min, where] of MAP_PAIRS) {
  const a = mapColour(palette, fg);
  const b = mapColour(palette, bg);
  const r = contrast(parse(a).rgb, parse(b).rgb);
  const ok = r >= min;
  if (!ok) failed++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${r.toFixed(2)}:1 (needs ${min.toFixed(1)})  ` +
      `${palette}.${fg} ${a} on .${bg} ${b} — ${where}`
  );
}

// The narrow no-break space, U+202F: a percent sign is never preceded by an
// ASCII space (which would let a line break there) nor by nothing at all.
console.log("\ncatalogs");
for (const file of CATALOGS) {
  const catalog = JSON.parse(readFileSync(file, "utf8"));
  const bad = Object.entries(catalog).filter(([, v]) => /(?<!\u202f)%/.test(v));
  const name = file.split(/[\\/]/).pop();
  if (bad.length) {
    failed++;
    console.log(`  FAIL ${name}: ${bad.map(([k]) => k).join(", ")} — % without U+202F`);
  } else {
    console.log(`  ok   ${name}: every % is preceded by U+202F`);
  }
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
