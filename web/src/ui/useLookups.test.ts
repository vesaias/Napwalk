import { describe, expect, it } from "vitest";
import type { Place } from "../plan/geocode";
import { searchState, type SearchState } from "./useLookups";

const IDLE: SearchState = { results: [], status: "idle" };
const PARK: Place = {
  name: "Günthersburgpark",
  kind: "park",
  district: "Nordend",
  lng: 8.696,
  lat: 50.128,
  inCity: true,
};

describe("searchState", () => {
  it("starts and resets to idle with nothing on screen", () => {
    expect(searchState({ results: [PARK], status: "idle" }, { k: "reset" })).toEqual(IDLE);
  });

  it("keeps the results already showing while the next query is out", () => {
    const prev: SearchState = { results: [PARK], status: "idle" };
    expect(searchState(prev, { k: "pending" })).toEqual({ results: [PARK], status: "loading" });
    // and a first query has nothing to keep
    expect(searchState(IDLE, { k: "pending" })).toEqual({ results: [], status: "loading" });
  });

  it("tells a zero-match apart from a failure (F2-02, F2-05)", () => {
    expect(searchState({ results: [], status: "loading" }, { k: "ok", results: [] })).toEqual({
      results: [],
      status: "empty",
    });
    expect(searchState({ results: [], status: "loading" }, { k: "fail" })).toEqual({
      results: [],
      status: "error",
    });
  });

  it("shows an answer that matched", () => {
    expect(searchState({ results: [], status: "loading" }, { k: "ok", results: [PARK] })).toEqual({
      results: [PARK],
      status: "idle",
    });
  });

  it("drops stale results when the retry that replaced them fails", () => {
    const shown: SearchState = { results: [PARK], status: "idle" };
    expect(searchState(shown, { k: "fail" })).toEqual({ results: [], status: "error" });
  });
});
