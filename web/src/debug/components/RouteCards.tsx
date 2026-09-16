import { t } from "../../i18n/t";
import type { RouteStats } from "../../router/stats";

type Props = {
  stats: RouteStats[];
  laps: (number | null)[]; // laps in a park circuit, or null for a round walk
  kinds: (string | null)[]; // "laps" | "eight" | "promenade" | null (fallback round walk)
  selected: number;
  onSelect: (i: number) => void;
};

// F5: the card is the trust surface — minutes big, the rest one quiet line.
export default function RouteCards({ stats, laps, kinds, selected, onSelect }: Props) {
  if (stats.length === 0) return null;
  return (
    <div className="route-cards">
      {stats.map((s, i) => (
        <button
          key={i}
          className="route-card"
          aria-pressed={i === selected}
          onClick={() => onSelect(i)}
        >
          <span className="route-card-minutes">
            {t("card.minutes", { min: s.minutes })}
          </span>
          <span className="route-card-kind">
            {kinds[i] === "promenade"
              ? t("card.promenade")
              : laps[i] === null
                ? t("card.loop")
                : laps[i] === 1
                  ? t("card.lap1")
                  : t("card.laps", { n: laps[i] })}
          </span>
          <span className="route-card-line">
            {t("card.stats", {
              km: s.km,
              shade: s.shadePct,
              quiet: s.quietPct,
              cobble: s.cobbleM,
            })}
          </span>
        </button>
      ))}
    </div>
  );
}
