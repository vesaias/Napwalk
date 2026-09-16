import { t } from "../../../i18n/t";
import type { Preference } from "../../../plan/preference";
import { Segment, Sheet, SheetHead, Tag } from "../../kit";
import type { AutoWindow } from "./Routes";

const ORDER: Preference[] = ["shade", "quiet", "balanced"];

/** Why the clock chose what it chose (SPEC §3 R5). The three preferences and
 *  the three rules are the same three cases — 11–16 h is the shade window,
 *  18 h to sunset the quiet one, and everything else is the low sun that
 *  makes Balanced right — so the pick names the reason. */
const AUTO_REASON: Record<Preference, string> = {
  shade: "pref.reasonAfternoon",
  quiet: "pref.reasonEvening",
  balanced: "pref.reasonLowSun",
};

type PreferenceSheetProps = {
  pref: Preference;
  /** Is the preference showing the clock's pick, or the reader's? */
  auto: boolean;
  /** The hours the automatic rule owns — null when it names none (before 11
   *  and after sunset the fallback is Balanced, with no window to badge). */
  autoWindow: AutoWindow;
  onApply: (pref: Preference) => void;
  onClose: () => void;
};

/** "What matters most?" — a segmented control and one line saying why the
 *  choice standing there is the one standing there (board HB-preference).
 *
 *  Tapping a segment applies it and closes the sheet: there is no Apply
 *  button and no draft state (SPEC §3 R5, slice 4). Three routes' worth of
 *  weights is a cheap thing to try, and the reader can see the answer change
 *  behind the sheet — holding the pick back behind a second tap only made
 *  the sheet harder to leave. */
export function PreferenceSheet({ pref, auto, autoWindow, onApply, onClose }: PreferenceSheetProps) {
  return (
    <Sheet open modal label={t("pref.title")} onClose={onClose} handleLabel={t("sheet.handle")}>
      <SheetHead title={t("pref.title")} closeLabel={t("actions.cancel")} onClose={onClose} />

      <div className="pref-segment">
        <Segment
          value={pref}
          label={t("pref.title")}
          options={ORDER.map((p) => ({ value: p, label: t(`pref.${p}`) }))}
          onChange={onApply}
        />
      </div>

      {/* Only the CLOCK's pick has a reason to give. A manual pick used to
          get "Your pick for this route", which told the reader what they had
          just done — the same line the cards dropped in CR-03 A5 and the last
          place it survived (round 3, item 8). With no reason and no window
          the row is empty, so it is not drawn at all. */}
      {auto ? (
        <div className="pref-reason">
          {autoWindow === null ? null : <Tag variant="acc">{t("pref.auto", autoWindow)}</Tag>}
          <span className="pref-reason-text">{t(AUTO_REASON[pref])}</span>
        </div>
      ) : null}
    </Sheet>
  );
}
