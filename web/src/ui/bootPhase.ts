// What the reader is waiting for, and in which order (phone round 3, items
// 2, 5 and 12; the pill dropped 2026-09-15).
//
// Viktor, item 2: "show some loader while the page is loading." Then item
// 12, which is the whole design: "make the map load ASAP, the tiles
// themselves. Rest can be post-loaded to make at least the illusion we are
// not loading 30 MB. So: small loader → tiles → everything else."
//
// The order that follows:
//
//   1. the app shell and the basemap. Nothing else is in flight — the graph
//      core, the shade bands and the city manifest all wait — so the tiles
//      have the connection to themselves. A tiny spinner over the map area,
//      and nothing more, because there is nothing yet to say.
//   2. the graph core, in SILENCE. The map is live — pan, zoom, a tap on a
//      POI all work without a graph — and the only thing that cannot be
//      answered without one is a plan, which has said "finding shade" since
//      long before any of this (ui/usePlanner.ts, the Computing skeleton).
//   3. the departure's shade bands, then the rest in the background, which
//      is unchanged (ui/useShadeBands.ts).
//
// Step 2 used to carry a compact pill over the map — the city's name, a byte
// count, a thin bar and a ✕. Viktor, 2026-09-15: drop it. A city switch is
// the same silence: the map moves on the tap and the graph follows behind
// it. So this module is now about the MAP's wait and nothing else, and the
// only wait a reader is ever shown for the graph is the skeleton on the
// screen that asked for a walk.
//
// Pure and DOM-free apart from one timer; the hook that measures the paint
// is four lines.
import { useEffect, useState } from "react";

/** How long the graph may wait for a basemap that has not painted.
 *
 *  The rule is "tiles first", not "tiles or nothing": a style whose sprite
 *  never arrives, a tile host that is down, a viewport over the sea — all
 *  of them leave `idle` unfired, and routing must not be starved by any of
 *  them. 1.5 s is the same order as the edge-city hold (ui/where.ts), and
 *  it is long enough that on a normal connection the tiles win it. */
export const PAINT_CAP_MS = 1500;

/** Has the basemap drawn — or waited long enough that nothing else should?
 *
 *  One flag, and the cap is part of it. It would read better as two (the
 *  spinner goes when the map PAINTS; the graph starts when the map paints
 *  OR the cap expires) and it would be wrong: a map that never reports —
 *  a tile host that is down, a style whose sprite never lands — would leave
 *  a spinner turning over it for the rest of the session. The cap says "stop
 *  waiting for the map", and everything that was waiting stops. */
export function useBootPaint(): { painted: boolean; gate: boolean; onPainted: () => void } {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done) return;
    const id = window.setTimeout(() => setDone(true), PAINT_CAP_MS);
    return () => window.clearTimeout(id);
  }, [done]);
  return { painted: done, gate: done, onPainted: () => setDone(true) };
}
