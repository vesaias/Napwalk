import type { Density } from "../sheetBudget";
import { Bars } from "./Bars";
import { Tag } from "./Tag";
import type { TagVariant } from "./Tag";

type RouteCardProps = {
  /** Already formatted, e.g. t("card.minutes", { min: 21 }). */
  minutes: string;
  /** The right-hand line: "1.7 km · arrive 14:21". */
  meta: string;
  tag: { variant: TagVariant; label: string };
  /** "shade first · afternoon sun" (plan/cardCopy.ts reasonLine), or null
   *  where there is no reason to give: a promoted alternative is the
   *  reader's own choice and says nothing about it (CR-03 A5, backlog B8). */
  why?: string | null;
  /** "no shade after 17:40" — replaces the reason line in warn colour
   *  (SPEC §1.1: a warning takes the note's place, it does not add a row). */
  warn?: string | null;
  /** Loop name, Wander only: "Shaded streets · Nordend". */
  name?: string;
  shadePct: number;
  quietPct: number;
  shadeLabel: string;
  quietLabel: string;
  /** `"compact"` is the peek snap's two-row card (CR-01 edit 3, board
   *  HB-routes): minutes, the tag and the distance/arrival on one line,
   *  the via or loop name and the two meters on the next. The full variant
   *  — three rows, a reason line and 56 px meters — is what the `default`
   *  snap and every web frame keep. */
  variant?: "full" | "compact";
  /** How much of the compact card fits on this phone (CR-01 edit 10,
   *  ui/sheetBudget.ts). `bars` drops the meters row, `min` the Recommended
   *  tag as well — in that order, and never the minutes or the arrival,
   *  which are the answer. Ignored by the full variant. */
  density?: Density;
  onClick?: () => void;
};

/** The recommended route: a 2 px accent-bordered card with the big minute
 *  count, a tag, and the two meters. */
export function RouteCard({
  minutes,
  meta,
  tag,
  why,
  warn = null,
  name,
  shadePct,
  quietPct,
  shadeLabel,
  quietLabel,
  variant = "full",
  density = "full",
  onClick,
}: RouteCardProps) {
  // Two rows, both of them fixed-height, because the peek budget is
  // measured in whole pixels: 8 + 26 + 4 + 16 + 8 inside a 2 px border is
  // the 66 the guard (ui/sheetBudget.ts) counts on. The `warn` line takes
  // the name's place rather than adding a row, the same rule §1.1 gives
  // the full card.
  const compact = (
    <>
      <div className="kit-card-row1">
        <span className="kit-card-min">{minutes}</span>
        {density === "min" ? null : <Tag variant={tag.variant}>{tag.label}</Tag>}
        <span className="kit-card-meta">{meta}</span>
      </div>
      {density !== "full" ? null : (
        <div className="kit-card-row2">
          {warn !== null ? (
            <span className="kit-card-via kit-card-via--warn">{warn}</span>
          ) : name === undefined ? null : (
            <span className="kit-card-via">{name}</span>
          )}
          <Bars
            compact
            shadePct={shadePct}
            quietPct={quietPct}
            shadeLabel={shadeLabel}
            quietLabel={quietLabel}
          />
        </div>
      )}
    </>
  );

  const body = (
    <>
      <div className="kit-card-head">
        <span className="kit-card-min">{minutes}</span>
        <span className="kit-card-meta">{meta}</span>
      </div>
      <div className="kit-card-tags">
        <Tag variant={tag.variant}>{tag.label}</Tag>
        {warn !== null ? (
          <span className="kit-card-meta kit-card-meta--warn">{warn}</span>
        ) : why === undefined || why === null ? null : (
          <span className="kit-card-meta">{why}</span>
        )}
      </div>
      {name === undefined ? null : <span className="kit-card-name">{name}</span>}
      <Bars
        shadePct={shadePct}
        quietPct={quietPct}
        shadeLabel={shadeLabel}
        quietLabel={quietLabel}
      />
    </>
  );

  const cls = variant === "compact" ? "kit-card kit-card--compact" : "kit-card";
  const inner = variant === "compact" ? compact : body;
  if (!onClick) return <div className={cls}>{inner}</div>;
  return (
    <button type="button" className={cls} onClick={onClick}>
      {inner}
    </button>
  );
}

type DeltaCardProps = {
  /** Already formatted, e.g. t("card.minutes", { min: 17 }). */
  minutes: string;
  /** Already formatted by format.ts deltaLabel(), e.g. "−4 min". */
  deltaLabel: string;
  deltaTone: "good" | "bad";
  kindLabel: string;
  /** Which tag colour the kind gets — "Quieter" is blue, the rest neutral. */
  kindVariant?: TagVariant;
  /** "9 min in full sun" (plan/cardCopy.ts altNote). */
  note: string;
  /** A warning takes the note's place, in warn colour (SPEC §1.1). */
  warn?: string | null;
  onClick: () => void;
};

/** An alternative route, shown two-up under the recommended card. */
export function DeltaCard({
  minutes,
  deltaLabel,
  deltaTone,
  kindLabel,
  kindVariant = "well",
  note,
  warn = null,
  onClick,
}: DeltaCardProps) {
  return (
    <button type="button" className="kit-delta" onClick={onClick}>
      <span className="kit-delta-head">
        <span className="kit-delta-min">{minutes}</span>
        <span className={`kit-delta-diff kit-delta-diff--${deltaTone}`}>{deltaLabel}</span>
      </span>
      <span className="kit-delta-foot">
        <Tag variant={kindVariant}>{kindLabel}</Tag>
        <span className={`kit-delta-note${warn === null ? "" : " kit-delta-note--warn"}`}>
          {warn ?? note}
        </span>
      </span>
    </button>
  );
}
