import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Read as text, the way GraphContext.test.ts reads RouteTab and tokens.test.ts
// reads tokens.css. The property below is about WHERE a call may appear in the
// source, not about anything a render produces, and this repo has no DOM test
// environment to mount a component in (jsdom is not a dependency).
const src = readFileSync(resolve(__dirname, "DayScrubber.tsx"), "utf8");
/** The same file with its comments taken out — the prose in it quotes the very
 *  call shape these tests forbid, and a grep cannot tell the two apart. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("DayScrubber — nothing dispatches during a render (P2, 2026-09-10)", () => {
  // The defect: `setPlaying((p) => { if (p) settle(); return !p; })`. React
  // runs a state updater during the RENDER phase to compute the next value —
  // the captured stack was `dispatchReducerAction` ← flush ← settle ← the
  // updater ← `basicStateReducer` ← `updateReducer` — so `settle()`'s
  // `dispatch` landed on the shell while this component was rendering:
  // "Cannot update a component (`Shell`) while rendering a different
  // component (`DayScrubber`)". An updater must be pure; the simplest way to
  // guarantee that here is to have no updaters at all.
  it("never hands setPlaying a function", () => {
    const calls = [...code.matchAll(/setPlaying\(([^)]*)/g)].map((m) => m[1].trim());
    expect(calls.length).toBeGreaterThan(0);
    for (const arg of calls) {
      expect(arg, `setPlaying(${arg}…) — an updater can run during render`).toMatch(
        /^(true|false|!playing)$/,
      );
    }
  });

  // ...and the settling that came out of the updater is still there, on the
  // pausing side only. Deleting it would silence the warning too, and would
  // leave the thumb holding a minute the shell never heard about.
  it("still settles when play stops, in one handler both controls use", () => {
    const at = code.indexOf("const togglePlay");
    expect(at, "togglePlay is the play/pause handler").toBeGreaterThan(-1);
    const body = code.slice(at, code.indexOf("};", at));
    expect(body).toContain("if (playing) settle();");
    expect(body).toContain("setPlaying(!playing);");
    // the button and the card's space bar are the same journey
    expect(code).toContain("onClick={togglePlay}");
    expect(code).toContain("togglePlay();");
  });
});
