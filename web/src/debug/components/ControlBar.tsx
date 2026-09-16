import { t } from "../../i18n/t";

// F3: the slider spans the WHOLE DAY in 5-min steps, like shademap
// (2026-08-28). The shadow overlay follows it exactly (W7 live shade) and
// already draws night correctly (`el <= 0`); the router's shade buckets only
// cover daylight, and shadeAt() returns full shade outside them — with the
// sun down, everything is shaded, which is the honest answer.
export const DAY_START_MIN = 0;
export const DAY_END_MIN = 24 * 60 - 5;
export const STEP_MIN = 5;

export type Mode = "loop" | "ab";
export type PresetKey = "balanced" | "maxShade" | "maxQuiet";
export type AccessKey = "wheelchair" | "stroller" | "walk";
export const DURATIONS = [30, 45, 60] as const;

export function fmt(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

type Props = {
  minutes: number;
  onMinutes: (m: number) => void;
  shadeOn: boolean;
  onToggle: () => void;
  noiseOn: boolean;
  onToggleNoise: () => void;
  mode: Mode;
  onMode: (m: Mode) => void;
  duration: number;
  onDuration: (d: number) => void;
  preset: PresetKey;
  onPreset: (p: PresetKey) => void;
  access: AccessKey;
  onAccess: (a: AccessKey) => void;
  onGps: () => void;
  hint: string | null;
};

export default function ControlBar(p: Props) {
  return (
    <div className="controls">
      <input
        className="hour-slider"
        type="range"
        min={DAY_START_MIN}
        max={DAY_END_MIN}
        step={STEP_MIN}
        value={p.minutes}
        aria-label={t("controls.time.label")}
        onChange={(e) => p.onMinutes(Number(e.target.value))}
      />
      <div className="row">
        <span className="time-readout">{fmt(p.minutes)}</span>
        <span className="toggle-group">
          <button className="shade-toggle" aria-pressed={p.noiseOn} onClick={p.onToggleNoise}>
            {p.noiseOn ? t("controls.noise.hide") : t("controls.noise.show")}
          </button>
          <button
            className="shade-toggle"
            aria-pressed={p.shadeOn}
            onClick={p.onToggle}
          >
            {p.shadeOn ? t("controls.shade.hide") : t("controls.shade.show")}
          </button>
        </span>
      </div>
      <div className="row row-modes">
        <div className="segmented" role="group">
          <button
            aria-pressed={p.mode === "loop"}
            onClick={() => p.onMode("loop")}
          >
            {t("mode.loop")}
          </button>
          <button aria-pressed={p.mode === "ab"} onClick={() => p.onMode("ab")}>
            {t("mode.ab")}
          </button>
        </div>
        {p.mode === "loop" && (
          <div className="segmented" role="group">
            {DURATIONS.map((d) => (
              <button
                key={d}
                aria-pressed={p.duration === d}
                onClick={() => p.onDuration(d)}
              >
                {t("duration.label", { min: d })}
              </button>
            ))}
          </div>
        )}
        <button className="gps-btn" onClick={p.onGps}>
          {t("start.gps")}
        </button>
      </div>
      <div className="row">
        <div className="segmented presets" role="group">
          {(["balanced", "maxShade", "maxQuiet"] as PresetKey[]).map((k) => (
            <button
              key={k}
              aria-pressed={p.preset === k}
              onClick={() => p.onPreset(k)}
            >
              {t(`preset.${k}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <div className="segmented access" role="group" aria-label={t("access.label")}>
          {(["stroller", "wheelchair", "walk"] as AccessKey[]).map((k) => (
            <button
              key={k}
              aria-pressed={p.access === k}
              onClick={() => p.onAccess(k)}
            >
              {t(`access.${k}`)}
            </button>
          ))}
        </div>
      </div>
      {p.hint && <div className="hint">{p.hint}</div>}
    </div>
  );
}
