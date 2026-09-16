// "Tap the map to start elsewhere", once (CR-01 edit 6).
//
// It was a permanent subline under the Wander title, which cost a whole line
// of header on every visit to say something a reader needs to be told once.
// A toast on the first visit says it just as well and gives the line back to
// the map (the CR's own words: "one-time toast on first Wander visit").
//
// "First" is per BROWSER, so the flag is in localStorage — and per SESSION as
// well, because a private window, a cleared store or a browser that throws on
// storage must not turn "once" into "every time the loops screen mounts".
const KEY = "sw.wanderHint";

let spent = false;

/** True exactly once: the first call of the first session that finds no flag
 *  written. Every later call — this session or any other — is false. */
export function takeWanderHint(): boolean {
  if (spent) return false;
  spent = true;
  try {
    if (localStorage.getItem(KEY) === "1") return false;
    localStorage.setItem(KEY, "1");
  } catch {
    // no storage: once per session is the honest fallback
  }
  return true;
}

/** Tests only: forget both halves of the flag. */
export function resetWanderHint(): void {
  spent = false;
}
