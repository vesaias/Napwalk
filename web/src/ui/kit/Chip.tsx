import type { ReactNode } from "react";

export type ChipVariant = "default" | "dark" | "accent";

type ChipProps = {
  variant?: ChipVariant;
  sunDot?: boolean;
  disabled?: boolean;
  /** For a chip that is a CHOICE (the report sheet's four types): it sets
   *  `aria-pressed` AND, when true, the filled face — a selected chip that
   *  differs only in text colour is invisible to a reader who cannot
   *  separate the two greens, and says nothing at all in a screenshot (UX
   *  sweep U15). Leave it undefined for a chip that opens a sheet. */
  pressed?: boolean;
  /** For a chip whose face is an icon (the access chip): its name, for the
   *  screen reader and the hover tooltip. The face carries no text. */
  label?: string;
  onClick: () => void;
  children: ReactNode;
};

/** The floating map chips: 36 px pills over the map that open a sheet.
 *  `sunDot` prefixes the amber dot the "Leave 14:00" chip carries. */
export function Chip({ variant = "default", sunDot, disabled, pressed, label, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      className={
        `kit-chip kit-chip--${variant}${sunDot ? " kit-chip--sun" : ""}` +
        `${label ? " kit-chip--icon" : ""}${pressed === true ? " kit-chip--pressed" : ""}`
      }
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {sunDot ? <span className="kit-chip-dot" /> : null}
      {children}
    </button>
  );
}
