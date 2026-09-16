import { t } from "../../../i18n/t";
import type { LngLat } from "../../../components/MapView";
import type { Place, SearchEnd } from "../../shellState";
import type { SearchStatus } from "../../useLookups";
import { Button, ListRow, LocateIcon, SearchBar } from "../../kit";
import { distanceM } from "../../geo";
import { km } from "../../time";

type SearchProps = {
  q: string;
  /** Which end of the walk this search is filling in (R4, 2026-09-06). The
   *  From field is the only one that can answer "where I am standing". */
  end: SearchEnd;
  results: Place[];
  /** How the query itself is going — loading, empty, failed, or none of
   *  those (QA F2-02/04/05). */
  status: SearchStatus;
  /** The city the results are ranked around, already translated. */
  cityName: string;
  /** Where "1.7 km" is measured from — the GPS fix or the chosen start. */
  from: LngLat | null;
  /** There is a fix, or one can still be asked for: without either, the
   *  "Your location" row is an answer the app cannot give. */
  canUseLocation: boolean;
  onChange: (q: string) => void;
  onBack: () => void;
  onClear: () => void;
  onPick: (p: Place) => void;
  /** The "Your location" row — From only. */
  onUseLocation: () => void;
  /** Ask the same question again after a failure. */
  onRetry: () => void;
};

/** No name from a geocoder is longer than this and still a name. The row
 *  ellipsises in CSS; this is the belt to that pair of braces — a hostile or
 *  buggy upstream can send a megabyte (QA F6-05), and a megabyte of text
 *  node is a layout cost even when none of it is visible. */
const MAX_NAME = 200;

/** "park" / "bus_stop" as OSM writes it, shown the way the mockup does:
 *  capitalised, underscores opened up. It is data, not UI copy — the same
 *  class of string as a street name. */
function kindLabel(kind: string): string {
  if (!kind) return "";
  const words = kind.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The full-page search: the query, Photon's results, and the note that
 *  a hit outside the city has no shade behind it
 *  (mockups/phone-search.html). */
export function Search({
  q,
  end,
  results,
  status,
  cityName,
  from,
  canUseLocation,
  onChange,
  onBack,
  onClear,
  onPick,
  onUseLocation,
  onRetry,
}: SearchProps) {
  return (
    <>
      {/* The bar comes FIRST in the DOM, and the results after it — the
          reading and tab order the screen actually has. It used to be the
          other way round (the page is absolutely positioned, so nothing on
          the phone showed it): Tab from the query landed on the ✕, where
          Enter wiped what had been typed, and the results were reachable
          only by Shift+Tab (UX sweep U9). On the web the card's own `order`
          rules keep the same visual arrangement (index.css, `.web-card >
          .shell-top`). */}
      <div className="shell-top">
        <SearchBar
          value={q}
          // The bar asks for the end it is filling in: "Where to?" over a
          // From field would be asking the wrong question.
          placeholder={end === "from" ? t("routes.from") : t("home.whereTo")}
          autoFocus
          onChange={onChange}
          onBack={onBack}
          onClear={onClear}
          backLabel={t("search.back")}
          clearLabel={t("search.clear")}
        />
      </div>

      <div className="shell-page">
        <div className="shell-results">
          {/* The one answer no geocoder has: where the reader is standing.
              Only over the From field, and only while there is a fix or a
              chance of one. */}
          {end === "from" && canUseLocation ? (
            <div className="search-mine">
              <ListRow
                avatar={<LocateIcon size={18} />}
                title={t("routes.yourLocation")}
                onClick={onUseLocation}
              />
            </div>
          ) : null}
          {results.map((p, i) => {
            const meta = [kindLabel(p.kind), p.district].filter(Boolean).join(" · ");
            const name = p.name.slice(0, MAX_NAME);
            const away = from ? t("card.km", { km: km(distanceM(from, [p.lng, p.lat])) }) : undefined;
            return (
              <ListRow
                key={`${p.name}|${p.lng}|${p.lat}|${i}`}
                avatar={name.slice(0, 1).toUpperCase()}
                title={name}
                meta={meta || undefined}
                metaTone={p.inCity ? "muted" : "warn"}
                right={away}
                onClick={() => onPick(p)}
              />
            );
          })}
        </div>
        {status === "loading" ? <p className="shell-state">{t("search.loading")}</p> : null}
        {status === "empty" ? <p className="shell-state">{t("search.noResults")}</p> : null}
        {status === "error" ? (
          <div className="shell-state shell-state--error">
            <span>{t("search.failed")}</span>
            <Button variant="smallSecondary" onClick={onRetry}>
              {t("actions.retry")}
            </Button>
          </div>
        ) : null}
        <p className="shell-note">{t("search.outsideNote", { city: cityName })}</p>
      </div>
    </>
  );
}
