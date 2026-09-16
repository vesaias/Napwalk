import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { writeFileSync, mkdirSync, statSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Connect } from "vite";
import strings from "./src/i18n/strings.en.json" with { type: "json" };

function artifactStamp(): string {
  try {
    return String(statSync(resolve(__dirname, "public/graph.bin.gz")).mtimeMs);
  } catch {
    return new Date().toISOString().slice(0, 16).replace("T", " ");
  }
}

// Debug dump autosave (2026-08-20): the app POSTs every debug dump to
// /__dump; dev/preview servers write it to data/work/frankfurt/osm/_browser_dump.json so
// offline replays never need manual copy-paste. Dev-only middleware — the
// production build has no server and the fetch fails silently.
function dumpSinkPlugin(): Plugin {
  const target = resolve(__dirname, "../data/work/frankfurt/osm/_browser_dump.json");
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    if (req.method !== "POST") return next();
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        mkdirSync(resolve(__dirname, "../data/work/frankfurt/osm"), { recursive: true });
        writeFileSync(target, Buffer.concat(chunks));
        res.statusCode = 204;
      } catch {
        res.statusCode = 500;
      }
      res.end();
    });
  };
  return {
    name: "shadewalk-dump-sink",
    configureServer(server) {
      server.middlewares.use("/__dump", handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/__dump", handler);
    },
  };
}

// Report sink (2026-09-05): the app POSTs "something's wrong here" reports
// to /api/report. In production that path is the Pages Function
// web/functions/api/report.ts (R2); in dev this middleware writes each one
// to data/work/reports/<timestamp>.json so the form can be exercised
// end-to-end without Cloudflare.
function reportSinkPlugin(): Plugin {
  const dir = resolve(__dirname, "../data/work/reports");
  // Both numbers are src/plan/report.ts's MAX_BODY / MAX_TEXT, repeated
  // because this file runs before the app is built (review B8). The dev sink
  // used to allow 64 KiB, so a report that 413s in production was accepted
  // here — the one thing a dev sink must never do. report.test.ts pins them.
  const MAX_BODY = 8192;
  const MAX_TEXT = 4000;
  // ReportType from src/plan/report.ts, plus null ("no category").
  const TYPES = ["wrong_shade", "blocked", "other", "question"];
  const handler: Connect.NextHandleFunction = (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (size > MAX_BODY) {
        res.statusCode = 413;
        res.end('{"ok":false,"error":"body too large"}');
        return;
      }
      // Mirror the Pages Function's validation so the form sees the same
      // errors in dev as in production.
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        body = undefined;
      }
      const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      const text = obj.text;
      if (typeof text !== "string" || text.length < 1 || text.length > MAX_TEXT) {
        res.statusCode = 400;
        res.end(`{"ok":false,"error":"text must be a string of 1-${MAX_TEXT} characters"}`);
        return;
      }
      const kind = obj.type;
      if (kind !== null && kind !== undefined && !TYPES.includes(kind as string)) {
        res.statusCode = 400;
        res.end(`{"ok":false,"error":"type must be one of ${TYPES.join(", ")}"}`);
        return;
      }
      try {
        mkdirSync(dir, { recursive: true });
        const ts = new Date().toISOString().replace(/:/g, "-");
        writeFileSync(resolve(dir, `${ts}.json`), JSON.stringify(body));
        res.statusCode = 200;
        res.end('{"ok":true}');
      } catch {
        res.statusCode = 500;
        res.end('{"ok":false}');
      }
    });
  };
  return {
    name: "shadewalk-report-sink",
    configureServer(server) {
      server.middlewares.use("/api/report", handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/report", handler);
    },
  };
}

// Where sink (2026-09-10, backlog B1): the app GETs /api/where once at boot
// when neither a stored city, a share link nor the device's time zone could
// say which city it is in. In production that path is the Pages Function
// web/functions/api/where.ts, which reads `request.cf`. Vite has no
// `request.cf` and no Functions runtime, so this middleware answers the same
// shape with nothing in it — which is what the client sees from any edge
// that did not enrich the request, and the case it has to survive.
//
// `?where=lng,lat` (optionally `&city=Name`) forges an answer, so the switch
// the app makes on a real edge can be walked through in dev:
//   http://localhost:5174/?where=2.35,48.85   → the app opens on Paris
// The client copies that parameter off the PAGE's url onto its request, in
// DEV builds only (src/ui/where.ts, fetchWhere).
function safeHost(origin: string): string {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return "";
  }
}

function whereSinkPlugin(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res) => {
    // The two answers the Function gives that are not a body (S7 review F9):
    // only `onRequestGet` is exported, so Pages answers 405 to every other
    // method — HEAD included — and a request announcing a foreign `Origin`
    // is refused outright with no `access-control-allow-origin` on it. The
    // stub is what the e2e suite and every dev walk actually exercise, so
    // the endpoint's two security-shaped behaviours are exercised here too.
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    // same-origin means the same HOST here: dev serves http, a preview may
    // not, and the scheme is not what this is about
    const origin = req.headers.origin;
    const foreign =
      typeof origin === "string" && safeHost(origin) !== (req.headers.host ?? "").toLowerCase();
    if (foreign) {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Vary", "origin");
      res.statusCode = 403;
      res.end('{"error":"cross-origin"}');
      return;
    }
    const q = url.searchParams;
    const [lng, lat] = (q.get("where") ?? "").split(",").map(Number);
    const ok = Number.isFinite(lng) && Number.isFinite(lat);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "origin");
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        city: ok ? q.get("city") : null,
        region: null,
        country: null,
        lat: ok ? lat : null,
        lng: ok ? lng : null,
      })
    );
  };
  return {
    name: "shadewalk-where-sink",
    configureServer(server) {
      server.middlewares.use("/api/where", handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/where", handler);
    },
  };
}

