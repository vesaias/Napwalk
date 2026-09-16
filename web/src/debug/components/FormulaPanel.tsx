// Debug-only tuning harness (?debug): live weight sliders over the cost
// formula. Deliberately NOT product surface — SPEC F4 says no weight
// sliders; this exists so the builder can find preset numbers worth
// baking in. Technical text, outside the i18n catalog like debug.ts.
import type { Preset } from "../../router/astar";
import { COMPOSER_DEFAULTS, type ComposerKnobs } from "../../router/composer";

type Props = {
  weights: Preset;
  isCustom: boolean;
  presetName: string;
  onChange: (w: Preset) => void;
  onReset: () => void;
  knobs: ComposerKnobs;
  onKnobs: (k: ComposerKnobs) => void;
  waysOn: boolean;
  onWays: () => void;
  onDump: () => void;
};

const KNOB_FIELDS: { key: keyof ComposerKnobs; label: string; max: number }[] = [
  { key: "lapBase", label: "lap penalty · (laps−1)·small", max: 0.5 },
  { key: "wLength", label: "length miss · |m−target|/t", max: 3 },
  { key: "wApproach", label: "approach badness · share", max: 3 },
  { key: "wIq", label: "quality: roundness (IQ)", max: 1 },
  { key: "wSize", label: "quality: size (len/1500)", max: 1 },
  { key: "wStreet", label: "quality: −street share", max: 3 },
  { key: "outBack", label: "there-and-back penalty", max: 1 },
];

type WKey = "wShade" | "wNoise" | "wSurface" | "wGreen";
const FIELDS: { key: WKey; label: string }[] = [
  { key: "wShade", label: "shade · (1−shade(t))" },
  { key: "wNoise", label: "noise · noise" },
  { key: "wSurface", label: "surface · surface" },
  { key: "wGreen", label: "green · (1−green)" },
];

export default function FormulaPanel({
  weights,
  isCustom,
  presetName,
  onChange,
  onReset,
  knobs,
  onKnobs,
  waysOn,
  onWays,
  onDump,
}: Props) {
  const knobsCustom = KNOB_FIELDS.some(({ key }) => knobs[key] !== COMPOSER_DEFAULTS[key]);
  return (
    <div className="formula-panel">
      <div className="formula-head">
        <code>cost = len × (1 + Σ w·c)</code>
        <span>{isCustom ? "custom" : presetName} · build {__BUILD__}</span>
        <button onClick={onDump}>copy debug dump</button>
        {isCustom && <button onClick={onReset}>reset</button>}
      </div>
      {FIELDS.map(({ key, label }) => (
        <label key={key} className="formula-row">
          <span className="formula-label">{label}</span>
          <input
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={weights[key]}
            onChange={(e) => onChange({ ...weights, [key]: Number(e.target.value) })}
          />
          <span className="formula-val">{weights[key].toFixed(1)}</span>
        </label>
      ))}
      <label className="formula-row" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={waysOn} onChange={onWays} style={{ flex: "none" }} />
        <span className="formula-label" style={{ width: "auto" }}>
          ways overlay: red sidewalk (light = weak) · orange path · blue carriageway w/ sidewalk (dark = major, 20/m) · grey street · purple crossing · green cycle crossing (4×) · brown centred (car-free / sidewalk=no) · magenta dashed = router's raw edges
        </span>
      </label>
      <div className="formula-head" style={{ marginTop: 8 }}>
        <code>value = park·q − appr − laps − len</code>
        <span>{knobsCustom ? "custom" : "default"}</span>
        {knobsCustom && <button onClick={() => onKnobs({ ...COMPOSER_DEFAULTS })}>reset</button>}
      </div>
      {KNOB_FIELDS.map(({ key, label, max }) => (
        <label key={key} className="formula-row">
          <span className="formula-label">{label}</span>
          <input
            type="range"
            min={0}
            max={max}
            step={max / 50}
            value={knobs[key]}
            onChange={(e) => onKnobs({ ...knobs, [key]: Number(e.target.value) })}
          />
          <span className="formula-val">{knobs[key].toFixed(2)}</span>
        </label>
      ))}
    </div>
  );
}
