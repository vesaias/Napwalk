import { useRef } from "react";
import type { Layers as MapOverlays } from "../../../plan/settings";
import { LayersButton } from "../../LayersButton";
import { layersButtonUnder, layersButtonVisible } from "../../layers";
import type { Action, ShellState } from "../../shellState";
import { LayersPopover } from "./LayersPopover";
import { LayersSheet } from "./LayersSheet";

type LayersProps = {
  s: ShellState;
  dispatch: (a: Action) => void;
  layers: MapOverlays;
  /** The minute the shade overlay is drawn at (AppShell). */
  shadeMin: number;
  /** Into the reader's settings, and to localStorage: a layer they turned on
   *  is on next time (SPEC §6.6, `layers.note`). */
  onChange: (layers: MapOverlays) => void;
  /** The web draws a popover in the bottom-right stack; the phone floats the
   *  button over the map and opens a modal sheet. */
  web: boolean;
};

/** The layers button and whatever it opens — one mount for both frames
 *  (CR-02 edits 2 and 3).
 *
 *  It is rendered by the LAYOUT rather than by a screen: the button belongs
 *  to the map, not to the card in front of it, and the two frames put it in
 *  different places — floating under the phone's search bar, first item of
 *  the web's bottom-right stack. Which screens offer it at all is ui/layers.ts.
 *
 *  The overlay is shell state (`overlay: "layers"`), like every other sheet
 *  in the app: `back` closes it, a tab change closes it, and the browser's
 *  back button walks it. */
export function Layers({ s, dispatch, layers, shadeMin, onChange, web }: LayersProps) {
  // the popover's own opener, so it does not have to guess at it
  const button = useRef<HTMLButtonElement>(null);
  const open = s.overlay === "layers";
  const toggle = () =>
    open ? dispatch({ type: "back" }) : dispatch({ type: "overlay", overlay: "layers" });
  const close = () => dispatch({ type: "back" });
  const rows = { layers, shadeMin, onChange };

  // The screens with no button of their own still open this sheet: since
  // CR-03 Q2 R4 and W1 reach it through the header's 30 px chip instead
  // (screens/layers/LayersChip.tsx). The SHEET stays mounted here, so there
  // is one of it whichever control opened it.
  if (!web && !layersButtonVisible(s)) {
    return open ? <LayersSheet {...rows} onClose={close} /> : null;
  }

  return web ? (
    <div className="web-layers">
      {open ? <LayersPopover {...rows} onClose={close} anchor={button} /> : null}
      <LayersButton ref={button} on={layers.shade || layers.noise} open={open} onClick={toggle} />
    </div>
  ) : (
    <>
      <LayersButton
        on={layers.shade || layers.noise}
        under={layersButtonUnder(s)}
        onClick={toggle}
      />
      {open ? <LayersSheet {...rows} onClose={close} /> : null}
    </>
  );
}
