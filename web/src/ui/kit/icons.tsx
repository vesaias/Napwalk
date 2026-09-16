/** The icon set (SPEC §5). Every icon is a 24×24 viewBox filled with
 *  `currentColor`, so colour comes from the class that wraps it. Size is a
 *  prop because the tab bar uses 24 and the search bar 22. */

type IconProps = { size?: number };

function Icon({ size = 24, path }: IconProps & { path: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

const ROUTE =
  "M21.71 11.29l-9-9a1 1 0 0 0-1.42 0l-9 9a1 1 0 0 0 0 1.42l9 9a1 1 0 0 0 1.42 0l9-9a1 1 0 0 0 0-1.42zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5z";
const WANDER =
  "M12 6v3l4-4-4-4v3a8 8 0 0 0-6.78 12.23l1.46-1.46A6 6 0 0 1 12 6zm6.78 1.77l-1.46 1.46A6 6 0 0 1 12 18v-3l-4 4 4 4v-3a8 8 0 0 0 6.78-12.23z";
const SETTINGS =
  "M19.14 12.94a7 7 0 0 0 0-1.88l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.3 7.3 0 0 0-1.62-.94l-.36-2.54A.48.48 0 0 0 13.93 2h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58a7 7 0 0 0 0 1.88l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.47.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z";
const REPORT = "M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z";
// The map-layers glyph (board C, card "Layers · day scrubber"): two stacked
// sheets seen edge-on — Material's `layers`, minus the third sheet.
const LAYERS =
  "M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z";
// The scrubber's transport pair (CR-02 edit 5, board `w-layers-day` draws a
// ▶ glyph): Material's play_arrow and pause, at the same 24 grid.
const PLAY = "M8 5v14l11-7z";
const PAUSE = "M6 5h3.5v14H6zm8.5 0H18v14h-3.5z";
const LOCATE =
  "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.94 3A8.99 8.99 0 0 0 13 3.06V1h-2v2.06A8.99 8.99 0 0 0 3.06 11H1v2h2.06A8.99 8.99 0 0 0 11 20.94V23h2v-2.06A8.99 8.99 0 0 0 20.94 13H23v-2h-2.06zM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14z";

// Who is walking (the access chip and the access sheet's segment). All three
// glyphs are the DESIGNER's own, lifted from the board CR-03 Q0 frame
// (`docs/design/handoff/board/screens-cr03/c-q0-access-sheet-make-default-in-
// the-head.html`) so the app draws what the board draws (CR-03 A7). The pram
// replaces one drawn here in the repo, and the wheelchair a Material
// `accessible` whose head was a separate <circle>; all three are one filled
// path on the same 24 grid now, which is what `Icon` takes.
//
// The wheelchair is stored but not offered: the segment is Walk / Stroller
// (ui/accessOptions.ts, Viktor's standing override), and this glyph is what
// an `a=wheelchair` link or a stored setting still draws.
const WALK =
  "M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3A7.3 7.3 0 0 0 19 13v-2a5.3 5.3 0 0 1-4.5-2.5l-1-1.6A2 2 0 0 0 11.8 6c-.3 0-.5 0-.8.1L6 8.3V13h2V9.6l1.8-.7z";
// A pram, in four marks and no interior detail: a quarter-circle hood that
// MERGES into a rounded tub (one subpath, no seam between them), one handle
// bar out of the tub's back, and two wheels. Board Q0's path drew the hood
// floating free and read as a hat at 18 px; the joined version that replaced
// it on 2026-09-15 still carried the board's chassis, its axle stub and its
// notched tub, and read as a smudge at the same size ("stroller icon still
// bad, should be less detailed maybe" — Viktor, 2026-09-16). This one is
// drawn for 18 px, which is the chip; 20 is the access segment.
//
// Every subpath is wound CLOCKWISE on screen, the handle included. It
// overlaps the tub by design — that is what makes the join seamless — and
// under the nonzero fill rule an opposite winding would have cut the overlap
// out as a notch instead (seen, and fixed, while picking between candidates).
const PRAM =
  // one smooth body (hood + tub in a single outline), a capsule handle with
  // round ends, two wheel dots — the hard-edged handle bar and the sharp
  // hood/tub corner of the first cut read as blocky at 18 px (Viktor, 2026-09-16)
  "M13.5 3.5c4.14 0 7.5 3.36 7.5 7.5v1c0 3.3-3.8 6-8.5 6S4 15.3 4 12v-1h9.5V3.5z" +
  "M4.9 12.4a1.3 1.3 0 0 1-1.05-.53L1.3 8.35a1.3 1.3 0 1 1 2.1-1.53l2.55 3.52a1.3 1.3 0 0 1-1.05 2.06z" +
  "M8.6 21.7a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2zm9 0a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2z";
const WHEELCHAIR =
  "M12 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm7 18h-2.4l-2.3-5H9.5A5.5 5.5 0 0 1 4 9.5V7h2v2.5A3.5 3.5 0 0 0 9.5 13H14a1 1 0 0 1 .9.6L17.2 18H19v2zm-11-1a4 4 0 0 1 0-8v2a2 2 0 1 0 2 2h2a4 4 0 0 1-4 4z";

export const RouteIcon = (p: IconProps) => <Icon {...p} path={ROUTE} />;
export const WalkIcon = (p: IconProps) => <Icon {...p} path={WALK} />;

export const StrollerIcon = (p: IconProps) => <Icon {...p} path={PRAM} />;
export const WheelchairIcon = (p: IconProps) => <Icon {...p} path={WHEELCHAIR} />;

export const WanderIcon = (p: IconProps) => <Icon {...p} path={WANDER} />;
export const SettingsIcon = (p: IconProps) => <Icon {...p} path={SETTINGS} />;
export const ReportIcon = (p: IconProps) => <Icon {...p} path={REPORT} />;
export const LocateIcon = (p: IconProps) => <Icon {...p} path={LOCATE} />;
export const LayersIcon = (p: IconProps) => <Icon {...p} path={LAYERS} />;

/** The magnifier is drawn with a stroke, not a fill: the home mockup's
 *  search glyph is a 2.5 px ring with a stub handle, not a solid lens. */
export function PlayIcon({ size = 18 }: IconProps) {
  return <Icon size={size} path={PLAY} />;
}

export function PauseIcon({ size = 18 }: IconProps) {
  return <Icon size={size} path={PAUSE} />;
}

export function SearchIcon({ size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.5" y1="15.5" x2="20.5" y2="20.5" />
    </svg>
  );
}
