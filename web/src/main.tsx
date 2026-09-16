import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./tokens.css";
import "./index.css";
import AppShell from "./ui/AppShell.tsx";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { t } from "./i18n/t";
import { debugLog, installDebugOverlay } from "./debug";
import { watchFocusSource } from "./ui/focusSource";

document.title = t("app.name");
debugLog.current = installDebugOverlay();
// Which device moved the focus, for the three selectors that care (item 10).
// At import, once, outside React: it is a property of the document, not of
// any component, and StrictMode would install it twice from an effect.
watchFocusSource();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  </StrictMode>
);
