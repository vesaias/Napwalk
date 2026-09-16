import { afterEach, describe, expect, it, vi } from "vitest";
import { resetWanderHint, takeWanderHint } from "./wanderHint";

function storageStub(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

afterEach(() => {
  resetWanderHint();
  vi.unstubAllGlobals();
});

describe("takeWanderHint", () => {
  it("is true once and false ever after, in this session", () => {
    vi.stubGlobal("localStorage", storageStub());
    expect(takeWanderHint()).toBe(true);
    expect(takeWanderHint()).toBe(false);
  });

  it("is false when an earlier visit wrote the flag", () => {
    vi.stubGlobal("localStorage", storageStub({ "sw.wanderHint": "1" }));
    expect(takeWanderHint()).toBe(false);
  });

  it("writes the flag so the next session finds it", () => {
    const ls = storageStub();
    vi.stubGlobal("localStorage", ls);
    takeWanderHint();
    expect(ls.getItem("sw.wanderHint")).toBe("1");
  });

  it("still fires only once when there is no storage at all", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    });
    expect(takeWanderHint()).toBe(true);
    expect(takeWanderHint()).toBe(false);
  });
});
