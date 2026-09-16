import type { ReactNode } from "react";

export type MetaTone = "muted" | "accent" | "warn";

type ListRowProps = {
  /** One or two characters — the search result's initial. */
  avatar?: ReactNode;
  title: string;
  /** The second line. Omit it for a settings row: the row then sits at
   *  52 px instead of 60 and `right`/`value` carries the value. */
  meta?: string;
  metaTone?: MetaTone;
  /** A caption under the title that WRAPS — the rule a toggle applies
   *  ("11–16 h shade first · …"). It belongs to the row, above its
   *  hairline; as a paragraph after the row it read as the next item
   *  (Viktor, 2026-09-08). `meta` stays one ellipsised line. */
  note?: string;
  /** The row's OWN value ("Frankfurt ▾", "Easy · 4 km/h ▾"), rendered INSIDE
   *  the tappable area — so the value is part of the button's accessible
   *  name and the ▾, which is the only affordance the mockup draws, is
   *  actually a tap target (review B5). Use `right` instead for a control
   *  that is not the row (a Toggle) or for text that is not the row's value
   *  (a search result's distance). */
  value?: string;
  /** Sits beside the tappable area, never inside it — `right` often holds a
   *  Toggle, and a button inside a button is invalid. */
  right?: ReactNode;
  /** For a disclosure row: whether the region it controls is showing. */
  expanded?: boolean;
  onClick?: () => void;
};

/** A hairline-separated row: a search result (avatar, title, meta, distance)
 *  or a settings line (title on the left, value on the right). */
export function ListRow({
  avatar,
  title,
  meta,
  metaTone = "muted",
  note,
  value,
  right,
  expanded,
  onClick,
}: ListRowProps) {
  const main = (
    <>
      {avatar === undefined ? null : (
        <span className={`kit-row-avatar kit-row-avatar--${metaTone === "accent" ? "acc" : "well"}`}>
          {avatar}
        </span>
      )}
      <span className="kit-row-text">
        <span className="kit-row-title">{title}</span>
        {meta === undefined ? null : (
          <span className={`kit-row-meta kit-row-meta--${metaTone}`}>{meta}</span>
        )}
        {note === undefined ? null : <span className="kit-row-note">{note}</span>}
      </span>
      {value === undefined ? null : <span className="kit-row-value">{value}</span>}
    </>
  );

  return (
    <div className={`kit-row${meta === undefined ? " kit-row--compact" : ""}`}>
      {onClick ? (
        <button
          type="button"
          className="kit-row-main"
          aria-expanded={expanded}
          onClick={onClick}
        >
          {main}
        </button>
      ) : (
        <span className="kit-row-main">{main}</span>
      )}
      {right === undefined ? null : <span className="kit-row-right">{right}</span>}
    </div>
  );
}