// Umami (2026-09-16): the owner's self-hosted counter at a.viktoresadze.com,
// the same one his personal site uses. The tag is injected only when
// VITE_UMAMI_ID is set at build time, so the dev server and any build
// without the id ship no analytics at all; the CSP in public/_headers allows
// the host either way. No cookies (Umami sets none).
//
// `data-auto-track="false"`: the script's own page view would send the real
// URL, and a share link's URL carries pins. The app sends virtual page views
// and events itself (src/ui/analytics.ts — the schema — through
// src/ui/useAnalytics.ts), and never a coordinate. The tag sits at the end of
// <head>, after the module script, so a slow analytics host can never hold
// the app's own boot; analytics.ts queues what it sends until s.js lands.
function umamiPlugin(): Plugin {
  return {
    name: "shadewalk-umami",
    transformIndexHtml(html) {
      const id = process.env.VITE_UMAMI_ID;
      if (!id) return html;
      return html.replace(
        "</head>",
        `    <script defer src="https://a.viktoresadze.com/s.js" data-website-id="${id}" data-auto-track="false"></script>
  </head>`,
      );
    },
  };
}

// The manifest is emitted at build time with the app name taken from the
// i18n catalog — the single naming point (CLAUDE.md rule 5, DECISIONS.md).
function manifestPlugin(): Plugin {
  const manifest = JSON.stringify({
    name: strings["app.name"],
    short_name: strings["app.name"],
    start_url: "/",
    display: "standalone",
    // --c-page / index.html's theme-color. The old paper #faf8f3 left the
    // PWA splash a different colour from the app it opened into (M3).
    background_color: "#eef1e9",
    theme_color: "#eef1e9",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  });
  return {
    name: "shadewalk-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.webmanifest",
        source: manifest,
      });
    },
    configureServer(server) {
      server.middlewares.use("/manifest.webmanifest", (_req, res) => {
        res.setHeader("Content-Type", "application/manifest+json");
        res.end(manifest);
      });
    },
  };
}

/** With VITE_TILE_BASE set (tiles on R2), the build must not ship
 *  web/public/tiles — 70k files would break Cloudflare Pages' 20k cap. Dev
 *  keeps them local. (2026-09-05) */
function tilesOffsitePlugin(): Plugin {
  return {
    name: "shadewalk-tiles-offsite",
    apply: "build",
    closeBundle() {
      if (!process.env.VITE_TILE_BASE) return;
      const dir = resolve(__dirname, "dist", "tiles");
      rmSync(dir, { recursive: true, force: true });
      // the .pmtiles basemaps ride on the same bucket since 2026-09-15: Pages
      // ignores byte-range requests, and a pmtiles is nothing but those
      rmSync(resolve(__dirname, "dist", "basemap"), { recursive: true, force: true });
      console.log(`tiles + basemaps served from ${process.env.VITE_TILE_BASE}; dist/tiles and dist/basemap removed`);
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    manifestPlugin(),
    umamiPlugin(),
    dumpSinkPlugin(),
    reportSinkPlugin(),
    whereSinkPlugin(),
    tilesOffsitePlugin(),
    // `npm run dev:lan`: a self-signed certificate so a phone on the LAN gets
    // a secure origin — geolocation is refused over plain http anywhere but
    // localhost. Accept the browser's warning once.
    ...(process.env.VITE_SSL === "1" ? [basicSsl()] : []),
  ],
  // debug.html is dev-only (Task 3, 2026-09-05): Vite's dev server serves any
  // html file in the root, but the production build must only emit the real
  // app shell — restricting rollup's input keeps debug.html out of dist/.
  build: { rollupOptions: { input: { main: resolve(__dirname, "index.html") } } },
  // LAN preview: never let the browser keep a stale index.html (hashed
  // assets are fine); a cached shell once served an old bundle for an hour
  preview: { headers: { "Cache-Control": "no-cache" } },
  // Same for dev: __BUILD__ is baked when the config loads, so under a
  // long-running dev server a rebuilt artifact keeps the old ?v= and the
  // browser never refetches it. Revalidating is dev-only and costs nothing.
  server: { headers: { "Cache-Control": "no-cache" } },
  // __BUILD__ cache-busts the artifact URL. It used to be the time the
  // Vite config was LOADED, i.e. dev-server start: rebuilding graph.bin.gz
  // under a running server left ?v= unchanged, so the browser served the
  // stale 7 MB blob and new circuits never appeared (Von-Bernus-Park,
  // 2026-08-29). The artifact's own mtime changes exactly when it does.
  define: { __BUILD__: JSON.stringify(artifactStamp()) },
});
