import { afterEach, describe, expect, it, vi } from "vitest";
import { parseGraph } from "../router/graph";
import { packGraph } from "../router/packGraph";
import { COBBLE_Q } from "../router/stats";
import { SPEED_M_PER_MIN } from "../router/astar";
import { getLocale } from "../i18n/t";
import {
  DEFAULT_SETTINGS,
  defaultsFor,
  hardFilter,
  loadSettings,
  PACE_KMH,
  parseSettings,
  saveSettings,
  storedCityId,
} from "./settings";

const NODES: [number, number][] = [
  [50.1109, 8.6821],
  [50.1145, 8.6821],
  [50.1181, 8.6821],
];

function storageStub(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  saveSettings(DEFAULT_SETTINGS); // restore module speed/locale side effects
});

describe("hardFilter", () => {
  const g = parseGraph(packGraph(NODES, [
    { u: 0, v: 1, lenDm: 1000, surfaceQ: 200 }, // cobbles
    { u: 1, v: 2, lenDm: 1000, surfaceQ: 10 }, // asphalt
  ]));

  it("walls off cobbles when avoidCobbles is on", () => {
    const f = hardFilter(g, { ...DEFAULT_SETTINGS, avoidCobbles: true })!;
    expect(f(0)).toBe(Infinity);
    expect(f(1)).toBe(0);
  });

  it("is undefined when avoidCobbles is off", () => {
    expect(hardFilter(g, DEFAULT_SETTINGS)).toBeUndefined();
  });

  it("uses the stats.ts cobble threshold", () => {
    expect(COBBLE_Q).toBe(178);
  });
});

