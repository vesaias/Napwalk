// Coming back after a tab discard (backlog B4, 2026-09-10) — the impure half.
//
// The ONLY module in the app that touches `sessionStorage`. It decides
// nothing: `snapshot` says what a page load leaves behind and `restore` says
// what a stored one is worth on this URL, both pure and both tested in
// resume.test.ts. What is left here is the wiring — when to write, and the
// four dispatches a restore is made of.
//
// The snapshot is read ONCE, at import, and not in an effect: MapView takes
// its camera in the map's constructor, which runs on the first mount, and a
// value that arrived a frame later would be a jump the reader can see.
// `location.search` is still the address bar's own at that point —
// `useHistory` rewrites it on the first render — so the URL a snapshot is
// matched against is the URL the reader reloaded.
//
// What is NOT here: a service worker. It would make the reload itself
// instant and it stays on the v1 cut list (CLAUDE.md); the URL, this
// snapshot and the memory the hidden tab gives back come first.
import { useCallback, useEffect, useRef } from "react";
import type { CityId } from "../cities";
import { debugLog } from "../debug";
import { BOOT_CITY } from "./boot";
import type { Snap } from "./kit/sheetSnap";
import {
  restore,
  screenId,
  snapshot,
  RESUME_KEY,
  type Camera,
  type Resume,
} from "./resume";
import { setSnap } from "./sheetSnapStore";
import { navigating, type Action, type ShellState } from "./shellState";

/** At most one write a second while the reader is working. The shell
 *  re-renders on every GPS fix and every clock tick, and a `JSON.stringify`
 *  plus a synchronous `sessionStorage` write on each of those is a stutter
 *  nobody asked for — the same reasoning `useHistory` applies to
 *  `replaceState`. Every hide flushes, so the throttle can never cost more
 *  than the last second of a session. */
const WRITE_MS = 1000;

function read(): Resume | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RESUME_KEY);
    if (raw === null) return null;
    // `BOOT_CITY` is the city this page load opens on — the link's, the
    // reader's stored one, or the clock's guess (ui/boot.ts). The edge may
    // still move it a moment later, but only on a first visit that carries
    // no link and no stored city, which is a page load no snapshot survives
    // to anyway.
    return restore(JSON.parse(raw), screenId(location.search), BOOT_CITY, Date.now());
  } catch {
    // A browser with storage switched off, or a value some other tab wrote
    // that is not JSON at all. Neither is worth a broken boot.
    return null;
  }
}

/** The snapshot this page load may come back from, or null for a fresh
 *  visit — a different URL, a stale snapshot, or nothing stored at all. */
export const BOOT_RESUME: Resume | null = read();

/** Said once per page load, not once per mount: React's dev StrictMode runs
 *  every effect twice, and a badge that said "resumed" twice would be a
 *  measurement of the dev build rather than of the app. */
let announced = false;

/** The camera the map should open on, for MapView's constructor. Null on a
 *  fresh visit, and then the city centre and the plan's own fit decide. */
export function bootCamera(): Camera | null {
  return BOOT_RESUME?.camera ?? null;
}

/**
 * Keep a snapshot of the view beside the URL, and put the view back from it
 * on a page load that follows one.
 *
 * `camera` is a getter rather than a value: the map publishes its camera on
 * every settled move, into a ref, and a pan must not re-render the shell
 * (ui/useMapCentre.ts).
 */
export type ResumeWiring = {
  /** The map's camera, on demand (ui/useMapCentre.ts). */
  camera: () => Camera | null;
  /** Subscribe to settled map moves. The throttle below hangs off it, so a
   *  pan — which changes no reducer state and no sheet rung — reaches the
   *  snapshot within `WRITE_MS` instead of waiting for a hide that a tab
   *  killed by the OS never gets (S6 review, finding 4). */
  onCameraMove: (fn: () => void) => () => void;
  /** The rung the sheet is at, or null when there is no sheet. */
  snap: Snap | null;
  /** The city the shell is showing — the snapshot's other half of "is this
   *  the same screen?" (S6 review, finding 1). */
  city: CityId;
  /** Is the map following the walker right now? */
  following: boolean;
  /** ...and how to re-arm it on a resumed walk (S6 review, finding 2). */
  setFollowing: (on: boolean) => void;
};

