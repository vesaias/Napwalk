// The user's settings, as the shell holds them (UI redesign Task 14).
//
// TWO records, not one — that is the whole point of this file:
//
//   - `persisted` is what localStorage holds, and the only thing
//     `saveSettings` is ever handed.
//   - `session` is what the screens read: `persisted` with this session's
//     overrides laid over it — a share link's `c=` / `a=`.
//
// A ONE-OFF loosening is no longer one of these (compact UI slice 2): the
// access chip and the no-route card's "Allow cobbles" / "Walk mode" write a
// per-TRIP override in the shell's own state (shellState.Trip), which resets
// on the next destination. `relaxSettings` stays because the boot override is
// exactly the same transition, and the invariant below is what makes handing
// `persisted` to applySettings sound.
//
// Keeping one record and writing it back was a real bug (review B1): the
// ref that `patch` merged into absorbed the boot overrides and every relax,
// so opening someone's `?c=nyc&a=wheelchair` link and then tapping the theme
// wrote THEIR city and access into YOUR settings, for good.
//
// The three transitions are pure and exported, so that invariant is a test
// rather than a promise (useSettings.test.ts).
//
// The persisting write is also synchronous — `saveSettings` before
// `setPair`, not in an effect. The language row depends on it: `t()` reads a
// module-level locale, so if the catalog only switched after the render that
// followed, the first frame of the new language would still be written in
// the old one.
import { useRef, useState } from "react";
import type { CityId } from "../cities";
import { loadSettings, saveSettings, storedCityId, type Settings } from "../plan/settings";
import type { Access } from "../router/astar";

/** What a share link may override for the session, and never for good.
 *  `avoidCobbles` joined the list with `ac=` (review B-3): a link reproduces
 *  the walk, and the cobble wall is half of what decides which routes exist. */
export type BootOverride = { city?: CityId; access?: Access; avoidCobbles?: boolean };

export type SettingsPair = {
  /** Written to localStorage; only `patchSettings` touches it. */
  persisted: Settings;
  /** What the screens read and the planner is handed. */
  session: Settings;
  /** Did the READER name this city — or is it still a guess?
   *
   *  False on a first visit: `persisted.city` is then the device's time zone
   *  or the edge's answer (backlog B1), a default the reader never chose.
   *  `saveSettings` leaves `city` out of the stored record while this is
   *  false, so an unrelated settings change no longer quietly adopts the
   *  guess (S7 review F2) and the next page load asks the same two cheap
   *  sources again. Any `patch` that carries a city sets it: picking one in
   *  Settings, or the access sheet's "Make default", is a choice. */
  cityChosen: boolean;
};

export type SettingsStore = {
  settings: Settings;
  /** Has the reader chosen a city, rather than been guessed at? The graph
   *  hold reads it: an explicit pick releases the wait for the edge, which
   *  otherwise ran its whole 1.5 s budget for an answer nobody wanted any
   *  more (S7 review F6, ui/useCity.ts). */
  cityChosen: boolean;
  /** What localStorage holds, under this session's overrides. The address
   *  bar needs both to tell a link's access override from the reader's own
   *  setting (ui/history.ts, historyUrl). */
  persisted: Settings;
  /** Change and persist — the Settings screen, and the access sheet's
   *  "Make default". */
  patch: (p: Partial<Settings>) => void;
  /** The edge's late answer to "which city is this?" — a default, stored
   *  nowhere, ignored once anything the reader chose has spoken (B1). */
  defaultCity: (city: CityId) => void;
};

/** The pair a session opens on: the stored record, and the same record with
 *  the link's overrides on top. `cityChosen` says whether `stored.city` is
 *  the reader's own — `storedCityId() !== null` at the call site. */
