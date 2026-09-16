import { t } from "../../../i18n/t";
import { Segment, Sheet, SheetHead } from "../../kit";

type OptionSheetProps<T extends string> = {
  title: string;
  value: T;
  /** Two or three options, as a Segment — the same control the preference
   *  sheet and "How you walk" use for the same shape of question. */
  options: { value: T; label: string }[];
  /** Tapping applies and closes; there is no Apply button (SPEC §3 R5's
   *  rule, and the City sheet's). */
  onPick: (value: T) => void;
  onClose: () => void;
};

/** A settings row's options, as a small modal sheet.
 *
 *  Theme, Pace and Language wore a ▾ — the glyph the mockup puts after a
 *  value with more behind it — and CYCLED on tap: one tap on Language
 *  re-languaged the whole app with no list, no confirmation and nothing
 *  announced, while City, wearing the same ▾, opened a sheet (UX sweep U6).
 *  Now all four keep their promise. The Segment brings radio semantics with
 *  it, so the current value is `aria-checked` rather than a colour, and the
 *  arrow keys move the choice. */
export function OptionSheet<T extends string>({
  title,
  value,
  options,
  onPick,
  onClose,
}: OptionSheetProps<T>) {
  return (
    <Sheet open modal side label={title} onClose={onClose} handleLabel={t("sheet.handle")}>
      <SheetHead title={title} closeLabel={t("actions.cancel")} onClose={onClose} />
      <div className="pref-segment">
        <Segment<T>
          value={value}
          label={title}
          options={options}
          onChange={(v) => {
            onPick(v);
            onClose();
          }}
        />
      </div>
    </Sheet>
  );
}
