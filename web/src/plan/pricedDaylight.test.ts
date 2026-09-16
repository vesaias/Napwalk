// The leave-at window against the EIGHT SHIPPED ARTIFACTS (P1 review F1).
//
// The P1 report claimed the router's clamp "no longer fires inside the
// daylight of any day of the year". It still did, in all eight cities:
// `10_sun_shade` starts its first bucket `MARGIN_MIN = 8` minutes after
// sunrise and snaps UP to the 15-minute grid, while the sheet's own window
// started five minutes after sunrise on a 5-minute grid. A slider that
// offered 05:25 where the artifact's first bucket was 05:30 made the badge's
// "Best: 05:25 — 100 % shade" `lerpShade` reading bucket 0 for a minute
// nobody measured.
//
// This is the test that keeps the two windows meeting. It READS THE HEADERS
// at test time rather than trusting a table: which day the pipeline models
// is a pipeline decision that moves (21 June through B14, the current season
// after it), and every assertion below is written to hold whichever day it
// is. The table at the bottom of this block is a fallback for a clone that
// has no artifacts at all — web/public is gitignored — and nothing is
// compared against it.
import { existsSync, openSync, readSync, closeSync } from "node:fs";
import { gunzipSync, constants as zlibConstants } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CITIES, coreUrls, type CityId } from "../cities";
import { sunriseFor, sunsetFor, leaveWindow, STEP_MIN } from "../ui/time";
import { barMinute, daylightHours, pricedDaylight, shadeWindow, type ShadeWindow } from "./hours";

/** The two days the sun is furthest from itself: whatever the pipeline
 *  models, one of these is the widest the daylight can be against it and the
 *  other the narrowest. */
const SOLSTICES = ["2026-06-21", "2026-12-21"] as const;
const NOON = 12 * 60;

/** What the eight cores carried on 2026-09-10, for a clone with no artifacts
 *  on disk. NOT an expectation — the pipeline re-models and these move; they
 *  are here so the invariants below still have eight windows to run over in
 *  a checkout that has never run the pipeline. */
const FALLBACK: Record<CityId, { startMin: number; buckets: number; stepMin: number }> = {
  frankfurt: { startMin: 330, buckets: 65, stepMin: 15 }, // 05:30–21:30
  berlin: { startMin: 300, buckets: 66, stepMin: 15 }, //    05:00–21:15
  hamburg: { startMin: 300, buckets: 67, stepMin: 15 }, //   05:00–21:30
  london: { startMin: 300, buckets: 65, stepMin: 15 }, //    05:00–21:00
  munich: { startMin: 330, buckets: 63, stepMin: 15 }, //    05:30–21:00
  paris: { startMin: 360, buckets: 64, stepMin: 15 }, //     06:00–21:45
  nyc: { startMin: 345, buckets: 59, stepMin: 15 }, //       05:45–20:15
  sf: { startMin: 360, buckets: 58, stepMin: 15 }, //        06:00–20:15
};

/** The header of a shipped core, without inflating the whole 4–21 MB of it:
 *  gzip is a stream, so the first 64 KiB inflates to far more than the JSON
 *  header the file opens with (`SWG1`, u32 length, then the JSON). */
function shippedHeader(id: CityId): Record<string, unknown> | null {
  const city = CITIES.find((c) => c.id === id)!;
  // coreUrls stamps a build query and may name parts; the header is in .0
  const file = coreUrls(city, "x")[0].split("?")[0];
  const path = new URL(`../../public${file}`, import.meta.url);
  if (!existsSync(path)) return null;
  const fd = openSync(path, "r");
  const raw = Buffer.alloc(1 << 16);
  const n = readSync(fd, raw, 0, raw.length, 0);
  closeSync(fd);
  const head = gunzipSync(raw.subarray(0, n), { finishFlush: zlibConstants.Z_SYNC_FLUSH });
  expect(head.subarray(0, 4).toString()).toBe("SWG1");
  return JSON.parse(head.subarray(8, 8 + head.readUInt32LE(4)).toString());
}

