import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./tokens.css";
import "./index.css";
// the W1 single-screen UI's own rules — this page is the only thing that
// renders them, and it is dev-only (M1)
import "./debug.css";
import App from "./debug/App.tsx";
import { t } from "./i18n/t";
import { debugLog, installDebugOverlay } from "./debug";

document.title = t("app.name");
debugLog.current = installDebugOverlay(true);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
