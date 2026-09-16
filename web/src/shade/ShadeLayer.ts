// Live shadow overlay as a maplibre custom WebGL layer (W7).
//
// ShadeMap's architecture with our own 1 m DSM: the DSM tiles under the
// view (plus one tile on the sun side, so shadows can enter) are drawn
// into ONE heightmap texture — the atlas — so the shadow computation
// never sees a tile edge. When the time or the atlas changes, a shadow
// pass marches every atlas texel toward the sun (GPU, once); each frame
// then just draws the resulting mask through the map matrix, so panning
// and zooming inside the atlas is free. Nothing here is per-frame CPU
// work; there are no seams and no per-tile latency.
import type { CustomLayerInterface, CustomRenderMethodInput, Map as LibreMap } from "maplibre-gl";
import { sunPosition, type Observer } from "./sun";
import { tileUrl, type City } from "../cities";

const TILE = 512;
const MIN_Z = 12;
const MAX_Z = 16;
const R = 20037508.342789244;
const ALPHA = 110 / 255;
/** below this zoom nothing is drawn. Zoomed out the coarse (max-pooled)
 *  DSM levels render like ShadeMap does at city zoom (DEM level =
 *  round(map zoom), building shadows mostly sub-pixel, soft residue) —
 *  a shaded-fraction heat map was tried and read as blur (2026-08-16) */
export const LIVE_SHADE_FROM = 11;
const MAX_H = 60; // tallest occluder that matters (m) -> shadow reach = MAX_H / tan(el)
const MAX_REACH_M = 400;
const MAX_STEPS = 400;
// Where the DSM has no tile: Terrarium(-32768 m), a sentinel the shadow
// shader treats as NO DATA — never a caster, never drawn. It used to be
// "100 m ground", Frankfurt's level: around a sea-level city that was a
// 100 m wall at the tile edge casting a 400 m band into the ocean at low
// sun (SF, 2026-09-02).
const FILL_RGB = [0, 0, 0];
const NO_DATA_M = -30000.0;
const CACHE = 300; // decoded DSM tiles kept
const TILE_VERSION = 2; // bump when data/export/dsm_tiles is regenerated (busts the browser cache)
const CLEAN_MAX_M = 1.6; // majority filter only where a texel is ~1 m; coarser levels would lose whole shadows
const FADE_MS = 300; // crossfade when the atlas is swapped for a finer/coarser one

// u_matrix already includes the atlas rectangle (folded in on the CPU in
// float64): the shader only sees 0..1 — projecting raw mercator (~0.5)
// in float32 loses ~1 m and the overlay rattles while zooming (2026-08-16)
const VS = `#version 300 es
in vec2 a_pos;      // 0..1 over the atlas
uniform mat4 u_matrix;
out vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}`;