/** The bucket grid of a city, from the core on disk where there is one. Read
 *  ONCE: the file is 4–21 MB and eight of them are opened here. */
const HEADERS: Record<string, { startMin: number; buckets: number; stepMin: number; live: boolean }> =
  Object.fromEntries(
    CITIES.map((c) => {
      const h = shippedHeader(c.id);
      return [
        c.id,
        h === null
          ? { ...FALLBACK[c.id], live: false }
          : {
              startMin: h.bucket_start_min as number,
              buckets: h.buckets as number,
              stepMin: h.bucket_step_min as number,
              live: true,
            },
      ];
    })
  );

function windowOf(id: CityId): ShadeWindow {
  const s = HEADERS[id];
  return shadeWindow({
    bucketStartMin: s.startMin,
    buckets: s.buckets,
    bucketStepMin: s.stepMin,
  });
}

describe("the shipped shade windows", () => {
  for (const city of CITIES) {
    it(`${city.id}: is a 15-minute grid over a day's worth of buckets`, () => {
      const h = HEADERS[city.id];
      const win = windowOf(city.id);
      expect(h.stepMin, "the pipeline's bucket step").toBe(15);
      // The narrowest window the pipeline has ever shipped is a winter
      // city's daylight; the widest is a June one's. Eight hours of buckets
      // to eighteen covers both, and a header outside it is a broken export
      // rather than a season.
      expect(win.endMin - win.startMin).toBeGreaterThanOrEqual(8 * 60);
      expect(win.endMin - win.startMin).toBeLessThanOrEqual(18 * 60);
      expect(win.startMin).toBeGreaterThanOrEqual(0);
      expect(win.endMin).toBeLessThan(24 * 60);
      // `side_bytes = ceil(buckets/16)` — the P1 review's F6
      expect(Math.ceil(h.buckets / 16)).toBeLessThanOrEqual(5);
    });
  }

  it("reads the windows off the artifacts, not off a table", () => {
    // A checkout that has run the pipeline measures the real thing; one that
    // has not still runs every invariant, against the fallback. Both are
    // fine — what is not fine is a hard-coded expectation the pipeline
    // silently outgrows, which is what this replaced (CR-04 r7).
    const live = CITIES.filter((c) => HEADERS[c.id].live).map((c) => c.id);
    expect(Object.keys(HEADERS), "one window per city").toHaveLength(CITIES.length);
    console.info(
      live.length === 0
        ? "pricedDaylight: no artifacts on disk — running against the fallback table"
        : `pricedDaylight: read ${live.length}/${CITIES.length} headers from disk (${live.join(", ")})`
    );
  });
});

