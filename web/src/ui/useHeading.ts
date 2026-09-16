// The walker's heading, for the arrow (the rules are in ui/heading.ts).
//
// Listened to only while a walk is being navigated: outside Navigate the
// dot is a dot, and a compass listener left on is a sensor left on. The
// fix's heading arrives with the fix (`s.gpsHeading`, via the `gps` action,
// which the debug walk feeds too); the compass is this hook's own.
//
// iOS 13+ hands out orientation events only after
// `DeviceOrientationEvent.requestPermission()`, which must be called from a
// tap or it rejects. `arm` is that tap — Start, and ▴ — and never a page
// load. Everywhere else the call does not exist and arming is free.
import { useEffect, useRef, useState } from "react";
import { compassHeading, pickHeading, turned, type OrientationReading } from "./heading";
import type { ShellState } from "./shellState";

/** The compass is OFF (owner, 2026-09-16, after a real walk: "can it not
 *  use motion?"). Google Maps does use it, but it costs a motion-sensor
 *  prompt on iOS, and the fix's own heading — held between fixes by the
 *  reducer — turned out to be enough. With this false `arm` asks for
 *  nothing and no listener is attached; flip it and everything below works
 *  again as written. */
export const COMPASS: boolean = false;

/** The compass reaches React at most this often, and only when it has
 *  swung by TURN_DEG. Fine enough to feed the arrow's own easing (MapView,
 *  ui/heading.ts `easeHeading`), which is where the smoothing lives;
 *  coarse enough not to re-render the shell sixty times a second. */
const PUSH_MS = 60;
const TURN_DEG = 0.5;

type Permitting = { requestPermission?: () => Promise<"granted" | "denied"> };

export type Heading = {
  /** Degrees clockwise from north, or null: draw the dot. */
  deg: number | null;
  /** Call from the gesture that enters Navigate. Idempotent. */
  arm: () => void;
};

export function useHeading(s: ShellState, navOn: boolean): Heading {
  const [armed, setArmed] = useState(false);
  const [compass, setCompass] = useState<number | null>(null);
  const shown = useRef<number | null>(null);
  const pushedAt = useRef(0);

  useEffect(() => {
    if (!COMPASS || !navOn || !armed) return;
    // Chrome's absolute event where it exists; elsewhere the plain one,
    // which is absolute on iOS (webkitCompassHeading) and relative — so
    // refused by compassHeading — on the rest.
    const ev =
      "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    const onTurn = (e: Event) => {
      const h = compassHeading(e as unknown as OrientationReading);
      if (h === null) return;
      const now = Date.now();
      if (now - pushedAt.current < PUSH_MS || !turned(shown.current, h, TURN_DEG)) return;
      pushedAt.current = now;
      shown.current = h;
      setCompass(h);
    };
    window.addEventListener(ev, onTurn);
    return () => {
      window.removeEventListener(ev, onTurn);
      shown.current = null;
      setCompass(null);
    };
  }, [navOn, armed]);

  const arm = () => {
    if (!COMPASS || armed) return;
    const req = (globalThis.DeviceOrientationEvent as unknown as Permitting | undefined)
      ?.requestPermission;
    if (typeof req !== "function") {
      setArmed(true);
      return;
    }
    req
      .call(globalThis.DeviceOrientationEvent)
      .then((r) => {
        if (r === "granted") setArmed(true);
      })
      .catch(() => {
        /* refused, or not from a gesture: the dot stays a dot */
      });
  };

  return { deg: navOn ? pickHeading(s.gpsHeading, compass) : null, arm };
}
