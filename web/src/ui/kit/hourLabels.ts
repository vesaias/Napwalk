// The hour strip's arithmetic, apart from the strip that draws it (the way
// kit/sheetSnap.ts is apart from the sheet): what one column comes out at,
// and how often the labels under them can be drawn. Pure, so the thresholds
// are a unit test rather than a screenshot — hourLabels.test.ts.
/** The strip's own geometry, in one place because the label rule is decided
 *  from it: the columns share the row with a 4 px gap between them
 *  (index.css `.kit-hours`), and no column is ever narrower than 6 px. */
export const BAR_GAP = 4;
export const BAR_MIN = 6;

/** How wide one column comes out at, for `count` bars in a `stripWidth` px
 *  strip. The same arithmetic flex does. */
export function columnWidth(count: number, stripWidth: number): number {
  if (count <= 0) return 0;
  return Math.max(BAR_MIN, (stripWidth - BAR_GAP * (count - 1)) / count);
}

/** Every how-manyth hour carries a label.
 *
 *  The BARS never change shape — a 13-hour day and a 17-hour one are the
 *  same chart, drawn wider or narrower (2026-09-16). Only the labels thin
 *  out, and by the column width the browser actually laid out rather than
 *  by a bar count: fourteen bars are roomy in a 368 px panel and cramped in
 *  a 240 px one, and the old `DENSE_FROM = 14` threshold could not tell the
 *  two apart — it turned London's day into 6 px sticks beside Frankfurt's
 *  full bars for the sake of one extra hour.
 *
 *  The thresholds are the 12 px digits under the bars (--fs-micro): two of
 *  them measure ~14 px, so a column under 20 px cannot hold one per hour
 *  with air between them, and under 12 px not even every second. */
export function labelEvery(count: number, stripWidth: number): 1 | 2 | 3 {
  // not measured yet — the first render, or a test with no layout. Assume
  // the roomy case; the observer corrects it before the browser paints.
  if (stripWidth <= 0) return 1;
  const col = columnWidth(count, stripWidth);
  if (col >= 20) return 1;
  if (col >= 12) return 2;
  return 3;
}
