import { useMemo } from "react";
import { getCity, type CityId } from "../../../cities";
import { t } from "../../../i18n/t";
import type { LngLat } from "../../../components/MapView";
import type { Outside } from "../../outside";
import { daylightHint } from "../../theme";
import { cityClock, sunriseFor, sunsetFor } from "../../time";
import type { SettingsStore } from "../../useSettings";
import { pointKey, useLabels } from "../../useWander";
import { splitLabel } from "../../wander";
import type { Action, ShellState } from "../../shellState";
import { CitySheet } from "./CitySheet";
import { ReportSheet } from "./ReportSheet";
import { Settings } from "./Settings";

type SettingsTabProps = {
  s: ShellState;
  dispatch: (a: Action) => void;
  store: SettingsStore;
  /** Where the fix stands relative to the current city's data, or null. */
  outside: Outside | null;
  /** The map's current centre, read only when the report sheet's "attach my
   *  map position" toggle is on. A getter, not a value: the centre changes
   *  on every pan and nothing on this page should re-render for it. */
  mapCenter: () => LngLat | null;
  /** A city row was tapped: the shell closes this sheet and switches, with
   *  the download counted on the map (ui/useShellCity.ts). It used to be
   *  this component's own two lines — `patch({city})` and a `city` action —
   *  which was right while the sheet owned the download and wrong the moment
   *  the sheet stopped outliving it. */
  onPickCity: (id: CityId) => void;
};

/** The Settings tab, and the two sheets that belong to no tab.
 *
 *  The city sheet opens from the Settings row AND from the outside-city
 *  banner on Home; the report sheet opens from the Settings row and from the
 *  city sheet's "request a city", and from nowhere else since slice 7 (SPEC
 *  §2: no long-press entry). Mounting both here — rather than in the route
 *  tab's overlay switch — is what lets `overlay: "city"` mean the same thing
 *  on every tab, and it is why AppShell renders this component
 *  unconditionally. */
export function SettingsTab({ s, dispatch, store, outside, mapCenter, onPickCity }: SettingsTabProps) {
  const { settings, patch } = store;

  // The place the walker is actually in, for the city sheet's context line.
  // Photon answers with "street · district"; the sentence wants the second
  // half ("You're in Offenbach"), and says nothing until it lands.
  // Gated on the sheet being OPEN (review B7). This component is mounted on
  // every tab, and without the gate a walker outside the border sent Photon a
  // reverse geocode of their live position every ~11 m of movement, for ever,
  // whether or not they ever asked which city they were in.
  const gps = s.gps;
  const asking = s.overlay === "city";
  const target = useMemo(
    () => (asking && outside && gps ? { key: pointKey(gps), at: gps } : { key: "", at: null }),
    [asking, outside, gps]
  );
  const label = useLabels(useMemo(() => [target], [target]));
  const here = target.key ? label(target.key) : null;
  // The box appears as soon as the DISTANCE is known; the place name joins
  // it when Photon answers (CR-03 Q5 gives the sentence a variant without
  // one). It used to wait for both, so a walker whose reverse geocode never
  // landed was told nothing at all.
  const context = outside
    ? { place: here ? (splitLabel(here).district ?? splitLabel(here).name) : null, km: outside.km }
    : null;

  const openReport = () => dispatch({ type: "overlay", overlay: "report" });

  const closeReport = () => dispatch({ type: "back" });

  const sent = () => {
    dispatch({ type: "toast", text: t("report.sent") });
    closeReport();
  };

  // The daylight row's subline. Computed on render rather than on a timer:
  // it is a label, it only changes twice a day, and this component
  // re-renders on the shell's own five-minute clock long before either. Not
  // memoised — one Intl format over two cached sun tables (ui/time.ts).
  const daylight =
    settings.theme === "daylight"
      ? (() => {
          const city = getCity(settings.city);
          const { day, minute } = cityClock(city);
          return daylightHint(minute, sunriseFor(day, city), sunsetFor(day, city));
        })()
      : null;

  return (
    <>
      {s.tab !== "settings" ? null : (
        <Settings
          settings={settings}
          cityName={t(`city.${settings.city}`)}
          attribution={t(`map.attribution.${settings.city}`)}
          daylight={daylight}
          onPatch={patch}
          onCity={() => dispatch({ type: "overlay", overlay: "city" })}
          onReport={openReport}
        />
      )}

      {s.overlay !== "city" ? null : (
        <CitySheet
          current={settings.city}
          outside={context}
          onPick={onPickCity}
          onRequest={openReport}
          onClose={() => dispatch({ type: "back" })}
        />
      )}

      {s.overlay !== "report" ? null : (
        <ReportSheet
          city={settings.city}
          mapCenter={mapCenter}
          onSent={sent}
          onClose={closeReport}
        />
      )}
    </>
  );
}
