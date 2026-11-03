import { lazy, Suspense, useEffect, useRef } from "react";
import { AppShell } from "./components/shell/AppShell";
import { RenderBoundary } from "./components/shell/RenderBoundary";
import { EmptyState, Panel, buttonClass } from "./components/ui/primitives";
import { getRun } from "./data/store";
import { useLocation, type Route } from "./lib/router";
import { Connections } from "./pages/Connections";
import { HistoryEntry, HistoryList } from "./pages/History";
import { Overview } from "./pages/Overview";
import { Rules } from "./pages/Rules";
import { Settings } from "./pages/Settings";
import { LocalVerificationDetail, VerificationDetail } from "./pages/VerificationDetail";
import { Verifications } from "./pages/Verifications";
import { CaptureRuns, WorkspaceOverview, WorkspaceVerifications } from "./pages/Workspace";

// The interface-state specimens are a reference page few visits open; keep them out of the main bundle.
const States = lazy(() => import("./pages/States").then((m) => ({ default: m.States })));
// The CSV check carries the offline checker (evaluator, CSV reader, Unicode tables); only its own visits load it.
const Check = lazy(() => import("./pages/Check").then((m) => ({ default: m.Check })));

const TITLES: Record<string, string> = {
  check: "CSV check — FlowAssert",
  workspace: "Overview — FlowAssert",
  capture: "Capture runs — FlowAssert",
  "demo-overview": "Demo overview — FlowAssert",
  "demo-verifications": "Demo runs — FlowAssert",
  connections: "Connections — FlowAssert",
  rules: "Rules — FlowAssert",
  settings: "Settings — FlowAssert",
  states: "Interface states — FlowAssert",
  "local-verifications": "Verifications — FlowAssert",
  "local-history": "History — Local research — FlowAssert",
  "not-found": "Not found — FlowAssert",
};

function Crumbs({ route }: { route: Route }) {
  switch (route.name) {
    case "check":
      return (
        <>
          <b className="font-semibold text-ink">CSV check</b>
          <span className="truncate">in this browser · your files stay on this computer</span>
        </>
      );
    case "workspace":
      return (
        <>
          <b className="font-semibold text-ink">Overview</b>
          <span className="truncate">LOCAL_RESEARCH · local Service archive · synthetic</span>
        </>
      );
    case "capture":
      return (
        <>
          <b className="font-semibold text-ink">Capture runs</b>
          <span className="truncate">not implemented in this build</span>
        </>
      );
    case "demo-overview":
      return (
        <>
          <b className="font-semibold text-ink">Demo overview</b>
          <span className="truncate">MOCK · lead synchronisation · n8n → HubSpot</span>
        </>
      );
    case "demo-verifications":
      return (
        <>
          <b className="font-semibold text-ink">Demo runs</b>
          <span className="truncate">MOCK · synthetic fixtures</span>
        </>
      );
    case "demo-verification":
      return (
        <>
          <a href="#/demo/verifications" className="fa-hit hover:text-ink">
            Demo runs
          </a>
          <span aria-hidden>/</span>
          <b className="mono-id font-medium text-ink">{route.id}</b>
          <span className="hidden truncate sm:inline">{getRun(route.id)?.workflow.name}</span>
        </>
      );
    case "connections":
    case "rules":
    case "settings":
      return (
        <>
          <b className="font-semibold text-ink capitalize">{route.name}</b>
          <span className="truncate">Demo configuration · nothing connected</span>
        </>
      );
    case "local-verifications":
      return (
        <>
          <b className="font-semibold text-ink">Verifications</b>
          <span className="truncate">LOCAL_RESEARCH · synthetic · unapproved research version</span>
        </>
      );
    case "local-verification":
      return (
        <>
          <a href="#/verifications" className="fa-hit hover:text-ink">
            Verifications
          </a>
          <span aria-hidden>/</span>
          <b className="mono-id font-medium text-ink">{route.id}</b>
          <span className="hidden truncate sm:inline">LOCAL_RESEARCH · synthetic</span>
        </>
      );
    case "local-lookup":
      return (
        <>
          <a href="#/verifications" className="fa-hit hover:text-ink">
            Verifications
          </a>
          <span aria-hidden>/</span>
          <b className="mono-id truncate font-medium text-ink" title={route.malformed ? undefined : route.id}>
            {route.malformed ? "Exact-ID lookup" : route.id}
          </b>
          <span className="hidden truncate sm:inline">exact-ID lookup · LOCAL_RESEARCH · synthetic</span>
        </>
      );
    case "local-history":
      return (
        <>
          <b className="font-semibold text-ink">History</b>
          <span className="truncate">LOCAL_RESEARCH · local SQLite archive · synthetic</span>
        </>
      );
    case "local-history-entry":
      return (
        <>
          <a href="#/local/history" className="fa-hit hover:text-ink">
            History
          </a>
          <span aria-hidden>/</span>
          <b className="mono-id font-medium text-ink" title={route.id}>
            {route.id.length > 22 ? `${route.id.slice(0, 13)}…${route.id.slice(-4)}` : route.id}
          </b>
          <span className="hidden truncate sm:inline">archived evaluation · LOCAL_RESEARCH</span>
        </>
      );
    case "states":
      return (
        <>
          <a href="#/settings" className="fa-hit hover:text-ink">
            Settings
          </a>
          <span aria-hidden>/</span>
          <b className="font-semibold text-ink">Interface states</b>
          <span className="hidden truncate sm:inline">Simulated · nothing requested</span>
        </>
      );
    default:
      return <b className="font-semibold text-ink">Not found</b>;
  }
}

