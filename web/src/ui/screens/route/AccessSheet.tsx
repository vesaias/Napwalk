import { t } from "../../../i18n/t";
import { accessOptions } from "../../accessOptions";
import type { Access } from "../../../router/astar";
import { ListRow, Segment, Sheet, SheetHead, StrollerIcon, Toggle, WalkIcon, WheelchairIcon } from "../../kit";

const GLYPH: Record<Access, (p: { size?: number }) => React.ReactElement> = {
  walk: WalkIcon,
  stroller: StrollerIcon,
  wheelchair: WheelchairIcon,
};

type AccessSheetProps = {
  /** What this walk is being planned with — the trip override if there is
   *  one, the settings underneath it if there is not. */
  access: Access;
  avoidCobbles: boolean;
  /** Applied to THIS trip. Picking a mode CLOSES the sheet, because the
   *  answer to it is a new pair of routes and the reader has to be able to
   *  see them being computed (round 3, item 9a). The cobble toggle does
   *  not: it is a switch, and a switch that shut the sheet on its first
   *  flick could not be flicked back. */
  onAccess: (access: Access) => void;
  onCobbles: (on: boolean) => void;
  onClose: () => void;
};

/** The access chip's sheet (SPEC §3c, board CR-03 Q0): Walk / Stroller and
 *  "Avoid cobbles", for this trip only.
 *
 *  Per-trip is the whole point (SPEC §1): these two change WHICH ROUTES
 *  EXIST, so a reader whose result looks odd has to be able to try another
 *  mode without editing their profile — and without that experiment
 *  silently becoming the setting for every walk after it.
 *
 *  It said so in a footer, and offered the promotion in a head button, and
 *  round 3 took both away (items 7 and 9b). "For this trip. Your default is
 *  Stroller." is a sentence about a rule the reader did not ask about, under
 *  two controls that are already labelled; "Make default" is a settings
 *  edit offered from inside a per-trip override, which is the one thing
 *  this sheet exists NOT to be. Settings is where the default lives, and
 *  the ✕ in the head is what this sheet needs in that corner (item 11). */
export function AccessSheet({ access, avoidCobbles, onAccess, onCobbles, onClose }: AccessSheetProps) {
  return (
    <Sheet open modal label={t("access.title")} onClose={onClose} handleLabel={t("sheet.handle")}>
      <SheetHead title={t("access.title")} closeLabel={t("actions.cancel")} onClose={onClose} />

      <div className="access-segment">
        <Segment
          value={access}
          label={t("access.label")}
          options={accessOptions(access).map((a) => {
            const Glyph = GLYPH[a];
            return { value: a, label: t(`access.${a}`), icon: <Glyph size={20} /> };
          })}
          onChange={onAccess}
        />
      </div>

      <ListRow
        title={t("settings.avoidCobbles")}
        note={t("access.cobblesNote")}
        right={
          <Toggle on={avoidCobbles} onChange={onCobbles} label={t("settings.avoidCobbles")} />
        }
      />
    </Sheet>
  );
}
