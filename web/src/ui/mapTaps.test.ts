import { describe, expect, it } from "vitest";
import { getCity } from "../cities";
import { mapTaps } from "./mapTaps";
import { initialShell, reduce, type Action, type ShellState } from "./shellState";

const FFM = getCity("frankfurt");
const AT: [number, number] = [8.7027, 50.1291];
const POI = { name: "Günthersburgpark", kind: "park", lng: 8.7027, lat: 50.1291 };

/** The shell at a given screen, plus a recorder for whatever it dispatches. */
function at(build: (s: ShellState) => ShellState) {
  const s = build(initialShell(14 * 60, "shade"));
  const sent: Action[] = [];
  return { taps: mapTaps(s, (a) => sent.push(a), FFM), sent };
}

const home = () => at((s) => s);
const place = () =>
  at((s) =>
    reduce(s, {
      type: "pickPlace",
      place: { name: "P", kind: "park", district: null, ...{ lng: AT[0], lat: AT[1] }, inCity: true },
    })
  );
/** W0, the Wander tab's root: a tap there STARTS the loops (CR-02 slice A). */
const idle = () => at((s) => reduce(s, { type: "tab", tab: "wander" }));
/** W1, with loops already on screen: a tap MOVES them. */
const loops = () =>
  at((s) =>
    reduce(reduce(s, { type: "tab", tab: "wander" }), {
      type: "origin",
      origin: { kind: "gps" },
    })
  );

describe("mapTaps — on the route tab", () => {
  it("does nothing on an empty tap on Home: a tap is not a pin (HANDOVER §4.3)", () => {
    const { taps, sent } = home();
    taps.onMapClick(AT);
    expect(sent).toEqual([]);
  });

  it("dismisses the card a tap lands beside", () => {
    const { taps, sent } = place();
    taps.onMapClick(AT);
    expect(sent).toEqual([{ type: "back" }]);
  });

  it("turns a POI into the place card, stamped with whether it is in the city", () => {
    const { taps, sent } = home();
    taps.onFeatureTap(POI);
    expect(sent).toEqual([
      {
        type: "pickPlace",
        place: {
          name: POI.name,
          kind: POI.kind,
          district: null,
          lng: POI.lng,
          lat: POI.lat,
          inCity: true,
        },
      },
    ]);
  });

  it("marks a POI outside the city as such", () => {
    const { taps, sent } = home();
    taps.onFeatureTap({ ...POI, lng: 8.2, lat: 49.9 });
    expect(sent[0]).toMatchObject({ type: "pickPlace", place: { inCity: false } });
  });
});

describe("mapTaps — on Wander a tap is the question", () => {
  it("starts the loops from where the map was tapped", () => {
    const { taps, sent } = loops();
    taps.onMapClick(AT);
    expect(sent).toEqual([
      { type: "origin", origin: { kind: "point", at: AT, label: null } },
    ]);
  });

  it("takes a POI's name with it", () => {
    const { taps, sent } = loops();
    taps.onFeatureTap(POI);
    expect(sent).toEqual([
      {
        type: "origin",
        origin: { kind: "point", at: [POI.lng, POI.lat], label: POI.name },
      },
    ]);
  });

  it("starts them from W0 too, where there are no loops to move yet", () => {
    const { taps, sent } = idle();
    taps.onMapClick(AT);
    expect(sent).toEqual([
      { type: "origin", origin: { kind: "point", at: AT, label: null } },
    ]);
    const poi = idle();
    poi.taps.onFeatureTap(POI);
    expect(poi.sent).toEqual([
      {
        type: "origin",
        origin: { kind: "point", at: [POI.lng, POI.lat], label: POI.name },
      },
    ]);
  });

  it("never opens a place card from the Wander tab", () => {
    const { taps, sent } = loops();
    taps.onFeatureTap(POI);
    expect(sent.some((a) => a.type === "pickPlace")).toBe(false);
  });

  it("ignores a tap once the walk is under way — it is not asking a question", () => {
    const { taps, sent } = at((s) => {
      const w = reduce(s, { type: "tab", tab: "wander" });
      return { ...w, wander: { k: "navigate" } };
    });
    taps.onMapClick(AT);
    taps.onFeatureTap(POI);
    expect(sent).toEqual([]);
  });
});

describe("mapTaps — the long press", () => {
  it("drops a pin wherever it lands", () => {
    const { taps, sent } = home();
    taps.onLongPress(AT);
    expect(sent).toEqual([{ type: "longPress", at: AT }]);
  });
});