describe("loadSettings", () => {
  it("merges stored fields over defaults", () => {
    vi.stubGlobal("localStorage", storageStub({ "sw.settings": JSON.stringify({ pace: "brisk" }) }));
    const s = loadSettings();
    expect(s.pace).toBe("brisk");
    expect(s.access).toBe(DEFAULT_SETTINGS.access);
    expect(s.avoidCobbles).toBe(false);
    expect(s.city).toBe(DEFAULT_SETTINGS.city);
    expect(s.theme).toBe("light");
  });

  it("returns defaults on invalid JSON", () => {
    vi.stubGlobal("localStorage", storageStub({ "sw.settings": "{not json" }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults without storage (Node)", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back per field on invalid values, keeping valid ones", () => {
    vi.stubGlobal("localStorage", storageStub({
      "sw.settings": JSON.stringify({ pace: "turbo", city: "atlantis", avoidCobbles: "yes", theme: "dark", access: "walk" }),
    }));
    const s = loadSettings();
    expect(s.pace).toBe(DEFAULT_SETTINGS.pace);
    expect(s.city).toBe(DEFAULT_SETTINGS.city);
    expect(s.avoidCobbles).toBe(DEFAULT_SETTINGS.avoidCobbles);
    expect(s.theme).toBe("dark");
    expect(s.access).toBe("walk");
  });

  // 2026-09-06: "auto" is gone. Everyone who ever opened the app before
  // that date has it in localStorage, and what they actually chose was the
  // default — so it becomes the new default, `light`, and not "daylight",
  // which is a promise about the sun they never made.
  it("migrates a stored theme of \"auto\" to light", () => {
    vi.stubGlobal("localStorage", storageStub({ "sw.settings": JSON.stringify({ theme: "auto", pace: "brisk" }) }));
    const s = loadSettings();
    expect(s.theme).toBe("light");
    expect(s.pace).toBe("brisk"); // and takes nothing else down with it
  });

  it("keeps the three themes that exist, and defaults anything else", () => {
    for (const theme of ["light", "dark", "daylight"] as const) {
      vi.stubGlobal("localStorage", storageStub({ "sw.settings": JSON.stringify({ theme }) }));
      expect(loadSettings().theme).toBe(theme);
    }
    vi.stubGlobal("localStorage", storageStub({ "sw.settings": JSON.stringify({ theme: "sepia" }) }));
    expect(loadSettings().theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it("defaults to light — not to the device", () => {
    expect(DEFAULT_SETTINGS.theme).toBe("light");
  });

  // CR-02 edit 1. The map layers are a record of their own now, and the
  // `noiseDefault` row they replace is gone from the type — but not from
  // anybody's localStorage, so the reader who turned noise on keeps it.
  it("defaults to shade on, noise off, where there is no viewport to ask", () => {
    expect(DEFAULT_SETTINGS.layers).toEqual({ shade: true, noise: false });
    expect(loadSettings().layers).toEqual({ shade: true, noise: false });
  });

  // Viktor, 2026-09-09: shade costs ~3 MiB of DSM tiles on the first paint of
  // Home, which is a phone's problem and not a desktop's.
  it("defaults shade OFF on the phone and ON on the web", () => {
    expect(defaultsFor({ phone: true }).layers).toEqual({ shade: false, noise: false });
    expect(defaultsFor({ phone: false }).layers).toEqual({ shade: true, noise: false });
    // and every other field is the same record either way
    const { layers: _p, ...phone } = defaultsFor({ phone: true });
    const { layers: _w, ...web } = defaultsFor({ phone: false });
    expect(phone).toEqual(web);
  });

  it("hands out a fresh layers object per frame, not the defaults' own", () => {
    const a = defaultsFor({ phone: true });
    a.layers.noise = true;
    expect(defaultsFor({ phone: true }).layers.noise).toBe(false);
    expect(DEFAULT_SETTINGS.layers.noise).toBe(false);
  });

  // The frame decides ONCE. After that the record is the reader's, at every
  // width: a phone reader who turned shade on keeps it, and a desktop reader
  // who turned it off keeps that on their phone.
  it("lets a stored layers record win over the frame, both ways", () => {
    const on = JSON.stringify({ layers: { shade: true, noise: false } });
    expect(parseSettings(on, defaultsFor({ phone: true })).layers.shade).toBe(true);
    const off = JSON.stringify({ layers: { shade: false, noise: false } });
    expect(parseSettings(off, defaultsFor({ phone: false })).layers.shade).toBe(false);
  });

  it("falls back to the frame's shade for a record that has no layers", () => {
    const raw = JSON.stringify({ pace: "brisk" });
    expect(parseSettings(raw, defaultsFor({ phone: true })).layers.shade).toBe(false);
    expect(parseSettings(raw, defaultsFor({ phone: false })).layers.shade).toBe(true);
    // ...and for no record at all, or an unusable one
    for (const bad of [null, "", "{oops", "[1,2]"]) {
      expect(parseSettings(bad, defaultsFor({ phone: true })).layers).toEqual({
        shade: false,
        noise: false,
      });
    }
  });

  // The noiseDefault migration is about NOISE and is untouched by any of
  // this: it lands in `layers.noise` at either frame, and shade still
  // follows the frame beside it.
  it("migrates noiseDefault at either frame", () => {
    const raw = JSON.stringify({ noiseDefault: true, pace: "brisk" });
    expect(parseSettings(raw, defaultsFor({ phone: true })).layers).toEqual({
      shade: false,
      noise: true,
    });
    expect(parseSettings(raw, defaultsFor({ phone: false })).layers).toEqual({
      shade: true,
      noise: true,
    });
  });

  it("hands out a fresh layers object, not the defaults' own", () => {
    const a = loadSettings();
    a.layers.shade = false;
    expect(DEFAULT_SETTINGS.layers.shade).toBe(true);
    expect(loadSettings().layers.shade).toBe(true);
  });

  it("migrates a stored noiseDefault into layers.noise", () => {
    vi.stubGlobal("localStorage", storageStub({
      "sw.settings": JSON.stringify({ noiseDefault: true, pace: "brisk" }),
    }));
    const s = loadSettings();
    expect(s.layers).toEqual({ shade: true, noise: true });
    expect(s.pace).toBe("brisk"); // and takes nothing else down with it
  });

  it("prefers a stored layers record over a stale noiseDefault", () => {
    vi.stubGlobal("localStorage", storageStub({
      "sw.settings": JSON.stringify({ noiseDefault: true, layers: { shade: false, noise: false } }),
    }));
    expect(loadSettings().layers).toEqual({ shade: false, noise: false });
  });

  it("falls back per layer on a half-written record", () => {
    vi.stubGlobal("localStorage", storageStub({
      "sw.settings": JSON.stringify({ layers: { noise: true } }),
    }));
    expect(loadSettings().layers).toEqual({ shade: true, noise: true });
    vi.stubGlobal("localStorage", storageStub({
      "sw.settings": JSON.stringify({ layers: "yes" }),
    }));
    expect(loadSettings().layers).toEqual({ shade: true, noise: false });
  });

  it("rejects array JSON", () => {
    vi.stubGlobal("localStorage", storageStub({ "sw.settings": "[1,2]" }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("saveSettings", () => {
  it("persists to sw.settings and roundtrips", () => {
    const ls = storageStub();
    vi.stubGlobal("localStorage", ls);
    saveSettings({ ...DEFAULT_SETTINGS, pace: "normal", avoidCobbles: true });
    expect(JSON.parse(ls.store.get("sw.settings")!).pace).toBe("normal");
    expect(loadSettings().avoidCobbles).toBe(true);
  });

  it("round-trips the layers, and drops noiseDefault on the way", () => {
    const ls = storageStub({ "sw.settings": JSON.stringify({ noiseDefault: true }) });
    vi.stubGlobal("localStorage", ls);
    const migrated = loadSettings();
    expect(migrated.layers).toEqual({ shade: true, noise: true });
    saveSettings({ ...migrated, layers: { shade: false, noise: true } });
    const stored = JSON.parse(ls.store.get("sw.settings")!);
    expect(stored.noiseDefault).toBeUndefined();
    expect(loadSettings().layers).toEqual({ shade: false, noise: true });
  });

  // S7 review F2: a city nobody picked is a guess, and a guess in storage
  // reads as a choice on the next page load — `storedCityId()` is what B1's
  // whole precedence rests on.
  it("leaves a GUESSED city out of the stored record", () => {
    const ls = storageStub();
    vi.stubGlobal("localStorage", ls);
    saveSettings({ ...DEFAULT_SETTINGS, city: "london", pace: "normal" }, false);
    const stored = JSON.parse(ls.store.get("sw.settings")!);
    expect(stored.city).toBeUndefined();
    expect(stored.pace).toBe("normal");
    expect(storedCityId()).toBeNull();
    // ...and the record still reads back with whatever default is handed in
    expect(loadSettings("paris").city).toBe("paris");
  });

  it("writes a CHOSEN city, and a later guess cannot unwrite it", () => {
    const ls = storageStub();
    vi.stubGlobal("localStorage", ls);
    saveSettings({ ...DEFAULT_SETTINGS, city: "hamburg" }, true);
    expect(storedCityId()).toBe("hamburg");
    expect(loadSettings("paris").city).toBe("hamburg");
  });

  it("applies pace and locale side effects", () => {
    vi.stubGlobal("localStorage", storageStub());
    saveSettings({ ...DEFAULT_SETTINGS, pace: "brisk", locale: "de" });
    expect(SPEED_M_PER_MIN).toBeCloseTo(5500 / 60);
    expect(getLocale()).toBe("de");
    saveSettings({ ...DEFAULT_SETTINGS, locale: "en" });
    expect(SPEED_M_PER_MIN).toBeCloseTo(4000 / 60);
    expect(getLocale()).toBe("en");
  });

  it("exposes the pace table", () => {
    expect(PACE_KMH).toEqual({ easy: 4, normal: 4.8, brisk: 5.5 });
  });
});

// backlog B1: the city the device's clock or Cloudflare's edge guessed at,
// as a DEFAULT the stored record still beats — and never a write.
describe("the boot city default", () => {
  it("is what the record falls back to when it names no city", () => {
    expect(defaultsFor({ phone: false, city: "london" }).city).toBe("london");
    expect(defaultsFor({ phone: false }).city).toBe(DEFAULT_SETTINGS.city);
    vi.stubGlobal("localStorage", storageStub());
    expect(loadSettings("london").city).toBe("london");
  });

  it("loses to a stored city, every time", () => {
    vi.stubGlobal("localStorage", storageStub({ "sw.settings": '{"city":"nyc"}' }));
    expect(loadSettings("london").city).toBe("nyc");
  });

  it("writes nothing", () => {
    const store = storageStub();
    vi.stubGlobal("localStorage", store);
    loadSettings("london");
    expect(store.store.size).toBe(0);
  });
});

describe("storedCityId", () => {
  it("is the city the record names", () => {
    vi.stubGlobal("localStorage", storageStub({ "sw.settings": '{"city":"hamburg"}' }));
    expect(storedCityId()).toBe("hamburg");
  });

  it("is null when nothing was ever chosen — the case B1 exists for", () => {
    vi.stubGlobal("localStorage", storageStub());
    expect(storedCityId()).toBeNull();
    // a record from before `city`, and one with a city that is not one
    vi.stubGlobal("localStorage", storageStub({ "sw.settings": '{"theme":"dark"}' }));
    expect(storedCityId()).toBeNull();
    vi.stubGlobal("localStorage", storageStub({ "sw.settings": '{"city":"atlantis"}' }));
    expect(storedCityId()).toBeNull();
  });

  it("survives junk and a storage that throws", () => {
    vi.stubGlobal("localStorage", storageStub({ "sw.settings": "not json" }));
    expect(storedCityId()).toBeNull();
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked");
      },
    });
    expect(storedCityId()).toBeNull();
  });

  // loadSettings().city cannot tell these two apart; that is the whole point
  it("is not loadSettings().city", () => {
    vi.stubGlobal("localStorage", storageStub());
    expect(loadSettings().city).toBe(DEFAULT_SETTINGS.city);
    expect(storedCityId()).toBeNull();
  });
});
