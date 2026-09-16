import { t } from "../i18n/t";
import { LayersIcon } from "./kit";

type LayersButtonProps = {
  /** Is any layer on? The button is ink-filled when one is, outlined —
   *  a white circle with an ink glyph, the locate button's shape — when
   *  neither is (board C, "layers button · idle / any layer on (ink)"). */
  on: boolean;
  /** Web only: is the popover up? The button owns that dialog, so it says
   *  so with `aria-expanded`. The phone's sheet is a modal the button only
   *  opens — nothing stays expanded under it — so it passes nothing. */
  open?: boolean;
  /** Phone only: which box the button hangs 12 px under — the 52 px search
   *  bar or W0's 44 px pill (ui/layers.ts). Omitted on the web, where the
   *  button is an item in the bottom-right stack and positions itself. */
  under?: "search" | "pill";
  onClick: () => void;
  /** Web only: the popover holds this so it can tell a click on its own
   *  opener from a click outside, and hand focus back to it on close —
   *  rather than guessing at `document.activeElement`, which is `<body>` in
   *  every browser that does not focus a button on click (CR-02 slice B
   *  review, finding 8). React 19 takes `ref` as a plain prop. */
  ref?: React.Ref<HTMLButtonElement>;
};

/** The 44 px circle that opens the map layers (CR-02 edit 2).
 *
 *  One component for both frames: the phone floats it over the map under the
 *  search bar (`--float`), the web makes it the first item of the
 *  bottom-right stack, above Locate and the zoom pill. The ink fill is the
 *  banner pair — `--c-banner` under `--c-onBanner` — which is the same pair
 *  the walk banner and the dark chips wear and the one the contrast check
 *  already holds at 4.5:1 in both themes ("the ink button"). */
export function LayersButton({ on, open, under, onClick, ref }: LayersButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      className={`shell-layers${under === undefined ? "" : " shell-layers--float"}`}
      data-on={on}
      data-under={under}
      aria-label={t("layers.button")}
      aria-pressed={on}
      aria-expanded={open}
      onClick={onClick}
    >
      <LayersIcon size={22} />
    </button>
  );
}
