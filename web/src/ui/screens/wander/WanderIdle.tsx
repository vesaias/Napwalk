import { t } from "../../../i18n/t";
import { LocateIcon, WanderIcon } from "../../kit";

type WanderIdleProps = {
  /** The length the next loop will be, shown in the pill's right-hand
   *  button. W0 keeps it: the reader who set 90 minutes yesterday should not
   *  have to say so again to see it (SPEC §3 W0). */
  durationMin: number;
  /** Is there a pinned start? Then the pill plans from THAT rather than from
   *  the live fix, and says so (CR-04, "W0 pill copy"). */
  fromPin: boolean;
  /** Plan a loop from the fix. Also what asks for the fix, when the browser
   *  has not been asked yet — the pill IS the tap the permission prompt
   *  needs (ui/useGps.ts). Without one the loops screen says so itself, the
   *  same way it does when a fix is refused (ui/noRoute.ts). */
  onPlan: () => void;
  onDuration: () => void;
  onLocate: () => void;
};

/** W0, the Wander tab's root (SPEC §3 W0, board `screens-cr02/hb-wander-idle`).
 *
 *  The whole screen is the map and one 44 px pill: "↻ Plan a loop from your
 *  location · 45 min ▾". Nothing is planned here and nothing is asked for —
 *  which is the point of it. Until CR-02 the tab opened straight onto loops
 *  from wherever the reader happened to be standing, computed before they
 *  had said they wanted a walk at all.
 *
 *  The pill is TWO buttons in one box, not a button inside a button: the
 *  sentence plans the loop, the length opens the duration sheet, and a
 *  button inside a button is invalid HTML that no screen reader and no
 *  keyboard can take apart (e2e `noNestedButtons`). The box around them is a
 *  plain div wearing the pill's shape.
 *
 *  The tab bar stays (ui/tabBar.ts — W0 is a tab root), and what a tap on
 *  the map does is said once, as a toast on the first visit
 *  (ui/wanderHint.ts, fired by WanderTab). */
export function WanderIdle({
  durationMin,
  fromPin,
  onPlan,
  onDuration,
  onLocate,
}: WanderIdleProps) {
  return (
    <>
      <div className="shell-top">
        <div className="wander-idle">
          <button type="button" className="wander-idle-plan" onClick={onPlan}>
            {/* 20 px, the same glyph the W1 pill leads with */}
            <WanderIcon size={20} />
            {/* Two halves in the usual case — "Plan a loop" and a muted
                "from your location" — and ONE sentence when the loops start
                at a pin. The pin's copy is a whole sentence in the catalog
                because German cannot be split the same way: "Runde ab der
                Stecknadel planen" puts its verb at the end, so a title plus
                a trailing phrase would be word salad (CLAUDE.md rule 5 — the
                catalog decides the shape of the sentence, not the markup). */}
            <span className="wander-idle-title">
              {fromPin ? (
                t("wander.idleFromPin")
              ) : (
                <>
                  {t("wander.idleTitle")}{" "}
                  <span className="wander-idle-from">{t("wander.idleFrom")}</span>
                </>
              )}
            </span>
          </button>
          <button type="button" className="wander-idle-dur" onClick={onDuration}>
            {t("wander.duration", { min: durationMin })}
          </button>
        </div>
      </div>

      <div className="shell-float wander-idle-float">
        <button type="button" className="shell-locate" aria-label={t("start.gps")} onClick={onLocate}>
          <LocateIcon size={22} />
        </button>
      </div>
    </>
  );
}
