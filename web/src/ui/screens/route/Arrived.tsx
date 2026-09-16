import { t } from "../../../i18n/t";
import type { RouteStats } from "../../../router/stats";
import { Button, Sheet, Tag, fmtTime, int } from "../../kit";

type ArrivedProps = {
  destName: string;
  /** Minutes since midnight, captured when the walk ended — not re-read, so
   *  standing on the spot does not tick the arrival time forward. */
  atMin: number;
  /** The walk that was taken; null if the plan was thrown away first. */
  stats: RouteStats | null;
  /** Wander a loop back from here. */
  onLoopHome: () => void;
  /** Also what a flick off the bottom of the screen means (SPEC §4). */
  onDone: () => void;
};

/** The end of a walk: what it was, and the two ways out — a loop back home
 *  or nothing at all (mockups/phone-arrived.html). No chrome over the map
 *  but this sheet: the walk is over, there is nothing left to steer. */
export function Arrived({ destName, atMin, stats, onLoopHome, onDone }: ArrivedProps) {
  return (
    <Sheet open onDismiss={onDone} handleLabel={t("sheet.handle")}>
      <div className="shell-head">
        <span className="shell-title">{t("arrived.title")}</span>
        <span className="kit-card-meta">{`${destName} · ${fmtTime(atMin)}`}</span>
      </div>
      {stats === null ? null : (
        <div className="route-tags">
          <Tag variant="well">{t("card.minutes", { min: stats.minutes })}</Tag>
          <Tag variant="acc">{t("card.inShade", { pct: stats.shadePct })}</Tag>
          <Tag variant="quiet">{t("card.quietPct", { pct: stats.quietPct })}</Tag>
          <Tag variant="well">{t("card.cobbles", { m: int(stats.cobbleM) })}</Tag>
        </div>
      )}
      <div className="kit-actions">
        <Button onClick={onLoopHome}>{t("arrived.loopHome")}</Button>
        <Button variant="secondary" onClick={onDone}>
          {t("actions.done")}
        </Button>
      </div>
    </Sheet>
  );
}
