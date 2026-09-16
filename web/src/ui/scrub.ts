// The day scrubber's arithmetic (CR-02 edit 5, SPEC §6.7).
//
// Pure, next to ui/layers.ts and for the same reason that one is pure: what
// the thumb means, how fast play runs and where it loops are rules, not
// pixels, and a rule that can only be read off a screenshot is a rule
// nobody can check. The component in ui/DayScrubber.tsx is the markup and
// the timers; every number it moves comes from here.
//
// The track is a WINDOW on the day, not the day: 06:00 to 21:00, which is
// the span the board draws and the only span whose shadows are worth
// looking at. The shade minute the map draws is not clamped to it — a walk
// at 22:30 still paints its own darkness — so `clampMinute` is about the
// CONTROL, and the scrubber says so by showing the value it can reach.

/** 06:00 — the left end of the track (SPEC §6.7). */
export const TRACK_START = 6 * 60;
/** 21:00 — the right end. */
export const TRACK_END = 21 * 60;
export const TRACK_SPAN = TRACK_END - TRACK_START;

/** Play speed: one hour of the day per real second (SPEC §6.7). A sunrise
 *  to sunset run is therefore about thirteen seconds in Frankfurt in
 *  September, which is the CR's "≤ 14 s". */
export const PLAY_MIN_PER_MS = 60 / 1000;

/** ←/→ move a quarter of an hour (SPEC §6.7). The input's own step stays 1:
 *  a drag has to be smooth, so the keyboard step is handled by the keydown
 *  rather than by making every pixel of the drag a 15-minute jump. */
export const NUDGE_MIN = 15;

/** The labels under the track: every third hour, both ends included. */
export const TICKS: readonly number[] = [0, 1, 2, 3, 4, 5].map(
  (i) => TRACK_START + i * 3 * 60,
);

/** Sunrise and sunset for the day being scrubbed (ui/time.ts). */
export type SunWindow = { sunrise: number; sunset: number };

/** A minute the track can actually show. Anything unreadable is the left
 *  end — a NaN thumb is a thumb that has vanished. */
export function clampMinute(minute: number): number {
  if (!Number.isFinite(minute)) return TRACK_START;
  return Math.min(TRACK_END, Math.max(TRACK_START, minute));
}

/** Where a minute sits on the track, 0 (06:00) to 1 (21:00). The gradient
 *  stops and the tick positions are the same question asked in percent. */
export function trackPos(minute: number): number {
  return (clampMinute(minute) - TRACK_START) / TRACK_SPAN;
}

/** ...and back: the minute at a position on the track, as a whole minute. */
export function minuteAt(pos: number): number {
  const p = Number.isFinite(pos) ? Math.min(1, Math.max(0, pos)) : 0;
  return Math.round(TRACK_START + p * TRACK_SPAN);
}

/**
 * One frame of play: `dtMs` of real time later, and back at sunrise once the
 * sun has set.
 *
 * The result is deliberately NOT rounded — the caller rounds for the input's
 * value, and rounding here would lose a 16 ms frame's 0.96 minutes every
 * time and play would crawl.
 *
 * A window that makes no sense — the two ends equal, or a day key the sun
 * code could not answer for — falls back to the whole track rather than
 * looping on the spot for ever.
 */
export function stepPlay(minute: number, dtMs: number, sun: SunWindow): number {
  const rise = clampMinute(sun.sunrise);
  const set = clampMinute(sun.sunset);
  const from = set > rise ? rise : TRACK_START;
  const to = set > rise ? set : TRACK_END;
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const next = clampMinute(minute) + dt * PLAY_MIN_PER_MS;
  return next > to ? from : next;
}

/** ←/→ on the track: a quarter hour either way, and no further than the
 *  track's own ends. */
export function nudge(minute: number, delta: number): number {
  return clampMinute(Math.round(clampMinute(minute) + delta));
}
