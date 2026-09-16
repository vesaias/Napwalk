import type { ReactElement } from "react";
import { Chip, StrollerIcon, WalkIcon, WheelchairIcon } from "../../kit";
import { t } from "../../../i18n/t";
import type { Access } from "../../../router/astar";

const GLYPH: Record<Access, (p: { size?: number }) => ReactElement> = {
  walk: WalkIcon,
  stroller: StrollerIcon,
  wheelchair: WheelchairIcon,
};

/** The header's "who is walking" chip, as an icon: a walker, a pram or a
 *  wheelchair, with the ▾ that says it opens a sheet. It was "Stroller ▾" in
 *  words until 2026-09-08, when four text chips wrapped to a second row on
 *  Wander (Viktor) — the name moves to aria-label and the tooltip.
 *
 *  All three modes have their own glyph since UX sweep U22: wheelchair fell
 *  through to the walking figure, so `?a=wheelchair` drew a walker over a
 *  plan that had refused every kerb. */
export function AccessChip({ access, onClick }: { access: Access; onClick: () => void }) {
  const Glyph = GLYPH[access];
  return (
    <Chip label={t(`access.${access}`)} onClick={onClick}>
      <Glyph size={18} />
      <span aria-hidden="true">{t("chip.caret")}</span>
    </Chip>
  );
}
