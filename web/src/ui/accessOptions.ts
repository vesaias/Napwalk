// Which access modes the UI offers (Viktor, 2026-09-08: wheelchair is out
// of the UI for now — the router, the settings whitelist and `a=wheelchair`
// links keep working, so a stored or shared wheelchair walk still shows
// its mode rather than nothing).
import type { Access } from "../router/astar";

const OFFERED: Access[] = ["walk", "stroller"];

/** The segment's options: the offered modes, plus the current one when it
 *  is not offered (so it can still be read, and left). */
export function accessOptions(current: Access): Access[] {
  return OFFERED.includes(current) ? OFFERED : [...OFFERED, current];
}
