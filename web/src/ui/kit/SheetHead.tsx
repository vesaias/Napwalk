type SheetHeadProps = {
  title: string;
  /** Accessible name for the ✕. */
  closeLabel: string;
  onClose: () => void;
};

/** A modal sheet's first row: its title and the ✕ that dismisses it. Every
 *  modal in the app wears it — preference, leave-at, access, duration,
 *  layers, city, report and the three option sheets — which is what makes
 *  "a ✕ on every modal" (round 3, item 11) one component rather than ten.
 *
 *  The glyph is `--sz-closeGlyph`, 1.5× the 15 px it was: at 15 the ✕ was
 *  the smallest mark on a 390 px phone and read as decoration on a sheet
 *  whose handle is 36 px wide. The hit area does not change with it — it is
 *  the 44 px `.kit-search-glyph::before` slop, and it was already 44. */
export function SheetHead({ title, closeLabel, onClose }: SheetHeadProps) {
  return (
    <div className="kit-sheet-head">
      <span className="kit-sheet-title">{title}</span>
      <button
        type="button"
        className="kit-search-glyph kit-sheet-close"
        aria-label={closeLabel}
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}
