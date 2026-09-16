import { t } from "../../i18n/t";

// F7 walk view chrome: exit + re-center. No voice, no turns, no rerouting.
type Props = {
  hasFix: boolean;
  following: boolean;
  onRecenter: () => void;
  onExit: () => void;
};

export default function WalkBar({ hasFix, following, onRecenter, onExit }: Props) {
  return (
    <div className="walk-bar">
      {!hasFix && <span className="walk-status">{t("walk.waiting")}</span>}
      {hasFix && !following && (
        <button className="shade-toggle" onClick={onRecenter}>
          {t("walk.recenter")}
        </button>
      )}
      <button className="shade-toggle walk-exit" aria-pressed onClick={onExit}>
        {t("walk.exit")}
      </button>
    </div>
  );
}
