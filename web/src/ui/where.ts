// Where the reader probably is, before anything has asked them (backlog B1,
// 2026-09-10).
//
// A first-time reader who has not tapped Locate — or who refused it — used
// to land in Frankfurt whatever continent they were on. Google Maps answers
// the same question with last fix → fused OS fix → IP city; this app has no
// account and no third-party IP service, so it has two cheap sources and
// neither of them is a position:
//
//   1. `Intl.DateTimeFormat().resolvedOptions().timeZone` — offline, free,
//      no prompt, and for half the registry it is decisive on its own.
//   2. Cloudflare's own edge (`request.cf`, via functions/api/where.ts),
//      asked ONCE and only when the clock could not answer.
//
// Everything here is pure but the last two exports, so the precedence is a
// test rather than a promise (where.test.ts).
//
// NONE of this is a fix. It picks which city's graph to load and where the
// map opens — it never becomes "Your location", never starts a route, and
// is never written to storage (CLAUDE.md rule 3 is untouched: the router
// still runs on the client over the city's own graph).
import { CITIES, DEFAULT_CITY, inCity, type City, type CityId } from "../cities";
import { distanceM } from "./geo";

/** What the edge is willing to say about the request, all of it optional:
 *  `request.cf` is absent in local `wrangler dev`, and any field of it can
 *  be missing for a client behind a proxy. */
export type EdgeWhere = {
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
};

/** The answer, validated field by field. It arrives over the network from a
 *  path anything on the origin could answer, so it is parsed the way a URL
 *  parameter is: a number that is not one is absent, not NaN. */
export function parseWhere(v: unknown): EdgeWhere | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" && x.length > 0 && x.length <= 100 ? x : null);
  const num = (x: unknown, max: number) =>
    typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= max ? x : null;
  return {
    city: str(o.city),
    region: str(o.region),
    country: str(o.country),
    lat: num(o.lat, 90),
    lng: num(o.lng, 180),
  };
}

/**
 * The registry city the device's time zone names — or null.
 *
 * "Or null" is doing the work. A zone with no city in it (Asia/Tokyo) is a
 * null, because the nearest city by UTC offset is not a city the reader is
 * in: Europe/Berlin and Africa/Lagos share an offset for half the year and
 * share nothing else. And a zone with MORE than one city in it is also a
 * null — Europe/Berlin holds four of the eight, so it says "Germany" and
 * nothing more. That second case is what makes asking the edge worth a
 * request: it is exactly the zone where the clock cannot tell Frankfurt from
 * Berlin, and Cloudflare can.
 *
 * Only `available` cities count. A city listed but not built is not
 * somewhere this app can route.
 */
export function cityFromTimeZone(
  tz: string | null | undefined,
  cities: readonly City[] = CITIES
): CityId | null {
  if (!tz) return null;
  const hit = cities.filter((c) => c.available && c.timeZone === tz);
  return hit.length === 1 ? hit[0].id : null;
}

/** How far from a city's centre still counts as being in it. Generous on
 *  purpose: an IP fix is the reader's ISP as often as it is the reader, and
 *  the cost of being wrong is a map that opens on the wrong side of a
 *  country — while the cost of being too strict is a reader in Offenbach
 *  landing in Frankfurt-the-default anyway. 150 km puts every commuter belt
 *  in, and keeps Paris and London apart (344 km). */
export const EDGE_RADIUS_M = 150_000;

/**
 * The registry city the edge's coordinates fall in: inside the city's own
 * bounds, or else the nearest centre within EDGE_RADIUS_M. The city NAME the
 * edge sends is deliberately not matched — "London" is a place in eight
 * countries and the coordinates are unambiguous.
 */
export function cityFromEdge(
  w: EdgeWhere | null,
  cities: readonly City[] = CITIES
): CityId | null {
  if (!w || w.lat === null || w.lng === null) return null;
  const at: [number, number] = [w.lng, w.lat];
  let best: { id: CityId; m: number } | null = null;
  for (const c of cities) {
    if (!c.available) continue;
    if (inCity(c, w.lng, w.lat)) return c.id;
    const m = distanceM(at, c.center);
    if (m <= EDGE_RADIUS_M && (best === null || m < best.m)) best = { id: c.id, m };
  }
  return best?.id ?? null;
}

