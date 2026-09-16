import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildReport, MAX_BODY, MAX_TEXT, postReport, REPORT_TIMEOUT_MS, type Report } from "./report";

const REPORT: Report = {
  text: "The shade is wrong here",
  type: "wrong_shade",
  coord: [8.6821, 50.1109],
  city: "frankfurt",
  route_id: "abc",
  app_version: "test",
  ua: "vitest",
  ts: "2026-09-05T10:00:00.000Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("postReport", () => {
  it("POSTs JSON to /api/report and reports 'sent' on ok", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await postReport(REPORT)).toBe("sent");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/report");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual(REPORT);
  });

  it("reports 'failed' on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    expect(await postReport(REPORT)).toBe("failed");
  });

  it("reports 'failed' when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await postReport(REPORT)).toBe("failed");
  });

  // QA F6-03: /api/report used to be a plain fetch with no signal. A request
  // that never settled left Send disabled forever, with no failure message
  // and no way out but Cancel — which discards what was typed.
  it("gives up after REPORT_TIMEOUT_MS on a request that never settles", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise((_res, rej) => {
          signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
        });
      })
    );
    const pending = postReport(REPORT);
    let settled: string | null = null;
    void pending.then((r) => (settled = r));

    await vi.advanceTimersByTimeAsync(REPORT_TIMEOUT_MS - 1);
    expect(settled).toBeNull();
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe("failed");
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("does not leave the abort timer running after a normal answer", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return { ok: true, status: 200 };
    }));
    expect(await postReport(REPORT)).toBe("sent");
    await vi.advanceTimersByTimeAsync(REPORT_TIMEOUT_MS * 2);
    expect(signal?.aborted).toBe(false);
    vi.useRealTimers();
  });
});

describe("buildReport", () => {
  it("fills app_version, ua and ts around the caller's fields", () => {
    vi.stubGlobal("navigator", { userAgent: "UA/1.0" });
    const before = Date.now();
    const r = buildReport({ text: "hi", type: null, coord: null, city: "berlin", route_id: null });
    expect(r).toMatchObject({ text: "hi", type: null, coord: null, city: "berlin", route_id: null, ua: "UA/1.0" });
    // vitest applies vite.config's `define`, so __BUILD__ is the artifact stamp here
    expect(typeof r.app_version).toBe("string");
    expect(r.app_version.length).toBeGreaterThan(0);
    expect(Date.parse(r.ts)).toBeGreaterThanOrEqual(before - 1);
    expect(r.ts).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  // Slice 7: the sheet opens on Question, and the map position rides along
  // only when the toggle asked for it.
  it("carries a question with no coordinate", () => {
    vi.stubGlobal("navigator", { userAgent: "UA/1.0" });
    const r = buildReport({
      text: "Which cities are next?",
      type: "question",
      coord: null,
      city: "frankfurt",
      route_id: null,
    });
    expect(r.type).toBe("question");
    expect(r.coord).toBeNull();
    expect(r.route_id).toBeNull();
  });

  it("carries the attached map centre as [lng, lat]", () => {
    vi.stubGlobal("navigator", { userAgent: "UA/1.0" });
    const r = buildReport({
      text: "The path here is fenced off.",
      type: "blocked",
      coord: [8.6821, 50.1109],
      city: "frankfurt",
      route_id: null,
    });
    expect(r.coord).toEqual([8.6821, 50.1109]);
    // lng first: the Function and the dev sink both read it that way
    expect(r.coord![0]).toBeCloseTo(8.6821, 4);
  });

  it("tolerates a missing navigator", () => {
    vi.stubGlobal("navigator", undefined);
    expect(buildReport({ text: "hi", type: "other", coord: null, city: "sf", route_id: null }).ua).toBe("");
  });
});

describe("the caps the client, the dev sink and the Function all enforce", () => {
  // Neither server can import from here — Cloudflare compiles the Function on
  // its own and vite.config.ts runs before the app is built — so each repeats
  // the numbers. This is what stops the three copies drifting (review B8:
  // the dev sink allowed 64 KiB, so a body that 413s in production was
  // accepted in dev, and the form showed the same generic failure either way).
  const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
  const constOf = (src: string, name: string) => {
    const m = new RegExp("const " + name + " = ([0-9]+)").exec(src);
    if (!m) throw new Error(`no ${name} in that file`);
    return Number(m[1]);
  };

  it("names one text length", () => {
    expect(MAX_TEXT).toBe(4000);
    expect(constOf(read("../../functions/api/report.ts"), "MAX_TEXT")).toBe(MAX_TEXT);
    expect(constOf(read("../../vite.config.ts"), "MAX_TEXT")).toBe(MAX_TEXT);
  });

  it("names one body size, in bytes, on both servers", () => {
    expect(MAX_BODY).toBe(8192);
    expect(constOf(read("../../functions/api/report.ts"), "MAX_BODY")).toBe(MAX_BODY);
    expect(constOf(read("../../vite.config.ts"), "MAX_BODY")).toBe(MAX_BODY);
  });

  it("names one set of report types", () => {
    // The client's ReportType, spelled out again on each server because
    // neither can import it. A report from something that is not this app
    // is refused rather than stored (final review I3).
    const typesOf = (src: string) => {
      const m = /const TYPES = \[([^\]]*)\]/.exec(src);
      if (!m) throw new Error("no TYPES in that file");
      return m[1].match(/"([a-z_]+)"/g)!.map((s) => s.slice(1, -1));
    };
    const want = ["wrong_shade", "blocked", "other", "question"];
    expect(typesOf(read("../../functions/api/report.ts"))).toEqual(want);
    expect(typesOf(read("../../vite.config.ts"))).toEqual(want);
  });

  it("leaves room for a full-length report in a multi-byte script", () => {
    // a body that the UI's own maxLength permits must fit the byte cap in
    // ASCII; beyond that the servers agree on the answer, which is the point
    const r = buildReport({
      text: "x".repeat(MAX_TEXT),
      type: "other",
      coord: [8.6821, 50.1109],
      city: "frankfurt",
      route_id: null,
    });
    expect(new TextEncoder().encode(JSON.stringify(r)).length).toBeLessThanOrEqual(MAX_BODY);
  });
});
