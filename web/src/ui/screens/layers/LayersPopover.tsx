import { useEffect, useRef, type RefObject } from "react";
import { t } from "../../../i18n/t";
import type { Layers } from "../../../plan/settings";
import { focusables, nextIndex } from "../../kit/focus";
import { LayerRows } from "./LayerRow";

type LayersPopoverProps = {
  layers: Layers;
  shadeMin: number;
  onChange: (layers: Layers) => void;
  onClose: () => void;
  /** The button that opened it. Held rather than read off
   *  `document.activeElement` (CR-02 slice B review, finding 8): a click
   *  does not focus a button in Safari or in Firefox on macOS, so that read
   *  was `<body>` there — which contains every target, so the outside-click
   *  test could never fire and the focus return was a no-op. */
  anchor: RefObject<HTMLButtonElement | null>;
};

const TITLE_ID = "layers-pop-title";

/** The web's map layers: a 300 px card anchored above the layers button
 *  (CR-02 edit 3, board `screens-cr02/w-layers-day`).
 *
 *  A popover, not a Sheet. The web frame already has one card holding the
 *  screen, and a second one sliding up from the bottom of a 900 px desktop
 *  to say two words would be a dialog for a question the reader can answer
 *  with the map still in view. So it dims nothing, keeps the map live, and
 *  goes away on a click outside it or on Escape.
 *
 *  It is still a dialog for the keyboard: focus moves to the first switch
 *  when it opens, Tab wraps inside it, and focus returns to the button when
 *  it closes. The button itself is excluded from the outside-click test — it
 *  toggles the popover, and closing here as well would have a tap on it
 *  close and immediately reopen.
 */
export function LayersPopover({
  layers,
  shadeMin,
  onChange,
  onClose,
  anchor,
}: LayersPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  // The latest `onClose`, read at the moment the reader presses a key rather
  // than baked into the effect's dependencies. `Layers` builds a fresh
  // `close` arrow on every render, so a dependency on it re-ran the whole
  // effect on every re-render of the shell — and that effect moves focus to
  // the FIRST switch, while its cleanup puts focus back on the button. A
  // keyboard reader who had Tabbed to Noise was yanked back to Shade by the
  // next unrelated render (the shade minute ticking is enough). Measured
  // 2026-09-10: Tab → Noise, and 1.2 s later → Shade.
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opener = anchor.current;
    el.querySelector<HTMLElement>(".kit-toggle")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        latestClose.current();
      }
      // Tab stays inside, the way it does in a Sheet (kit/focus.ts). The
      // popover is non-modal — it dims nothing and the map stays live — but
      // a keyboard reader who Tabs out of it lands on the Locate button
      // BEHIND an open card with no way back to it (review, finding 9).
      // Escape and a click outside are still the ways out.
      if (e.key !== "Tab") return;
      const items = focusables(el);
      const i = nextIndex(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      if (i < 0) return;
      e.preventDefault();
      items[i].focus();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!el.contains(target) && !(opener !== null && opener.contains(target)))
        latestClose.current();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown, true);
      opener?.focus();
    };
    // `anchor` is a ref object, so this runs on mount and unmount and at no
    // other time — which is what "focus the first switch when it opens, and
    // give the button its focus back when it closes" means.
  }, [anchor]);

  return (
    <div ref={ref} className="layers-pop" role="dialog" aria-labelledby={TITLE_ID}>
      {/* The popover's own head. It had a title and no way out but Escape or
          a click outside — which is a keyboard instruction and a guess, on
          the one modal in the app with no ✕ (round 3, item 11). Same row as
          every sheet's `SheetHead`, same glyph size. */}
      <div className="kit-sheet-head">
        <span className="layers-pop-title" id={TITLE_ID}>
          {t("layers.title")}
        </span>
        <button
          type="button"
          className="kit-search-glyph kit-sheet-close"
          aria-label={t("actions.done")}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="layers-body">
        <div className="layers-rows">
          <LayerRows layers={layers} shadeMin={shadeMin} onChange={onChange} />
        </div>
        <p className="layers-note">{t("layers.note")}</p>
      </div>
    </div>
  );
}
