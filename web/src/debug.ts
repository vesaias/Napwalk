// Debug surface behind a URL flag (SPEC F8 spirit): ?debug collects runtime
// errors, a WebGL capability report and routing timings. Collapsed to a
// small corner badge showing the last line; tap to expand the full log.
// Technical text, not UI copy — deliberately outside the i18n catalog.
export function installDebugOverlay(force = false) {
  if (!force && !new URLSearchParams(location.search).has("debug")) return;
  const lines: string[] = [];
  let expanded = false;

  const badge = document.createElement("pre");
  badge.style.cssText =
    "position:fixed;top:calc(env(safe-area-inset-top,0px) + 12px);right:52px;" +
    "z-index:9999;margin:0;background:#1f2430cc;color:#faf8f3;" +
    "font-size:10.5px;line-height:1.35;padding:4px 8px;border-radius:8px;" +
    "max-width:46vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
    "cursor:pointer;font-family:ui-monospace,monospace";
  badge.title = "debug log — tap to expand";

  const render = () => {
    if (expanded) {
      badge.style.whiteSpace = "pre-wrap";
      badge.style.maxWidth = "min(92vw, 520px)";
      badge.style.maxHeight = "45dvh";
      badge.style.overflow = "auto";
      badge.style.wordBreak = "break-all";
      badge.textContent = lines.join("\n");
    } else {
      badge.style.whiteSpace = "nowrap";
      badge.style.maxWidth = "46vw";
      badge.style.maxHeight = "";
      badge.style.overflow = "hidden";
      badge.textContent = lines[lines.length - 1] ?? "debug";
    }
    if (!badge.isConnected) document.body.appendChild(badge);
  };
  badge.addEventListener("click", () => {
    expanded = !expanded;
    render();
  });

  // The same lines, readable from a test: the badge shows one at a time
  // unless it is tapped, and the e2e suite needs to count them (slice 5's
  // "exactly one silent reroute"). ?debug only, like everything else here.
  (window as unknown as { __swLog?: string[] }).__swLog = lines;

  const log = (msg: string) => {
    lines.push(msg);
    render();
  };
  window.addEventListener("error", (e) =>
    log(`error: ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) =>
    log(`rejection: ${String(e.reason).slice(0, 300)}`));
  const c = document.createElement("canvas");
  const gl2 = c.getContext("webgl2");
  const gl1 = gl2 ? null : c.getContext("webgl");
  log(`webgl2: ${gl2 ? "yes" : "NO"}  webgl1: ${gl1 ? "yes" : gl2 ? "-" : "NO"}`);
  const dbg = (gl2 ?? gl1)?.getExtension("WEBGL_debug_renderer_info");
  if (dbg && (gl2 ?? gl1))
    log(`renderer: ${(gl2 ?? gl1)!.getParameter(dbg.UNMASKED_RENDERER_WEBGL)}`);
  log(`ua: ${navigator.userAgent.slice(0, 120)}`);
  return log;
}

export const debugLog: { current: ((m: string) => void) | undefined } = {
  current: undefined,
};
