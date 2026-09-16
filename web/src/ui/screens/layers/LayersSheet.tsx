import { t } from "../../../i18n/t";
import type { Layers } from "../../../plan/settings";
import { Sheet, SheetHead } from "../../kit";
import { LayerRows } from "./LayerRow";

type LayersSheetProps = {
  layers: Layers;
  /** The minute the shade overlay is drawn at, for the Shade row's source
   *  line (AppShell decides it; ui/layers.ts does not). */
  shadeMin: number;
  onChange: (layers: Layers) => void;
  onClose: () => void;
};

/** The phone's map layers (CR-02 edit 3, board `screens-cr02/hb-layers-sheet`).
 *
 *  A modal sheet, the AccessSheet's shape: a head with a ✕, the rows, and one
 *  muted note. Both switches apply immediately and the sheet stays open —
 *  the two layers are one question ("what is on this map"), and a sheet that
 *  shut on the first tap would hide the second half of the answer.
 *
 *  It is as short as its content: 266 px at 390 × 744. SPEC §6.6 asks for
 *  220, and that is not reachable with the rows the CR draws — the board's
 *  OWN sheet (`screens-cr02/hb-layers-sheet`) measures 256 at the same size,
 *  and the 10 px between the two is this app's sheet chrome (a drag handle
 *  the board draws flat, and SPEC §4's 10/22 padding). Cutting to 220 would
 *  mean dropping a legend or the footer note, which are the two things the
 *  sheet is for. Recorded for the designer.
 *
 *  There is no scrubber here — the day scrubber is the web's (CR-02 edit 5). */
export function LayersSheet({ layers, shadeMin, onChange, onClose }: LayersSheetProps) {
  return (
    <Sheet open modal label={t("layers.title")} onClose={onClose} handleLabel={t("sheet.handle")}>
      <SheetHead title={t("layers.title")} closeLabel={t("actions.done")} onClose={onClose} />
      <div className="layers-body">
        <div className="layers-rows">
          <LayerRows layers={layers} shadeMin={shadeMin} onChange={onChange} />
        </div>
        <p className="layers-note">{t("layers.note")}</p>
      </div>
    </Sheet>
  );
}
