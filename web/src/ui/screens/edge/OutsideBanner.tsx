import { t } from "../../../i18n/t";
import { Button } from "../../kit";

type OutsideBannerProps = {
  /** The city the walker is outside of, translated. */
  cityName: string;
  /** Fly the map to the city centre. */
  onShowCity: () => void;
  /** Open the city sheet, which repeats the distance in words. */
  onSwitchCity: () => void;
};

/** "You're outside Frankfurt" — the card under the search bar when the fix
 *  falls beyond the city's data border (mockups/phone-outside.html).
 *
 *  It states the fact and offers the two things that can be done about it;
 *  it does not block the map, because a walker in Offenbach can still look
 *  at Frankfurt, and it never appears without a fix to be sure about. */
export function OutsideBanner({ cityName, onShowCity, onSwitchCity }: OutsideBannerProps) {
  return (
    <div className="edge-outside">
      <span className="edge-outside-title">{t("edge.outsideTitle", { city: cityName })}</span>
      <span className="edge-outside-body">{t("edge.outsideBody")}</span>
      <div className="edge-outside-actions">
        <Button variant="small" onClick={onShowCity}>
          {t("edge.showCity", { city: cityName })}
        </Button>
        <Button variant="smallSecondary" onClick={onSwitchCity}>
          {t("edge.switchCity")}
        </Button>
      </div>
    </div>
  );
}
