// What the map says when one of its sources cannot load, and what the shell
// does about it.
//
// QA F2-08 (2026-09-06): with the basemap `.pmtiles` 404ing, the map was a
// flat pale rectangle with the GPS dot, the search bar and the tab bar all
// present and apparently working. Nothing said anything was wrong, so a
// first-time visitor had no way to tell a broken download from the design.
//
// MapLibre's error event is noisy — one per tile, per frame, per retry — so
// MapView debounces it to one call per kind per map, and this decides which
// kinds are worth interrupting the walker for.

import { useCallback } from "react";
import { t } from "../i18n/t";
import type { Action } from "./shellState";

/** Which of the map's three tiers failed.
 *  - `basemap` the streets themselves (the city's `.pmtiles`, or the
 *    debug page's OSM raster). Without it the map is an empty rectangle.
 *  - `tiles`   an overlay: the noise raster. The map is still a map.
 *  - `other`   anything else MapLibre complains about (a glyph range, a
 *    sprite, a GeoJSON source we filled ourselves). */
export type MapErrorKind = "basemap" | "tiles" | "other";

/** Classify a MapLibre error by the source that raised it, falling back to
 *  the message when the event carries no `sourceId` (the pmtiles protocol
 *  can fail before the source is named). Pure — the source ids are
 *  MapView's own: `protomaps`/`osm` for the basemap, `noise` for the
 *  overlay. */
export function mapErrorKind(sourceId: string | undefined, message: string): MapErrorKind {
  if (sourceId === "protomaps" || sourceId === "osm") return "basemap";
  if (sourceId === "noise") return "tiles";
  if (sourceId !== undefined) return "other";
  if (/\.pmtiles|pmtiles:\/\//.test(message)) return "basemap";
  if (/\/noise\//.test(message)) return "tiles";
  return "other";
}

/**
 * The shell's answer to a map that could not load. Only `basemap` is worth
 * saying out loud: a missing noise overlay is a toggle the walker did not
 * notice, but a missing basemap is the whole screen.
 *
 * The toast says "reload", not "retry", because there is no seam to re-add
 * the source: the style — and with it the pmtiles source — is built once per
 * (city, basemap, theme) in `buildStyle`, and the only thing that rebuilds it
 * is `setStyle`, which throws away every custom source and the WebGL shade
 * layer with it. Offering a Retry would mean either a full style reinstall on
 * a button the walker taps blind, or a `Toast` that can carry an action,
 * which it cannot (`kit/Toast.tsx` takes a string). A reload does the same
 * work, honestly. Worth revisiting if this turns out to be common.
 */
export function useMapErrors(dispatch: (a: Action) => void): (kind: MapErrorKind, message: string) => void {
  return useCallback(
    (kind: MapErrorKind) => {
      if (kind !== "basemap") return;
      dispatch({ type: "toast", text: t("map.basemapFailed") });
    },
    [dispatch]
  );
}
