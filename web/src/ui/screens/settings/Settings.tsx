import { useState, type ReactNode } from "react";
import { t } from "../../../i18n/t";
import { accessOptions } from "../../accessOptions";
import type { Locale } from "../../../i18n/t";
import { PACE_KMH, type Pace, type Settings as SettingsModel, type ThemePref } from "../../../plan/settings";
import type { Access } from "../../../router/astar";
import type { DaylightHint } from "../../theme";
import { fmtTime, ListRow, ReportIcon, Segment, Toggle } from "../../kit";
import { OptionSheet } from "./OptionSheet";

type SettingsProps = {
  settings: SettingsModel;
  /** The current city, translated — the value on the City row. */
  cityName: string;
  /** map.attribution.<city>, behind the "Data & sources" disclosure. */
  attribution: string;
  /** Which way the daylight option resolves in the selected city right now,
   *  and when it turns over. Null unless that option is the one chosen —
   *  the other two say all there is to say in one word. */
  daylight: DaylightHint | null;
  /** Change and persist one field. */
  onPatch: (p: Partial<SettingsModel>) => void;
  onCity: () => void;
  onReport: () => void;
};

/** The rows whose value is a short list open a sheet with that list in it,
 *  the way City does — three paces, three themes, two languages.
 *
 *  They used to CYCLE on tap, under the same ▾ City wears: one tap on
 *  Language re-languaged the whole app, with no options shown, no
 *  confirmation and nothing announced (UX sweep U6). The ▾ stays and is
 *  honest now. */
type OptionRow = "pace" | "theme" | "language";

const PACES: readonly Pace[] = ["easy", "normal", "brisk"];
const THEMES: readonly ThemePref[] = ["light", "dark", "daylight"];
const LOCALES: readonly Locale[] = ["en", "de"];
const PACE_KEY: Record<Pace, string> = {
  easy: "settings.paceEasy",
  normal: "settings.paceNormal",
  brisk: "settings.paceBrisk",
};
const THEME_KEY: Record<ThemePref, string> = {
  light: "settings.themeLight",
  dark: "settings.themeDark",
  daylight: "settings.themeDaylight",
};
const MODE_KEY = { light: "settings.themeModeLight", dark: "settings.themeModeDark" } as const;
const LOCALE_KEY: Record<Locale, string> = { en: "settings.langEn", de: "settings.langDe" };

/** The ▾ the mockup puts after every cycling value. It is punctuation, not
 *  copy — the same glyph in both catalogs — and it says "there is more than
 *  one of these" without a control that has to be dismissed. */
const MORE = " ▾";

/** The mockup's middle dot, the same separator settings.paceValue writes
 *  inside its own sentence. Punctuation, so it lives here and not in the
 *  catalog. */
const DOT = " · ";

/** "Light", "Dark" — and for the daylight option the answer it is giving
 *  right now: "By daylight · light until 20:00". Without the second half
 *  the row cannot be read at a glance, because the whole point of the
 *  option is that the value changes while nobody touches it. */
function themeValue(pref: ThemePref, daylight: DaylightHint | null): string {
  const name = t(THEME_KEY[pref]);
  if (pref !== "daylight" || daylight === null) return name;
  const until = t("settings.themeDaylightUntil", {
    mode: t(MODE_KEY[daylight.mode]),
    time: fmtTime(daylight.until),
  });
  return name + DOT + until;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="set-section">{title}</div>
      {children}
    </>
  );
}

/** The Settings tab: a white page of sections, every change written straight
 *  through to localStorage (mockups/phone-settings.html). */
export function Settings({
  settings,
  cityName,
  attribution,
  daylight,
  onPatch,
  onCity,
  onReport,
}: SettingsProps) {
  const [sources, setSources] = useState(false);
  /** Which row's options are open, or none. Local: these three sheets are a
   *  detail of this page, not a screen the URL or the back button owns —
   *  Escape and the ✕ close them, as `Sheet modal` does for every dialog. */
  const [open, setOpen] = useState<OptionRow | null>(null);
  const close = () => setOpen(null);

  return (
    <div className="set-page">
      <span className="set-title">{t("settings.title")}</span>

      <Section title={t("settings.howYouWalk")}>
        <div className="set-segment">
          <Segment<Access>
            value={settings.access}
            label={t("settings.howYouWalk")}
            options={accessOptions(settings.access).map((a) => ({
              value: a,
              label: t(`settings.${a}`),
            }))}
            onChange={(access) => onPatch({ access })}
          />
        </div>
        <ListRow
          title={t("settings.avoidCobbles")}
          right={
            <Toggle
              on={settings.avoidCobbles}
              label={t("settings.avoidCobbles")}
              onChange={(avoidCobbles) => onPatch({ avoidCobbles })}
            />
          }
        />
        <ListRow
          title={t("settings.pace")}
          value={
            t("settings.paceValue", {
              name: t(PACE_KEY[settings.pace]),
              kmh: PACE_KMH[settings.pace],
            }) + MORE
          }
          onClick={() => setOpen("pace")}
        />
      </Section>

      <Section title={t("settings.routing")}>
        <ListRow
          title={t("settings.autoPref")}
          note={t("settings.autoPrefRule")}
          right={
            <Toggle
              on={settings.autoPref}
              label={t("settings.autoPref")}
              onChange={(autoPref) => onPatch({ autoPref })}
            />
          }
        />
      </Section>

      <Section title={t("settings.map")}>
        <ListRow title={t("settings.city")} value={cityName + MORE} onClick={onCity} />
        <ListRow
          title={t("settings.theme")}
          value={themeValue(settings.theme, daylight) + MORE}
          onClick={() => setOpen("theme")}
        />
        <ListRow
          title={t("settings.language")}
          value={t(LOCALE_KEY[settings.locale]) + MORE}
          onClick={() => setOpen("language")}
        />
      </Section>

      <Section title={t("settings.about")}>
        <ListRow
          title={t("settings.dataSources")}
          value={MORE.trim()}
          expanded={sources}
          onClick={() => setSources((v) => !v)}
        />
        {sources ? <p className="set-note set-note--sources">{attribution}</p> : null}
        {/* not a ListRow: the mockup's last line is the accent-coloured
            "Report or ask" with its own icon, and ListRow's title is a
            string. One button, nothing nested inside it. */}
        <button type="button" className="kit-row kit-row--compact set-report" onClick={onReport}>
          <span className="set-report-label">
            <ReportIcon size={20} />
            {t("settings.report")}
          </span>
          <span className="set-arrow" aria-hidden="true">
            →
          </span>
        </button>
      </Section>

      {open !== "pace" ? null : (
        <OptionSheet<Pace>
          title={t("settings.paceTitle")}
          value={settings.pace}
          options={PACES.map((p) => ({ value: p, label: t(PACE_KEY[p]) }))}
          onPick={(pace) => onPatch({ pace })}
          onClose={close}
        />
      )}
      {open !== "theme" ? null : (
        <OptionSheet<ThemePref>
          title={t("settings.themeTitle")}
          value={settings.theme}
          options={THEMES.map((p) => ({ value: p, label: t(THEME_KEY[p]) }))}
          onPick={(theme) => onPatch({ theme })}
          onClose={close}
        />
      )}
      {open !== "language" ? null : (
        <OptionSheet<Locale>
          title={t("settings.languageTitle")}
          value={settings.locale}
          options={LOCALES.map((p) => ({ value: p, label: t(LOCALE_KEY[p]) }))}
          onPick={(locale) => onPatch({ locale })}
          onClose={close}
        />
      )}
    </div>
  );
}
