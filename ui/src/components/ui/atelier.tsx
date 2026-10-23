/**
 * Shared Evidence Atelier pieces for the configuration pages (Connections, Rules, Settings).
 * Same tokens and type rules as v1.0: serif conclusions, sans interface, mono evidence.
 */
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { RuleProvenance } from "../../data/demoConfig";

/* ---------- Page head: kicker, serif statement, lede, optional ledger aside ---------- */

export function PageHead({ kicker, title, lede, aside }: { kicker: ReactNode; title: ReactNode; lede: ReactNode; aside?: ReactNode }) {
  return (
    <header className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end">
      <div className="min-w-0">
        <p className="kicker">{kicker}</p>
        <h1 className="display mt-3 max-w-[32ch] text-[34px] leading-[1.05] text-ink sm:text-[40px]">{title}</h1>
        <div className="mt-4 max-w-[62ch] text-md leading-[1.6] text-ink-2">{lede}</div>
      </div>
      {aside}
    </header>
  );
}

/** Section title in the serif with a mono aside. */
export function SectionHead({ title, aside, id }: { title: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id={id} className="serif text-2xl leading-8 text-ink">
        {title}
      </h2>
      {aside && <span className="kicker">{aside}</span>}
    </div>
  );
}

/* ---------- Demo stamp: the register mark for anything that is preview-only ---------- */

export function DemoStamp({ children = "Demo · nothing is sent", className }: { children?: ReactNode; className?: string }) {
  return (
    <span className={cn("fa-stamp", className)}>
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
        <rect x="1" y="1" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 1.4" />
      </svg>
      {children}
    </span>
  );
}

/* ---------- Provenance mark: research-supported / proposed / demo draft ---------- */

const PROV: Record<RuleProvenance, { label: string; long: string }> = {
  research: { label: "Research", long: "Research-supported" },
  proposed: { label: "Proposed", long: "Proposed rule" },
  draft: { label: "Draft", long: "Demo-only draft" },
};
export const provenanceCopy = PROV;

export function ProvenanceMark({ p, long = false, className }: { p: RuleProvenance; long?: boolean; className?: string }) {
  return (
    <span className={cn("fa-prov", className)} data-p={p}>
      <i aria-hidden />
      {long ? PROV[p].long : PROV[p].label}
    </span>
  );
}

/* ---------- Not-connected seal: neutral, dashed — never a state colour ---------- */

export function OpenSeal({ children }: { children: ReactNode }) {
  return <span className="fa-openseal">{children}</span>;
}

/* ---------- Segmented control: a radiogroup with arrow-key movement ---------- */

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  hint?: string;
}

/**
 * WAI-ARIA radio group keyboard behaviour: one Tab stop (the checked radio, tabIndex 0; the rest -1), and arrow keys
 * move selection and focus together, wrapping and skipping disabled options.
 */
export function useRadioGroupKeys<T extends string>(options: readonly { value: T; disabled?: boolean }[], value: T, onChange: (v: T) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const focusAfterChange = useRef(false);
  // Focus the newly checked option once it has rendered (arrow keys move selection and focus together).
  useEffect(() => {
    if (!focusAfterChange.current) return;
    focusAfterChange.current = false;
    ref.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [value]);
  const onKey = (e: KeyboardEvent) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const next = enabled[(i + step + enabled.length) % enabled.length];
    if (!next) return;
    focusAfterChange.current = true;
    onChange(next.value);
  };
  return { ref, onKey };
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const { ref, onKey } = useRadioGroupKeys(options, value, onChange);
  return (
    <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={onKey} className={cn("fa-seg", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            tabIndex={on ? 0 : -1}
            title={o.hint}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Switch ---------- */

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className="fa-switch">
      <i aria-hidden />
      <span className="font-mono text-[10.5px] tracking-[0.06em] uppercase">{checked ? "true" : "false"}</span>
    </button>
  );
}

/* ---------- Preference row: label + explanation on the left, control (and preview) on the right ---------- */

export function PrefRow({ title, body, control, preview }: { title: ReactNode; body?: ReactNode; control: ReactNode; preview?: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="grid gap-x-8 gap-y-3 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="min-w-0">
        <p id={id} className="text-md font-semibold text-ink">
          {title}
        </p>
        {body && <p className="mt-1 max-w-[46ch] text-sm leading-[1.55] text-ink-3">{body}</p>}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3">
        {control}
        {preview}
      </div>
    </div>
  );
}
