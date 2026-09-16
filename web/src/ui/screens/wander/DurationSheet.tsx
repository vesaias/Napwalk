import { useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { t } from "../../../i18n/t";
import { Button, Sheet, SheetHead, TimeSlider, fmtTime } from "../../kit";
import { rovingStep } from "../../kit/focus";
import { DAY_END_MIN } from "../../time";
import { DURATION_TILES, backByFor, durationFromBackBy } from "../../wander";

/** The region the back-by row discloses. One sheet is on screen at a time,
 *  so a constant id is enough. */
const SLIDER_ID = "dur-backby-slider";

type DurationSheetProps = {
  durationMin: number;
  /** The DEPARTURE, as minutes since midnight — what "be back by" is
   *  measured against. Not the wall clock: the loops card counts its own
   *  "back 17:45" from the same minute, and a sheet measured from `now`
   *  disagreed with it by the whole of a pinned departure (final review
   *  I1). Under "leave now" the two are the same number anyway. */
  departMin: number;
  /** The length, and — when it was picked as an hour to be home by — that
   *  hour, so a shared link can say it the way the reader did (`bb=HHMM`).
   *  A tile passes no hour, which clears any that was set. */
  onApply: (min: number, backBy?: number | null) => void;
  onClose: () => void;
};

/** "How long?" — four tiles, or an hour to be home by (board HB-how-long).
 *
 *  A tile applies and closes on the tap: four fixed lengths are the whole
 *  question, and an Apply button under them only asked it twice (SPEC §3 W2,
 *  slice 4). The hour is the one control that still needs a Set, because it
 *  is a slider: every drag of it would otherwise throw the plan away and
 *  recompute it thirty times on the way to 15:30.
 *
 *  The two controls are one number seen from both ends — picking a tile is
 *  the hour, moving the hour deselects the tiles — so there is nothing to
 *  reconcile between them. */
export function DurationSheet({ durationMin, departMin, onApply, onClose }: DurationSheetProps) {
  const [pick, setPick] = useState(durationMin);
  const [backOpen, setBackOpen] = useState(false);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const backMin = backByFor(departMin, pick);
  // The two controls are one number seen from both ends, and past 23:55 that
  // stops being true — the slider covers one day, so a 90-minute loop at
  // 23:00 has no hour to name. The row goes rather than lie about the length.
  const fitsToday = backMin <= DAY_END_MIN;

  return (
    <Sheet open modal label={t("dur.title")} onClose={onClose} handleLabel={t("sheet.handle")}>
      <SheetHead title={t("dur.title")} closeLabel={t("actions.cancel")} onClose={onClose} />

      {/* Four mutually exclusive lengths: a radio group, not four toggle
          buttons (slice 9 review, F4 — the same argument kit/Segment.tsx
          answered). One difference from Segment, and it is the sheet's
          fault rather than the pattern's: a tap here APPLIES and closes
          (SPEC §3 W2), so if the arrows applied too, a keyboard reader
          would shut the sheet on their first keystroke and could never
          reach the tile after next. So the arrows move the group's own
          selection — `pick`, which is what `aria-checked` reads and what the
          "Or be back by …" row below counts from — and Enter or Space, the
          button's native activation, applies it. Arrows still move the
          checked radio, which is what licenses the single tab stop. */}
      <div className="dur-tiles" role="radiogroup" aria-label={t("dur.title")}>
        {DURATION_TILES.map((min, i) => (
          <button
            key={min}
            ref={(el) => {
              tiles.current[i] = el;
            }}
            type="button"
            role="radio"
            className="dur-tile"
            data-sel={min === pick}
            aria-checked={min === pick}
            tabIndex={min === pick ? 0 : -1}
            onKeyDown={(e: ReactKeyboardEvent<HTMLButtonElement>) => {
              const to = rovingStep(e.key, i, DURATION_TILES.length);
              if (to < 0) return;
              // the sheet's handle reads ArrowUp/ArrowDown as a snap change
              e.preventDefault();
              e.stopPropagation();
              setPick(DURATION_TILES[to]);
              tiles.current[to]?.focus();
            }}
            onClick={() => onApply(min)}
          >
            <span className="dur-tile-num">{min}</span>
            <span className="dur-tile-unit">{t("dur.min")}</span>
          </button>
        ))}
      </div>

      {!fitsToday ? null : (
        <button
          type="button"
          className="dur-backrow"
          aria-expanded={backOpen}
          aria-controls={SLIDER_ID}
          onClick={() => setBackOpen((v) => !v)}
        >
          {t("dur.backBy", { time: fmtTime(backMin) })}{" "}
          {/* the caret says which way the row goes NEXT — it never flipped
              while the panel was open, unlike the peek sheet's "N more ▴"
              (UX sweep U20). Punctuation, so it is not part of the
              sentence and both catalogs spell it the same. */}
          <span aria-hidden="true">{t(backOpen ? "chip.caretUp" : "chip.caret")}</span>
        </button>
      )}

      {/* the ±5 min note is the back-by row's own caption, tight under it
          (Viktor, 2026-09-11: it read as a stray line at the sheet's foot) */}
      {fitsToday ? <span className="kit-card-meta dur-note">{t("dur.note")}</span> : null}

      {fitsToday && backOpen ? (
        <div id={SLIDER_ID} className="dur-backby">
          <TimeSlider
            value={backMin}
            label={t("controls.time.label")}
            onChange={(min) => setPick(durationFromBackBy(min, departMin))}
          />
          <Button onClick={() => onApply(pick, backMin)}>
            {t("leave.set", { time: fmtTime(backMin) })}
          </Button>
        </div>
      ) : null}

      {fitsToday ? null : <span className="kit-card-meta">{t("dur.note")}</span>}
    </Sheet>
  );
}
