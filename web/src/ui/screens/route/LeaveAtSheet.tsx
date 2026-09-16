import { useState } from "react";
import { t } from "../../../i18n/t";
import { bestHour } from "../../../plan/hours";
import { Button, HourBars, Sheet, SheetHead, TimeSlider, fmtTime } from "../../kit";
import { leaveWindow, noShadeAt } from "../../time";
import { useWholeDayBands } from "../../useShadeBands";

type LeaveAtSheetProps = {
  startMin: number;
  /** The day's daylight hours — one bar each (plan/hours.ts). */
  hours: number[];
  /** Shade percentage of the recommended route per hour of `hours`. */
  hourPct: number[];
  /** The recommended walk's duration — the hint promises it does not change. */
  minutes: number;
  /** The wall clock — read only to say whether the sun has gone; it is no
   *  longer either end of the slider (CR-03 A3). */
  nowMin: number;
  /** Sunrise and sunset in the selected city, minutes since midnight — the
   *  two ends of the window (ui/time.ts leaveWindow). */
  sunriseMin: number;
  sunsetMin: number;
  /** ...and the part of that daylight the artifact prices, which is what the
   *  track may offer (ui/useSunDay.ts `priced`, P1 review F1). */
  priced: { sunriseMin: number; sunsetMin: number };
  onSet: (startMin: number) => void;
  onNow: () => void;
  onClose: () => void;
};

/** "When are you leaving?" — the clock, the departure slider, the shade of
 *  this walk hour by hour, and the shadiest hour spelled out
 *  (mockups/phone-leave.html).
 *
 *  The picked minute is local until Set: every change of the shell's start
 *  minute throws the plan away and recomputes it, and dragging a slider
 *  must not do that thirty times on the way to 17:00.
 *
 *  The slider covers the DAYLIGHT DAY, sunrise↑5 to sunset↓5 (CR-03 A3,
 *  backlog B7). It ran the whole 00:00–23:55 once, then only what was left
 *  of the day (UX sweep U4), which was too tight the other way: a time
 *  earlier than now is a what-if for TODAY, and this app has no tomorrow to
 *  confuse it with. Past sunset the track still offers the day and the sheet
 *  says there is no shade left to plan for. The bars cover the same window,
 *  one per daylight hour, so no departure the slider offers is off the end
 *  of them — nor off the end of the artifact's shade buckets, which is the
 *  other window both halves are intersected with (P1 review F1). */
