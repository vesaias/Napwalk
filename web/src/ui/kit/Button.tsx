import type { ReactNode } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ink"
  | "danger"
  | "small"
  | "smallSecondary";

type ButtonProps = {
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
};

/** The action button. 52 px tall and pill-shaped for the sheet's action row
 *  (primary / secondary / ink), 44 px and outlined in red for `danger` (the
 *  End button on the navigation bar), 40 px for the two `small` variants
 *  that sit inside the "no route" card. */
export function Button({ variant = "primary", disabled, onClick, children }: ButtonProps) {
  return (
    <button
      type="button"
      className={`kit-btn kit-btn--${variant}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
