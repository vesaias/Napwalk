import { SearchIcon } from "./icons";

type SearchBarProps = {
  value: string;
  placeholder: string;
  onChange?: (value: string) => void;
  /** Show a back arrow on the left instead of the magnifier. */
  onBack?: () => void;
  /** Show the ✕ on the right. */
  onClear?: () => void;
  /** Render the value as text, not an editable field — the whole bar then
   *  acts as one button that calls `onFocus`. */
  readOnly?: boolean;
  onFocus?: () => void;
  /** Take the keyboard as soon as the bar appears — the search page opens
   *  ready to type. Ignored when `readOnly`, which renders a button. */
  autoFocus?: boolean;
  /** Accessible names for the two glyph buttons and, when read-only, the
   *  bar itself. */
  backLabel?: string;
  clearLabel?: string;
};

/** The 52 px floating search bar: magnifier or back arrow, the query, an
 *  optional ✕.
 *
 *  Read-only, the WHOLE pill is the button — magnifier included. It used to
 *  be a 358 x 52 pill with a 290 x 44 button inside it, so half of Home's
 *  one control did nothing at all, and the glyph that says what it is for
 *  was the deadest part of it (UX sweep U2). There is no ✕ or back arrow on
 *  a read-only bar (Home, the place and pin cards), so nothing nests inside
 *  the button — and the one read-only+back combination left (the kit
 *  gallery's stale routes summary; no screen renders it) keeps the old
 *  markup rather than swallowing its own back arrow. */
export function SearchBar({
  value,
  placeholder,
  onChange,
  onBack,
  onClear,
  readOnly,
  onFocus,
  autoFocus,
  backLabel,
  clearLabel,
}: SearchBarProps) {
  if (readOnly && onBack === undefined) {
    return (
      <button type="button" className="kit-search kit-search--button" onClick={onFocus}>
        <span className="kit-search-icon">
          <SearchIcon size={20} />
        </span>
        <span className={`kit-search-value${value ? "" : " kit-search-value--empty"}`}>
          {value || placeholder}
        </span>
      </button>
    );
  }

  return (
    <div className="kit-search">
      {onBack ? (
        <button type="button" className="kit-search-glyph kit-search-glyph--back" aria-label={backLabel} onClick={onBack}>
          ←
        </button>
      ) : (
        <span className="kit-search-icon">
          <SearchIcon size={20} />
        </span>
      )}

      {/* Before the field in the DOM, after it on screen (index.css gives it
          `order: 1`). The bar's own two glyphs stay together at the head of
          the tab order, so Tab out of the query goes straight to the first
          result rather than through a ✕ that wipes it on Enter (UX sweep
          U9). */}
      {onClear ? (
        <button type="button" className="kit-search-glyph kit-search-glyph--clear" aria-label={clearLabel} onClick={onClear}>
          ✕
        </button>
      ) : null}

      {readOnly ? (
        <button
          type="button"
          className={`kit-search-value${value ? "" : " kit-search-value--empty"}`}
          onClick={onFocus}
        >
          {value || placeholder}
        </button>
      ) : (
        <input
          className="kit-search-input"
          type="text"
          autoFocus={autoFocus}
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => onChange?.(e.target.value)}
          onFocus={onFocus}
        />
      )}

    </div>
  );
}
