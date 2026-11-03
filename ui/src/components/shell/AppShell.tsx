import { Menu, Monitor, Moon, Sun, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { setLocale, useLocale, type Locale } from "../../i18n/locale";
import { cn } from "../../lib/cn";
import { PAGES_BUILD } from "../../lib/build";
import { DEMO_NOW_MS, formatDateTime } from "../../lib/format";
import { isHistoryRoute, isLocalRoute, type Route } from "../../lib/router";
import { useTheme, type ThemePreference } from "../../lib/theme";
import { useRadioGroupKeys } from "../ui/atelier";
import { SERVICE_STATUS_SCOPE, ServiceStatus } from "./ServiceStatus";

/**
 * The FlowAssert mark — evidence trace: an open source node and a solid destination node joined
 * by a trace, crossed by the indigo assertion tick where the comparison happens.
 * Below 20px a simplified, heavier construction is used so it holds at favicon/rail size.
 */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  const small = size < 20;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className={cn("shrink-0", className)}>
      {small ? (
        <>
          <rect x="2.5" y="8" width="7" height="8" rx="1.2" fill="none" stroke="var(--fa-ink)" strokeWidth="2.4" />
          <rect x="15" y="7.5" width="7.5" height="9" rx="1.5" fill="var(--fa-ink)" />
          <path d="M12.25 4.5v15" stroke="var(--fa-brand)" strokeWidth="3" strokeLinecap="round" />
        </>
      ) : (
        <>
          <rect x="2.75" y="8.75" width="6.5" height="6.5" rx="1" fill="none" stroke="var(--fa-ink)" strokeWidth="1.75" />
          <rect x="15" y="8.5" width="7" height="7" rx="1.25" fill="var(--fa-ink)" />
          <path d="M9.5 12h5.5" stroke="var(--fa-ink)" strokeWidth="1.75" />
          <path d="M12.25 6.5v11" stroke="var(--fa-brand)" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <Logo size={26} />
      <span className="font-display text-[23px] leading-none tracking-[-0.01em] text-ink">
        Flow<i className="text-ink-2">Assert</i>
      </span>
    </span>
  );
}

interface NavItem {
  n: string;
  label: string;
  href: string;
  match: (r: Route) => boolean;
}

/** The CSV check: files compared in this browser; nothing is sent. */
const CHECK_NAV: NavItem[] = [{ n: "00", label: "CSV check", href: "#/check", match: (r: Route) => r.name === "check" }];
/** The product: pages that read the local Python service (LOCAL_RESEARCH). */
const NAV: NavItem[] = [
  { n: "01", label: "Overview", href: PAGES_BUILD ? "#/overview" : "#/", match: (r: Route) => r.name === "workspace" },
  {
    n: "02",
    label: "Verifications",
    href: "#/verifications",
    match: (r: Route) => r.name === "local-verifications" || r.name === "local-verification" || r.name === "local-lookup",
  },
  // Phase 3A: archived evaluations from the Service's local SQLite archive.
  { n: "03", label: "History", href: "#/local/history", match: isHistoryRoute },
  // Not implemented: the page says so and offers no action.
  { n: "04", label: "Capture runs", href: "#/capture", match: (r: Route) => r.name === "capture" },
];
/** Configuration pages: synthetic, nothing connected. */
const DEMO_NAV: NavItem[] = [
  { n: "05", label: "Connections", href: "#/connections", match: (r: Route) => r.name === "connections" },
  { n: "06", label: "Rules", href: "#/rules", match: (r: Route) => r.name === "rules" },
  { n: "07", label: "Settings", href: "#/settings", match: (r: Route) => r.name === "settings" || r.name === "states" },
];
/** The MOCK demo: synthetic fixtures, nothing read from any service. */
const MOCK_NAV: NavItem[] = [
  { n: "08", label: "Demo overview", href: "#/demo", match: (r: Route) => r.name === "demo-overview" },
  { n: "09", label: "Demo runs", href: "#/demo/verifications", match: (r: Route) => r.name === "demo-verifications" || r.name === "demo-verification" },
];

function NavItems({ items, route, onNavigate }: { items: NavItem[]; route: Route; onNavigate?: () => void }) {
  return (
    <ul className="grid gap-0.5">
      {items.map((item) => {
        const active = item.match(route);
        return (
          <li key={item.label}>
            <a
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mx-2 grid h-10 grid-cols-[26px_1fr] items-center rounded-sm px-2 text-[13.5px] transition-colors duration-(--fa-dur-fast) lg:h-9",
                active ? "bg-nav-active text-ink ring-1 ring-line" : "text-ink-2 hover:bg-hover hover:text-ink",
              )}
            >
              <span aria-hidden data-ornament className={cn("font-mono text-[10.5px]", active ? "text-brand" : "text-ink-4")}>
                {item.n}
              </span>
              {item.label}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function NavList({ route, onNavigate }: { route: Route; onNavigate?: () => void }) {
  return (
    <>
    {/* The CSV check has its own landmark, so the Primary navigation keeps the pages it always listed. */}
    <nav aria-label="Browser check" className="mb-5">
      <p className="kicker mb-1 flex items-center justify-between text-ink-3">
        Check <span className="rounded-[2px] bg-brand-soft px-1 text-[9px] tracking-[0.1em] text-brand-ink">browser</span>
      </p>
      <NavItems items={CHECK_NAV} route={route} onNavigate={onNavigate} />
    </nav>
    <nav aria-label="Primary">
      <p id="nav-local" className="kicker mb-1 flex items-center justify-between text-ink-3">
        Workspace <span className="rounded-[2px] bg-brand-soft px-1 text-[9px] tracking-[0.1em] text-brand-ink">{PAGES_BUILD ? "local only" : "local"}</span>
      </p>
      <div aria-labelledby="nav-local">
        <NavItems items={NAV} route={route} onNavigate={onNavigate} />
      </div>
      <p id="nav-demo" className="kicker mt-5 mb-1 flex items-center justify-between text-ink-3">
        Configure <span className="rounded-[2px] border border-dashed border-line-strong px-1 text-[9px] tracking-[0.1em] text-ink-3">demo</span>
      </p>
      <div aria-labelledby="nav-demo">
        <NavItems items={DEMO_NAV} route={route} onNavigate={onNavigate} />
      </div>
      <p id="nav-mock" className="kicker mt-5 mb-1 flex items-center justify-between text-ink-3">
        Demo register <span className="rounded-[2px] border border-dashed border-line-strong px-1 text-[9px] tracking-[0.1em] text-ink-3">mock</span>
      </p>
      <div aria-labelledby="nav-mock">
        <NavItems items={MOCK_NAV} route={route} onNavigate={onNavigate} />
      </div>
    </nav>
    </>
  );
}

function ThemeSwitch() {
  const { preference, setPreference } = useTheme();
  const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Paper (light)", icon: Sun },
    { value: "dark", label: "Night ledger (dark)", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];
  const keys = useRadioGroupKeys(options, preference, setPreference);
  return (
    <div ref={keys.ref} role="radiogroup" aria-label="Theme" onKeyDown={keys.onKey} className="flex rounded-sm border border-line p-0.5">
      {options.map((o) => {
        const Icon = o.icon;
        const active = preference === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            aria-label={o.label}
            title={o.label}
            onClick={() => setPreference(o.value)}
            className={cn(
              "grid h-7 w-8 place-items-center rounded-xs transition-colors duration-(--fa-dur-fast)",
              active ? "bg-ink text-canvas" : "text-ink-3 hover:text-ink",
            )}
          >
            <Icon size={13} strokeWidth={1.75} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

function LocaleSwitch() {
  const locale = useLocale();
  const options: { value: Locale; label: string; short: string }[] = [
    { value: "en", label: "English", short: "EN" },
    { value: "zh-CN", label: "简体中文", short: "中文" },
  ];
  const keys = useRadioGroupKeys(options, locale, (value: Locale) => setLocale(value));
  return (
    <div ref={keys.ref} role="radiogroup" aria-label="Language" onKeyDown={keys.onKey} className="flex rounded-sm border border-line p-0.5">
      {options.map((o) => {
        const active = locale === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            aria-label={o.label}
            title={o.label}
            onClick={() => setLocale(o.value)}
            className={cn(
              "grid h-7 min-w-8 place-items-center rounded-xs px-1.5 font-mono text-[10px] transition-colors duration-(--fa-dur-fast)",
              active ? "bg-ink text-canvas" : "text-ink-3 hover:text-ink",
            )}
          >
            {o.short}
          </button>
        );
      })}
    </div>
  );
}

type Register = "local" | "demo" | "check";

function RailFooter({ register }: { register: Register }) {
  const local = register === "local";
  return (
    <div className="grid gap-3">
      <div className="rounded-sm border border-dashed border-line-strong px-3 py-2.5 text-xs leading-[1.45] text-ink-3">
        {register === "check" ? (
          <>
            <p className="kicker mb-0.5 text-ink-2">Browser check register</p>
            Your files are read in this browser and never sent. Nothing you choose is stored.
          </>
        ) : PAGES_BUILD && local ? (
          <>
            <p className="kicker mb-0.5 text-ink-2">Local research register</p>
            These pages read a local Service and work only locally. This online demo has none.
          </>
        ) : local ? (
          <>
            <p className="kicker mb-0.5 text-ink-2">Local research register</p>
            LOCAL_RESEARCH: read from the local Python service. Synthetic input. Configure and Demo pages stay MOCK.
          </>
        ) : (
          <>
            <p className="kicker mb-0.5 text-ink-2">Demo register</p>
            Synthetic records from the research contract. No live n8n or HubSpot.
          </>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-ink-3">v1.0</span>
        <LocaleSwitch />
      </div>
      <div className="flex justify-end">
        <ThemeSwitch />
      </div>
    </div>
  );
}

function TopBar({ crumbs, register }: { crumbs: ReactNode; register: Register }) {
  const [open, setOpen] = useState(false);
  const local = register === "local";
  return (
    <div className="border-b border-line">
      <div className="flex min-h-[52px] items-center justify-between gap-4 py-2">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-baseline gap-2.5 text-[12.5px] text-ink-3">
          {crumbs}
        </nav>
        <section aria-label={register === "check" ? "Browser check register" : local ? "Local research register" : "Demo register"} className="flex shrink-0 items-center gap-4">
          {register === "check" ? (
            <span className="hidden font-mono text-[11px] text-ink-3 sm:inline">files stay on this computer</span>
          ) : local && PAGES_BUILD ? (
            <span className="font-mono text-[11px] text-ink-3">works only locally</span>
          ) : local ? (
            <ServiceStatus />
          ) : (
            <span className="hidden font-mono text-[11px] text-ink-3 sm:inline">
              clock fixed · <span className="text-ink-2">{formatDateTime(new Date(DEMO_NOW_MS).toISOString())}</span>
            </span>
          )}
          <button
            type="button"
            aria-expanded={open}
            aria-controls="demo-details"
            onClick={() => setOpen((v) => !v)}
            className="fa-hit rounded-xs text-xs font-medium text-ink-2 underline decoration-line-strong underline-offset-[3px] hover:text-ink"
          >
            {open ? "Hide" : "What’s real?"}
          </button>
        </section>
      </div>
      <section
        id="demo-details"
        aria-label={register === "check" ? "What is real in the CSV check" : local ? "What is real on the local research pages" : "What is real in this demo"}
        hidden={!open}
        className="fade-in border-t border-line py-4"
      >
        {register === "check" ? (
          <dl className="grid gap-4 text-xs leading-[1.5] text-ink-2 sm:grid-cols-3">
            <div>
              <dt className="mb-1 font-semibold text-ink">Real on this page</dt>
              <dd>Your own files, read in this browser by the rules of flowassert-verify. The JSON and HTML reports are the command line’s, byte for byte.</dd>
            </div>
            <div>
              <dt className="mb-1 font-semibold text-ink">Stated by you</dt>
              <dd>Completeness statements and counts. FlowAssert records them in the report and does not check them.</dd>
            </div>
            <div>
              <dt className="mb-1 font-semibold text-ink">Not shown or proven</dt>
              <dd>That a workflow ran, that the source is true, that a file came from where you say, or that a record existed by a past deadline.</dd>
            </div>
          </dl>
        ) : local ? (
          <dl className="grid gap-4 text-xs leading-[1.5] text-ink-2 sm:grid-cols-3">
            <div>
              <dt className="mb-1 font-semibold text-ink">Real on these pages</dt>
              <dd>
                HTTP reads of the accepted local Python service on 127.0.0.1:8765. Verdicts, record results and evidence references are the pinned evaluator’s, copied
                unchanged. The status beside this link is the newest read’s outcome: {SERVICE_STATUS_SCOPE}
              </dd>
            </div>
            <div>
              <dt className="mb-1 font-semibold text-ink">Still synthetic</dt>
              <dd>The five reviewed input fixtures and their mapped times (synthetic origin, 60 s per tick). The evaluator is an unapproved research version; authorization is research_only.</dd>
            </div>
            <div>
              <dt className="mb-1 font-semibold text-ink">Not shown or proven</dt>
              <dd>No capture run, no evidence admission, no live n8n or HubSpot read, no authenticated evidence, no real customer verification, no workflow causality, no release approval. The Configure and Demo pages are the MOCK demo.</dd>
            </div>
          </dl>
        ) : (
        <dl className="grid gap-4 text-xs leading-[1.5] text-ink-2 sm:grid-cols-3">
          <div>
            <dt className="mb-1 font-semibold text-ink">Exists in research</dt>
            <dd>The four-state model, rule outcomes, cohort aggregation and premise-evidence checks — an offline Python model run on synthetic fixtures.</dd>
          </div>
          <div>
            <dt className="mb-1 font-semibold text-ink">Mocked in this UI</dt>
            <dd>Workflows, run IDs, wall-clock times, names, emails and digests. The email rule is a proposed extension of the phone rule.</dd>
          </div>
          <div>
            <dt className="mb-1 font-semibold text-ink">Not implemented</dt>
            <dd>n8n and HubSpot integrations, source connectors, authentication, scheduling and authenticated evidence acquisition. The Workspace pages read a local synthetic research service.</dd>
          </div>
        </dl>
        )}
      </section>
    </div>
  );
}

/** Tailwind's `lg` breakpoint, where the rail replaces the drawer. */
const DESKTOP_QUERY = "(min-width: 64rem)";

export function AppShell({ route, crumbs, children }: { route: Route; crumbs: ReactNode; children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const local = isLocalRoute(route);
  const register: Register = route.name === "check" ? "check" : local ? "local" : "demo";
  const closeRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!drawer) return;
    closeRef.current?.focus();
    // The drawer is modal. The page behind it is `inert` (see below), and Tab / Shift+Tab are cycled
    // here, on the document, so containment holds wherever focus is when the key is pressed: on a
    // drawer control, or on <body> after a click on non-interactive drawer space (WebKit then hands Tab
    // to the page). Focus is moved explicitly, so it also holds where the browser's own Tab order skips
    // links and buttons (Safari's default "Press Tab to highlight each item" off).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawer(false);
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      e.preventDefault();
      const i = focusable.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? focusable.length - 1 : i - 1) : i === -1 || i === focusable.length - 1 ? 0 : i + 1;
      // This is keyboard focus, so ask for the indicator: WebKit otherwise withholds :focus-visible from
      // script-moved focus when the drawer was opened with a pointer.
      focusable[next]!.focus({ focusVisible: true });
    };
    // The drawer exists only below `lg`. If the viewport widens past it while open (a tablet rotating),
    // close it rather than leave an invisible modal holding the scroll lock.
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const onWiden = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) setDrawer(false);
    };
    document.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onWiden);
    onWiden(desktop);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onWiden);
      document.body.style.overflow = previousOverflow;
      // Return focus to the menu button; at desktop widths it is hidden, so focus the main region instead.
      if (!desktop.matches) openRef.current?.focus();
      else document.getElementById("main")?.focus({ preventScroll: true });
    };
  }, [drawer]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[212px_minmax(0,1fr)]">
      <a href="#main" inert={drawer} className="sr-only z-50 rounded-sm bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>

      {/* The rail scrolls when the window is shorter than its contents, so its footer controls stay reachable. */}
      <aside inert={drawer} className="sticky top-0 hidden h-dvh flex-col gap-7 overflow-y-auto border-r border-line bg-[linear-gradient(180deg,var(--fa-canvas),var(--fa-surface-sunken))] px-[18px] pt-5 pb-4 lg:flex">
        <Wordmark />
        <div className="flex-1">
          <NavList route={route} />
        </div>
        <RailFooter register={register} />
      </aside>

      <header inert={drawer} className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-line bg-canvas/92 px-3 backdrop-blur-md lg:hidden">
        <Wordmark />
        <button
          ref={openRef}
          type="button"
          aria-label="Open navigation"
          aria-expanded={drawer}
          onClick={() => setDrawer(true)}
          className="grid size-10 place-items-center rounded-sm text-ink-2 hover:bg-hover"
        >
          <Menu size={18} strokeWidth={1.75} />
        </button>
      </header>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" aria-label="Close navigation" tabIndex={-1} className="absolute inset-0 bg-black/35" onClick={() => setDrawer(false)} />
          <div
            ref={panelRef}
            className="fade-in absolute inset-y-0 left-0 flex w-[min(290px,86vw)] flex-col gap-6 overflow-y-auto border-r border-line bg-canvas px-[18px] pt-3 pb-4 shadow-pop"
          >
            <div className="flex items-center justify-between">
              <Wordmark />
              <button ref={closeRef} type="button" aria-label="Close navigation" onClick={() => setDrawer(false)} className="grid size-10 place-items-center rounded-sm text-ink-2 hover:bg-hover">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1">
              <NavList route={route} onNavigate={() => setDrawer(false)} />
            </div>
            <RailFooter register={register} />
          </div>
        </div>
      )}

      <div inert={drawer} className="min-w-0 px-4 sm:px-8 xl:px-11">
        <TopBar crumbs={crumbs} register={register} />
        <main id="main" tabIndex={-1} className="mx-auto max-w-[1280px] pt-7 pb-16 outline-none focus-visible:shadow-none lg:pt-8">
          {children}
        </main>
      </div>
    </div>
  );
}
