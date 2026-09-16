import type { ReactNode } from "react";
import { t } from "../../../i18n/t";
import type { Layers } from "../../../plan/settings";
import { fmtTime, Toggle } from "../../kit";

type LayerRowProps = {
  /** "Shade" / "Noise" — 16/600, the row's own name. */
  title: string;
  /** What the layer IS, one muted line at 13 ("Building and tree shadows
   *  for 14:00", "Traffic noise"). Not where it comes from: the noise line
   *  used to name Frankfurt's Lärmkartierung 2022 in all eight cities, and
   *  the per-city credit already lives in `map.attribution.<city>`, behind
   *  Settings' "Data sources" (CR-02 slice B review, finding 1). */
  source: string;
  /** The 11 px legend under the source: a swatch and a word for shade, a
   *  55 → 75+ dB gradient bar for noise (board C). */
  legend: ReactNode;
  on: boolean;
  onChange: (on: boolean) => void;
};

/** One layer in the sheet (phone) and the popover (web) — the same
 *  component in both, because it is the same row: a name, where the data
 *  comes from, what its colours mean, and a switch (CR-02 edit 3, board C
 *  card "Layers · day scrubber").
 *
 *  Not a kit `ListRow`: that row's second line is one ellipsised line beside
 *  a value, and this one is a stack of three (source, legend, sometimes a
 *  hint) at a 56 px minimum with a hairline above it. */
export function LayerRow({ title, source, legend, on, onChange }: LayerRowProps) {
  return (
    <div className="layers-row">
      <div className="layers-row-text">
        <span className="layers-row-title">{title}</span>
        <span className="layers-row-source">{source}</span>
        <span className="layers-row-legend">{legend}</span>
      </div>
      <Toggle on={on} onChange={onChange} label={title} />
    </div>
  );
}

/** The shade swatch: the grey the overlay paints, and what it means. */
export function ShadeLegend() {
  return (
    <>
      <span className="layers-swatch" aria-hidden="true" />
      <span>{t("layers.shadeLegend")}</span>
    </>
  );
}

/** The noise ramp, quiet to loud, with the two ends of the scale named. */
export function NoiseLegend() {
  return (
    <>
      <span>{t("layers.noiseMin")}</span>
      <span className="layers-ramp" aria-hidden="true" />
      <span>{t("layers.noiseMax")}</span>
    </>
  );
}

type LayerRowsProps = {
  layers: Layers;
  /** The minute the overlay is drawing the sun at — the walk's departure,
   *  or the wall clock while one is under way (AppShell). It is the Shade
   *  row's source line, because the board's "Shade for 14:00" map label
   *  does not exist in this app (plan ruling, 2026-09-08). */
  shadeMin: number;
  onChange: (layers: Layers) => void;
};

/** The two rows, shared by the phone's sheet and the web's popover — the
 *  frames differ, the rows do not. */
export function LayerRows({ layers, shadeMin, onChange }: LayerRowsProps) {
  return (
    <>
      <LayerRow
        title={t("layers.shade")}
        source={t("layers.shadeSub", { time: fmtTime(shadeMin) })}
        legend={<ShadeLegend />}
        on={layers.shade}
        onChange={(shade) => onChange({ ...layers, shade })}
      />
      <LayerRow
        title={t("layers.noise")}
        source={t("layers.noiseSub")}
        legend={<NoiseLegend />}
        on={layers.noise}
        onChange={(noise) => onChange({ ...layers, noise })}
      />
    </>
  );
}
