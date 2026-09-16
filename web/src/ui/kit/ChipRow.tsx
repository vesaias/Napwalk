import { useEffect, useRef, useState, type ReactNode } from "react";

/** A row of chips that scrolls sideways when it has to. The 24 px right
 *  fade (CR-01 edit 7) and the trailing room the last chip scrolls into
 *  are only there while the chips actually overflow: a row that fits was
 *  wearing the fade over its last chip's ▾ (Viktor, 2026-09-08 — the
 *  access chip as an icon made Wander's four fit 390 px, and the fade then
 *  ate its caret). Overflow is measured, not styled: a ResizeObserver on
 *  the row and its chips, so a language switch or a rotated phone re-checks.
 *
 *  What overflow means is the row's own width and nothing else since CR-04
 *  ruling 2. There used to be a `reserve` prop — the width of the Layers
 *  chip pinned OVER the row's right end, counted as overflow so a chip that
 *  would come to rest under the circle raised the fade instead of hiding a
 *  caret. The chip is a flex sibling now (index.css `.chip-bar`), the row
 *  ends where the chip begins, and nothing is ever behind anything. */
export function ChipRow({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const check = () => {
      const chips = el.children;
      if (chips.length === 0) return setOver(false);
      const first = chips[0].getBoundingClientRect();
      const last = chips[chips.length - 1].getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const inset = first.left - box.left + el.scrollLeft; // the row's own left padding
      setOver(
        Math.round(last.right - first.left + el.scrollLeft) > Math.round(box.width - 2 * inset)
      );
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    return () => ro.disconnect();
  }, [children]);
  return (
    <div ref={ref} className={`route-chips chip-row ${className}${over ? " chip-row--over" : ""}`}>
      {children}
    </div>
  );
}
