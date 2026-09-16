import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { City } from "../cities";
import { getLocale, t } from "../i18n/t";
import { PauseIcon, PlayIcon, fmtTime } from "./kit";
import {
  NUDGE_MIN,
  TICKS,
  TRACK_END,
  TRACK_START,
  clampMinute,
  nudge,
  stepPlay,
  trackPos,
} from "./scrub";
import { setLiveMinute } from "./scrubLive";
import type { Action } from "./shellState";
import { cityClock, sunriseFor, sunsetFor } from "./time";

type DayScrubberProps = {
  /** The minute the shade overlay is drawing right now — AppShell's
   *  `shadeMin` (ui/layers.ts), which is this scrubber's own value the
   *  moment the reader touches it and the walk's Leave-at before that. */
  minute: number;
  city: City;
  dispatch: (a: Action) => void;
};

/** How often a drag or a play frame reaches the reducer. The reducer runs
 *  once per dispatch and the whole shell re-renders behind it, while
 *  ShadeLayer's own mask is redrawn per FRAME and costs nothing extra
 *  (CR-02 slice B report). Ten steps a second is past what the eye asks of a
 *  moving shadow and an order of magnitude fewer renders than a drag emits. */
const DISPATCH_MS = 100;

/** The most day one frame may carry, in real milliseconds. Four rAF frames at
 *  60 Hz is 67 ms, so 250 ms is generous for a stutter and far short of the
 *  seconds a hidden tab hands back (CR-02 slice C review, F6). A frame longer
 *  than this counts as this, so an absence costs a quarter of a second of sun
 *  per frame instead of the whole of it. */
const MAX_FRAME_MS = 250;

const TITLE_ID = "day-scrub-title";

/** The date in the subline: "8 Sept" / "8. Sept.", in the reader's language.
 *  British English, not American, because that is the English this app is
 *  written in — 24-hour clocks, metres, and the day before the month, which
 *  is also the order the board writes it in. */
function dateLabel(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  const locale = getLocale() === "de" ? "de-DE" : "en-GB";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(d);
}

/**
 * Shade across the day (CR-02 edit 5, SPEC §6.7, board `w-layers-day`).
 *
 * A 640 px card, bottom-centre of the map on every frame but the phone,
 * offering the one thing a shade map is for that a route cannot answer: what
 * this street looks like at four o'clock. Play walks the sun from sunrise to
 * sunset at an hour a second and starts again; the thumb, the arrows and
 * **Now** are the same journey taken by hand.
 *
 * The minute is SHELL state (`s.scrub`), not this component's, because the
 * map, the layers popover's "Building and tree shadows for HH:MM" and this
 * card must all be looking at the same moment. What is local is the value
 * the reader is dragging: dispatching per pointer event would re-render the
 * shell sixty times a second for a shadow that does not need it, so the
 * thumb follows the finger and the shell hears about it ten times a second
 * (`DISPATCH_MS`). The two agree again the instant the drag settles.
 *
 * Reduced motion is deliberately not honoured for play: the sun moving is
 * the DATA this control exists to show, not decoration around it, and a
 * reader who has asked for less animation has not asked to be shown a still
 * picture of a thing called "across the day". Nothing else here animates —
 * a native range thumb has no transition to turn off.
 */
