import type { ReactNode } from "react";

type BarsProps = {
  shadePct: number;
  quietPct: number;
  shadeLabel: string;
  quietLabel: string;
  /** The pair as the peek snap's compact card draws them (CR-01 edit 3,
   *  reworked by CR-03 Q7): 40 px tracks instead of 56, and the figure in
   *  bold ink with its word beside it in muted — "**76 %** shade".
   *
   *  CR-01 dropped the words here to save the row's width; the second phone
   *  round put them back, because two coloured 40 px bars with a bare
   *  percentage each say nothing at all to a reader who has not learnt the
   *  colours, and the card's whole job at peek is to be readable at a
   *  glance. What gives way when the row is too narrow is the via or loop
   *  NAME, which is the one thing on it the map is also saying. */
  compact?: boolean;
};

function clamp(n: number): number {
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

/** "76 % shade" → a bold ink "76 %" and a muted " shade" (board `c-q7`).
 *
 *  Split at the % sign, which the catalog always puts directly after the
 *  figure — scripts/contrast.mjs holds every catalog to a U+202F before it,
 *  so German's "76 % Schatten" splits in exactly the same place, and this
 *  needs no key of its own and no markup in a catalog string (rule 5). A
 *  label with no % in it at all — "after sunset" — is all word and stays
 *  muted, which is right: there is no figure in it to lead with. */
function figure(label: string): ReactNode {
  const at = label.indexOf("%");
  if (at < 0) return label;
  return (
    <>
      <b className="kit-bar-val">{label.slice(0, at + 1)}</b>
      {label.slice(at + 1)}
    </>
  );
}

/** The two 6 px meters under a route card: shade in green, quiet in blue. */
export function Bars({ shadePct, quietPct, shadeLabel, quietLabel, compact }: BarsProps) {
  const say = (label: string) => (compact ? figure(label) : label);
  return (
    <div className={compact ? "kit-bars kit-bars--compact" : "kit-bars"}>
      <div className="kit-bar">
        <div className="kit-bar-track">
          <div className="kit-bar-fill kit-bar-fill--shade" style={{ width: `${clamp(shadePct)}%` }} />
        </div>
        <span>{say(shadeLabel)}</span>
      </div>
      <div className="kit-bar">
        <div className="kit-bar-track">
          <div className="kit-bar-fill kit-bar-fill--quiet" style={{ width: `${clamp(quietPct)}%` }} />
        </div>
        <span>{say(quietLabel)}</span>
      </div>
    </div>
  );
}

type ShadeStripProps = {
  segments: { shade: boolean; m: number }[];
  /** 10 on a steps list, 6 in the navigation bar (SPEC §4, board
   *  HB-navigate) — the two the design draws, so the two on offer. */
  height?: 6 | 10;
};

/** The sun/shade ribbon along a route: green where the walk is shaded,
 *  amber where it is not, each block as wide as its share of the metres. */
export function ShadeStrip({ segments, height = 10 }: ShadeStripProps) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.m), 0);
  return (
    <div className={`kit-strip${height === 6 ? " kit-strip--thin" : ""}`}>
      {total <= 0
        ? null
        : segments.map((s, i) => (
            <span
              key={i}
              className={`kit-strip-seg kit-strip-seg--${s.shade ? "shade" : "sun"}`}
              style={{ width: `${(Math.max(0, s.m) / total) * 100}%` }}
            />
          ))}
    </div>
  );
}
