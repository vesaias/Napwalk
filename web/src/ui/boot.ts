// What a page load starts from (lifted out of AppShell.tsx for B4,
// 2026-09-10, unchanged).
//
// Two halves, and both are read once at import rather than in an effect:
// `?kit`, which swaps the whole app for the component gallery, and the
// share-link parameters the shell boots its reducer from. The address bar
// still carries what the reader opened at that moment — `useHistory`
// rewrites it on the first render — so anything that wants to read the
// ORIGINAL query string has to do it here, or from a module that is imported
// as early as this one (ui/resume.ts is the other).
//
// It sits beside `resume.ts` on purpose: between them they are the whole
// answer to "where does this page load come back to", the URL half and the
// session half.
import { DEFAULT_CITY, type City, type CityId } from "../cities";
import { autoPreference, type Preference } from "../plan/preference";
import { storedCityId } from "../plan/settings";
import { decodeState } from "../urlState";
import { bootShell, type ShellState } from "./shellState";
import { cityNowClamped, sunsetFor } from "./time";
import {
  askEdge,
  cityFromTimeZone,
  deviceTimeZone,
  fetchWhere,
  pickBootCity,
  type EdgeWhere,
} from "./where";

/** ?kit shows the component gallery instead of the app — a dev aid while
 *  the redesign lands screen by screen (Task 10, 2026-09-05). Dev only, so
 *  the gallery never reaches a production bundle. */
export const showKit =
  import.meta.env.DEV &&
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("kit");

/** Today's share links (urlState.ts) still open: the city, the clock, the
 *  pins and the preset are read once at boot. Writing the URL back is
 *  ui/history.ts's job. */
export const BOOT = decodeState(typeof location === "undefined" ? "" : location.search);

/** The city the reader's own settings name, if any. Read once, here, so
 *  that "did anybody choose a city?" is asked at the same moment as
 *  "did the link name one?" — a later read would see whatever the session
 *  has since written. */
const STORED_CITY: CityId | null = storedCityId();

/** The device's IANA time zone, read once. */
export const BOOT_TZ: string | null = deviceTimeZone();

/**
 * The city THIS LINK names — and the answer is not simply `c=`.
 *
 * `encodeState` writes `c=` on every link since the S7 review (F1), but the
 * links written before it omitted the default city, so a Frankfurt walk
 * travelled as pins and nothing else. `BOOT.city ?? null` read those as "no
 * link at all", and a reader in London opened a Frankfurt walk on a London
 * graph — with the address bar then minting a share link that claimed the
 * Frankfurt pins were in London. A `c=`-less link that CARRIES A WALK is a
 * link for the default city, because that is the only city it could ever
 * have been written in. A bare `/` carries no walk and names no city.
 */
const LINK_CITY: CityId | null = BOOT.city ?? (BOOT.start || BOOT.dest ? DEFAULT_CITY : null);

/**
 * The city a page load opens on when the stored settings name none
 * (backlog B1, ui/where.ts): the link, then the device's CLOCK. No prompt,
 * no network, no position.
 *
 * The link is in it since the S7 review — see `LINK_CITY` — and that is
 * safe because nothing here is written: `useSettings` hands this to
 * `loadSettings` as the record's DEFAULT, and a default the reader did not
 * choose never reaches localStorage (S7 review F2, plan/settings.ts).
 * `bootSettings` still lays `c=` on top as a session override, which is why
 * where.test.ts holds the two paths together.
 */
export const BOOT_CITY: CityId = pickBootCity({
  stored: STORED_CITY,
  link: LINK_CITY,
  tz: BOOT_TZ,
});

/** Which of `pickBootCity`'s sources named BOOT_CITY — the same order the
 *  pick takes them in. Read by ui/useAnalytics.ts alone: a time-zone guess
 *  is a city switch nobody tapped, and the dashboard counts it as one. */
export const BOOT_CITY_SOURCE: "link" | "stored" | "timezone" | "default" = LINK_CITY
  ? "link"
  : STORED_CITY
    ? "stored"
    : cityFromTimeZone(BOOT_TZ) !== null
      ? "timezone"
      : "default";

/** Should this page load ask the edge where it is? Only when neither the
 *  reader's settings nor the link nor the clock could say (ui/where.ts).
 *  A reader in Europe/London is already in London: no request is made.
 *
 *  `!showKit` because the gallery is not the app: `?kit` never renders a
 *  map, never loads a graph and has no city to be in, and the request it
 *  used to fire was pure waste (S7 review F5). `debug.html` never imports
 *  this module and so never asked in the first place. */
export const BOOT_ASK_EDGE: boolean =
  !showKit &&
  askEdge({
    stored: STORED_CITY,
    link: LINK_CITY,
    tz: BOOT_TZ,
  });

/**
 * The edge's answer, or null when it was not worth asking.
 *
 * Fired HERE, at import, rather than from an effect — for the same reason
 * `resume.ts` reads its snapshot at import. The graph load waits on it
 * (ui/useCity.ts), so every millisecond between the module graph landing and
 * React's first effect is a millisecond the request has already spent. It
 * also makes "at most once per page load" a property of the module system
 * rather than of a guard: React's dev StrictMode mounts every effect twice,
 * and two boots asking the edge twice is exactly what this must not do.
 *
 * The promise never rejects (ui/where.ts).
 */
export const BOOT_EDGE: Promise<EdgeWhere | null> | null = BOOT_ASK_EDGE ? fetchWhere() : null;

/** A link speaks in presets, the shell in preferences (ui/share.ts reads
 *  this the other way round). */
const PRESET_PREF: Record<string, Preference> = {
  balanced: "balanced",
  maxShade: "shade",
  maxQuiet: "quiet",
};

/**
 * The state the shell's reducer opens on.
 *
 * `t` (clock), `m` (tab), `d` (loop length), `s`/`e` (pins) and `r`
 * (candidate) are consumed by `bootShell`; `p` (preset) picks the preference
 * here, because only this side knows the sun. `c` (city) and `a` (access)
 * are settings a link overrides for the session, and were read into
 * `settings` before this runs (ui/useSettings.ts).
 */
export function bootState(city: City, day: string, autoPref: boolean): ShellState {
  const startMin = BOOT.minutes ?? cityNowClamped(city);
  const auto = autoPreference(startMin, sunsetFor(day, city)).pref;
  const linked = BOOT.preset ? PRESET_PREF[BOOT.preset] : undefined;
  return bootShell(BOOT, {
    startMin,
    pref: linked ?? (autoPref ? auto : "balanced"),
    prefAuto: linked === undefined && autoPref,
    destName: "", // a link carries coordinates, never a name: looked up below
  });
}
