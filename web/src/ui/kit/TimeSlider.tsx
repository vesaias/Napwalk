import { DAY_END_MIN, DAY_START_MIN, STEP_MIN } from "../time";
import { fmtTime } from "./format";

type TimeSliderProps = {
  /** Minutes since midnight. */
  value: number;
  /** Accessible name for the range input (the clock beside it is the value). */
  label: string;
  /** The ends of the track, in minutes since midnight. The whole day by
   *  default; the leave-at sheet narrows it to what is left of the daylight
   *  (ui/time.ts leaveWindow, UX sweep U4). */
  min?: number;
  max?: number;
  /** No departure is left to pick — the track is dead and the sheet says
   *  why beside it. */
  disabled?: boolean;
  onChange: (min: number) => void;
};

/** A clock at 44 px and a whole-day slider under the sun. Two sheets pick a
 *  time of day with it: "when are you leaving?" and Wander's "or be back
 *  by" (mockups/phone-leave.html, phone-dur.html).
 *
 *  The CSS keeps its `route-*` class names: the rules landed with the Task 12
 *  block and nothing about them changed when the markup moved here in
 *  Task 13. Renaming them would only churn a stylesheet and an E2E driver. */
export function TimeSlider({
  value,
  label,
  min = DAY_START_MIN,
  max = DAY_END_MIN,
  disabled,
  onChange,
}: TimeSliderProps) {
  return (
    <div className="route-clockrow">
      <span className="route-clock">{fmtTime(value)}</span>
      <input
        className="route-slider"
        type="range"
        min={min}
        max={max}
        step={STEP_MIN}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={fmtTime(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
