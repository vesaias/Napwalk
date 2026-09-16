import { useCallback, useRef } from "react";
import type { Camera, LngLat } from "../components/MapView";

/** Where the map is looking — kept out of React's way.
 *
 *  The camera changes on every frame of a drag and has two readers, neither
 *  of which draws it: the report sheet's "attach my map position" switch,
 *  which asks for the centre once, when the switch goes on (slice 7), and
 *  the resume snapshot, which asks for the whole camera when the tab goes
 *  away (B4). State would re-render the whole shell for a value nobody is
 *  drawing, so it lives in a ref and travels as a getter. All three halves
 *  are stable across renders, so handing `onCamera` to MapView does not
 *  churn its props.
 *
 *  Both getters are null until the map has settled once — a basemap that
 *  never loads raises neither `load` nor `moveend` — and each caller says
 *  so rather than posting a silent null or restoring a camera nobody set. */
export function useMapCentre(): {
  /** Hand this to MapView's `onCamera`. */
  onCamera: (c: Camera) => void;
  /** Hand this to whoever needs to ask where the map is looking. */
  centre: () => LngLat | null;
  /** ...and this to whoever needs the zoom and the angles with it. */
  camera: () => Camera | null;
  /** Be told that it moved — returns its own unsubscribe. Still not React
   *  state: a listener that only marks a snapshot dirty must not re-render
   *  the shell on every settled pan (B4, S6 review finding 4). */
  onMove: (fn: () => void) => () => void;
} {
  const at = useRef<Camera | null>(null);
  const subs = useRef<Set<() => void>>(new Set());
  const onCamera = useCallback((c: Camera) => {
    at.current = c;
    for (const fn of subs.current) fn();
  }, []);
  const centre = useCallback(() => at.current?.center ?? null, []);
  const camera = useCallback(() => at.current, []);
  const onMove = useCallback((fn: () => void) => {
    subs.current.add(fn);
    return () => {
      subs.current.delete(fn);
    };
  }, []);
  return { onCamera, centre, camera, onMove };
}
