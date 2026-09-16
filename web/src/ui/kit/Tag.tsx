import type { ReactNode } from "react";

export type TagVariant = "acc" | "quiet" | "well";

type TagProps = {
  variant: TagVariant;
  children: ReactNode;
};

/** The small 12 px badge on a card: "Recommended" (acc), "Quieter" (quiet),
 *  "Faster" / "Park loop" (well). */
export function Tag({ variant, children }: TagProps) {
  return <span className={`kit-tag kit-tag--${variant}`}>{children}</span>;
}