export function DayScrubber({ minute, city, dispatch }: DayScrubberProps) {
  // Today IN THE CITY, not on the host. Everything on this card is the
  // city's — Now already was — and the day it names is the day whose
  // sunrise and sunset the subline promises. AppShell hands the shade layer
  // the HOST's day (shade/sun.ts keys on it), which for San Francisco read
  // from Berlin around midnight is a different date: the card used to write
  // that one out in words (CR-02 slice C review, F10). The overlay's own
  // keying is unchanged and is a bigger question than this card.
  const day = cityClock(city).day;
  const [playing, setPlaying] = useState(false);
  /** The minute the reader is holding, ahead of the throttled dispatch.
   *  Null whenever the two agree, which is every moment but a drag or a
   *  play. */
  const [local, setLocal] = useState<number | null>(null);

  // The minute the MAP is drawing, and the minute the TRACK can show. They
  // differ in exactly one case: a departure outside 06:00–21:00, where the
  // track has no position for it. The thumb sits at the end it fell off and
  // the clock says what the map is really doing — which is what the slice
  // report claimed and the code did not do, so `?t=1380` read 21:00 over a
  // map drawing 22:00 (CR-02 slice C review, F3). `aria-valuetext` stays the
  // clamped one: it describes the SLIDER, and a slider must not announce a
  // value it is not at.
  const shownMin = Math.round(local ?? minute);
  const value = clampMinute(shownMin);

  const sun = useMemo(
    () => ({ sunrise: sunriseFor(day, city), sunset: sunsetFor(day, city) }),
    [day, city],
  );

  // --- the throttle --------------------------------------------------------
  const pending = useRef<number | null>(null);
  const sentAt = useRef(0);
  const timer = useRef(0);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    const m = pending.current;
    if (m === null) return;
    pending.current = null;
    sentAt.current = performance.now();
    dispatch({ type: "scrub", min: Math.round(m) });
  }, [dispatch]);

  /** Move the thumb now, and the map within `DISPATCH_MS`. */
  const push = useCallback(
    (m: number) => {
      setLocal(m);
      // the shade layer follows the thumb THIS frame (ui/scrubLive.ts); the
      // reducer gets the throttled dispatch below
      setLiveMinute(Math.round(m));
      pending.current = m;
      const wait = DISPATCH_MS - (performance.now() - sentAt.current);
      if (wait <= 0) flush();
      else if (timer.current === 0) timer.current = window.setTimeout(flush, wait);
    },
    [flush],
  );

  /** The drag (or the play) is over: send the last value and hand the thumb
   *  back to the shell, which is now holding the same minute. */
  const settle = useCallback(() => {
    flush();
    setLocal(null);
    setLiveMinute(null);
  }, [flush]);

  /** A tap, an arrow key or **Now**: one deliberate move, applied at once,
   *  and the animation stops out of the reader's way. */
  const jump = useCallback(
    (m: number) => {
      setPlaying(false);
      push(m);
      settle();
    },
    [push, settle],
  );

  // --- play ----------------------------------------------------------------
  // `shown` is the value the loop starts from without the effect depending
  // on it: a dependency on the minute would tear the loop down and build it
  // again sixty times a second.
  const shown = useRef(value);
  shown.current = value;

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev = performance.now();
    let m = shown.current;
    const tick = (now: number) => {
      // A tab that was hidden comes back with one enormous frame in its
      // hand: rAF does not run in the background, so `now - prev` is the
      // whole absence and `stepPlay` would overshoot sunset and hand back
      // sunrise — the reader who looks away at six o'clock finds the
      // morning (CR-02 slice C review, F6).
      //
      // So a long frame is CAPPED, not thrown away. Dropping it (the shape
      // this shipped in) also throws away every stutter on a slow renderer,
      // and a stutter is time that really did pass: measured on the
      // container's swiftshader, a third of the frames ran past 250 ms and
      // carried nine tenths of the wall clock with them, so the day crawled
      // at eight minutes a second instead of sixty and play never reached
      // sunset (CR-R, 2026-09-09). Capping keeps both properties: a frame
      // nobody could have seen is worth at most one frame of day, and a
      // frame that was merely slow still counts for what it can.
      const dt = Math.min(now - prev, MAX_FRAME_MS);
      prev = now;
      m = stepPlay(m, dt, sun);
      push(m);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, sun, push]);

  // A scrubber that has gone (shade off, a walk drawn, the frame narrowed to
  // a phone) leaves no minute behind: the map goes back to the walk's own
  // departure, which is what the CR asks for when a route is cleared.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      // A microtask, not a straight call. React flushes a pending passive
      // cleanup at the START of the next render when an update arrives before
      // it has run — and this cleanup's own `dispatch` then lands on the shell
      // while the shell is rendering, which React reports as "Cannot update a
      // component (Shell) while rendering a different component (DayScrubber)".
      // Intermittent, and it fails `expectNoPageErrors` when it happens
      // (CR-R, 2026-09-09). The shell only clears `scrub` here, so a tick
      // later is soon enough and is always outside the render.
      queueMicrotask(() => dispatch({ type: "scrubEnd" }));
    },
    [dispatch],
  );

  // --- the keyboard --------------------------------------------------------
  const onTrackKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // Both axes: a range input answers Up/Right and Down/Left alike, so a
    // reader who uses the vertical pair got the input's native step of ONE
    // minute while the horizontal pair moved fifteen (CR-02 slice C review,
    // F5).
    const up = e.key === "ArrowRight" || e.key === "ArrowUp";
    const down = e.key === "ArrowLeft" || e.key === "ArrowDown";
    if (!up && !down) return;
    // the input's own step is 1, so the arrows are handled rather than
    // configured — a 15-minute step would make the drag jump as well
    e.preventDefault();
    jump(nudge(value, up ? NUDGE_MIN : -NUDGE_MIN));
  };

  /** Play/pause, and the settling that pausing owes the shell.
   *
   *  `playing` is read from THIS render rather than from a
   *  `setPlaying((p) => …)` updater, and that is the whole of it: React runs
   *  a state updater during the RENDER phase to compute the next value
   *  (`basicStateReducer` inside `updateReducer`), so a `settle()` hidden
   *  inside one reaches `dispatch` while DayScrubber is rendering — React's
   *  "Cannot update a component (`Shell`) while rendering a different
   *  component (`DayScrubber`)". Intermittent, because `flush` only
   *  dispatches when the throttle has a minute pending, which during play is
   *  a race with its own 100 ms timer; DEV-only, and it fails
   *  `expectNoPageErrors` when it lands. It survived CR-02's microtask
   *  (`81bbe36`) and CR-03's two guesses (`d65d408`, reverted in `6a30f32`)
   *  because both looked at the unmount path and the play loop, and the
   *  dispatch was never on either: the captured stack ends in
   *  `basicStateReducer` (P2, 2026-09-10). No `setPlaying` here takes a
   *  function, and `DayScrubber.test.ts` holds that down.
   *
   *  Reading the render's own value is safe because a click and a keydown are
   *  both DISCRETE events: React flushes their update before the next one is
   *  delivered, so this closure never sees a stale `playing`. */
  const togglePlay = () => {
    if (playing) settle();
    setPlaying(!playing);
  };

  /** Space anywhere on the card is play/pause — except on a button, where
   *  space already means "press this one". */
  const onCardKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== " " && e.key !== "Spacebar") return;
    if ((e.target as HTMLElement).closest("button") !== null) return;
    e.preventDefault();
    togglePlay();
  };

  // --- the sun's own colours on the track ---------------------------------
  // Dark at both ends, warm at sunrise and sunset, amber at solar noon — the
  // stops are the DAY's, not a designer's percentages, so a December track
  // is short and orange and a June one long and bright.
  const stops = {
    "--scrub-rise": `${(trackPos(sun.sunrise) * 100).toFixed(2)}%`,
    "--scrub-noon": `${(trackPos((sun.sunrise + sun.sunset) / 2) * 100).toFixed(2)}%`,
    "--scrub-set": `${(trackPos(sun.sunset) * 100).toFixed(2)}%`,
  } as CSSProperties;

  const sub = t("scrub.sub", {
    hint: t("scrub.hint"),
    date: dateLabel(day),
    rise: fmtTime(sun.sunrise),
    set: fmtTime(sun.sunset),
  });

  return (
    <div className="day-scrub" role="group" aria-labelledby={TITLE_ID} onKeyDown={onCardKey}>
      <div className="day-scrub-head">
        <button
          type="button"
          className="day-scrub-play"
          aria-label={playing ? t("scrub.pause") : t("scrub.play")}
          onClick={togglePlay}
        >
          {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </button>
        <div className="day-scrub-text">
          <span className="day-scrub-title" id={TITLE_ID}>
            {t("scrub.title")}
          </span>
          <span className="day-scrub-sub">{sub}</span>
        </div>
        <span className="day-scrub-clock">{fmtTime(shownMin)}</span>
        <button
          type="button"
          className="day-scrub-now"
          onClick={() => jump(clampMinute(cityClock(city).minute))}
        >
          {t("scrub.now")}
        </button>
      </div>

      <input
        className="day-scrub-range"
        type="range"
        min={TRACK_START}
        max={TRACK_END}
        step={1}
        value={value}
        style={stops}
        aria-label={t("scrub.slider")}
        aria-valuetext={fmtTime(value)}
        onChange={(e) => push(Number(e.target.value))}
        onKeyDown={onTrackKey}
        onPointerDown={() => setPlaying(false)}
        onPointerUp={settle}
        onPointerCancel={settle}
        onKeyUp={settle}
        onBlur={settle}
      />

      <div className="day-scrub-ticks" aria-hidden="true">
        {TICKS.map((m) => (
          <span key={m}>{fmtTime(m)}</span>
        ))}
      </div>
    </div>
  );
}
