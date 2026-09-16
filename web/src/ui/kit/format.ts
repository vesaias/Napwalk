import { getLocale, t } from "../../i18n/t";

/** U+2212 MINUS SIGN. The design's minus is typographic, never a hyphen. */
const MINUS = "−";
/** U+202F NARROW NO-BREAK SPACE — the space before a % sign (DIN 5008 / SI). */
const NNBSP = " ";

const MIN_PER_DAY = 1440;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Minutes since local midnight as "14:00". Wraps in both directions so
 *  "start + elapsed" past midnight, or a negative offset, still reads. */
export function fmtTime(minutes: number): string {
  if (!Number.isFinite(minutes)) return "00:00";
  const m = ((Math.round(minutes) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** A signed minute delta against the recommended route: "−4 min" / "+2 min"
 *  / "0 min". The word comes from the catalog (German writes "Min."). */
export function deltaLabel(minutes: number): string {
  const m = Number.isFinite(minutes) ? Math.round(minutes) : 0;
  const sign = m > 0 ? "+" : m < 0 ? MINUS : "";
  return t("card.deltaMin", { sign, min: Math.abs(m) });
}

/** A whole percentage with the narrow no-break space: "68 %". Clamped —
 *  every percentage in this app is a share of a route, so 0–100. */
export function pct(n: number): string {
  const v = Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0;
  return `${int(v)}${NNBSP}%`;
}

// --- numbers in the reader's language (QA 2026-09-06, F4-01) --------------
//
// `toFixed(1)` writes "2.3" in every language, so the German build read
// "3.2 km" next to "48 Min." and "an 14:48". Every figure the app prints
// goes through one of these two, and both follow the catalog's locale —
// `getLocale()`, not the browser's, because the language row in Settings is
// what the reader chose.
//
// The formatters are cached per locale and digit count: Intl.NumberFormat is
// the expensive part of formatting, and the route card builds several
// figures per render.
const NUM_FMT = new Map<string, Intl.NumberFormat>();

function numberFormat(digits: number): Intl.NumberFormat {
  const locale = getLocale();
  const key = `${locale}|${digits}`;
  let f = NUM_FMT.get(key);
  if (f === undefined) {
    f = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    NUM_FMT.set(key, f);
  }
  return f;
}

/** One decimal, in the reader's language: "2.3" in English, "2,3" in
 *  German. Every km figure in the app is written this way. */
export function num1(n: number): string {
  return numberFormat(1).format(Number.isFinite(n) ? n : 0);
}

/** A whole number, in the reader's language and with its grouping:
 *  "1,200" in English, "1.200" in German. Metres and percentages. */
export function int(n: number): string {
  return numberFormat(0).format(Number.isFinite(n) ? Math.round(n) : 0);
}
