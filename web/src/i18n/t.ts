import en from "./strings.en.json";
import de from "./strings.de.json";

export type Locale = "en" | "de";

const catalogs: Record<Locale, Record<string, string>> = { en, de };

function initial(): Locale {
  try {
    const s = localStorage.getItem("sw.locale");
    if (s === "en" || s === "de") return s;
  } catch {
    /* no storage */
  }
  return typeof navigator !== "undefined" && navigator.language?.startsWith("de") ? "de" : "en";
}

let locale: Locale = initial();

export function getLocale(): Locale {
  return locale;
}

export function setLocale(l: Locale): void {
  locale = l;
  try {
    localStorage.setItem("sw.locale", l);
  } catch {
    /* ignore */
  }
}

/** Look up a UI string. All user-visible text goes through here so a German
 *  catalog is a file drop (CLAUDE.md rule 5). */
export function t(key: string, vars?: Record<string, string | number>): string {
  const raw = catalogs[locale][key] ?? catalogs.en[key];
  if (raw === undefined) {
    if (import.meta.env.DEV) throw new Error(`missing i18n key: ${key}`);
    return key;
  }
  return vars ? raw.replace(/\{(\w+)\}/g, (_, n) => String(vars[n] ?? `{${n}}`)) : raw;
}
