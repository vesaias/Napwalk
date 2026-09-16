// Numbers the planning UI shows beside a route (UI redesign Task 6,
// 2026-09-05): minutes in the sun, the leave-at hour strip, shade around a
// point, and where a pin stands relative to the city's shade border. Pure
// functions over the graph; no state.
import { shadeAt, shadeAtOrThrow, SPEED_M_PER_MIN, type Daylight } from "../router/astar";
import { SHADE_PENDING } from "../router/graph";
import { toXY, type Graph } from "../router/graph";
import { routeStats } from "../router/stats";
import type { BorderGeom } from "../shade/ShadeLayer";

/** Minutes walked on edges that are less than half shaded when the walker
 *  reaches them (arrival time per edge, CLAUDE.md rule 4). Rounded. */
export function sunMinutes(
  g: Graph,
  eids: number[],
  startMin: number,
  day?: Daylight
): number {
  let meters = 0;
  let sunM = 0;
  for (const eid of eids) {
    const len = g.lenDm[eid] / 10;
    // shadeAtOrThrow, not shadeAt: `SHADE_PENDING` is −1, which is `< 0.5`,
    // so a band that had not arrived used to count as FULL SUN in every
    // card's "X min in sun" (S8 review F7). This prices; it does not render.
    if (shadeAtOrThrow(g, eid, startMin + meters / SPEED_M_PER_MIN, day) < 0.5) sunM += len;
    meters += len;
  }
  return Math.round(sunM / SPEED_M_PER_MIN);
}

/** The minutes of the day the artifact actually prices: bucket 0's minute to
 *  the last bucket's (router/graph.ts header `bucket_start_min`, `buckets`,
 *  `bucket_step_min`). Since B14 that is the modelled day's daylight — the
 *  15th of the season's month, 15 September = 07:15–19:30 in Frankfurt —
 *  snapped to the 15-minute bucket grid. */
export type ShadeWindow = { startMin: number; endMin: number };

export function shadeWindow(
  g: Pick<Graph, "bucketStartMin" | "buckets" | "bucketStepMin">
): ShadeWindow {
  return {
    startMin: g.bucketStartMin,
    endMin: g.bucketStartMin + g.bucketStepMin * (g.buckets - 1),
  };
}

/** Sunrise and sunset narrowed to the minutes the artifact prices — the
 *  later of the two starts, the earlier of the two ends (P1 review F1).
 *
 *  The two windows do not meet at the ends. `10_sun_shade` starts its first
 *  bucket `MARGIN_MIN = 8` minutes after sunrise and then snaps UP to the
 *  15-minute grid, so on 15 September in Frankfurt the sun is up at 07:03
 *  and the first bucket is 07:15. Every minute in that gap is daylight the
 *  artifact cannot price, and asking for it drove `lerpShade` into its clamp
 *  — which answers with bucket 0, i.e. a measurement taken at a different
 *  minute. The leave-at sheet must not offer such a minute: the slider's two
 *  ends, the bars' departures and the "Best: HH:MM" badge all live inside
 *  this intersection. Nearer the winter solstice it is a no-op — a day whose
 *  daylight lies wholly inside the modelled window. */
export function pricedDaylight(
  sunriseMin: number,
  sunsetMin: number,
  win: ShadeWindow
): { sunriseMin: number; sunsetMin: number } {
  return {
    sunriseMin: Math.max(sunriseMin, win.startMin),
    sunsetMin: Math.min(sunsetMin, win.endMin),
  };
}

/** The departure hours the "leave at" histogram covers: every hour the
 *  daylight window TOUCHES — the hour sunrise falls in to the hour sunset
 *  falls in (CR-03 A3, backlog B7).
 *
 *  It was the fixed 10–19 until 2026-09-09 — ten bars, chosen because ten fit
 *  a phone — which left a 07:00 or a 20:00 departure with no bar and no
 *  badge, on a slider that now offers the whole daylight day. Frankfurt runs
 *  from 9 bars at the solstice in December to 17 in June; `HourBars` narrows
 *  its columns and thins its labels once there are more than thirteen.
 *
 *  The first end was `Math.ceil` until the S2 review (finding 3): only whole
 *  hours after sunrise got a bar, so a June departure between 05:25 (the
 *  window's own minimum, sunrise↑5) and 05:59 stood on no bar at all — no
 *  percentage read out, no current-hour label, `currentBar = -1`. The CR's
 *  row 3 asks for both halves at once ("Leave-at spans sunrise → sunset,
 *  hour bars for every daylight hour"), and the slider is the half that may
 *  not be narrowed (B7: "allow all sunlight day selection"). Flooring both
 *  ends makes the rule one rule and guarantees the invariant the sheet
 *  needs: every minute `leaveWindow` offers falls inside a bar.
 *
 *  A day with no daylight in it (a polar winter, where sunrise and sunset
 *  fold onto the same minute) yields an empty list, and every reader of it
 *  treats an empty profile as "nothing measured". Flooring cannot tell that
 *  day from a one-hour one, so it is answered first. */
export function daylightHours(sunriseMin: number, sunsetMin: number): number[] {
  if (sunsetMin <= sunriseMin) return [];
  const first = Math.floor(sunriseMin / 60);
  const last = Math.floor(sunsetMin / 60);
  const out: number[] = [];
  for (let h = first; h <= last; h++) out.push(h);
  return out;
}

/** The shadiest hour of a "leave at" profile: which bar to highlight, what
 *  it reads, and — by returning null — whether there is a measurement at all.
 *
 *  A profile whose length is not the window's is no plan having landed for
 *  this walk yet; empty bars and "0 % … same 0 minutes" would be a
 *  measurement nobody took. Ties go to the earlier hour. */
