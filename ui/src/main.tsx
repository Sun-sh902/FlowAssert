import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RenderBoundary } from "./components/shell/RenderBoundary";
import { pageLocale } from "./i18n/locale";
import { startLocalizer } from "./i18n/localizer";
import { applyInitialPrefs } from "./lib/prefs";
import { applyInitialTheme } from "./lib/theme";
import { DEMO_RUNS } from "./mocks/fixtures";
import { validateDemoRuns } from "./mocks/validate";
import "./styles/index.css";

applyInitialTheme();
applyInitialPrefs();
if (pageLocale() === "zh-CN") {
  document.documentElement.lang = "zh-CN";
  startLocalizer();
}

const root = createRoot(document.getElementById("root")!);

const problems = import.meta.env.DEV ? validateDemoRuns(DEMO_RUNS) : [];
if (problems.length) {
  console.error("Demo fixtures are internally inconsistent:", problems);
  root.render(
    <pre style={{ padding: 24, color: "crimson", whiteSpace: "pre-wrap" }}>
      {"Demo fixtures are internally inconsistent:\n\n" + problems.join("\n")}
    </pre>,
  );
} else {
  if (import.meta.env.DEV) console.info(`Demo fixtures consistent: ${DEMO_RUNS.length} runs checked.`);
  root.render(
    <StrictMode>
      <RenderBoundary>
        <App />
      </RenderBoundary>
    </StrictMode>,
  );
}
