// "Something's wrong here" reports (2026-09-05). The client POSTs one JSON
// document to /api/report; in dev the Vite middleware (vite.config.ts,
// reportSinkPlugin) writes it to data/work/reports/, in production the
// Pages Function web/functions/api/report.ts drops it into the REPORTS R2
// bucket (docs/DEPLOY.md). No backend of our own (CLAUDE.md rule 1) — a
// Pages Function is part of the static deploy.

import type { CityId } from "../cities";

export type ReportType = "wrong_shade" | "blocked" | "other" | "question";

/** How long a report may be, in CHARACTERS. The one number: the textarea's
 *  maxLength, the dev sink's check and the Pages Function's all mean this
 *  (review B8). The two servers cannot import it — a Pages Function is
 *  compiled by Cloudflare and vite.config.ts runs before the app is built —
 *  so each repeats it beside a pointer back here; report.test.ts pins the
 *  three copies together. */
export const MAX_TEXT = 4000;
/** And how large the whole JSON document may be, in BYTES. 8 KiB is what
 *  the Pages Function enforces, so the dev sink enforces the same: a report
 *  that would be rejected in production must be rejected in dev. */
export const MAX_BODY = 8192;

export type Report = {
  text: string;
  type: ReportType | null;
  coord: [number, number] | null; // lng, lat of the pin, if any
  city: CityId;
  route_id: string | null;
  app_version: string;
  ua: string;
  ts: string;                     // ISO 8601, when the user sent it
};

export type ReportInput = Pick<Report, "text" | "type" | "coord" | "city" | "route_id">;

/** The fields the client fills in itself. __BUILD__ is a Vite define, absent
 *  under vitest; navigator is absent in node. */
function reportMeta(): Pick<Report, "app_version" | "ua" | "ts"> {
  return {
    app_version: typeof __BUILD__ !== "undefined" ? __BUILD__ : "dev",
    ua: typeof navigator !== "undefined" && navigator ? navigator.userAgent ?? "" : "",
    ts: new Date().toISOString(),
  };
}

export function buildReport(input: ReportInput): Report {
  return { ...input, ...reportMeta() };
}

/** How long the client waits for /api/report before calling it failed.
 *  QA F6-03: a request that never settles left Send disabled forever, with
 *  no message and no way back but Cancel — which throws away what was
 *  typed, the one outcome this file's comment above says must never happen.
 *  Ten seconds is longer than any healthy POST of an 8 KiB document. */
export const REPORT_TIMEOUT_MS = 10_000;

export async function postReport(
  r: Report,
  timeoutMs: number = REPORT_TIMEOUT_MS
): Promise<"sent" | "failed"> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(r),
      signal: ac.signal,
    });
    return resp.ok ? "sent" : "failed";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}
