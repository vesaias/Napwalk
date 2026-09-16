type ToggleProps = {
  on: boolean;
  onChange: (on: boolean) => void;
  /** Accessible name. The visible text lives in the row next to it, so this
   *  is the only place a screen reader learns what the switch is for. */
  label: string;
};

/** The 44×26 settings switch. */
export function Toggle({ on, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="kit-toggle"
      data-on={on}
      onClick={() => onChange(!on)}
    >
      <span className="kit-toggle-knob" />
    </button>
  );
}
