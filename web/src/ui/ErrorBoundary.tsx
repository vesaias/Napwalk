import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n/t";
import { componentOf, track } from "./analytics";
import { Button } from "./kit";

type Props = { children: ReactNode };
type State = { failed: boolean };

/** The last thing between a thrown render and a white page.
 *
 *  QA F6-01 (2026-09-06): one bad coordinate from Photon threw inside a
 *  MapView effect, React unmounted the whole tree, and the walker was left
 *  with a blank document — no message, no way back but the browser's own
 *  reload button. The coordinate is validated at the door now; this is the
 *  floor under everything that is not.
 *
 *  Deliberately tiny: no state to restore, no retry that re-renders the same
 *  crash. Reload is the honest offer. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("shell crashed:", error, info.componentStack);
    // The component's name and nothing else (ui/analytics.ts, 2026-09-16):
    // the message could carry a place name or a coordinate.
    track("error", { component: componentOf(info.componentStack) });
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="crash" role="alert">
        <p className="crash-text">{t("error.crashed")}</p>
        <Button onClick={() => location.reload()}>{t("actions.reload")}</Button>
      </div>
    );
  }
}