export function useResume(
  s: ShellState,
  dispatch: (a: Action) => void,
  w: ResumeWiring
): void {
  const { camera, onCameraMove, snap, city, following, setFollowing } = w;
  /** When the walk on screen began, for the next snapshot. */
  const startedAt = useRef(0);
  /** The write, always the current render's — the listeners below are
   *  registered once and must not save a stale render. */
  const save = useRef(() => {});
  save.current = () => {
    try {
      const r = snapshot(s, camera(), snap, {
        url: screenId(location.search),
        city,
        now: Date.now(),
        startedAt: startedAt.current,
        following,
      });
      window.sessionStorage.setItem(RESUME_KEY, JSON.stringify(r));
    } catch {
      // Storage off, or full. A reload then simply starts fresh, which is
      // exactly what this whole module is an improvement on.
    }
  };

  const walking = navigating(s);
  useEffect(() => {
    if (!walking) startedAt.current = 0;
    else if (startedAt.current === 0) {
      startedAt.current = BOOT_RESUME?.nav?.startedAt || Date.now();
    }
  }, [walking]);

  // --- coming back ---------------------------------------------------------
  // The fix first, because it is the only piece a screen can be missing
  // while it waits for something else: a Navigate screen with no walker on
  // it is a blank ETA bar for as long as the GPS watch takes to answer.
  // `useWalk` reads `s.gps` and does not care where it came from; the first
  // real fix overwrites this one — and a REFUSAL does not, since a refusal
  // is the watch stopping rather than the reader moving (shellState.ts,
  // `case "gps"`). A permission denied on the way back used to wipe this
  // fix and leave Navigate with no walker on it (P2, 2026-09-10).
  useEffect(() => {
    const r = BOOT_RESUME;
    if (!r) return;
    if (announced) return;
    announced = true;
    debugLog.current?.(
      `resumed: ${r.snap ?? "no sheet"}, r=${r.selected}` +
        `${r.camera ? `, z${r.camera.zoom.toFixed(1)}` : ""}${r.nav ? ", walking" : ""}`
    );
    if (r.nav?.lastFix) dispatch({ type: "gps", pos: r.nav.lastFix });
  }, [dispatch]);

  // …then the pick, the scrubbed minute and the walk, once the first plan
  // has landed. None of the three means anything before that: there is no
  // candidate list to index into, `replan` clears the scrub with every
  // answer, and `start` on a screen with no plan is a walk with no line.
  const applied = useRef(BOOT_RESUME === null);
  useEffect(() => {
    if (applied.current || s.computing) return;
    applied.current = true;
    const r = BOOT_RESUME!;
    if (s.plan && r.selected !== s.selected) dispatch({ type: "select", i: r.selected });
    if (r.scrub !== null) dispatch({ type: "scrub", min: r.scrub });
    // The URL carries the walk; that it was being WALKED is the one thing
    // it cannot say (`m=ab` opens the routes screen, never Navigate), so it
    // comes from here — and only with a plan under it, exactly as Start
    // itself waits for one (ui/useStartWalk.ts).
    if (r.nav?.walking && s.plan) {
      dispatch({ type: "start" });
      // ...and following it, when that is what the reader left. The camera
      // being preserved in the Navigate case IS the walk's own following
      // camera — z17, pointed along the route — so keeping it while the
      // walker walks out of frame preserved nothing (S6 review, finding 2,
      // and the ruling on deviation 9). Absent or false: the camera stays
      // exactly as it is, which is the reader's own panned view.
      if (r.following) setFollowing(true);
    }
  }, [s.computing, s.plan, s.selected, dispatch, setFollowing]);

  // …and the rung the sheet was at, once there IS a sheet. It mounts at the
  // rung its screen opens on and publishes that to the store; this moves it,
  // the same call the back gesture makes (ui/sheetSnapStore.ts).
  const snapped = useRef(!BOOT_RESUME?.snap);
  useEffect(() => {
    if (snapped.current || snap === null) return;
    snapped.current = true;
    const want = BOOT_RESUME!.snap!;
    if (snap !== want) setSnap(want);
  }, [snap]);

  // --- leaving -------------------------------------------------------------
  useEffect(() => {
    // `pagehide` is the one event a discarded tab is guaranteed to get; the
    // hidden half of `visibilitychange` is what an OS app switch raises
    // first, and is where the snapshot has to be already written, because
    // the discard itself comes without warning.
    const flush = () => save.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // …and a throttled write behind every change, so a tab that goes away
  // without either event still has a recent snapshot. Leading edge, with a
  // trailing timer, so nothing sits unwritten for longer than WRITE_MS.
  const wroteAt = useRef(0);
  const pending = useRef(0);
  const mark = useCallback(() => {
    const due = wroteAt.current + WRITE_MS - Date.now();
    if (due <= 0) {
      wroteAt.current = Date.now();
      save.current();
      return;
    }
    if (pending.current) return; // a trailing write is already armed
    pending.current = window.setTimeout(() => {
      pending.current = 0;
      wroteAt.current = Date.now();
      save.current();
    }, due);
  }, []);
  useEffect(
    () => () => {
      if (pending.current) window.clearTimeout(pending.current);
    },
    []
  );

  // Every reducer change and every sheet rung...
  useEffect(() => {
    mark();
  }, [s, snap, mark]);

  // ...and every settled map move, which is neither. The camera is the one
  // field this whole feature exists for, and it was the one field the
  // throttle could not see: a pan only reached storage on the next hide, so
  // a tab killed by the OS came back to a stale camera (S6 review, finding
  // 4). `onCameraMove` is the same `moveend` `useMapCentre` already hears.
  useEffect(() => onCameraMove(mark), [onCameraMove, mark]);
}
