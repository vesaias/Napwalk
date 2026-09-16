import { t } from "../../../i18n/t";
import { Sheet, fmtTime } from "../../kit";

type ComputingProps = {
  /** The clock the plan is being computed for — the sentence names it, so
   *  a slow answer still tells you what it is answering. */
  startMin: number;
  /** False while a modal sheet covers it. */
  open?: boolean;
  /** The first ~450 ms of a plan: the sheet and its title are up at once
   *  (so nothing else — least of all a no-route card — flashes in the
   *  gap), the shimmer only joins once the wait has proven slow. */
  quiet?: boolean;
};

/** The wait: the sheet the routes screen wears while the planner runs, with
 *  one tall skeleton where the recommended card will be and two short ones
 *  for the alternatives (mockups/phone-computing.html). The shimmer stops
 *  under prefers-reduced-motion — that rule lives with .kit-skeleton.
 *
 *  On the phone it opens at PEEK and wears the peek snap's own shape (CR-01
 *  edit 2, board HB-computing): a block the height of the compact card and
 *  a greyed button row, which is exactly the geometry the answer lands in.
 *  The sheet's top edge is therefore in the same place before and after the
 *  plan arrives — the jump the live phone review called out (L1 → R4).
 *
 *  The shell only mounts this once the wait has lasted 200 ms; a plan that
 *  lands sooner never flickers a skeleton onto the screen. */
export function Computing({ startMin, open = true, quiet = false }: ComputingProps) {
  const shimmer = quiet ? "" : " kit-skeleton--shimmer";
  return (
    <Sheet
      open={open}
      openAt="peek"
      handleLabel={t("sheet.handle")}
      peek={
        <>
          <div className={`kit-skeleton route-skeleton-peek${shimmer}`} />
          <div className="kit-actions">
            <div className="kit-skeleton route-skeleton-btn" />
            <div className="kit-skeleton route-skeleton-btn" />
          </div>
        </>
      }
    >
      <span className="route-computing">{t("computing.title", { time: fmtTime(startMin) })}</span>
      <div className={`kit-skeleton route-skeleton-card${shimmer}`} />
      <div className="kit-actions">
        <div className="kit-skeleton route-skeleton-delta" />
        <div className="kit-skeleton route-skeleton-delta" />
      </div>
    </Sheet>
  );
}
