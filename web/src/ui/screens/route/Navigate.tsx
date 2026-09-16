import { t } from "../../../i18n/t";
import { Button, ShadeStrip, fmtTime, int } from "../../kit";
import { km as fmtKm } from "../../time";
import type { ShadeAhead } from "../../nav";

type NavigateProps = {
  destName: string;
  /** Metres from the fix to the destination pin — the banner's headline.
   *  null while there is no fix yet. */
  toDestM: number | null;
  /** What is left of the walk, from the nearest route node on. */
  ahead: ShadeAhead | null;
  /** Minutes since midnight, now — the arrival time is this plus what is
   *  left to walk. */
  nowMin: number;
  onRecenter: () => void;
  onEnd: () => void;
};

/** The walk itself: an ink banner with the distance still to go, and one bar
 *  along the bottom carrying the shade of what is left, the arrival time and
 *  the way out (SPEC §3 R8, board HB-navigate).
 *
 *  No turn instructions, and no glyph, street or "then" row in the banner:
 *  the artifact carries no street names, so turn-by-turn is a pipeline task
 *  (docs/issues/pipeline-street-names.md) rather than a thing this screen can
 *  honestly draw. What the walker gets instead is the distance to the
 *  destination and the sun over the next ten minutes. No ♪ either — there is
 *  nothing to speak (HANDOVER §6.2 calls it optional).
 *
 *  Everything here reads the live fix, so it refreshes with the GPS rather
 *  than on a clock of its own. */
export function Navigate({ destName, toDestM, ahead, nowMin, onRecenter, onEnd }: NavigateProps) {
  const remainingMin = ahead?.remainingMin ?? 0;
  const remainingM = ahead?.remainingM ?? 0;
  const strip = ahead && ahead.segments.length > 0 ? ahead : null;

  return (
    <>
      <div className="route-banner">
        <span className="route-banner-line">
          {toDestM === null
            ? t("walk.waiting")
            : t("nav.toDest", { m: int(toDestM), dest: destName })}
        </span>
      </div>

      <div className="route-eta">
        {strip === null ? null : (
          <div className="route-eta-shade">
            <ShadeStrip segments={strip.segments} height={6} />
            <span className="route-eta-shade-line">
              <b className="route-eta-shade-lead">{t("nav.shadeAhead")}</b>
              {` · ${strip.sunMin > 0 ? t("nav.sunMin", { min: strip.sunMin }) : t("nav.noSun")}`}
            </span>
          </div>
        )}

        <div className="route-eta-row">
          <button
            type="button"
            className="route-eta-recenter"
            aria-label={t("walk.recenter")}
            onClick={onRecenter}
          >
            ▴
          </button>
          <div className="route-eta-text">
            <span className="route-eta-time">
              {fmtTime(nowMin + remainingMin)}{" "}
              <span className="route-eta-word">{t("nav.arrival")}</span>
            </span>
            <span className="kit-card-meta">
              {t("nav.remaining", { min: remainingMin, km: fmtKm(remainingM), dest: destName })}
            </span>
          </div>
          <Button variant="danger" onClick={onEnd}>
            {t("actions.end")}
          </Button>
        </div>
      </div>
    </>
  );
}