export function App() {
  const location = useLocation();
  const { route } = location;
  const lastPath = useRef(location.path);

  // On real navigation (path change, not filter/selection change): reset scroll and move focus to main.
  useEffect(() => {
    if (lastPath.current === location.path) return;
    lastPath.current = location.path;
    window.scrollTo({ top: 0 });
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [location.path]);

  useEffect(() => {
    if (route.name !== "demo-verification" && route.name !== "local-verification" && route.name !== "local-lookup" && route.name !== "local-history-entry") document.title = TITLES[route.name] ?? "FlowAssert";
  }, [route.name]);

  return (
    <AppShell route={route} crumbs={<Crumbs route={route} />}>
      <RenderBoundary key={location.path}>
      {route.name === "check" && (
        <Suspense fallback={<p role="status" className="kicker">Opening the CSV check…</p>}>
          <Check />
        </Suspense>
      )}
      {route.name === "workspace" && <WorkspaceOverview />}
      {route.name === "capture" && <CaptureRuns />}
      {route.name === "demo-overview" && <Overview />}
      {route.name === "demo-verifications" && <Verifications location={location} />}
      {route.name === "demo-verification" && <VerificationDetail key={route.id} id={route.id} location={location} />}
      {route.name === "connections" && <Connections location={location} />}
      {route.name === "rules" && <Rules location={location} />}
      {route.name === "settings" && <Settings />}
      {route.name === "local-verifications" && <WorkspaceVerifications />}
      {route.name === "local-verification" && <LocalVerificationDetail key={route.id} id={route.id} malformed={route.malformed} location={location} />}
      {route.name === "local-lookup" && <LocalVerificationDetail key={route.malformed ? `lookup-malformed:${route.id}` : `lookup:${route.id}`} id={route.id} malformed={route.malformed} location={location} addressing="query" />}
      {route.name === "local-history" && <HistoryList location={location} />}
      {route.name === "local-history-entry" && <HistoryEntry key={route.id} id={route.id} location={location} />}
      {route.name === "states" && (
        <Suspense fallback={<p role="status" className="kicker">Opening interface-state specimens…</p>}>
          <States />
        </Suspense>
      )}
      {route.name === "not-found" && (
        <Panel>
          <EmptyState headingLevel={1} title="Page not found" body="This address does not exist." action={<a className={buttonClass()} href="#/">Back to overview</a>} />
        </Panel>
      )}
      </RenderBoundary>
    </AppShell>
  );
}