export function LeaveAtSheet({
  startMin,
  hours,
  hourPct,
  minutes,
  nowMin,
  sunriseMin,
  sunsetMin,
  priced,
  onSet,
  onNow,
  onClose,
}: LeaveAtSheetProps) {
  const win = leaveWindow(sunriseMin, sunsetMin, nowMin, priced);
  /** Does the artifact price LESS than the day is light? Then the strip and
   *  the slider are the artifact's window, not the sun's, and the sheet says
   *  which — a reader who knows their walk is shadier at 21:00 should be
   *  told the bars stop at 19:30 rather than be left to infer it from a
   *  missing column (CR-04 ruling 7, board O7).
   *
   *  Drawn is the NORMAL case in summer, not a rare one (CR-04 review M1).
   *  pipeline/10_sun_shade.py cuts the modelled window MARGIN_MIN = 8
   *  minutes inside sunrise and sunset and then snaps it inward to the
   *  15-minute grid, so on the modelled day itself the priced window is
   *  strictly inside daylight by construction — and it stays inside on
   *  every day longer than the modelled one. With a mid-September model
   *  that is roughly late March to late September; the note is away only in
   *  winter, when the day is shorter than the window and the two ends clamp
   *  to the sun's. A visible note is the rule working, not a bug. */
  const narrow = priced.sunriseMin > sunriseMin || priced.sunsetMin < sunsetMin;
  const clamp = (m: number) => Math.min(win.max, Math.max(win.min, m));
  // A share link, or a departure the reader set before the sun went down,
  // can arrive outside the window; the slider opens at the nearest minute
  // it can actually offer.
  const [pick, setPick] = useState(() => clamp(startMin));

  /** Open, this sheet prices every daylight hour, so it needs every shade
   *  band. Nothing fetches those in the background beyond the day's walking
   *  window any more (P1 review F3), so the sheet asks for them while it is
   *  up and the strip appears as they land — the same wait the departure's
   *  own bands have always had. */
  useWholeDayBands((hours[0] ?? 0) * 60, (hours[hours.length - 1] ?? 0) * 60 + 59, hours.length > 0);

  const hour = Math.floor(pick / 60);
  // null is "no plan has ever landed for this walk": the clock and the
  // buttons still work, the strip and the hint stay away (plan/hours.ts).
  const best = bestHour(hourPct, hours);

  return (
    <Sheet open modal label={t("leave.title")} onClose={onClose} handleLabel={t("sheet.handle")}>
      <SheetHead title={t("leave.title")} closeLabel={t("actions.cancel")} onClose={onClose} />

      {/* Never disabled, even after sunset: the day behind the reader is a
          what-if they are allowed to ask (B7). */}
      <TimeSlider
        value={pick}
        label={t("controls.time.label")}
        min={win.min}
        max={win.max}
        onChange={(m) => setPick(clamp(m))}
      />

      {/* The note is about the minute the reader has PICKED, never about the
          wall clock (ui/time.ts `noShadeAt`, round 3 item 3). `win.afterSunset`
          said "the sun is down NOW", so dragging the slider back to 11:00 at
          nine in the evening left the sheet insisting there was no shade to
          plan for over a strip of bars pricing that very hour. */}
      {noShadeAt(pick, sunsetMin, win) ? (
        <div className="route-best">{t("leave.afterSunset")}</div>
      ) : null}

      {best === null ? null : (
        <>
          {/* The caption the desktop panel has always had over the same ten
              bars (SPEC §3 R6); without it the phone drew a bar chart with
              no title (UX sweep U11). */}
          <div className="route-hours-cap">{t("leave.hourBars")}</div>
          <HourBars
            hours={hours}
            pct={hourPct}
            current={hour}
            best={best.hour}
            onPick={(h) => setPick(clamp(h * 60))}
          />
        </>
      )}

      {/* One muted line where a filled hint box used to be (board
          HB-leave-at, slice 4): the sheet has an hour bar per hour and two
          buttons already, and the shadiest departure is a fact, not a
          callout. */}
      {/* The badge names a departure the reader can actually take: the
          shadiest BAR, at the earliest minute of it the slider offers. The
          first and last bars cover only the daylight part of their hour
          (plan/hours.ts), so on 21 June in Frankfurt the shadiest bar is
          05:00 and the earliest departure in it is 05:30 — and "Best: 05:00"
          named a minute the track has no room for. 05:30, not 05:25: the
          window is the daylight intersected with the artifact's own buckets
          now (P1 review F1), so the badge names a minute that was measured
          rather than clamped. Same clamp the bars' own onPick uses. */}
      {/* ...and the row is drawn for EITHER of its two halves. A walk with no
          best hour still has bars that stop where the artifact stops, and
          before CR-04 review M3 the note went with the Best line it was
          sitting beside — which is the one case ruling 7 exists to cover
          (nothing else on the sheet says the strip is short). The note's
          condition is `narrow`, and only that. */}
      {best === null && !narrow ? null : (
        <div className="route-best">
          {best === null ? null : (
            <span>
              {t("leave.best", {
                time: fmtTime(clamp(best.hour * 60)),
                pct: best.pct,
                min: minutes,
              })}
            </span>
          )}
          {/* …and, at the right end of the same line, what the bars cover
              when that is less than the day (board O7). It names the
              ARTIFACT's window rather than the slider's: the two ends are
              the same minutes, but "shade data" is what the sentence is
              about. */}
          {narrow ? (
            <span className="route-best-note">
              {t("leave.pricedNote", {
                from: fmtTime(priced.sunriseMin),
                to: fmtTime(priced.sunsetMin),
              })}
            </span>
          ) : null}
        </div>
      )}

      <div className="kit-actions kit-actions--wide">
        <Button onClick={() => onSet(pick)}>{t("leave.set", { time: fmtTime(pick) })}</Button>
        <Button variant="secondary" onClick={onNow}>
          {t("leave.now")}
        </Button>
      </div>
    </Sheet>
  );
}
