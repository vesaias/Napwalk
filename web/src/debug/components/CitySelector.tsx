import { CITIES, type CityId } from "../../cities";
import { t } from "../../i18n/t";

// Cities without an artifact are listed but disabled — the list is the
// roadmap, and a disabled row is honest where a row that silently fails is
// not (2026-08-30).
type Props = {
  city: CityId;
  onCity: (c: CityId) => void;
};

export default function CitySelector({ city, onCity }: Props) {
  return (
    <label className="city-select" title={t("city.label")}>
      <span className="visually-hidden">{t("city.label")}</span>
      <select value={city} onChange={(e) => onCity(e.target.value as CityId)}>
        {CITIES.map((c) => (
          <option key={c.id} value={c.id} disabled={!c.available}>
            {t(`city.${c.id}`)}
            {c.available ? "" : ` · ${t("city.soon")}`}
          </option>
        ))}
      </select>
    </label>
  );
}
