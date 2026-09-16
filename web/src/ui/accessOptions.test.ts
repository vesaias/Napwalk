import { describe, expect, it } from "vitest";
import { accessOptions } from "./accessOptions";

describe("accessOptions (wheelchair out of the UI, 2026-09-08)", () => {
  it("offers walk and stroller", () => {
    expect(accessOptions("walk")).toEqual(["walk", "stroller"]);
    expect(accessOptions("stroller")).toEqual(["walk", "stroller"]);
  });
  it("still shows a wheelchair walk that a link or old setting brought in", () => {
    expect(accessOptions("wheelchair")).toEqual(["walk", "stroller", "wheelchair"]);
  });
});
