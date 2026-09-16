// @ts-nocheck
// Cloudflare Pages Function: POST /api/report (2026-09-05).
//
// Stores one "something's wrong here" report from the app as a JSON object
// in R2. `env.REPORTS` is an R2 bucket binding configured on the Pages
// project (Settings → Functions → R2 bucket bindings, variable name
// REPORTS, bucket shadewalk-reports) — see docs/DEPLOY.md, "Reports".
//
// No dependency and no type package: Pages compiles this file itself, and
// @cloudflare/workers-types is not worth adding for one handler (CLAUDE.md:
// ask before adding a dependency). Hence the @ts-nocheck; tsconfig.app.json
// only includes src/, so the app build never sees this file anyway.
//
// The dev server has no Functions runtime; vite.config.ts's reportSinkPlugin
// answers the same path there and writes to data/work/reports/.

// Both numbers are src/plan/report.ts's MAX_TEXT / MAX_BODY, repeated
// because Cloudflare compiles this file on its own and it cannot import from
// the app's source tree. src/plan/report.test.ts pins the three copies
// together (review B8).
const MAX_TEXT = 4000;
const MAX_BODY = 8192;
// The Report shape from web/src/plan/report.ts — only these fields are
// stored; anything else in the body is dropped, never spread into R2.
const FIELDS = ["text", "type", "coord", "city", "route_id", "app_version", "ua", "ts"];
// ReportType from web/src/plan/report.ts, plus null: the form opens on
// "question" but the chip can be tapped off again, so no category is a
// legal answer. Anything else is a client that is not this app, and is
// refused rather than stored (final review I3).
const TYPES = ["wrong_shade", "blocked", "other", "question"];

// What each optional field may be, so a stored report is bounded and typed
// (security review 2026-09-16: a later report viewer must not meet a 1 MB
// `ua` or a `coord` that is a string). Anything outside is dropped, not
// refused — the text is the report; the rest is context.
const MAX_STR = { city: 64, route_id: 128, app_version: 64, ua: 512 };
function bounded(f, v) {
  if (f === "coord") {
    return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 180)
      ? v
      : undefined;
  }
  if (f === "ts") return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  if (f in MAX_STR) return typeof v === "string" && v.length <= MAX_STR[f] ? v : undefined;
  return v;
}

export const onRequestPost = async ({ request, env }) => {
  // Same origin only, and JSON only. A cross-origin POST with a text/plain
  // body is a CORS "simple request" — no preflight — so without these two
  // checks any web page could make its visitors write into the bucket
  // (security review 2026-09-16). where.ts does the same for its GET.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return new Response('{"ok":false,"error":"cross-origin"}', json(403));
  }
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) {
    return new Response('{"ok":false,"error":"expected application/json"}', json(415));
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY) {
    return new Response('{"ok":false,"error":"body too large"}', json(413));
  }
  // The header is a hint, not a promise: a chunked request carries none, and
  // request.json() would then read an unbounded body. Measure what actually
  // arrived (review B8).
  let raw;
  try {
    raw = await request.text();
  } catch {
    return bad("invalid JSON");
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY) {
    return new Response('{"ok":false,"error":"body too large"}', json(413));
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return bad("invalid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("expected an object");
  const text = body.text;
  if (typeof text !== "string" || text.length < 1 || text.length > MAX_TEXT) {
    return bad(`text must be a string of 1-${MAX_TEXT} characters`);
  }
  const kind = body.type;
  if (kind !== null && kind !== undefined && !TYPES.includes(kind)) {
    return bad(`type must be one of ${TYPES.join(", ")}`);
  }
  if (!env.REPORTS) return new Response('{"ok":false,"error":"REPORTS binding missing"}', json(500));

  const report = { received: new Date().toISOString() };
  for (const f of FIELDS) {
    if (!(f in body)) continue;
    const v = bounded(f, body[f]);
    if (v !== undefined) report[f] = v;
  }

  const key = `reports/${report.received.replace(/:/g, "-")}-${crypto.randomUUID()}.json`;
  await env.REPORTS.put(key, JSON.stringify(report), {
    httpMetadata: { contentType: "application/json" },
  });
  return new Response('{"ok":true}', json(200));
};

function json(status) {
  return { status, headers: { "Content-Type": "application/json" } };
}

function bad(error) {
  return new Response(JSON.stringify({ ok: false, error }), json(400));
}
