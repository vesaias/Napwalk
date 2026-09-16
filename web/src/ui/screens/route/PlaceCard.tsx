import { t } from "../../../i18n/t";
import type { Place } from "../../shellState";
import { Button, SearchBar, Sheet, Tag } from "../../kit";
import { UNKNOWN_MIN } from "../../time";

type PlaceCardProps = {
  place: Place;
  /** The recommended walk from the current origin: null until the plan
   *  lands, or for good when there is no origin to walk from. */
  minutes: number | null;
  /** Already formatted, e.g. "1.7". */
  km: string | null;
  shadePct: number | null;
  quietPct: number | null;
  onSearch: () => void;
  onRoute: () => void;
  /** "↻ Loop via" (R3): the Wander tab, planning loops through this place
   *  (W3). Given only where a loop can be planned at all. */
  onLoopVia: () => void;
  /** Flicked off the bottom of the screen: back to the bare map (SPEC §4). */
  onDismiss: () => void;
};

/** A place picked from search: the map on the pin, and a sheet with the
 *  numbers that decide whether to walk there (board HB-place). Two ways to
 *  use it: walk there (primary), or walk a loop that passes through it and
 *  comes back (secondary — W3, slice 6).
 *
 *  Compact since CR-01 edit 8: the title at 20 with the distance beside it,
 *  ONE tag row that runs off the right edge rather than wrapping to a
 *  second, and 44 px buttons. The card was costing a third of the phone for
 *  three badges. The tab bar stays — there is no trip yet. */
export function PlaceCard({
  place,
  minutes,
  km,
  shadePct,
  quietPct,
  onSearch,
  onRoute,
  onLoopVia,
  onDismiss,
}: PlaceCardProps) {
  return (
    <>
      <div className="shell-top">
        <SearchBar value="" placeholder={t("home.whereTo")} readOnly onFocus={onSearch} />
      </div>
      <Sheet open tabBar onDismiss={onDismiss} handleLabel={t("sheet.handle")}>
        <div className="kit-card-head place-head">
          <span className="shell-title">{place.name}</span>
          {km === null ? null : <span className="kit-card-meta">{t("card.km", { km })}</span>}
        </div>
        <div className="kit-card-tags place-tags">
          {minutes === null ? null : <Tag variant="well">{t("place.walkMin", { min: minutes })}</Tag>}
          {shadePct === null ? null : (
            <Tag variant="acc">{t("place.shadeNow", { pct: shadePct })}</Tag>
          )}
          {quietPct === null ? null : (
            // the design's "quiet" / "loud" badge; the catalog has no bare
            // word for either, so the tag carries the number it is read off
            <Tag variant={quietPct >= 50 ? "quiet" : "well"}>
              {t("card.quietPct", { pct: quietPct })}
            </Tag>
          )}
        </div>
        <div className="kit-actions place-actions">
          <Button onClick={onRoute}>
            {t("place.routeMin", { min: minutes === null ? UNKNOWN_MIN : minutes })}
          </Button>
          <Button variant="secondary" onClick={onLoopVia}>
            {t("place.loopVia")}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