// The invariant, over all eight cities and both solstices: whichever day the
// pipeline models, no minute the sheet offers may fall outside the buckets.
describe.each(SOLSTICES)("what the leave-at sheet offers on %s", (DAY) => {
  for (const city of CITIES) {
    const win = windowOf(city.id);
    const sunrise = sunriseFor(DAY, city);
    const sunset = sunsetFor(DAY, city);
    const priced = pricedDaylight(sunrise, sunset, win);
    const day = { sunriseMin: sunrise, sunsetMin: sunset };

    it(`${city.id}: the track stays inside the artifact's buckets`, () => {
      const w = leaveWindow(sunrise, sunset, NOON, priced);
      expect(w.min).toBeGreaterThanOrEqual(win.startMin);
      expect(w.max).toBeLessThanOrEqual(win.endMin);
      expect(w.max).toBeGreaterThan(w.min); // a June day is not a point
      // ...and every step of it, which is what the reader drags through
      for (let m = w.min; m <= w.max; m += STEP_MIN) {
        expect(m, `${city.id} @ ${m}`).toBeGreaterThanOrEqual(win.startMin);
        expect(m, `${city.id} @ ${m}`).toBeLessThanOrEqual(win.endMin);
      }
    });

    it(`${city.id}: every hour bar is priced at a minute the artifact carries`, () => {
      const hours = daylightHours(priced.sunriseMin, priced.sunsetMin);
      expect(hours.length).toBeGreaterThan(6); // a city, not a polar night
      for (const h of hours) {
        const m = barMinute(h, day, win);
        expect(m, `${city.id} bar ${h}`).toBeGreaterThanOrEqual(win.startMin);
        expect(m, `${city.id} bar ${h}`).toBeLessThanOrEqual(win.endMin);
      }
      // the badge names the earliest minute of the shadiest bar, and it is
      // one of these: the sheet clamps `best.hour * 60` into the same track
      const w = leaveWindow(sunrise, sunset, NOON, priced);
      for (const h of hours) {
        const m = Math.min(w.max, Math.max(w.min, h * 60));
        expect(m, `${city.id} badge ${h}`).toBeGreaterThanOrEqual(win.startMin);
        expect(m, `${city.id} badge ${h}`).toBeLessThanOrEqual(win.endMin);
      }
    });

    // The intersection is either a NO-OP or a narrowing, never anything
    // else, and where it narrows it narrows to the buckets exactly. Which of
    // the two it is depends on the modelled day — a June window swallows
    // December whole, a September one does not — so the assertion is the
    // shape rather than the outcome (CR-04 r7: the headers move).
    it(`${city.id}: the intersection narrows to the buckets, or does nothing`, () => {
      const bare = leaveWindow(sunrise, sunset, NOON);
      if (sunrise >= win.startMin && sunset <= win.endMin) {
        expect(priced).toEqual(day);
        expect(leaveWindow(sunrise, sunset, NOON, priced)).toEqual(bare);
      } else {
        expect(priced.sunriseMin).toBe(Math.max(sunrise, win.startMin));
        expect(priced.sunsetMin).toBe(Math.min(sunset, win.endMin));
        const narrowed = leaveWindow(sunrise, sunset, NOON, priced);
        expect(narrowed.min).toBeGreaterThanOrEqual(bare.min);
        expect(narrowed.max).toBeLessThanOrEqual(bare.max);
      }
    });

    // ...and the note the sheet draws over the bars says so exactly when it
    // narrowed (CR-04 r7, LeaveAtSheet's `narrow`).
    it(`${city.id}: the "shade data" note appears iff the window is narrower`, () => {
      const narrow = priced.sunriseMin > sunrise || priced.sunsetMin < sunset;
      expect(narrow).toBe(sunrise < win.startMin || sunset > win.endMin);
    });
  }
});

// The first bar of the strip is the first BUCKET, never a minute five before
// it: `barMinute` pulls the bar into the window and `leaveWindow` will not
// offer anything earlier, so "Best: HH:MM" names a departure that was
// measured rather than clamped (P1 review F1). Read off whatever is shipped.
describe("the first departure is the first bucket", () => {
  for (const city of CITIES) {
    it(`${city.id}: on the day the artifact is narrowest against`, () => {
      const win = windowOf(city.id);
      const day = SOLSTICES.find(
        (d) => sunriseFor(d, city) < win.startMin || sunsetFor(d, city) > win.endMin
      );
      if (day === undefined) return; // this artifact covers both solstices whole
      const sunrise = sunriseFor(day, city);
      const sunset = sunsetFor(day, city);
      const priced = pricedDaylight(sunrise, sunset, win);
      const w = leaveWindow(sunrise, sunset, NOON, priced);
      expect(w.min).toBeGreaterThanOrEqual(win.startMin);
      expect(w.max).toBeLessThanOrEqual(win.endMin);
      const hours = daylightHours(priced.sunriseMin, priced.sunsetMin);
      // the earliest bar stands for a minute inside the window, and the
      // slider can be dragged to it
      const first = barMinute(hours[0], { sunriseMin: sunrise, sunsetMin: sunset }, win);
      expect(first).toBeGreaterThanOrEqual(win.startMin);
      expect(Math.min(w.max, Math.max(w.min, hours[0] * 60))).toBeGreaterThanOrEqual(win.startMin);
    });
  }
});
