import { t } from "../../../i18n/t";
import { LocateIcon, SearchBar } from "../../kit";

type HomeProps = {
  onSearch: () => void;
  /** Ask for the location (the first tap is what starts watchPosition). */
  onLocate: () => void;
};

/** The map with nothing on it but the search bar and the locate button —
 *  where the app opens (mockups/phone-home.html). */
export function Home({ onSearch, onLocate }: HomeProps) {
  return (
    <>
      <div className="shell-top">
        <SearchBar value="" placeholder={t("home.whereTo")} readOnly onFocus={onSearch} />
      </div>
      <div className="shell-float">
        <button type="button" className="shell-locate" aria-label={t("start.gps")} onClick={onLocate}>
          <LocateIcon size={22} />
        </button>
      </div>
    </>
  );
}
