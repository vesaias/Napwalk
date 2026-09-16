import { CITIES, type City, type CityId } from "../../../cities";
import { t } from "../../../i18n/t";
import { ListRow, Sheet, SheetHead } from "../../kit";

type CitySheetProps = {
  current: CityId;
  /** The context line, when the fix is outside the current city's data: how
   *  far out (ui/outside.ts), and where the walker is when the reverse
   *  geocode has landed — `place` is null until it does, and the sentence
   *  has a variant without it rather than waiting. Null when the fix is
   *  inside, or when there is no fix at all. */
  outside: { place: string | null; km: string } | null;
  /** A row was tapped. The sheet closes on it and the shell takes over
   *  (ui/useShellCity.ts): the city changes at once, the map goes with it,
   *  and the graph follows in the background. Including the row you are
   *  already on, which closes the sheet and does nothing else. */
  onPick: (id: CityId) => void;
  /** "Request a city →" — the report sheet, with a question in it. */
  onRequest: () => void;
  onClose: () => void;
};

/** Which city the app is showing — and nothing else (Viktor, 2026-09-15:
 *  "remove the years and the MB size from the city picker, just a selection
 *  of cities").
 *
 *  Three things have now left this sheet in three rounds, and each was the
 *  same mistake in a smaller form. CR-03 Q5 put a **Load** button on every
 *  row and turned the row under the reader's finger into a progress bar;
 *  round 3 item 5 took the button and the bar away and left the row a
 *  switch, with the bytes counted on the map. What stayed was the row's
 *  second line — "Shade 2021 · Noise 2022 · 38 MB" — a survey year and a
 *  download size offered as the thing to choose a CITY by. A reader picking
 *  Berlin is picking Berlin.
 *
 *  So the row is a name, and a ✓ on the one you are in. The download is not
 *  a decision to be priced up front; it is something that happens after the
 *  tap, on the map, with a ✕ on it.
 *
 *  All eight route since 2026-09-01, so the `city.soon` note is for a
 *  registry entry whose artifact has not shipped — today that is none. */
export function CitySheet({ current, outside, onPick, onRequest, onClose }: CitySheetProps) {
  return (
    <Sheet open modal side label={t("city.title")} onClose={onClose} handleLabel={t("sheet.handle")}>
      <SheetHead title={t("city.title")} closeLabel={t("search.back")} onClose={onClose} />
      {outside === null ? null : (
        <p className="set-context">
          {outside.place === null
            ? t("city.outsideContextHere", { km: outside.km, city: t(`city.${current}`) })
            : t("city.outsideContext", {
                place: outside.place,
                km: outside.km,
                city: t(`city.${current}`),
              })}
        </p>
      )}
      <div className="set-cities">
        {CITIES.map((c: City) => (
          <ListRow
            key={c.id}
            avatar={t(`city.${c.id}`).slice(0, 1)}
            title={t(`city.${c.id}`)}
            metaTone={c.id === current ? "accent" : "muted"}
            right={
              c.id === current ? (
                <span className="set-check">✓</span>
              ) : c.available ? undefined : (
                t("city.soon")
              )
            }
            onClick={c.available ? () => onPick(c.id) : undefined}
          />
        ))}
      </div>
      <button type="button" className="shell-link set-request" onClick={onRequest}>
        {t("city.request")}
      </button>
    </Sheet>
  );
}
