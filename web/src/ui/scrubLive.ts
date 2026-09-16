// The minute the reader is HOLDING on the day scrubber, published outside
// React so the shade layer can follow the thumb every frame. The reducer
// still gets the throttled `scrub` dispatches (DayScrubber, DISPATCH_MS) —
// the cards, the clock and the store need a minute that settles — but the
// WebGL overlay costs nothing per frame and a 100 ms step between thumb and
// shadow read as lag on the first live desktop (Viktor, 2026-09-15).
// Null = nothing held; the layer then follows the shell's minute as before.

type Listener = (min: number | null) => void;
const listeners = new Set<Listener>();
let live: number | null = null;

export function liveMinute(): number | null {
  return live;
}

/** Publish the held minute (or null when the drag settles). Idempotent. */
export function setLiveMinute(min: number | null): void {
  if (min === live) return;
  live = min;
  for (const l of listeners) l(min);
}

export function subscribeLive(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
