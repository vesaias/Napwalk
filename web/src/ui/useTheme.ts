// The theme the document and the map wear, and the one thing that makes it
// move on its own (2026-09-06).
//
// Lifted out of useCity.ts when the theme model changed: "auto" used to mean
// the device's `prefers-color-scheme` and a `matchMedia` listener was the
// whole implementation. The third option is now "daylight" — the sun over
// the SELECTED CITY — which no media query can answer and which turns over
// twice a day whether or not anything else in the shell re-renders. So this
// hook ticks.
//
// `data-theme` is now ALWAYS written. Nothing is left to the cascade's
// `prefers-color-scheme` branch, because there no longer is one
// (tokens.css): a light default that a dark phone silently overrode was
// exactly the behaviour the user asked us to drop.
import { useEffect, useState } from "react";
import type { City } from "../cities";
import type { MapTheme } from "../components/MapView";
import { applySettings, type Settings, type ThemePref } from "../plan/settings";
import { resolveTheme, type Theme } from "./theme";
import { cityClock, sunriseFor, sunsetFor } from "./time";

/** Once a minute. Sunrise and sunset are minute-resolution values, so this
 *  is as fine as the answer can be, and the work behind it is one cached
 *  Intl format plus two cached table lookups. */
const TICK_MS = 60_000;

/** The resolved theme for a preference right now. Exported for the Settings
 *  row, which shows the same answer in words. */
export function themeNow(pref: ThemePref, city: City): Theme {
  if (pref !== "daylight") return pref;
  const { day, minute } = cityClock(city);
  return resolveTheme(pref, minute, sunriseFor(day, city), sunsetFor(day, city));
}

/** Paint the resolved theme onto the document: the attribute every token in
 *  tokens.css hangs off, and the browser-chrome colour beside it. The colour
 *  is READ BACK from `--c-page` rather than written twice — index.html and
 *  vite.config.ts already carry the light value, and a hex literal here
 *  would be a third place to forget. */
function paint(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const page = getComputedStyle(document.documentElement).getPropertyValue("--c-page").trim();
  if (page) meta.setAttribute("content", page);
}

/** The resolved light/dark, re-evaluated every minute and on every change of
 *  city or preference. The wall clock it reads is the real one in the city's
 *  zone — not the shell's `startMin`, which a share link may have pinned. */
export function useTheme(settings: Settings, city: City): MapTheme {
  // applySettings pushes locale and pace. Since Task 14 the Settings screen
  // also applies them SYNCHRONOUSLY (useSettings patches before it sets
  // state, so the language row does not render one frame in the old
  // catalog), which makes this the boot path and the `relax` path — not the
  // only path it once was (review B12).
  useEffect(() => {
    applySettings(settings);
  }, [settings]);

  const pref = settings.theme;
  const [theme, setTheme] = useState<Theme>(() => themeNow(pref, city));

  useEffect(() => {
    const tick = () => setTheme(themeNow(pref, city));
    tick();
    // Only the daylight option moves by itself; the other two are already
    // the answer and an interval would be a wake-up for nothing.
    if (pref !== "daylight") return;
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [pref, city]);

  useEffect(() => {
    paint(theme);
  }, [theme]);

  return theme;
}
