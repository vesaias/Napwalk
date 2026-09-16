import { useLayoutEffect, useRef, useState } from "react";
import { pct } from "./format";
import { labelEvery } from "./hourLabels";

type HourBarsProps = {
  /** Hours of the day, e.g. [10, 11, … 19] — the day's daylight hours
   *  (plan/hours.ts `daylightHours`). */
  hours: number[];
  /** Shade percentage per hour, same length and order as `hours`. */
  pct: number[];
  /** The hour currently chosen. */
  current: number;
  /** The shadiest hour on offer — highlighted at 60 % so it reads as a
   *  suggestion rather than a selection. */
  best: number;
  onPick: (hour: number) => void;
};

/** The departure-hour histogram on the "when are you leaving?" sheet. */
export function HourBars({ hours, pct: values, current, best, onPick }: HourBarsProps) {
  const strip = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  /* Layout, not effect: the width is read and the labels settled in the same
     frame the strip is laid out in, so a reader never sees the labels thin
     out after the fact. */
  useLayoutEffect(() => {
    const el = strip.current;
    if (el === null) return;
    setWidth(el.getBoundingClientRect().width);
    // jsdom has no ResizeObserver, and a strip that cannot resize is still
    // measured once above
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box !== undefined) setWidth(box.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const every = labelEvery(hours.length, width);
  return (
    <div className="kit-hours" ref={strip}>
      {hours.map((h, i) => {
        const v = Math.min(100, Math.max(0, values[i] ?? 0));
        const isCurrent = h === current;
        const isBest = !isCurrent && h === best;
        return (
          <button
            key={h}
            type="button"
            className="kit-hour"
            /* `aria-current`, not `aria-pressed` (slice 9 review, F4): a bar
               is not a toggle — tapping the current hour again does not
               un-pick it — and the bars are not the hour's control either.
               The TimeSlider above them owns the departure minute
               (LeaveAtSheet) and each bar is a shortcut into it, so what the
               current one has to say is "this is the one in effect", which
               is exactly `aria-current`. Ten labelled buttons also read
               better here than one radio group would: every bar announces
               its own hour, and the "best" bar is a suggestion rather than a
               second selection. */
            aria-current={isCurrent ? "true" : undefined}
            data-current={isCurrent}
            onClick={() => onPick(h)}
          >
            <span className="kit-hour-pct">{isCurrent ? pct(v) : ""}</span>
            <span className="kit-hour-track">
              <span
                className={`kit-hour-fill${isCurrent ? " kit-hour-fill--current" : isBest ? " kit-hour-fill--best" : ""}`}
                style={{ height: `${v}%` }}
              />
            </span>
            {/* the current and the best bar keep their label whatever the
                arithmetic says: they are the two the reader is being asked
                to compare */}
            <span className="kit-hour-label">
              {h % every === 0 || h === current || h === best ? h : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
