import { ArrowRight, RotateCcw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { DemoStamp, PageHead, PrefRow, Segmented, Switch } from "../components/ui/atelier";
import { buttonClass, Tag } from "../components/ui/primitives";
import { Seal } from "../components/ui/status";
import { activeProvider, PROVIDERS } from "../data/provider";
import { clearRuleDraft } from "../data/ruleDraft";
import { runs } from "../data/store";
import { cn } from "../lib/cn";
import { DEMO_NOW_MS, formatDateTime } from "../lib/format";
import { resetPrefs, setPref, usePrefs } from "../lib/prefs";
import { resetThemePreference, useTheme, type ThemePreference } from "../lib/theme";

const SECTIONS = [
  { id: "set-theme", n: "§1", label: "Theme" },
  { id: "set-display", n: "§2", label: "Display" },
  { id: "set-a11y", n: "§3", label: "Accessibility" },
  { id: "set-demo", n: "§4", label: "Demo configuration" },
  { id: "set-account", n: "§5", label: "Account & security" },
];

function Index() {
  return (
    <nav aria-label="Settings sections" className="lg:sticky lg:top-8 lg:self-start">
      <p className="kicker mb-2">Contents</p>
      <ol className="fa-ledger">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="grid w-full grid-cols-[30px_1fr] items-baseline py-2 text-left text-sm text-ink-2 hover:text-ink"
            >
              <span aria-hidden data-ornament className="font-mono text-[10.5px] text-ink-4">
                {s.n}
              </span>
              {s.label}
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs leading-[1.5] text-ink-3">Stored in this browser only. Nothing here changes a verification result.</p>
    </nav>
  );
}

function Section({ id, n, title, aside, children }: { id: string; n: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-[1.5px] border-rule pb-2.5">
        <h2 id={`${id}-h`} className="serif flex items-baseline gap-3 text-2xl leading-8 text-ink">
          <span aria-hidden data-ornament className="font-mono text-[11px] tracking-normal text-ink-4">
            {n}
          </span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/* ---------- §1 Theme specimens ---------- */

const SPECIMEN_CELLS = "VVVVVVMVVVVVVVVVVVVVMVVVVVVVVVVVVVVVVMVVVVVVM".split("");

function Plate({ theme, compact = false }: { theme: "light" | "dark"; compact?: boolean }) {
  return (
    <div data-theme={theme} className={cn("fa-specimen-plate h-full", compact && "px-3")}>
      <p className="kicker">{compact ? "VR-2025" : "VR-2025 · 14:05 UTC"}</p>
      <p className={cn("display mt-2 leading-[1.05] text-ink", compact ? "text-[18px]" : "text-[22px]")}>
        <em className="text-mismatch-ink">4 of 48</em> contradict{compact ? "." : " the source."}
      </p>
      <div className="fa-cells mt-3 max-w-[200px]">
        {SPECIMEN_CELLS.slice(0, compact ? 14 : 45).map((c, i) => (
          <i key={i} className="fa-cell" data-s={c === "M" ? "Mismatch" : "Verified"} />
        ))}
      </div>
      <div className="mt-3">
        <Seal state="Mismatch" />
      </div>
    </div>
  );
}

function ThemeSpecimens() {
  const { preference, setPreference } = useTheme();
  const options: { value: ThemePreference; name: string; note: string }[] = [
    { value: "light", name: "Paper", note: "Warm paper, carbon ink" },
    { value: "dark", name: "Night ledger", note: "Composed, not inverted" },
    { value: "system", name: "System", note: "Follows the device" },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="grid gap-4 pt-5 sm:grid-cols-3">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={preference === o.value} onClick={() => setPreference(o.value)} className="fa-specimen">
          <div className="h-[168px] overflow-hidden">
            {o.value === "system" ? (
              <div className="grid h-full grid-cols-2">
                <Plate theme="light" compact />
                <Plate theme="dark" compact />
              </div>
            ) : (
              <Plate theme={o.value} />
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
            <span>
              <span className="serif block text-xl leading-6 text-ink">{o.name}</span>
              <span className="text-xs text-ink-3">{o.note}</span>
            </span>
            <span aria-hidden className={cn("grid size-[18px] place-items-center rounded-full border-[1.5px]", preference === o.value ? "border-ink" : "border-line-strong")}>
              {preference === o.value && <span className="size-2 rounded-full bg-ink" />}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ---------- Previews ---------- */

function CellPreview({ size }: { size: number }) {
  return (
    <div className="fa-cells" aria-hidden style={{ gap: size > 8 ? 3 : 2.5 }}>
      {["Verified", "Verified", "Mismatch", "Verified", "Pending", "Verified", "Unverified", "Verified", "Verified"].map((s, i) => (
        <i key={i} className="fa-cell" data-s={s} style={{ width: size, height: size }} />
      ))}
    </div>
  );
}

function DensityPreview({ compact }: { compact: boolean }) {
  return (
    <div aria-hidden className="w-[150px] border-y-[1.5px] border-rule">
      {[0, 1, 2].map((i) => (
        <div key={i} className={cn("flex items-center gap-2 border-t border-line first:border-0", compact ? "py-1" : "py-2")}>
          <span className="size-[7px] rounded-full bg-verified" />
          <span className="h-[5px] w-16 rounded-full bg-line" />
          <span className="ml-auto h-[5px] w-6 rounded-full bg-line-subtle" />
        </div>
      ))}
    </div>
  );
}

/* ---------- Page ---------- */

export function Settings() {
  const { density, cell, landing, motion, ring, pattern, underline } = usePrefs();
  const provider = activeProvider.mode;
  const [resetAt, setResetAt] = useState<number | null>(null);
  useEffect(() => {
    if (resetAt === null) return;
    const t = window.setTimeout(() => setResetAt(null), 5000);
    return () => window.clearTimeout(t);
  }, [resetAt]);
  const reset = () => {
    resetPrefs();
    resetThemePreference();
    clearRuleDraft();
    setResetAt(Date.now());
  };

  return (
    <div className="grid gap-12">
      <PageHead
        kicker="Settings · this browser only"
        title={
          <>
            How the evidence is drawn. <span className="text-ink-3">Nothing here changes what it says.</span>
          </>
        }
        lede="Display and accessibility preferences apply to this browser. Verification results, rules and states are not configurable here, and there are no accounts in this preview."
      />

      <div className="grid gap-x-14 gap-y-10 lg:grid-cols-[200px_minmax(0,1fr)]">
        <Index />

        <div className="grid min-w-0 gap-14">
          <Section id="set-theme" n="§1" title="Theme" aside={<span className="kicker">applies immediately</span>}>
            <ThemeSpecimens />
          </Section>

          <Section id="set-display" n="§2" title="Display">
            <div className="divide-y divide-line">
              <PrefRow
                title="Density"
                body="Row height in ledgers and record lists."
                control={<Segmented label="Density" value={density} onChange={(v) => setPref("density", v)} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />}
                preview={<DensityPreview compact={density === "compact"} />}
              />
              <PrefRow
                title="Record cell size"
                body="One square per record in traces and record indexes. Larger cells are easier to target."
                control={<Segmented label="Record cell size" value={cell} onChange={(v) => setPref("cell", v)} options={[{ value: "8", label: "8 px" }, { value: "10", label: "10 px" }, { value: "12", label: "12 px" }]} />}
                preview={<CellPreview size={Number(cell)} />}
              />
              <PrefRow
                title="Time zone"
                body="Evidence times are always shown in UTC with an explicit label, so captures, deadlines and observations line up."
                control={
                  <span className="inline-flex items-center gap-2 font-mono text-[12.5px] text-ink">
                    UTC <Tag>fixed by design</Tag>
                  </span>
                }
              />
              <PrefRow
                title="Opening page"
                body="Where a visit without an address inside the app begins."
                control={<Segmented label="Opening page" value={landing} onChange={(v) => setPref("landing", v)} options={[{ value: "overview", label: "Overview" }, { value: "verifications", label: "Verifications" }]} />}
              />
            </div>
          </Section>

          <Section id="set-a11y" n="§3" title="Accessibility">
            <div className="divide-y divide-line">
              <PrefRow
                title="Motion"
                body="Fades and lifts are already brief. Reduce removes them regardless of the device setting."
                control={<Segmented label="Motion" value={motion} onChange={(v) => setPref("motion", v)} options={[{ value: "system", label: "Follow device" }, { value: "reduce", label: "Reduce" }]} />}
              />
              <PrefRow
                title="Focus ring"
                body="The indigo ring that marks keyboard focus."
                control={<Segmented label="Focus ring" value={ring} onChange={(v) => setPref("ring", v)} options={[{ value: "standard", label: "Standard" }, { value: "heavy", label: "Heavy" }]} />}
                preview={
                  <span
                    aria-hidden
                    className="inline-flex h-8 items-center rounded-md border border-line bg-surface px-3 text-sm text-ink-2"
                    style={{ boxShadow: "var(--fa-ring)" }}
                  >
                    Focused control
                  </span>
                }
              />
              <PrefRow
                title="Uncertainty pattern"
                body="Hatching marks where evidence runs out. Strong draws it heavier for low-contrast screens."
                control={<Segmented label="Uncertainty pattern" value={pattern} onChange={(v) => setPref("pattern", v)} options={[{ value: "standard", label: "Standard" }, { value: "strong", label: "Strong" }]} />}
                preview={
                  <span aria-hidden className="flex gap-[3px]">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <i
                        key={i}
                        className="fa-cell"
                        data-s="Unverified"
                        style={{ width: 12, height: 12 }}
                      />
                    ))}
                  </span>
                }
              />
              <PrefRow
                title="Underline all links"
                body="Adds an underline to every link, not only those in running text."
                control={<Switch checked={underline} onChange={(v) => setPref("underline", v)} label="Underline all links" />}
                preview={<span className={cn("text-sm text-brand-ink", underline ? "underline underline-offset-[3px]" : "")}>Open VR-2025 →</span>}
              />
            </div>
          </Section>

          <Section id="set-demo" n="§4" title="Demo configuration" aside={<DemoStamp>Demo register</DemoStamp>}>
            <div className="pt-5">
              <p className="label mb-2">Data provider</p>
              <div role="radiogroup" aria-label="Data provider" className="surface overflow-hidden rounded-lg">
                {PROVIDERS.map((m) => {
                  const on = provider === m.mode;
                  const enabled = m.status === "active";
                  return (
                    <div
                      key={m.mode}
                      role="radio"
                      aria-checked={on}
                      aria-disabled={!enabled}
                      tabIndex={on ? 0 : -1}
                      className={cn("grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-line-subtle px-4 py-4 last:border-0 sm:grid-cols-[22px_190px_minmax(0,1fr)_auto] sm:items-center sm:px-5", !enabled && "text-ink-4")}
                    >
                      <span aria-hidden className={cn("grid size-[16px] place-items-center rounded-full border-[1.5px]", on ? "border-ink" : "border-dashed border-line-strong")}>
                        {on && <span className="size-[7px] rounded-full bg-ink" />}
                      </span>
                      <span className={cn("font-mono text-[12.5px] font-medium", enabled ? "text-ink" : "text-ink-3")}>{m.mode}</span>
                      <span className={cn("text-sm max-sm:col-start-2", enabled ? "text-ink-2" : "text-ink-3")}>
                        <b className={cn("font-semibold", enabled ? "text-ink" : "text-ink-2")}>{m.title}.</b> {m.body}
                        {!enabled && <span className="mt-1 block font-mono text-[10.5px] text-ink-3">Depends on — {m.dependsOn}</span>}
                      </span>
                      <span className="max-sm:col-start-2">
                        {m.status === "active" && <Tag tone="demo">active</Tag>}
                        {m.status === "local-routes" && <Tag tone="brand">local research pages only</Tag>}
                        {m.status === "not-implemented" && <Tag>not implemented</Tag>}
                      </span>
                    </div>
                  );
                })}
              </div>

              <a
                href="#/local/verifications"
                className="group mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-lg border border-dashed border-line-strong px-4 py-3.5 transition-colors duration-(--fa-dur-fast) hover:bg-hover sm:px-5"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">Local research pages</span>
                  <span className="block text-xs text-ink-3">LOCAL_RESEARCH over HTTP from the local Python service on 127.0.0.1:8765 — synthetic, unapproved research version. The demo pages stay on MOCK.</span>
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-2 group-hover:text-ink">
                  Open cases <ArrowRight size={12} aria-hidden />
                </span>
              </a>

              <a
                href="#/states"
                className="group mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-lg border border-line px-4 py-3.5 transition-colors duration-(--fa-dur-fast) hover:bg-hover sm:px-5"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">Interface states</span>
                  <span className="block text-xs text-ink-3">Loading, empty, request error, not found, partial, stale snapshot, evidence and service unavailable — simulated, never verdicts.</span>
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-2 group-hover:text-ink">
                  View specimens <ArrowRight size={12} aria-hidden />
                </span>
              </a>

              <dl className="mt-6 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
                {[
                  { k: "Demo clock", v: formatDateTime(new Date(DEMO_NOW_MS).toISOString()), h: "Frozen so relative times stay consistent." },
                  { k: "Fixture check", v: `${runs.length} runs consistent`, h: "Checked against the research precedence at startup." },
                  { k: "Source of states", v: "model.py precedence", h: "React never calculates a verdict." },
                ].map((f) => (
                  <div key={f.k} className="bg-surface px-4 py-3.5 sm:px-5">
                    <dt className="label">{f.k}</dt>
                    <dd className="mt-1 font-mono text-[12.5px] text-ink">{f.v}</dd>
                    <dd className="mt-1 text-xs text-ink-3">{f.h}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button type="button" onClick={reset} className={buttonClass("default")}>
                  <RotateCcw size={13} aria-hidden /> Reset local preferences
                </button>
                <span role="status" className={cn("text-xs", resetAt ? "text-ink" : "text-ink-3")}>
                  {resetAt ? "Theme, display, accessibility and the draft rule were reset in this browser." : "Clears theme, display, accessibility and the draft rule saved in this browser."}
                </span>
              </div>
            </div>
          </Section>

          <Section id="set-account" n="§5" title="Account & security" aside={<span className="kicker">future · not implemented</span>}>
            <div className="fa-future mt-5 px-4 py-5 sm:px-6">
              <p className="serif max-w-[40ch] text-[22px] leading-[1.25] text-ink">
                There are no accounts in this preview. <span className="text-ink-3">It never asks for, or stores, a credential.</span>
              </p>
              <ul className="mt-5 grid gap-x-8 sm:grid-cols-2">
                {[
                  ["Sign-in and identity", "Owner decision pending"],
                  ["Workspace members and roles", "Owner decision pending"],
                  ["Connector authorisation", "Phase 4 or later"],
                  ["Audit log of evidence reads", "Proposed"],
                  ["Data retention", "Proposed"],
                  ["Session and device management", "Not planned yet"],
                ].map(([t, s]) => (
                  <li key={t} className="flex items-baseline justify-between gap-4 border-t border-dashed border-line-strong py-2.5">
                    <span className="text-sm text-ink-2">{t}</span>
                    <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{s}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-3">Listed so the gap is visible. No control is shown for a feature that does not exist.</p>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
