import type { ReactNode } from "react";
import { t } from "../../../i18n/t";

type ABHeaderProps = {
  /** "Your location", or the label of the pin the walk starts from. */
  fromLabel: string;
  toLabel: string;
  /** The walk starts at the live fix rather than at a place: the From glyph
   *  is the map's own blue dot instead of a pinned point's teardrop. */
  fromIsGps: boolean;
  /** Swapping needs a point to put at the far end: with the walk starting
   *  at the live fix there is nothing to turn into a destination. */
  canSwap: boolean;
  /** The ✕ on the From row: leaves the walk for the screen it came from —
   *  the place card, or Home (the reducer's `back` decides which). */
  onClose: () => void;
  onEditFrom: () => void;
  onEditTo: () => void;
  onSwap: () => void;
  /** The three chips, drawn on the same white panel (Routes.tsx owns them:
   *  they change the question, not the ends of the walk). */
  children?: ReactNode;
};

/** The routes header (R4, compact rework 2026-09-06): a white panel with two
 *  stacked From / To fields joined by a dotted connector, a 24 px trailing
 *  column carrying the ✕ that leaves and the ⇅ that turns the walk around,
 *  and the chip row under them. 127 px tall in a browser tab
 *  (board `HB-routes.html`, SPEC §3 R4 / §4).
 *
 *  There is no back arrow: the ✕ IS the way out, and it sits on the From row
 *  where the arrow used to be (SPEC §4). That also buys the fields the whole
 *  width of the panel, which is what lets them be 36 px tall and still read.
 *
 *  Both ends are editable, so each one is a field of its own and says which
 *  end it is. The value is inside the button and also inside its accessible
 *  name — a bare "From" would tell a screen-reader user which field it is and
 *  not what is in it. */
export function ABHeader({
  fromLabel,
  toLabel,
  fromIsGps,
  canSwap,
  onClose,
  onEditFrom,
  onEditTo,
  onSwap,
  children,
}: ABHeaderProps) {
  return (
    <div className="route-header">
      <div className="route-header-row">
        <div className="route-header-fields">
          <span className="route-header-link" aria-hidden="true" />
          <button
            type="button"
            className="route-header-field route-header-field--from"
            aria-label={`${t("routes.from")}: ${fromLabel}`}
            onClick={onEditFrom}
          >
            <span className="route-header-slot" aria-hidden="true">
              <span
                className={`route-header-glyph route-header-glyph--${fromIsGps ? "gps" : "start"}`}
              />
            </span>
            <span className="route-header-value route-header-value--from">{fromLabel}</span>
          </button>
          <button
            type="button"
            className="route-header-field route-header-field--to"
            aria-label={`${t("routes.to")}: ${toLabel}`}
            onClick={onEditTo}
          >
            <span className="route-header-slot" aria-hidden="true">
              <span className="route-header-glyph route-header-glyph--dest" />
            </span>
            <span className="route-header-value route-header-value--to">{toLabel}</span>
          </button>
        </div>

        {/* the 24 px column: ✕ beside From, ⇅ beside To, each one as tall as
            the field it belongs to (SPEC §4) */}
        <div className="route-header-col">
          <button
            type="button"
            className="route-header-close"
            aria-label={t("routes.close")}
            onClick={onClose}
          >
            ✕
          </button>
          <button
            type="button"
            className="route-header-swap"
            // No catalog word for "swap", so the button says where it would
            // take you — which is what it does (the old bar's own label).
            aria-label={`${toLabel} → ${fromLabel}`}
            disabled={!canSwap}
            // A pointer tap must not leave the ring behind (seen on a phone
            // 2026-09-06); a keyboard activation has detail 0 and keeps focus.
            onClick={(e) => {
              if (e.detail > 0) e.currentTarget.blur();
              onSwap();
            }}
          >
            ⇅
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
