import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RenderBoundary } from "./components/shell/RenderBoundary";
import { applyInitialPrefs } from "./lib/prefs";
import { applyInitialTheme } from "./lib/theme";
import { DEMO_RUNS } from "./mocks/fixtures";
import { validateDemoRuns } from "./mocks/validate";
import "./styles/index.css";

applyInitialTheme();
applyInitialPrefs();
// 1.0 kept a chosen interface language here; from 1.1.0 the interface is English only, so the choice is cleared.
try {
  localStorage.removeItem("flowassert.locale");
} catch {
  /* storage unavailable: nothing was kept */
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
