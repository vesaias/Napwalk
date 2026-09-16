// The city's day, as the planning UI needs it (CR-03 A3).
//
// Three numbers that are all the same fact — when the sun is up over this
// city on this date — asked for in one place so they cannot disagree: the
// two ends of the leave-at slider (ui/time.ts `leaveWindow`) and the hours
// its bars cover (plan/hours.ts `daylightHours`). `sunriseFor`/`sunsetFor`
// are minute-by-minute walks and cache per day and city; this hook is the
// memo that keeps the HOURS ARRAY stable too, because `useWalk` measures
// every candidate against it and a fresh array each render would re-measure
// the whole profile on every GPS fix.
//
// ...and a fourth, since the P1 review's F1: the part of that daylight the
// ARTIFACT prices. The graph's shade buckets start a few minutes after
// sunrise (`10_sun_shade`'s margin, then the 15-minute grid), so the sheet
// asks for its bars and its slider ends over the intersection while the
// router keeps the real sun for its night rule.
import { useMemo } from "react";
import type { City } from "../cities";
import { daylightHours, pricedDaylight, shadeWindow } from "../plan/hours";
import type { Daylight } from "../router/astar";
import type { Graph } from "../router/graph";
import { sunriseFor, sunsetFor } from "./time";

/** Sunrise and sunset in minutes since midnight, and the full daylight hours
 *  between them.
 *
 *  `daylight` is the same two numbers in the shape the ROUTER takes
 *  (router/astar.ts `Daylight`), memoised here with the rest so its identity
 *  is stable: `useWalk` lists it in a memo that measures every candidate's
 *  hour profile, and a fresh object each render would re-measure the lot on
 *  every GPS fix. The router computes no astronomy and imports no `ui/`, so
 *  this is how the day reaches it.
 *
 *  `priced` is that daylight intersected with the graph's shade window — the
 *  minutes the leave-at sheet may offer. Before the graph lands it is the
 *  daylight itself, which is what the sheet used to offer at every moment. */
export type SunDay = {
  sunrise: number;
  sunset: number;
  hours: number[];
  daylight: Daylight;
  priced: Daylight;
};

export function useSunDay(day: string, city: City, graph: Graph | null): SunDay {
  return useMemo(() => {
    const sunrise = sunriseFor(day, city);
    const sunset = sunsetFor(day, city);
    const priced = graph
      ? pricedDaylight(sunrise, sunset, shadeWindow(graph))
      : { sunriseMin: sunrise, sunsetMin: sunset };
    return {
      sunrise,
      sunset,
      // the bars cover the minutes the sheet can OFFER, so that the hour
      // sunrise falls in is dropped when the artifact does not reach it
      hours: daylightHours(priced.sunriseMin, priced.sunsetMin),
      daylight: { sunriseMin: sunrise, sunsetMin: sunset },
      priced,
    };
  }, [day, city, graph]);
}
