import { useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { rovingStep } from "./focus";

type SegmentProps<T extends string> = {
  value: T;
  /** `icon` is optional and decorative — the web layout's tab switcher draws
   *  the tab bar's glyphs beside the same labels; the settings segments have
   *  none (Task 15). */
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  /** Accessible name for the group, e.g. t("settings.howYouWalk"). */
  label?: string;
};

/** The three-up segmented control (Walk / Stroller / Wheelchair): a well
 *  with a raised card marking the choice.
 *
 *  It is a RADIO GROUP, not three toggle buttons (slice 9, 2026-09-07; the
 *  slice-2 review's B-10). Three `aria-pressed` buttons say "each of these
 *  can be on or off", which is not what this control is: exactly one option
 *  holds at a time and picking one un-picks the others. `radiogroup` says
 *  that, and it brings the keyboard behaviour readers already expect from
 *  one — the group is a single Tab stop (the roving tabindex below) and the
 *  arrow keys move the choice inside it. `aria-pressed` is deliberately
 *  absent: a control that carries both is announced twice and agrees with
 *  itself only by luck. */
export function Segment<T extends string>({ value, options, onChange, label }: SegmentProps<T>) {
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  /** Arrow keys move the SELECTION, not just the focus — that is what a
   *  radio group does, and it is why the group can be one tab stop: there is
   *  no way to land on an option without taking it. `rovingStep` (kit/
   *  focus.ts) decides where; it wraps at both ends and owns both axes. */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    const to = rovingStep(e.key, i, options.length);
    if (to < 0) return;
    // the sheet's handle reads ArrowUp/ArrowDown as a snap change; inside the
    // group they belong to the group.
    e.preventDefault();
    e.stopPropagation();
    onChange(options[to].value);
    items.current[to]?.focus();
  };

  return (
    <div className="kit-segment" role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            items.current[i] = el;
          }}
          type="button"
          role="radio"
          className="kit-segment-item"
          aria-checked={o.value === value}
          /* the roving tabindex: Tab reaches the group once, at whichever
             option is taken, and the arrows do the rest. */
          tabIndex={o.value === value ? 0 : -1}
          onKeyDown={(e) => onKeyDown(e, i)}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
