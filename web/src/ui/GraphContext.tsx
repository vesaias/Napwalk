import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { Graph } from "../router/graph";

// The routing graph, reachable from anywhere in the tree and reachable from
// nowhere in React's own bookkeeping.
//
// React 19's DEVELOPMENT build writes a Performance-panel entry for every
// component render, and to label that entry `addObjectDiffToProperties`
// (react-dom_client.js:2443) deep-walks the previous and the next props. A
// prop holding a `Graph` — eight typed arrays over up to 738k edges, 389k
// geometry points, and a circuit catalog of several thousand objects each
// with its own number arrays — makes that walk block the main thread for
// 12 s on Frankfurt and past 150 s, with V8 near-heap-limit interrupts, on
// Hamburg. StrictMode's double effect does it twice. The production bundle
// has none of this instrumentation and boots the same city in ~2 s.
// (Measured in the Task 16 review, Part 2.)
//
// A plain context would not help: a Provider's `value` is a prop like any
// other, and so is the `graph` a `GraphProvider` component would take. So
// the graph sits in a module-level box React never looks inside, and the
// context carries only a **version number** — one primitive, one comparison.
//
// The rule this file exists to enforce: no React component takes the graph
// as a prop. Hooks may still take it as an argument (a hook's arguments are
// not a fiber's props).

const box: { graph: Graph | null } = { graph: null };
let version = 0;

/** Put a graph in the box; return the version that names it. Idempotent —
 *  the same graph twice (StrictMode's double render) is one version. */
function publish(graph: Graph | null): number {
  if (box.graph !== graph) {
    box.graph = graph;
    version += 1;
  }
  return version;
}

/** The stamp for a graph: hand it to `GraphProvider`. Held in a `useMemo`
 *  keyed on identity, so the box is written only when the graph changes.
 *
 *  `revision` is `ui/useShadeBands.ts`'s counter (artifact v8, backlog B11).
 *  A shade band landing mutates the store INSIDE the graph and deliberately
 *  does not replace the graph object — a Graph that changed identity would
 *  be a new value for React to walk, which is the whole reason this file
 *  exists. So the band count rides on the stamp instead, and every
 *  `useGraph()` reader re-renders when a minute becomes priceable. */
export function useGraphStamp(graph: Graph | null, revision = 0): number {
  const base = useMemo(() => publish(graph), [graph]);
  return base * 1e6 + revision;
}

const StampCtx = createContext(0);

/** Wrap the tree that reads the graph. The only thing crossing the boundary
 *  is `stamp`, a number — see the note above for why that matters. */
export function GraphProvider({ stamp, children }: { stamp: number; children: ReactNode }) {
  return <StampCtx.Provider value={stamp}>{children}</StampCtx.Provider>;
}

/** The graph the shell has loaded, or null while it is loading or failed.
 *  Reading the stamp is what re-renders the caller when a graph arrives. */
export function useGraph(): Graph | null {
  useContext(StampCtx);
  return box.graph;
}

/** The stamp itself — for a `useMemo` that prices a minute.
 *
 *  The graph object does NOT change identity when a shade band lands (the
 *  store is mutated in place, see above), so a memo keyed on `[graph, …]`
 *  alone never recomputes and a figure that could not be worked out at first
 *  ask stays missing for ever. The stamp is the only dependency that says "a
 *  minute that could not be priced can be now" (S8 review F2). */
// eslint-disable-next-line react-refresh/only-export-components
export function useGraphRevision(): number {
  return useContext(StampCtx);
}

/** For tests: the stamp function on its own, with the box it writes to. */
export const __testing = { publish, peek: () => box.graph };