const VS_FULL = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}`;

// shadow pass: march toward the sun in texel space
const FS_SHADOW = `#version 300 es
precision highp float;
uniform sampler2D u_dem;
uniform vec2 u_texels;
uniform vec2 u_step;   // texel step toward the sun
uniform float u_rise;  // metres the sun ray climbs per step
uniform int u_steps;
uniform int u_night;
in vec2 v_uv;
out vec4 o;
float h(vec2 t) {
  vec3 c = texelFetch(u_dem, ivec2(t), 0).rgb * 255.0;
  return c.r * 256.0 + c.g + c.b / 256.0 - 32768.0;
}
void main() {
  if (u_night == 1) { o = vec4(1.0); return; }
  vec2 p = v_uv * u_texels;
  float H = h(p) + 0.05;
  if (H < ${NO_DATA_M.toFixed(1)}) { o = vec4(0.0); return; } // no DSM here: nothing to shade
  vec2 q = p;
  for (int i = 0; i < ${MAX_STEPS}; i++) {
    if (i >= u_steps) break;
    q += u_step;
    H += u_rise;
    if (q.x < 0.0 || q.y < 0.0 || q.x >= u_texels.x || q.y >= u_texels.y) break;
    if (h(q) > H) { o = vec4(1.0); return; }
  }
  o = vec4(0.0);
}`;

// clean pass: 3x3 majority — drops isolated one-texel shadows (DSM
// noise, wires, small trees) and one-texel holes; binary, edges stay crisp
const FS_CLEAN = `#version 300 es
precision mediump float;
uniform sampler2D u_mask;
uniform int u_filter;
in vec2 v_uv;
out vec4 o;
void main() {
  ivec2 p = ivec2(v_uv * vec2(textureSize(u_mask, 0)));
  if (u_filter == 0) { o = vec4(texelFetch(u_mask, p, 0).r); return; }
  float n = 0.0;
  for (int dy = -1; dy <= 1; dy++)
    for (int dx = -1; dx <= 1; dx++)
      n += texelFetch(u_mask, p + ivec2(dx, dy), 0).r;
  o = vec4(n >= 5.0 ? 1.0 : 0.0);
}`;

// draw: the mask is sampled linear — a one-texel soft edge (0.77 m at
// street zoom, roughly the sun's own penumbra); an average when zoomed
// out. Viktor preferred this over an antialiased 1-2 px threshold edge
// (2026-08-16).
const FS_DRAW = `#version 300 es
precision mediump float;
uniform sampler2D u_mask;
uniform sampler2D u_clip; // 1 inside the city border, 0 outside (atlas space)
uniform float u_alpha;
in vec2 v_uv;
out vec4 o;
void main() {
  float s = texture(u_mask, v_uv).r * texture(u_clip, v_uv).r;
  o = vec4(0.0, 0.0, 0.0, s * u_alpha); // black, premultiplied
}`;

type Atlas = {
  z: number;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  w: number;
  h: number;
  dem: WebGLTexture;
  mask: WebGLTexture; // raw shadow pass
  fbo: WebGLFramebuffer;
  clean: WebGLTexture; // after the majority filter — this is what is drawn
  fboClean: WebGLFramebuffer;
  clip: WebGLTexture; // city border rasterised in atlas space (2026-09-02)
};

export type BorderGeom = { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };

/**
 * Which side of the view gets the extra tile of atlas, for a sun at this
 * azimuth — the margin shadows come in from.
 *
 * Pure, and exported, because it is the whole of what the atlas box owes the
 * CLOCK: the camera decides the rest. There are four answers in a day and the
 * sun crosses from one to the next three times between 06:00 and 21:00 (due
 * east, due south, due west), so a scrub of the whole track needs the atlas
 * rebuilt three times and not once more. `setTime` compares this key and
 * schedules nothing when it has not moved (perf, 2026-09-15).
 */
export function sunMargin(az: number): { x0: number; x1: number; y0: number; y1: number } {
  const r = (az * Math.PI) / 180;
  const east = Math.sin(r) > 0;
  const north = Math.cos(r) > 0;
  return { x0: east ? 0 : -1, x1: east ? 1 : 0, y0: north ? -1 : 0, y1: north ? 0 : 1 };
}

const marginKey = (m: { x0: number; x1: number; y0: number; y1: number }) =>
  `${m.x0}${m.x1}${m.y0}${m.y1}`;

/** Web-mercator tile-space coordinates (fraction of the world, times 2^z)
 *  of a lng/lat — the same mapping the atlas grid uses. */
export function tileXY(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

/** Rasterise the border into a canvas covering atlas tiles x0..x0+nx,
 *  y0..y0+ny at level z: white inside, black outside. `scale` = canvas px
 *  per atlas texel (a quarter is plenty; the edge is sampled LINEAR). */
export function rasteriseBorder(border: BorderGeom | null, z: number, x0: number, y0: number, nx: number, ny: number, scale: number): OffscreenCanvas {
  const cv = new OffscreenCanvas(Math.max(1, Math.round(nx * TILE * scale)), Math.max(1, Math.round(ny * TILE * scale)));
  const ctx = cv.getContext("2d")!;
  if (!border) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    return cv;
  }
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cv.width, cv.height);
  const polys = border.type === "Polygon" ? [border.coordinates] : border.coordinates;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  for (const rings of polys) {
    for (const ring of rings) {
      ring.forEach(([lng, lat], i) => {
        const [tx, ty] = tileXY(lng, lat, z);
        const px = (tx - x0) * TILE * scale;
        const py = (ty - y0) * TILE * scale;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
    }
  }
  ctx.fill("evenodd"); // holes (enclaves) stay outside
  return cv;
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  return p;
}

const observerOf = (c: City): Observer => ({ lat: c.center[1], lng: c.center[0], timeZone: c.timeZone });

export class ShadeLayer implements CustomLayerInterface {
  id = "shade-live";
  type = "custom" as const;
  renderingMode = "2d" as const;

  private map!: LibreMap;
  private gl!: WebGL2RenderingContext;
  private progShadow!: WebGLProgram;
  private progClean!: WebGLProgram;
  private progDraw!: WebGLProgram;
  private quad!: WebGLBuffer;
  private atlas: Atlas | null = null;
  private prev: Atlas | null = null; // fading out after a swap
  private fadeStart = 0;
  private atlasKey = "";
  /** `marginKey` of the sun side the live atlas is cut for; "" until the
   *  first build. */
  private margin = "";
  private loading = 0;
  private maskDirty = true;
  private visible = true;
  /** Atlases finished since this layer was constructed. Read by `state()`;
   *  nothing in the render path looks at it. */
  private builds = 0;
  private minutes: number;
  private day: string;
  private tiles = new Map<string, Promise<ImageBitmap | null>>();
  /** Aborts the DSM fetches in flight when the tab goes away (`setPageHidden`).
   *  Replaced rather than reused: a controller that has fired stays fired. */
  private fetching = new AbortController();
  private timer = 0;
  private city: string;
  private obs: Observer;
  private border: BorderGeom | null = null;
  private tileExt = "webp";
  private maxZ = MAX_Z;
  private onMove = () => this.schedule();

  constructor(minutes: number, day: string, city: City) {
    this.minutes = minutes;
    this.day = day;
    this.city = city.id;
    this.obs = observerOf(city);
    this.tileExt = city.tileExt ?? "webp";
    this.maxZ = city.tileMaxZoom ?? MAX_Z;
  }

  /** The city's data border: shadows are drawn only inside it. */
  setBorder(border: BorderGeom | null) {
    this.border = border;
    const a = this.atlas;
    if (a) {
      this.uploadClip(a); // re-rasterise for the current atlas without refetching tiles
      this.map?.triggerRepaint();
    }
  }

  private uploadClip(a: Atlas) {
    const gl = this.gl;
    const cv = rasteriseBorder(this.border, a.z, a.x0, a.y0, a.nx, a.ny, 0.25);
    gl.bindTexture(gl.TEXTURE_2D, a.clip);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Switch the DSM tile set and the sun's observer when the city changes. */
  setCity(city: City) {
    if (city.id === this.city) return;
    this.city = city.id;
    this.obs = observerOf(city);
    this.tileExt = city.tileExt ?? "webp";
    this.maxZ = city.tileMaxZoom ?? MAX_Z;
    this.tiles.clear();
    this.atlasKey = ""; // force a rebuild over the new city
    this.margin = ""; // and over the new city's sun
    this.maskDirty = true;
    this.schedule();
  }

  /**
   * The clock moved (the walk's departure, or the day scrubber's thumb).
   *
   * The mask is re-marched on the next frame — that is a GPU pass over an
   * atlas that is already there, and it is what makes the shadows follow the
   * thumb. The ATLAS is another matter: the only thing the clock can change
   * about it is which side carries the extra tile of margin, and that changes
   * three times in a day (`sunMargin`). This used to `schedule()` on every
   * call, which re-armed a 200 ms timer ten times a second while the reader
   * dragged; the rebuild it eventually ran refetched the DSM tiles it needed
   * from the network. Measured on napwalk.com, one human-paced drag across
   * 06:00–21:00: four rebuilds, 14 DSM tiles at 143 ms apiece, and the
   * overlay drawing the previous margin for 0.6–1.2 s at a stretch. On
   * localhost, where the tiles came back in 4 ms, the same drag hid it — and
   * localhost was the whole of "back ago" until the first deploy
   * (DECISIONS 2026-09-15).
   *
   * So: schedule only when the margin really moves, and then at once rather
   * than in 200 ms — a clock change is not a pinch, there is no gesture to
   * wait out. `rebuildAtlas` has warmed the tiles the other three margins
   * need, so the build that follows asks the network for nothing.
   */
  setTime(minutes: number, day: string) {
    if (minutes === this.minutes && day === this.day) return;
    this.minutes = minutes;
    this.day = day;
    this.maskDirty = true;
    this.dropPrev();
    this.map?.triggerRepaint();
    const want = marginKey(sunMargin(sunPosition(day, minutes, this.obs).az));
    if (want !== this.margin) this.schedule(0);
  }

  setVisible(v: boolean) {
    if (this.visible === v) return;
    this.visible = v;
    this.map?.triggerRepaint();
    // A hidden overlay does no work (see `rebuildAtlas`), so everything that
    // happened while it was away — pans, zooms, the clock — has to be caught
    // up on the way back in, or the first draw under a new plan would show
    // the atlas the map had the last time the overlay was on screen.
    if (v) this.schedule();
  }

  /** What the overlay is showing right now — for `?debug`'s `window.__swShade`
   *  and the e2e suite behind it. A custom WebGL layer keeps its visibility
   *  and its clock in these fields rather than in the style, so
   *  `getLayoutProperty("shade-live", "visibility")` cannot answer either
   *  question (CR-01 edit 1, 2026-09-08).
   *
   *  `builds` counts finished atlases. It is the only way to see the work
   *  this layer does NOT do while it is hidden, which is the whole point of
   *  the guard in `rebuildAtlas` (CR-01 review A, finding 2). `tiles` is the
   *  size of the decoded DSM cache, which is what a hidden tab gives back
   *  (B4, `setPageHidden`). */
  state(): {
    visible: boolean;
    minutes: number;
    day: string;
    builds: number;
    tiles: number;
    atlas: boolean;
  } {
    return {
      visible: this.visible,
      minutes: this.minutes,
      day: this.day,
      builds: this.builds,
      tiles: this.tiles.size,
      // `atlas` is what a hidden tab now KEEPS (B4, S6 review finding 6):
      // the e2e asserts it survives, where it used to assert a rebuild.
      atlas: this.atlas !== null,
    };
  }

  /**
   * The tab went away, or came back (backlog B4).
   *
   * A hidden tab draws nothing, and this layer is the heaviest thing in it
   * that can be handed back: up to 300 decoded DSM tiles — a 512 x 512 RGBA
   * ImageBitmap is a megabyte apiece. A browser under memory pressure
   * discards the whole TAB rather than a page's caches, so the only way to
   * keep the tab is to be smaller than the one it would take instead.
   *
   * The ATLAS stays (S6 review, finding 6). It is one texture plus three
   * render targets — a few MB against the tiles' 47–76 — and freeing it
   * bought almost none of the saving while costing the reader ~250–300 ms
   * of unshaded map on the way back in (localhost, warm cache; on mobile
   * data it is a tile round trip) and a re-fetch of every DSM tile the view
   * covers. Keeping it means `rebuildAtlas` finds the view still covered
   * and returns at once: the old shade draws on the first frame, and only a
   * pan asks the network for anything.
   *
   * Nothing about what the overlay SHOWS changes: the city, the clock, the
   * border and the visibility are settings, and the `schedule()` on the way
   * back in re-asks the same question of them — the same path
   * `setVisible(true)` takes when the overlay is switched on. `maskDirty`
   * is set so the shadow pass is re-marched for the minute on screen rather
   * than trusted from before the tab went away. The map's own raster
   * sources are left alone: MapLibre manages those, they are far smaller,
   * and dropping them would blank the map.
   */
  setPageHidden(hidden: boolean) {
    if (!hidden) {
      this.schedule();
      return;
    }
    window.clearTimeout(this.timer);
    this.loading += 1; // supersede a rebuild in flight: its bitmaps are going
    this.fetching.abort();
    this.fetching = new AbortController();
    for (const p of this.tiles.values()) {
      void p.then((bm) => bm?.close()).catch(() => {});
    }
    this.tiles.clear();
    // the atlas that is FADING OUT is transient and nobody misses it; the
    // live one stays, and with it the first frame on the way back in
    if (this.gl) this.dropPrev();
    this.maskDirty = true;
  }

  onAdd(map: LibreMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.gl = gl;
    this.progShadow = compile(gl, VS_FULL, FS_SHADOW);
    this.progClean = compile(gl, VS_FULL, FS_CLEAN);
    this.progDraw = compile(gl, VS, FS_DRAW);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    map.on("move", this.onMove);
    this.schedule();
  }

  onRemove(map: LibreMap, gl: WebGL2RenderingContext) {
    map.off("move", this.onMove);
    window.clearTimeout(this.timer);
    if (this.atlas) this.freeAtlas(gl, this.atlas);
    this.dropPrev();
    gl.deleteProgram(this.progShadow);
    gl.deleteProgram(this.progClean);
    gl.deleteProgram(this.progDraw);
    gl.deleteBuffer(this.quad);
  }

  // ---- atlas -----------------------------------------------------------
  // rebuild only when the map rests: mid-gesture the old atlas is drawn
  // scaled (correct, just coarser), which avoids the upload+shadow-pass
  // hitch on every frame of a pinch (feedback 2026-08-16)
  private schedule(ms = 200) {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.rebuildAtlas(), ms);
  }

  private tile(z: number, x: number, y: number): Promise<ImageBitmap | null> {
    const key = `${z}/${x}/${y}`;
    let p = this.tiles.get(key);
    if (!p) {
      p = fetch(tileUrl(`${this.city}/dsm/${key}.${this.tileExt}?v=${TILE_VERSION}`), {
        signal: this.fetching.signal,
      })
        .then((r) => (r.ok ? r.blob().then((b) => createImageBitmap(b)) : null))
        .catch(() => null); // including the abort: a hidden tab wants nothing
      this.tiles.set(key, p);
      if (this.tiles.size > CACHE) this.tiles.delete(this.tiles.keys().next().value!);
    }
    return p;
  }

  private async rebuildAtlas() {
    // Nothing is drawn while the overlay is off, so nothing is worth
    // building: without this the DSM tiles were fetched and the atlas and
    // its shadow pass rebuilt on every pan-rest on Home, Search and
    // Settings, where CR-01 edit 1 has deliberately turned the layer off
    // (CR-01 review A, finding 2). `setVisible(true)` re-schedules, so the
    // first rest after a plan appears still builds.
    if (!this.visible) return;
    const map = this.map;
    const zoom = map.getZoom();
    if (zoom < LIVE_SHADE_FROM) return; // nothing drawn this far out
    // finest level the atlas cap allows: z16 from about zoom 14 up (2 x
    // screen resolution), so level switches — every edge re-cut on another
    // grid, a visible sideways jump — only happen zoomed far out, where a
    // texel is under half a screen pixel (feedback 2026-08-16)
    const el = map.getContainer();
    const width = el.clientWidth || 1000;
    const height = el.clientHeight || 800;
    const maxTiles = Math.floor(4096 / TILE);
    const fits = (px: number) => Math.floor(zoom + Math.log2(((maxTiles - 1) * TILE) / px));
    const z = Math.max(MIN_Z, Math.min(this.maxZ, Math.floor(zoom) + 2, fits(width), fits(height)));
    const n = 2 ** z;
    const b = map.getBounds();
    const mx = (lng: number) => ((lng + 180) / 360) * n;
    const my = (lat: number) => {
      const s = Math.sin((lat * Math.PI) / 180);
      return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
    };
    let x0 = Math.floor(mx(b.getWest()));
    let x1 = Math.floor(mx(b.getEast()));
    let y0 = Math.floor(my(b.getNorth()));
    let y1 = Math.floor(my(b.getSouth()));
    // one tile of margin on the sun side, so shadows can come in
    const { az } = sunPosition(this.day, this.minutes, this.obs);
    const m = sunMargin(az);
    // the side the CURRENT atlas is cut for: `setTime` schedules only when
    // this changes, which is three times in a day and not once per minute
    this.margin = marginKey(m);
    x0 += m.x0;
    x1 += m.x1;
    y0 += m.y0;
    y1 += m.y1;
    // clamp the atlas to what a phone GPU takes (4096 texels)
    if (x1 - x0 + 1 > maxTiles) x1 = x0 + maxTiles - 1;
    if (y1 - y0 + 1 > maxTiles) y1 = y0 + maxTiles - 1;
    // still covered at this level? then keep the atlas (zooming in shrinks
    // the needed range; a rebuild would only be a stall)
    const cur = this.atlas;
    if (cur && cur.z === z && x0 >= cur.x0 && x1 < cur.x0 + cur.nx && y0 >= cur.y0 && y1 < cur.y0 + cur.ny) return;
    const key = `${z}/${x0}-${x1}/${y0}-${y1}`;
    if (key === this.atlasKey) return;
    const nx = x1 - x0 + 1;
    const ny = y1 - y0 + 1;
    const gen = ++this.loading;
    const bitmaps = await Promise.all(
      Array.from({ length: nx * ny }, (_, i) => this.tile(z, x0 + (i % nx), y0 + Math.floor(i / nx)))
    );
    if (gen !== this.loading) return; // superseded
    const cv = new OffscreenCanvas(nx * TILE, ny * TILE);
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = `rgb(${FILL_RGB.join(",")})`;
    ctx.fillRect(0, 0, cv.width, cv.height);
    bitmaps.forEach((bm, i) => {
      if (bm) ctx.drawImage(bm, (i % nx) * TILE, Math.floor(i / nx) * TILE);
    });
    const gl = this.gl;
    // the old atlas fades out under the new one (a level change re-cuts
    // every edge on a different grid; a hard swap reads as a jump)
    this.dropPrev();
    this.prev = this.atlas;
    this.fadeStart = performance.now();
    const dem = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, dem);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const [mask, fbo] = this.target(gl, cv.width, cv.height, gl.NEAREST, gl.NEAREST);
    // drawn mask: crisp texels when magnified (street zoom), averaged when
    // minified (zoomed out — ShadeMap's slight softness there)
    const [clean, fboClean] = this.target(gl, cv.width, cv.height, gl.LINEAR, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const clip = gl.createTexture()!;
    this.atlas = { z, x0, y0, nx, ny, w: cv.width, h: cv.height, dem, mask, fbo, clean, fboClean, clip };
    this.uploadClip(this.atlas);
    this.atlasKey = key;
    this.maskDirty = true;
    this.builds += 1;
    this.map.triggerRepaint();
    this.warmMargins(z, m, x0, x1, y0, y1);
  }

  /**
   * Fetch the tiles the OTHER three sun-side margins would need, now, while
   * nobody is waiting for them (perf, 2026-09-15).
   *
   * The clock can move the margin to any of four positions (`sunMargin`), so
   * the union of every atlas the sun can ask for at this camera is the view
   * grown by one tile all round. This atlas holds one corner of that union;
   * the rest is a column and a row — about fourteen tiles at a desktop
   * viewport, 2–5 KiB apiece as WebP, so under 100 KiB against the 7.5 MiB
   * Frankfurt is allowed (rule 7). Decoding them here means the rebuild that
   * a margin flip triggers mid-scrub finds every bitmap in `this.tiles` and
   * lands on the next frame instead of after a round trip to R2.
   */
  private warmMargins(z: number, m: { x0: number; x1: number; y0: number; y1: number }, x0: number, x1: number, y0: number, y1: number) {
    // the column and the row this atlas does NOT hold: the far side of each
    // axis from the one the sun is on
    const ox = m.x1 === 1 ? x0 - 1 : x1 + 1;
    const oy = m.y0 === -1 ? y1 + 1 : y0 - 1;
    for (let y = y0 - 1; y <= y1 + 1; y++) void this.tile(z, ox, y);
    for (let x = x0 - 1; x <= x1 + 1; x++) void this.tile(z, x, oy);
  }

  // the DEM and the raw mask stay NEAREST (encoded values must not be interpolated)
  private target(gl: WebGL2RenderingContext, w: number, h: number, minF: number, magF: number): [WebGLTexture, WebGLFramebuffer] {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minF);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magF);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return [tex, fbo];
  }

  private dropPrev() {
    if (this.prev) this.freeAtlas(this.gl, this.prev);
    this.prev = null;
  }

  private freeAtlas(gl: WebGL2RenderingContext, a: Atlas) {
    gl.deleteTexture(a.dem);
    gl.deleteTexture(a.mask);
    gl.deleteTexture(a.clean);
    gl.deleteTexture(a.clip);
    gl.deleteFramebuffer(a.fbo);
    gl.deleteFramebuffer(a.fboClean);
  }

  // ---- shadow pass (prerender: renders to the mask texture) -----------
  prerender(gl: WebGL2RenderingContext) {
    const a = this.atlas;
    if (!a || !this.maskDirty || !this.visible) return;
    this.maskDirty = false;
    const { az, el } = sunPosition(this.day, this.minutes, this.obs);
    const lat = this.map.getCenter().lat;
    const ground = ((2 * R) / 2 ** a.z / TILE) * Math.cos((lat * Math.PI) / 180); // m per texel
    const night = el <= 0;
    const reachM = night ? 0 : Math.min(MAX_REACH_M, MAX_H / Math.tan((el * Math.PI) / 180));
    let stepTexels = 1;
    let steps = Math.ceil(reachM / ground);
    if (steps > MAX_STEPS) {
      stepTexels = steps / MAX_STEPS;
      steps = MAX_STEPS;
    }
    const azr = (az * Math.PI) / 180;
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const prevVp = gl.getParameter(gl.VIEWPORT) as Int32Array;
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
    gl.viewport(0, 0, a.w, a.h);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.useProgram(this.progShadow);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, a.dem);
    gl.uniform1i(gl.getUniformLocation(this.progShadow, "u_dem"), 0);
    gl.uniform2f(gl.getUniformLocation(this.progShadow, "u_texels"), a.w, a.h);
    // toward the sun in texel space: east = +x, south = +y (row 0 = north)
    gl.uniform2f(gl.getUniformLocation(this.progShadow, "u_step"), Math.sin(azr) * stepTexels, -Math.cos(azr) * stepTexels);
    gl.uniform1f(gl.getUniformLocation(this.progShadow, "u_rise"), Math.tan((el * Math.PI) / 180) * stepTexels * ground);
    gl.uniform1i(gl.getUniformLocation(this.progShadow, "u_steps"), steps);
    gl.uniform1i(gl.getUniformLocation(this.progShadow, "u_night"), night ? 1 : 0);
    this.drawQuad(gl, this.progShadow);
    // clean pass: mask -> clean (a plain copy where texels are coarse)
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fboClean);
    gl.useProgram(this.progClean);
    gl.bindTexture(gl.TEXTURE_2D, a.mask);
    gl.uniform1i(gl.getUniformLocation(this.progClean, "u_mask"), 0);
    gl.uniform1i(gl.getUniformLocation(this.progClean, "u_filter"), ground <= CLEAN_MAX_M ? 1 : 0);
    this.drawQuad(gl, this.progClean);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    gl.viewport(prevVp[0], prevVp[1], prevVp[2], prevVp[3]);
  }

  // ---- draw (every frame, cheap) ---------------------------------------
  render(gl: WebGL2RenderingContext, opts: CustomRenderMethodInput) {
    const a = this.atlas;
    if (!a || !this.visible || this.map.getZoom() < LIVE_SHADE_FROM) return;
    const t = this.prev ? Math.min(1, (performance.now() - this.fadeStart) / FADE_MS) : 1;
    const M = opts.defaultProjectionData.mainMatrix as ArrayLike<number>;
    gl.useProgram(this.progDraw);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(gl.getUniformLocation(this.progDraw, "u_mask"), 0);
    gl.uniform1i(gl.getUniformLocation(this.progDraw, "u_clip"), 1);
    if (this.prev && t < 1) this.drawAtlas(gl, this.prev, M, ALPHA * (1 - t));
    this.drawAtlas(gl, a, M, ALPHA * t);
    if (t < 1) this.map.triggerRepaint();
    else this.dropPrev();
  }

  private drawAtlas(gl: WebGL2RenderingContext, a: Atlas, M: ArrayLike<number>, alpha: number) {
    const n = 2 ** a.z;
    const x0 = a.x0 / n, y0 = a.y0 / n, w = a.nx / n, h = a.ny / n;
    // M' = M · [scale(w,h,1) · translate(x0,y0,0)], column-major, in float64
    const m = new Float64Array(16);
    for (let r = 0; r < 4; r++) {
      m[r] = M[r] * w;
      m[4 + r] = M[4 + r] * h;
      m[8 + r] = M[8 + r];
      m[12 + r] = M[r] * x0 + M[4 + r] * y0 + M[12 + r];
    }
    gl.uniformMatrix4fv(gl.getUniformLocation(this.progDraw, "u_matrix"), false, new Float32Array(m));
    gl.uniform1f(gl.getUniformLocation(this.progDraw, "u_alpha"), alpha);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, a.clip);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, a.clean);
    this.drawQuad(gl, this.progDraw);
  }

  private drawQuad(gl: WebGL2RenderingContext, prog: WebGLProgram) {
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