/** The four things that may name the city a page load opens on, in the only
 *  order they can be in. */
export type BootCityInput = {
  /** The city in the reader's own stored settings — their choice, and the
   *  only one of the four that is. */
  stored?: CityId | null;
  /** `?c=` on a share link: someone else's walk, and it wins outright. */
  link?: CityId | null;
  /** The device's IANA zone. */
  tz?: string | null;
  /** What the edge answered, if it was asked at all. */
  edge?: EdgeWhere | null;
};

/**
 * Which city a page load opens on.
 *
 * A link first — it carries a walk, and a walk has a city. Then the reader's
 * own stored choice, which nothing may override. Then the two guesses, edge
 * before clock because coordinates beat a country. Then Frankfurt, which is
 * where this app has always started.
 *
 * `boot.ts` calls this WITHOUT `link` and hands the answer to `loadSettings`
 * as the record's default, because a link's city is a session override and
 * must never be written into the reader's own settings (useSettings.ts). The
 * link is laid on top afterwards by `bootSettings`, which is why the city the
 * shell ends up on is this function with all four — and where.test.ts holds
 * the two paths together.
 */
export function pickBootCity(
  { stored, link, tz, edge }: BootCityInput,
  cities: readonly City[] = CITIES
): CityId {
  return (
    link ?? stored ?? cityFromEdge(edge ?? null, cities) ?? cityFromTimeZone(tz, cities) ?? DEFAULT_CITY
  );
}

/** Is the edge worth one request? Only when nothing the device already
 *  knows can answer: no stored city, no link, and a zone that names no
 *  single city. A reader in Europe/London is already in London and the app
 *  makes no request at all. */
export function askEdge(inp: BootCityInput, cities: readonly City[] = CITIES): boolean {
  if (inp.link || inp.stored) return false;
  return cityFromTimeZone(inp.tz, cities) === null;
}

/** The device's IANA zone, or null where there is no Intl at all. Not part
 *  of the pure surface above — it reads the environment — but a one-liner
 *  the callers should not each write. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** How long the client waits for the edge before going on without it. It
 *  holds the graph load (ui/useCity.ts), so it is a budget, not a timeout in
 *  the usual sense: 1.5 s is far longer than a same-origin request served at
 *  the edge that already has the answer attached, and short enough that a
 *  reader on a stalled connection never notices it happened. */
export const WHERE_TIMEOUT_MS = 1500;

/**
 * Ask the edge where this request came from: GET /api/where, the Pages
 * Function in web/functions/api/where.ts.
 *
 * Never throws and never rejects — every failure is the same null, because
 * every failure means the same thing: go on with what the device knew. That
 * covers a timeout, an offline reader, a 404 (a deploy without the Function,
 * or a preview server), and the SPA fallback answering with index.html.
 *
 * It took a caller's `AbortSignal` until the S7 review (F7): no caller ever
 * passed one, and the one thing that would have wanted to — the reader
 * picking a city while the request is still out — is answered on the other
 * side instead, by releasing the graph hold (ui/useCity.ts). The request is
 * a few hundred bytes and its own timeout already bounds it; the dead
 * parameter cost more than it saved.
 */
export async function fetchWhere(timeoutMs: number = WHERE_TIMEOUT_MS): Promise<EdgeWhere | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(whereUrl(), {
      signal: ac.signal,
      headers: { accept: "application/json" },
      // an answer about THIS reader is never served from a cache
      cache: "no-store",
    });
    if (!resp.ok) return null;
    return parseWhere(await resp.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** `/api/where`, plus the dev server's forgery parameters when the page was
 *  opened with them (`?where=lng,lat&city=Name`, vite.config.ts's
 *  whereSinkPlugin). DEV only, and `import.meta.env.DEV` is a compile-time
 *  constant, so the production bundle contains the bare path. */
function whereUrl(): string {
  const path = "/api/where";
  if (!import.meta.env.DEV || typeof location === "undefined") return path;
  const p = new URLSearchParams(location.search);
  const forged = new URLSearchParams();
  for (const k of ["where", "city"]) {
    const v = p.get(k);
    if (v !== null) forged.set(k, v);
  }
  return forged.has("where") ? `${path}?${forged}` : path;
}
