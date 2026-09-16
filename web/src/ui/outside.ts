// Where the walker stands relative to the city's data (UI redesign Task 14,
// 2026-09-05).
//
// The shade and noise layers stop at the border the pipeline exports
// (common.export_border); a fix beyond it can still be routed FROM in
// theory, but nothing the app promises is true out there. Two screens ask
// the same question about it — the banner on Home ("you're outside
// Frankfurt") and the city sheet's context line ("1.2 km outside
// Frankfurt's data") — so the question is answered once, here, as a pure
// function over the geometry and the fix.
import type { LngLat } from "../components/MapView";
import { distanceToBorder, insideBorder } from "../plan/hours";
import type { BorderGeom } from "../shade/ShadeLayer";
import { km } from "./time";

export type Outside = {
  /** Metres to the nearest border vertex (hours.distanceToBorder). */
  m: number;
  /** The same distance as the catalog wants it: one decimal, "1.2". */
  km: string;
};

/** Null whenever the banner must not appear: no border loaded yet, no fix,
 *  a fix inside the city, or a geometry with no vertices to measure to. */
export function outsideInfo(border: BorderGeom | null, gps: LngLat | null): Outside | null {
  if (!border || !gps) return null;
  const [lng, lat] = gps;
  if (insideBorder(border, lng, lat)) return null;
  const m = distanceToBorder(border, lng, lat);
  if (!Number.isFinite(m)) return null;
  return { m, km: km(m) };
}
