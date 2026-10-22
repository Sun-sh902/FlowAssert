import { ChevronRight, Search, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

/* ---------- Panel ---------- */

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  as: Tag = "section",
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: "section" | "div" | "aside";
  id?: string;
}) {
  const headingId = useId();
  return (
    <Tag
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className={cn("surface min-w-0 rounded-lg", className)}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line px-4 pt-3.5 pb-3 sm:px-5">
          <div className="min-w-0">
            {title && (
              <h2 id={headingId} className="serif text-xl leading-7 text-ink">
                {title}
              </h2>
            )}
            {description && <p className="mt-0.5 text-xs text-ink-3">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 max-sm:w-full sm:shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn(bodyClassName)}>{children}</div>
    </Tag>
  );
}

/* ---------- Tag ---------- */

export function Tag({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "brand" | "demo"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] items-center rounded-xs px-1.5 font-mono text-[10px] tracking-[0.06em] uppercase",
        tone === "neutral" && "bg-sunken text-ink-3 ring-1 ring-line ring-inset",
        tone === "brand" && "bg-brand-soft text-brand-ink",
        tone === "demo" && "bg-demo text-canvas",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------- Buttons ---------- */

export function buttonClass(variant: "default" | "ghost" | "primary" = "default", size: "sm" | "md" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors duration-(--fa-dur-fast) disabled:opacity-50",
    size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
    variant === "default" && "surface text-ink-2 hover:bg-hover hover:text-ink",
    variant === "ghost" && "text-ink-2 hover:bg-hover hover:text-ink",
    variant === "primary" && "bg-ink text-canvas hover:opacity-90",
  );
}

/* ---------- Filter chips (single-select) ---------- */

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  icon?: ReactNode;
}

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors duration-(--fa-dur-fast)",
              active ? "bg-ink text-canvas" : "text-ink-2 hover:bg-hover hover:text-ink",
            )}
          >
            {o.icon}
            {o.label}
            {o.count !== undefined && (
              <span className={cn("font-mono text-[10px] tabular", active ? "opacity-70" : "text-ink-3")}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Search ---------- */

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-4" aria-hidden />
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onChange("");
          }
        }}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border border-line bg-surface pr-8 pl-8 text-sm text-ink transition-colors duration-(--fa-dur-fast) placeholder:text-ink-3 hover:border-line-strong focus:border-brand focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-ink-3 hover:bg-hover hover:text-ink"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

/* ---------- Disclosure ---------- */

export function Disclosure({
  summary,
  meta,
  children,
  defaultOpen = false,
  className,
}: {
  summary: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="group flex min-h-10 w-full items-center gap-2 py-2.5 text-left text-sm font-medium text-ink-2 hover:text-ink"
      >
        <ChevronRight size={14} aria-hidden className={cn("shrink-0 text-ink-4 transition-transform duration-150", open && "rotate-90")} />
        <span className="min-w-0 flex-1">{summary}</span>
        {meta && <span className="shrink-0 text-xs font-normal text-ink-3">{meta}</span>}
      </button>
      <div id={id} hidden={!open} className={cn(open && "fade-in")}>
        {children}
      </div>
    </div>
  );
}

/* ---------- Empty state ---------- */

export function EmptyState({ title, body, action }: { title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 grid size-9 place-items-center rounded-full border border-dashed border-line-strong text-ink-4">
        <Search size={15} aria-hidden />
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-3">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ---------- Key / value ---------- */

export function Fact({ label, value, hint, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="label">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink tabular">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-ink-3">{hint}</dd>}
    </div>
  );
}