export function bootSettings(
  stored: Settings,
  boot: BootOverride,
  cityChosen = false
): SettingsPair {
  return relaxSettings(
    { persisted: stored, session: stored, cityChosen },
    {
      ...(boot.city ? { city: boot.city } : {}),
      ...(boot.access ? { access: boot.access } : {}),
      // `false` is a value here, not an absence: a link that says "cobbles
      // are fine" has to say so to a reader whose own setting avoids them.
      ...(boot.avoidCobbles === undefined ? {} : { avoidCobbles: boot.avoidCobbles }),
    }
  );
}

/** A Settings-screen change: into both records, because a setting the reader
 *  chose is also what they want next time. */
export function patchSettings(pair: SettingsPair, p: Partial<Settings>): SettingsPair {
  return {
    persisted: { ...pair.persisted, ...p },
    session: { ...pair.session, ...p },
    // a patch that names a city IS the reader choosing one (S7 review F2)
    cityChosen: pair.cityChosen || p.city !== undefined,
  };
}

/** A session override: into the session only. `persisted` is returned by
 *  identity, so it cannot even accidentally be written back. */
export function relaxSettings(pair: SettingsPair, p: Partial<Settings>): SettingsPair {
  return {
    persisted: pair.persisted,
    session: { ...pair.session, ...p },
    cityChosen: pair.cityChosen,
  };
}

/** The DEFAULT city changed under the app: the edge answered, late, with a
 *  city the clock could not name (backlog B1, ui/where.ts). Into BOTH
 *  records — it is a default, not an override, and a default the two records
 *  disagreed about would be written back to storage as the reader's choice
 *  the next time they touched any setting.
 *
 *  It is NOT `patchSettings`: nothing is saved, and `cityChosen` stays
 *  false, which is what keeps this city out of the stored record on the
 *  reader's next unrelated settings change (S7 review F2). A guess about
 *  where the reader is has no business in localStorage, and the next page
 *  load makes the same guess from the same two sources. `useSettings`
 *  refuses it once the reader has a stored city or a link named one, so it
 *  can only ever move a city nobody chose. */
export function defaultCitySettings(pair: SettingsPair, city: CityId): SettingsPair {
  return {
    persisted: { ...pair.persisted, city },
    session: { ...pair.session, city },
    cityChosen: pair.cityChosen,
  };
}

/** `defaultCity` is what the record falls back to when it names no city:
 *  the time zone's guess, resolved before the first render (ui/boot.ts). */
export function useSettings(boot: BootOverride, defaultCity?: CityId): SettingsStore {
  const [pair, setPair] = useState<SettingsPair>(() =>
    bootSettings(loadSettings(defaultCity), boot, storedCityId() !== null)
  );
  // The latest pair, readable synchronously: `patch` computes the next one
  // itself rather than through a functional update, because it has a side
  // effect (saveSettings) that must see the same record.
  const ref = useRef(pair);
  ref.current = pair;

  return {
    settings: pair.session,
    persisted: pair.persisted,
    cityChosen: pair.cityChosen,
    patch: (p) => {
      const next = patchSettings(ref.current, p);
      ref.current = next;
      // `persisted` is what is stored AND what applySettings is fed. The two
      // records can only differ in `city`, `access` and `avoidCobbles` — the
      // only fields a link ever sets — and applySettings reads none of them,
      // so the locale, pace and theme it pushes are the session's too.
      // useSettings.test.ts holds that invariant down.
      // ...and the city goes with it only once the reader has named one
      // (S7 review F2): until then it is B1's guess, and a guess in
      // localStorage would read as a choice on the next page load.
      saveSettings(next.persisted, next.cityChosen);
      setPair(next);
    },
    defaultCity: (city) => {
      // The reader's own city, or a link's, is not a default and does not
      // move. `boot.ts` already declines to ask the edge in either case;
      // this is the second lock, on the side that does the writing.
      if (ref.current.cityChosen || storedCityId() !== null || boot.city) return;
      const next = defaultCitySettings(ref.current, city);
      ref.current = next;
      setPair(next);
    },
  };
}
