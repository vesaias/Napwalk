import { t } from "../../../i18n/t";
import type { Layers as MapOverlays } from "../../../plan/settings";
import { LayersIcon } from "../../kit";
import type { Action, ShellState } from "../../shellState";

type LayersChipProps = {
  s: ShellState;
  dispatch: (a: Action) => void;
  layers: MapOverlays;
};

/** The 30 px round Layers chip, pinned to the right edge of the header chip
 *  row while a walk is drawn (CR-03 Q2, board `c-q2`).
 *
 *  R4 and W1 have no map to float the 44 px button over — a header owns the
 *  top of the phone there and the sheet the bottom — so until now the layers
 *  could not be reached at all from the two screens a reader spends longest
 *  on. Since CR-03 A1 the shade wash is theirs to switch on and off, which
 *  makes that a real gap rather than a tidy simplification: the chip closes
 *  it, and the 44 px button hides for as long as the chip is up
 *  (`layersButtonVisible` / `layersChipVisible`, ui/layers.ts).
 *
 *  It opens the same modal sheet the button does — mounted, as ever, by
 *  screens/layers/Layers.tsx, so there is exactly one of it. */
export function LayersChip({ s, dispatch, layers }: LayersChipProps) {
  const on = layers.shade || layers.noise;
  const open = s.overlay === "layers";
  return (
    <button
      type="button"
      className="shell-layers shell-layers--chip"
      data-on={on}
      aria-label={t("layers.button")}
      aria-pressed={on}
      onClick={() =>
        open ? dispatch({ type: "back" }) : dispatch({ type: "overlay", overlay: "layers" })
      }
    >
      <LayersIcon size={18} />
    </button>
  );
}
