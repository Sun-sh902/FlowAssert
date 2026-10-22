import { StrictMode, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

/*
 * FlowAssert Design Lab — isolated art-direction prototypes.
 * Each direction is lazy-loaded so its fonts and CSS only apply on its own routes.
 * The production app (index.html) is untouched.
 */
const COverview = lazy(() => import("./c/COverview").then((m) => ({ default: m.COverview })));
const CDetail = lazy(() => import("./c/CDetail").then((m) => ({ default: m.CDetail })));
const AOverview = lazy(() => import("./a/AOverview").then((m) => ({ default: m.AOverview })));
const ADetail = lazy(() => import("./a/ADetail").then((m) => ({ default: m.ADetail })));
const Brand = lazy(() => import("./brand/Brand").then((m) => ({ default: m.Brand })));

const ROUTES: Record<string, { title: string; el: ReactNode }> = {
  "/a/overview": { title: "A · Precision Instrument — Overview", el: <AOverview /> },
  "/a/detail": { title: "A · Precision Instrument — Verification detail", el: <ADetail /> },
  "/c/overview": { title: "C · Evidence Atelier — Overview", el: <COverview /> },
  "/c/detail": { title: "C · Evidence Atelier — Verification detail", el: <CDetail /> },
  "/brand": { title: "Brand, type & colour exploration", el: <Brand /> },
};

function Index() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 48, maxWidth: 760, color: "#1d1b16", background: "#f6f5f2", minHeight: "100vh" }}>
      <p style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#7b7567" }}>FlowAssert · design lab</p>
      <h1 style={{ fontSize: 28, margin: "8px 0 6px" }}>Art-direction concepts</h1>
      <p style={{ color: "#4b473e", marginBottom: 24 }}>
        Concept screens for review at 1440 × 900. Demo data from the production view models; nothing here is wired into the app.
      </p>
      <ul style={{ display: "grid", gap: 8, listStyle: "none", padding: 0 }}>
        {Object.entries(ROUTES).map(([path, r]) => (
          <li key={path}>
            <a href={`#${path}`} style={{ color: "#2f3590" }}>
              {r.title}
            </a>{" "}
            <code style={{ color: "#7b7567" }}>lab.html#{path}</code>
          </li>
        ))}
      </ul>
    </main>
  );
}

function Lab() {
  const [path, setPath] = useState(() => window.location.hash.replace(/^#/, "") || "/");
  useEffect(() => {
    const on = () => {
      setPath(window.location.hash.replace(/^#/, "") || "/");
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const route = ROUTES[path];
  useEffect(() => {
    document.title = route ? `${route.title} — FlowAssert lab` : "FlowAssert — Design lab";
  }, [route]);
  return <Suspense fallback={null}>{route ? route.el : <Index />}</Suspense>;
}

document.body.style.margin = "0";

createRoot(document.getElementById("lab-root")!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
);
