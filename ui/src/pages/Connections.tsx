import { ArrowRight, Lock } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { DemoStamp, OpenSeal, PageHead, SectionHead } from "../components/ui/atelier";
import { buttonClass, Disclosure, Tag } from "../components/ui/primitives";
import { CONNECTIONS, type ConnectionRole, type ConnectionView, type Permission } from "../data/demoConfig";
import { workflows } from "../data/store";
import { cn } from "../lib/cn";
import { workflowLabelText } from "../lib/format";
import { useReplaceParams, type Location } from "../lib/router";

/** The n8n label as recorded; a null or empty label is shown as presentation text, in italics, and never invented. */
function WorkflowLabel({ label }: { label: string | null }) {
  const { text, fallback } = workflowLabelText(label);
  return <span className={cn("truncate text-sm text-ink-3", fallback && "italic")}>{text}</span>;
}

const STATUS_WORD: Record<ConnectionRole, string> = {
  source: "Not connected",
  workflow: "Identified only",
  destination: "Not connected",
};

function Register() {
  return (
    <section aria-labelledby="reg-h">
      <h2 id="reg-h" className="kicker mb-2">
        Connection register · demo
      </h2>
      <dl className="fa-ledger">
        {CONNECTIONS.map((c) => (
          <div key={c.role} className="flex items-baseline justify-between gap-3 py-[9px]">
            <dt className="flex min-w-0 items-baseline gap-2.5 text-sm text-ink-2">
              <span className="font-mono text-[10.5px] text-ink-3">{c.n}</span>
              <span className="truncate">{c.roleLabel}</span>
            </dt>
            <dd className="font-mono text-[11px] whitespace-nowrap text-ink-3">{STATUS_WORD[c.role]}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-ink-3">No credentials are requested or stored. Every value on this page is synthetic.</p>
    </section>
  );
}

/* ---------- Custody: the logo, drawn at page scale ---------- */

function Custody({ selected, onSelect }: { selected: ConnectionRole; onSelect: (r: ConnectionRole) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const focusAfterChange = useRef(false);
  useEffect(() => {
    if (!focusAfterChange.current) return;
    focusAfterChange.current = false;
    ref.current?.querySelector<HTMLButtonElement>(`[data-role-btn="${selected}"]`)?.focus();
  }, [selected]);
  // ←/→ (↑/↓ on narrow screens) move between parties; focus follows the selection.
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = CONNECTIONS.findIndex((c) => c.role === selected);
    const next = CONNECTIONS[(i + step + CONNECTIONS.length) % CONNECTIONS.length]!;
    focusAfterChange.current = true;
    onSelect(next.role);
  };
  return (
    <div className="surface rounded-lg px-3 pt-6 pb-5 sm:px-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 md:hidden">
        <span className="kicker text-brand-ink">FlowAssert compares A with C</span>
      </div>
      <div ref={ref} className="fa-custody" role="group" aria-label="Parties to a verification. Select one to see its role." onKeyDown={onKey}>
        <svg className="fa-custody-arc" viewBox="0 0 100 92" preserveAspectRatio="none" aria-hidden>
          <path d="M0 92 C 0 8, 100 8, 100 92" fill="none" stroke="var(--fa-brand)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
        <span aria-hidden className="pointer-events-none absolute top-[17px] left-1/2 z-[3] h-[24px] w-[2.5px] -translate-x-1/2 rounded-full bg-brand max-md:hidden" />
        <span className="kicker pointer-events-none absolute -top-1 left-1/2 z-[3] -translate-x-1/2 bg-surface px-2 whitespace-nowrap text-brand-ink max-md:hidden">
          FlowAssert compares · exact string
        </span>
        <i aria-hidden className="fa-custody-flow" />
        <span aria-hidden className="pointer-events-none absolute top-[116px] left-[27%] z-[2] font-mono text-[10px] text-ink-3 max-md:hidden">
          rows →
        </span>
        <span aria-hidden className="pointer-events-none absolute top-[116px] right-[24%] z-[2] font-mono text-[10px] text-ink-3 max-md:hidden">
          writes contacts →
        </span>

        {CONNECTIONS.map((c) => (
          <button
            key={c.role}
            type="button"
            data-role-btn={c.role}
            aria-pressed={selected === c.role}
            aria-controls="role-sheet"
            tabIndex={selected === c.role ? 0 : -1}
            onClick={() => onSelect(c.role)}
            className="fa-party"
          >
            <span className="fa-party-node" data-role={c.role} aria-hidden>
              {c.role === "workflow" && "under test"}
            </span>
            <span className="kicker">
              {c.n} · {c.roleLabel}
            </span>
            <span className="serif mt-1 text-[22px] leading-7 text-ink">{c.name}</span>
            <span className="mt-0.5 font-mono text-[11px] text-ink-3">{c.provider}</span>
            <span className="mt-3">
              <OpenSeal>{STATUS_WORD[c.role]}</OpenSeal>
            </span>
            <span className="mt-3 max-w-[30ch] text-xs leading-[1.5] text-ink-3">{c.stance}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- Role sheet ---------- */

const NEED: Record<Permission["need"], { label: string; cls: string }> = {
  required: { label: "Required", cls: "bg-ink text-canvas" },
  optional: { label: "Optional", cls: "text-ink-2 ring-1 ring-line-strong ring-inset" },
  never: { label: "Never held", cls: "border border-dashed border-line-strong text-ink-3 line-through decoration-ink-4" },
};

function RoleSheet({ c }: { c: ConnectionView }) {
  return (
    <section id="role-sheet" aria-labelledby="role-h" className="surface min-w-0 rounded-lg lg:col-span-7">
      <header className="border-b border-line px-4 pt-4 pb-4 sm:px-6">
        <p className="kicker">
          Role {c.n} · {c.roleLabel}
        </p>
        <h2 id="role-h" className="serif mt-1 text-[26px] leading-8 text-ink">
          {c.name}
        </h2>
        <p className="serif mt-2 max-w-[52ch] text-lg leading-[1.45] text-ink-2 italic">{c.stance}</p>
      </header>

      <div className="grid border-b border-line sm:grid-cols-2">
        <div className="px-4 py-4 sm:px-6">
          <p className="kicker mb-2">FlowAssert reads</p>
          <ul className="grid gap-1.5 text-sm text-ink-2">
            {c.reads.map((r) => (
              <li key={r} className="flex gap-2.5">
                <span aria-hidden className="mt-[7px] size-[5px] shrink-0 rounded-[1px] bg-ink-2" />
                {r}
              </li>
            ))}
          </ul>
        </div>
        <div className="border-line px-4 py-4 max-sm:border-t sm:border-l sm:px-6">
          <p className="kicker mb-2">Never reads</p>
          <ul className="grid gap-1.5 text-sm text-ink-3">
            {c.neverReads.map((r) => (
              <li key={r} className="flex gap-2.5">
                <span aria-hidden className="mt-[7px] size-[5px] shrink-0 rounded-[1px] ring-1 ring-ink-4" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="px-4 pt-4 pb-2 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="kicker">Permission requirements</p>
          <p className="font-mono text-[10.5px] text-ink-3">read-only by construction</p>
        </div>
        <ul className="mt-2">
          {c.permissions.map((p) => (
            <li key={p.id} className="grid gap-x-4 gap-y-1 border-t border-line-subtle py-3 first:border-t-[1.5px] first:border-rule sm:grid-cols-[92px_minmax(0,1fr)]">
              <span className={cn("inline-flex h-[19px] w-fit items-center rounded-xs px-1.5 font-mono text-[9.5px] tracking-[0.08em] uppercase", NEED[p.need].cls)}>
                {NEED[p.need].label}
              </span>
              <div className="min-w-0">
                <p className={cn("text-sm font-medium text-ink", p.label.includes(".") && "mono-id text-[12.5px]", p.need === "never" && "text-ink-3")}>
                  {p.label}
                  {!p.confirmed && (
                    <Tag className="ml-2 align-[1px]" tone="brand">
                      name awaits Phase 0
                    </Tag>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">{p.why}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------- Configuration preview ---------- */

function ConfigPreview({ c }: { c: ConnectionView }) {
  const noProvider = c.role === "source";
  return (
    <section aria-labelledby="cfg-h" className="surface min-w-0 rounded-lg lg:col-span-5">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 pt-4 pb-3.5 sm:px-5">
        <div>
          <h2 id="cfg-h" className="serif text-xl leading-7 text-ink">
            Configuration preview
          </h2>
          <p className="mt-0.5 text-xs text-ink-3">What this connection would bind. Read-only.</p>
        </div>
        <DemoStamp />
      </header>

      {noProvider && (
        <div className="mx-4 mt-4 flex gap-3 rounded-md border border-dashed border-line-strong px-3.5 py-3 sm:mx-5">
          <span aria-hidden className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-dashed border-line-strong">
            <span className="size-2.5 rounded-[1px] border-[1.5px] border-ink-3" />
          </span>
          <div>
            <p className="text-sm font-medium text-ink">No source provider chosen</p>
            <p className="mt-0.5 text-xs leading-[1.5] text-ink-3">The independent source is an owner decision still open. These fields show what any provider would have to supply.</p>
          </div>
        </div>
      )}

      <div className="px-4 pt-1 sm:px-5">
        {c.configFields.map((f) => (
          <div key={f.label} className="fa-field">
            <span className="label">{f.label}</span>
            <output aria-label={f.label}>{f.value}</output>
            <span className="text-[11.5px] text-ink-3">{f.hint}</span>
          </div>
        ))}
      </div>

      <div className="mt-2 border-t border-line px-4 py-4 sm:px-5">
        <button type="button" disabled className={cn(buttonClass("primary"), "w-full")} aria-describedby="cfg-why">
          <Lock size={13} aria-hidden /> Authorise {c.provider === "Provider not chosen" ? "source" : c.provider}
        </button>
        <p id="cfg-why" className="mt-2 text-xs leading-[1.5] text-ink-3">
          Authorisation is not implemented in this preview. Nothing is requested, connected or stored.
        </p>
        <Disclosure summary="What would be requested" meta={`${c.permissions.filter((p) => p.need !== "never").length} read permission${c.permissions.filter((p) => p.need !== "never").length === 1 ? "" : "s"}`} className="mt-2 border-t border-line-subtle">
          <ul className="grid gap-1 pb-1 pl-6 font-mono text-[11.5px] text-ink-2">
            {c.permissions
              .filter((p) => p.need !== "never")
              .map((p) => (
                <li key={p.id}>
                  {p.label} <span className="text-ink-3">· {p.need}</span>
                </li>
              ))}
          </ul>
        </Disclosure>
      </div>
    </section>
  );
}

/* ---------- Workflow bindings ---------- */

function Bindings() {
  return (
    <section aria-labelledby="bind-h">
      <SectionHead id="bind-h" title="Workflow bindings" aside={`${workflows.length} demo bindings`} />
      <div className="surface overflow-hidden rounded-lg">
        <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)] gap-4 border-b border-line px-6 py-2.5 md:grid">
          {["Workflow", "A · Source namespace", "B · n8n label", "C · Destination"].map((h) => (
            <span key={h} className="kicker">
              {h}
            </span>
          ))}
        </div>
        <ul>
          {workflows.map((w) => (
            <li key={w.id} className="grid gap-x-4 gap-y-1.5 border-b border-line-subtle px-4 py-3.5 last:border-0 sm:px-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)] md:items-center">
              <span className="text-md font-semibold text-ink">{w.name}</span>
              <span className="flex min-w-0 items-center gap-2">
                <i aria-hidden className="fa-node-src shrink-0" />
                <span className="mono-id truncate text-ink-2">{w.sourceNamespace}</span>
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <i aria-hidden className="h-[10px] w-[18px] shrink-0 rounded-[2px] border border-dashed border-line-strong" />
                <WorkflowLabel label={w.n8nLabel} />
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <i aria-hidden className="fa-node-dst shrink-0 scale-[0.85]" />
                <span className="mono-id truncate text-ink-2">HubSpot · contacts</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-2.5 text-xs text-ink-3">
        Bindings mirror the demo fixtures. In a live product each binding would pair one source namespace with one HubSpot account and object.{" "}
        <a href="#/rules" className="fa-hit inline-flex items-center gap-1 text-ink-2 underline decoration-line-strong underline-offset-[3px] hover:text-ink">
          Rules bound to these workflows <ArrowRight size={12} aria-hidden />
        </a>
      </p>
    </section>
  );
}

const ROLES: ConnectionRole[] = ["source", "workflow", "destination"];

export function Connections({ location }: { location: Location }) {
  const replace = useReplaceParams("/connections");
  const requested = location.params.get("role");
  const role: ConnectionRole = ROLES.includes(requested as ConnectionRole) ? (requested as ConnectionRole) : "destination";
  const setRole = (r: ConnectionRole) => replace({ role: r === "destination" ? null : r });
  const c = CONNECTIONS.find((x) => x.role === role)!;
  return (
    <div className="grid gap-12">
      <PageHead
        kicker="Connections · demo configuration · nothing connected"
        title={
          <>
            Read both ends. <span className="text-ink-3">Never take the workflow’s word for it.</span>
          </>
        }
        lede="A verification compares an independent read of the source with an observation of HubSpot. The n8n workflow sits between them as the thing under test — identified by name, never trusted as evidence."
        aside={<Register />}
      />
      <Custody selected={role} onSelect={setRole} />
      <div className="grid gap-5 lg:grid-cols-12 lg:items-start">
        <RoleSheet key={c.role} c={c} />
        <ConfigPreview key={`cfg-${c.role}`} c={c} />
      </div>
      <Bindings />
    </div>
  );
}
