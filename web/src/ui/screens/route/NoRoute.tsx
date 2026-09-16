import { t } from "../../../i18n/t";
import type { NoRouteReason } from "../../noRoute";
import { Button, LocateIcon } from "../../kit";

type NoRouteProps = {
  reason: NoRouteReason;
  /** Ask for the location — the only thing that helps a walk with no start. */
  onLocate: () => void;
  /** Drop the cobble wall for THIS walk (the trip override, not the
   *  setting — shellState.Trip). */
  onAllowCobbles: () => void;
  /** Route as a walker rather than a stroller, for this walk only. */
  onWalkMode: () => void;
  /** An end of the walk is outside the city: fly to the city, or change it. */
  onShowCity: () => void;
  onSwitchCity: () => void;
  /** Fetch the city's artifact again — the only thing that helps when it
   *  never arrived (QA F2-07). */
  onRetryCity: () => void;
  /** How a start point is set with no fix, on the tab this card is on. The
   *  route tab wants a LONG press (a plain tap there opens a place card);
   *  the Wander tab takes a plain tap (`mapTaps.startHere`). Telling a
   *  Wander reader to long-press was E2's wording on the wrong tab (CR-02
   *  slice A review, F5). */
  tapToStart?: boolean;
};

/** Nothing to show, and why (mockups/phone-noroute.html).
 *
 *  Two cards, because there are two causes and only one of them is about a
 *  setting. With no start point the reader is offered a location, not a
 *  cobble switch; with a real dead end they are offered the settings that
 *  could actually change the answer — and never one that is already off. */
export function NoRoute({
  reason,
  onLocate,
  onAllowCobbles,
  onWalkMode,
  onShowCity,
  onSwitchCity,
  onRetryCity,
  tapToStart = false,
}: NoRouteProps) {
  // Nothing loaded, so there is nothing to loosen and nowhere to walk from.
  // The card used to say "check your connection and reload" and offer no
  // control for doing either (QA F2-07); Retry asks for the artifact again,
  // which is what a dropped 10-36 MB download needs.
  if (reason.k === "cityFailed") {
    return (
      <div className="route-noroute">
        <span className="route-noroute-title">
          {t("edge.cityFailed", { city: t(`city.${reason.city}`) })}
        </span>
        <div className="route-noroute-actions">
          <Button variant="small" onClick={onRetryCity}>
            {t("actions.retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (reason.k === "noOrigin") {
    return (
      <>
        <div className="route-noroute">
          <span className="route-noroute-title">{t("gps.error")}</span>
          <span className="kit-card-meta">
            {t(tapToStart ? "edge.locationOffTap" : "edge.locationOff")}
          </span>
          <div className="route-noroute-actions">
            <Button variant="small" onClick={onLocate}>
              <LocateIcon size={18} />
              {t("edge.useLocation")}
            </Button>
          </div>
        </div>
      </>
    );
  }

  if (reason.k === "outside") {
    const city = t(`city.${reason.city}`);
    return (
      <div className="route-noroute">
        <span className="route-noroute-title">{t("edge.outsideTitle", { city })}</span>
        <span className="kit-card-meta">{t("edge.outsideBody")}</span>
        <div className="route-noroute-actions">
          <Button variant="small" onClick={onShowCity}>
            {t("edge.showCity", { city })}
          </Button>
          <Button variant="smallSecondary" onClick={onSwitchCity}>
            {t("edge.switchCity")}
          </Button>
        </div>
      </div>
    );
  }

  const offers = reason.canAllowCobbles || reason.canWalkMode;
  return (
    <>
      <div className="route-noroute">
        {/* the mode the walk was refused for, not a hardcoded "stroller":
            the header's chip may say something else (review B-4) */}
        <span className="route-noroute-title">
          {/* "without cobbles" only when cobbles are what stands in the way */}
          {t(`edge.${reason.canAllowCobbles ? "noRouteTitle" : "noRoutePlain"}.${reason.access}`)}
        </span>
        {offers ? <span className="kit-card-meta">{t("edge.noRouteBody")}</span> : null}
        {offers ? (
          <div className="route-noroute-actions">
            {reason.canAllowCobbles ? (
              <Button variant="small" onClick={onAllowCobbles}>
                {t("edge.allowCobbles")}
              </Button>
            ) : null}
            {reason.canWalkMode ? (
              <Button variant="smallSecondary" onClick={onWalkMode}>
                {t("edge.walkMode")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <span className="kit-card-meta">{t("edge.noRouteOther")}</span>
    </>
  );
}
