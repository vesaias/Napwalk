import { t } from "../../../i18n/t";
import { Button, SearchBar, Sheet } from "../../kit";
import { UNKNOWN_MIN } from "../../time";

type PinCardProps = {
  /** Photon's reverse geocode, null while it is in flight or has nothing. */
  address: string | null;
  shadePct: number | null;
  minutes: number | null;
  onSearch: () => void;
  onRoute: () => void;
  /** Make this pin the start of the next walk. */
  onStartHere: () => void;
  /** Flicked off the bottom of the screen: back to the bare map (SPEC §4). */
  onDismiss: () => void;
};

/** A long press on the map: what is here, how shaded it is, and the two
 *  things you can do with it (mockups/phone-pin.html). The "report this
 *  spot" link went in slice 7 — reporting is a Settings flow now, and the
 *  place it needs comes from the map-position toggle (SPEC §2).
 *
 *  Compact on the same terms as the place card (CR-01 edit 8): the title at
 *  20 over one muted line, and 44 px buttons. */
export function PinCard({
  address,
  shadePct,
  minutes,
  onSearch,
  onRoute,
  onStartHere,
  onDismiss,
}: PinCardProps) {
  const sub = [address, shadePct === null ? null : t("pin.shadedAround", { pct: shadePct })]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <div className="shell-top">
        <SearchBar value="" placeholder={t("home.whereTo")} readOnly onFocus={onSearch} />
      </div>
      <Sheet open tabBar onDismiss={onDismiss} handleLabel={t("sheet.handle")}>
        <div className="shell-head place-head">
          <span className="shell-title">{t("pin.title")}</span>
          {sub ? <span className="kit-card-meta">{sub}</span> : null}
        </div>
        <div className="kit-actions place-actions">
          <Button onClick={onRoute}>
            {t("pin.routeHere", { min: minutes === null ? UNKNOWN_MIN : minutes })}
          </Button>
          <Button variant="secondary" onClick={onStartHere}>
            {t("pin.startHere")}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