export function bestHour(
  hourPct: number[],
  hours: number[]
): { idx: number; hour: number; pct: number } | null {
  if (hours.length === 0 || hourPct.length !== hours.length) return null;
  let idx = 0;
  for (let i = 1; i < hourPct.length; i++) if (hourPct[i] > hourPct[idx]) idx = i;
  return { idx, hour: hours[idx], pct: hourPct[idx] };
}

/** The route's shade percentage if the walk started on each full hour —
 *  the "leave at" strip.
 *
 *  One `routeStats` pass per hour over a route that is already found: no A*,
 *  no graph search, just the walk's own edges priced at another departure.
 *  Sixteen bars for three candidates is 48 passes over a few hundred edges
 *  each — measured against the real Frankfurt graph at **0.41 ms** for the
 *  whole set (0.31 ms for the ten bars this replaced), so the bars are
 *  computed eagerly and there is nothing to make lazy. */
export function shadeByHour(
  g: Graph,
  eids: number[],
  hours: number[],
  day?: Daylight
): number[] {
  const win = shadeWindow(g);
  return hours.map((h) => routeStats(g, eids, barMinute(h, day, win), day).shadePct);
}

/** The departure a bar stands for: its own hour, pulled inside the daylight
 *  when the hour straddles sunrise or sunset.
 *
 *  The first and last bars cover only the daylight PART of their hour — that
 *  is what `daylightHours` means by "every hour the window touches" — and
 *  the leave-at slider cannot offer a minute outside the window either. So
 *  pricing them at the bare hour measured a departure nobody can choose: in
 *  Frankfurt in June the 05:00 bar was priced twenty minutes before sunrise,
 *  which is night, which is full shade. It stands for 05:20 onwards, and it
 *  is priced there.
 *
 *  ...and inside the ARTIFACT's window as well, once the graph is in hand
 *  (P1 review F1). Frankfurt's June sunrise is 05:15 and its first bucket is
 *  05:30, so a bar priced at sunrise was answered by `lerpShade`'s clamp
 *  reading bucket 0 — a real measurement, but of another minute, and the
 *  "Best: 05:25 — 100 % shade" badge was one of them. The bar stands for
 *  05:30 now, which is a departure the slider offers and the artifact
 *  prices. Without `day` there is no window clamp either: a bare hour with
 *  no sun to place it in may be night, and pulling it into the window would
 *  fabricate a daylight reading for a dark hour. */
export function barMinute(h: number, day?: Daylight, win?: ShadeWindow): number {
  const m = h * 60;
  if (day === undefined) return m;
  const inDay = Math.min(day.sunsetMin, Math.max(day.sunriseMin, m));
  if (win === undefined) return inDay;
  return Math.min(win.endMin, Math.max(win.startMin, inDay));
}

// graph.ts keeps its grid constants private; these mirror cellKey there
// (250 m cells, +200 offset, 4096 stride). A 150 m radius never leaves the
// 3 × 3 block of cells around the query.
const CELL_M = 250;
const AROUND_M = 150;

/** Mean shade (percent, 0..100) at `startMin` over edges whose source node
 *  lies within 150 m of the point; 0 when no edge is that close, and NULL
 *  when this minute's shade band has not been downloaded (artifact v8,
 *  backlog B11).
 *
 *  Null rather than a number, because there is no honest number: averaging
 *  over the edges whose band happens to be in would report a shade
 *  percentage for a place at a time nobody measured. Both callers already
 *  had a "no figure" state — the pin card and the place card show the tag
 *  without it — so the band simply arrives and the tag appears. */
export function shadeAround(
  g: Graph,
  lng: number,
  lat: number,
  startMin: number,
  day?: Daylight
): number | null {
  const [qx, qy] = toXY(lng, lat);
  const cx = Math.floor(qx / CELL_M);
  const cy = Math.floor(qy / CELL_M);
  let sum = 0;
  let n = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const nodes = g.grid.get((cx + dx + 200) * 4096 + (cy + dy + 200));
      if (!nodes) continue;
      for (const v of nodes) {
        if (Math.hypot(g.x[v] - qx, g.y[v] - qy) > AROUND_M) continue;
        for (let e = g.firstEdge[v]; e < g.firstEdge[v + 1]; e++) {
          const sh = shadeAt(g, e, startMin, day);
          if (sh === SHADE_PENDING) return null;
          sum += sh;
          n++;
        }
      }
    }
  }
  return n > 0 ? Math.round((sum / n) * 100) : 0;
}

function rings(border: BorderGeom): number[][][] {
  return border.type === "Polygon" ? border.coordinates : border.coordinates.flat();
}

const EARTH_R = 6_371_000;
function haversineM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

/** Metres from the point to the nearest ring VERTEX of the border — a
 *  cheap "how far outside the shade data am I" figure, not a true
 *  point-to-polygon distance. Infinity for an empty geometry. */
export function distanceToBorder(border: BorderGeom, lng: number, lat: number): number {
  let best = Infinity;
  for (const ring of rings(border)) {
    for (const [vLng, vLat] of ring) {
      const d = haversineM(lng, lat, vLng, vLat);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Even-odd ray casting over every ring of the border, so holes and the
 *  several polygons of a MultiPolygon fall out of the same count. */
export function insideBorder(border: BorderGeom, lng: number, lat: number): boolean {
  let inside = false;
  for (const ring of rings(border)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
