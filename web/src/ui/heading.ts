// Which way the walker is facing — the arrow the GPS dot becomes in Navigate
// (owner ruling 2026-09-16: "the GPS dot is good; can it be an arrow in nav
// mode?"; DECISIONS.md).
//
// Two sources, in this order. The fix's own `coords.heading` is the
// direction of TRAVEL, which is what a walker wants — but a phone only knows
// it while it is moving, and Geolocation hands back NaN (or the last number
// it had) when the walker stands still. So the fix's heading counts only
// above MOVING_M_PER_S; below that the compass answers, which is the way the
// PHONE points — close enough for someone pushing a stroller in front of
// them. Neither, and the dot is a dot.
//
// Everything here is pure (heading.test.ts). The listeners and the iOS
// permission are in useHeading.ts; the arrow itself is drawn by MapView,
// which hands MapLibre a compass heading and lets the map-aligned marker
// take the camera's bearing off it.

/** Below this a fix's heading is noise: a walker with a stroller does
 *  ~1.1 m/s, a phone in a pocket at a bus stop reports 0.1–0.4. */
export const MOVING_M_PER_S = 0.5;

/** Degrees into [0, 360). */
export function normDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** The fix's heading, when the fix says the walker is moving. Null while
 *  standing still, and for the NaN a browser sends when it has no idea. */
export function motionHeading(c: { heading: number | null; speed: number | null }): number | null {
  if (c.speed === null || !Number.isFinite(c.speed) || c.speed <= MOVING_M_PER_S) return null;
  if (c.heading === null || !Number.isFinite(c.heading)) return null;
  return normDeg(c.heading);
}

/** What a device-orientation event carries that a compass can be read from. */
export type OrientationReading = {
  alpha: number | null;
  absolute?: boolean;
  /** iOS only: degrees clockwise from magnetic north, already a heading. */
  webkitCompassHeading?: number;
};

/** A compass heading from an orientation event, or null when the event
 *  cannot give one. iOS's `webkitCompassHeading` is a heading as it stands.
 *  The standard `alpha` runs COUNTER-clockwise from north, hence 360 − α —
 *  and only when the browser calls it absolute: a relative alpha is
 *  measured from wherever the phone pointed when the page loaded, which is
 *  an arrow to nowhere. */
export function compassHeading(e: OrientationReading): number | null {
  const ios = e.webkitCompassHeading;
  if (typeof ios === "number" && Number.isFinite(ios)) return normDeg(ios);
  if (e.absolute !== true) return null;
  if (e.alpha === null || !Number.isFinite(e.alpha)) return null;
  return normDeg(360 - e.alpha);
}

/** The arrow's heading: the fix's while moving, else the compass, else none. */
export function pickHeading(motion: number | null, compass: number | null): number | null {
  return motion ?? compass;
}

/** Signed short-way-round difference `to − from`, in (−180, 180]:
 *  359 → 1 is +2, not −358. */
export function deltaDeg(from: number, to: number): number {
  const d = normDeg(to - from);
  return d > 180 ? d - 360 : d;
}

/** Has the compass swung at least `minDeg` since `prev`, the short way round?
 *  Anything is a turn from nothing. */
export function turned(prev: number | null, next: number, minDeg: number): boolean {
  return prev === null || Math.abs(deltaDeg(prev, next)) >= minDeg;
}

/** How long the drawn arrow takes to settle on a new heading: an
 *  exponential approach that is 95 % of the way there in this time. A fix
 *  lands once a second and the heading with it, in steps; an arrow that
 *  stepped with them read as stutter on a real walk (owner, 2026-09-16). */
export const EASE_MS = 300;
/** Closer than this and the arrow is simply put on the target. */
export const SNAP_DEG = 0.1;

/** One frame of the arrow's turn: where it is drawn `dtMs` after standing
 *  at `cur`, heading for `target` the short way round. Never overshoots,
 *  and returns exactly `target` once within SNAP_DEG so a loop can stop on
 *  equality. A frame of no time is a frame of no turn. */
export function easeHeading(cur: number, target: number, dtMs: number): number {
  const d = deltaDeg(cur, target);
  if (Math.abs(d) <= SNAP_DEG) return normDeg(target);
  const k = 1 - Math.exp((-3 * Math.max(0, dtMs)) / EASE_MS);
  return normDeg(cur + d * k);
}
