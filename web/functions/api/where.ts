// @ts-nocheck
// Cloudflare Pages Function: GET /api/where (2026-09-10, backlog B1).
//
// The SECOND server-side piece in a static app, and the last one asked for
// (CLAUDE.md rule 1). It answers one question — "roughly where is this
// request from?" — out of `request.cf`, which Cloudflare fills in at the
// edge from the connection itself. No third-party IP service, no key, no
// database, no request to anywhere: the whole answer is already attached to
// the request by the time this handler runs.
//
// What the client does with it: pick which city's graph to load on a FIRST
// visit, when the reader has stored no city, opened no share link, and the
// device's time zone named no single city (web/src/ui/where.ts). It is never
// a fix — it does not start a route, it is not "Your location", and the app
// never stores it (backlog B1, "Not in scope").
//
// Privacy, in three rules this file keeps:
//   1. Nothing is logged. There is no console call here on purpose: the
//      point of the endpoint is that the reader's rough position is used and
//      forgotten in the same request.
//   2. `cache-control: private, no-store` — an answer about THIS reader must
//      never be served to the next one out of a shared cache.
//   3. Same-origin only. No CORS header is ever sent, so no other site can
//      read the answer, and a request that announces a foreign `Origin` is
//      refused outright rather than answered into a void. (where.test.ts
//      greps this file for one, which is why the header is not named here.)
//
// No dependency and no type package, for the same reason report.ts has
// neither: Pages compiles this file itself and tsconfig.app.json only
// includes src/, so the app build never sees it. Hence the @ts-nocheck.
//
// The dev server has no Functions runtime; vite.config.ts's wherePlugin
// answers the same path there (empty, or a `?where=lng,lat` override) so the
// client path can be exercised without Cloudflare.

const HEADERS = {
  "content-type": "application/json",
  // never a shared cache, never a stored copy — see rule 2 above
  "cache-control": "private, no-store",
  vary: "origin",
};

/** A `cf` string field, or null. Length-capped: it is echoed to the client
 *  and there is no city name on earth that needs more. */
function str(v) {
  return typeof v === "string" && v.length > 0 && v.length <= 100 ? v : null;
}

/** `cf.latitude` / `cf.longitude` arrive as STRINGS. */
function num(v, max) {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

export const onRequestGet = async ({ request }) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return new Response('{"error":"cross-origin"}', { status: 403, headers: HEADERS });
  }
  // Absent in `wrangler dev` and on any request Cloudflare did not enrich;
  // an empty answer is a legal one, and the client falls back to Frankfurt.
  const cf = request.cf ?? {};
  const body = {
    city: str(cf.city),
    region: str(cf.region),
    country: str(cf.country),
    lat: num(cf.latitude, 90),
    lng: num(cf.longitude, 180),
  };
  return new Response(JSON.stringify(body), { status: 200, headers: HEADERS });
};

// Only GET is exported: Pages answers 405 itself for a method a route file
// has no handler for, and a catch-all `onRequest` beside a method handler is
// ambiguous enough not to be worth writing.
