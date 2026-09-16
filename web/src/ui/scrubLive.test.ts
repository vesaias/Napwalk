import { describe, expect, it } from "vitest";
import { liveMinute, setLiveMinute, subscribeLive } from "./scrubLive";

describe("scrubLive — the held minute, outside React", () => {
  it("starts empty, publishes changes, and is idempotent", () => {
    const seen: (number | null)[] = [];
    const off = subscribeLive((m) => seen.push(m));
    expect(liveMinute()).toBeNull();
    setLiveMinute(600);
    setLiveMinute(600); // no second notification
    setLiveMinute(615);
    setLiveMinute(null);
    expect(seen).toEqual([600, 615, null]);
    expect(liveMinute()).toBeNull();
    off();
    setLiveMinute(700);
    expect(seen).toEqual([600, 615, null]); // unsubscribed
    setLiveMinute(null);
  });
});
