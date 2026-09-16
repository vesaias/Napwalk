import { createContext, useContext } from "react";

/** Where the sheets in this subtree live.
 *
 *  `"sheet"` is the phone: a panel pinned to the bottom of the viewport that
 *  slides in and out. `"web"` is the card or side panel (Task 15): the same
 *  children, but a plain sheet becomes a block in the flow of the card
 *  ("inline") and a modal one a centred dialog. Nothing else changes — no
 *  screen knows which frame it is being rendered in.
 *
 *  `"panel"` is the landscape phone's 300 px left rail (CR-03 Q4). It is the
 *  web's container behaviour — inline block, no handle, no snap — in a box
 *  390 px tall, which is why it is a third value rather than a second use of
 *  `"web"`: the two screens that draw a walk read it back and keep the
 *  COMPACT recommended card there, the one the peek rung shows on an upright
 *  phone. Everything else about the two is identical.
 *
 *  The context lives in this file rather than beside `Sheet` so that the
 *  hook below is not a non-component export sitting in a file of components
 *  (oxlint `react/only-export-components`, which is about fast refresh). */
export type SheetSurface = "sheet" | "web" | "panel";

export const SurfaceCtx = createContext<SheetSurface>("sheet");

/** Which container this screen is being drawn in. Two callers, and both ask
 *  the same question: is there room for the full card, or is this the
 *  landscape rail? */
export function useSheetSurface(): SheetSurface {
  return useContext(SurfaceCtx);
}
