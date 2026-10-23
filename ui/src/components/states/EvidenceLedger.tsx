/** Evidence-reference inventory: stored availability and this read's payload outcome, side by side. */
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { EvidenceAvailabilityView, EvidenceReferenceView } from "../../domain/evidence";
import { assessItem } from "../../domain/integrity";
import { cn } from "../../lib/cn";
import { shortDigest } from "../../lib/format";
import { IntegrityTag } from "../integrity/Integrity";

const AVAIL_WORD: Record<EvidenceAvailabilityView, string> = {
  available: "available",
  not_collected: "not collected",
  unavailable: "unavailable",
  redacted: "redacted",
  expired: "expired",
};

export function Availability({ a }: { a: EvidenceAvailabilityView }) {
  return (
    <span className="fa-avail" data-a={a}>
      <i aria-hidden />
      {AVAIL_WORD[a]}
    </span>
  );
}

function payloadWord(r: EvidenceReferenceView): string {
  switch (r.payload.state) {
    case "loaded":
      return r.payload.digest === "reproduced"
        ? "payload read · sha256 reproduced"
        : r.payload.digest === "mismatch"
          ? "payload read · sha256 not reproduced here"
          : r.payload.digest === "not_checkable"
            ? "payload read · digest not checkable here"
            : "payload read";
    case "omitted":
      return `payload omitted · ${r.payload.reason}`;
    case "not_loaded":
      return "payload not read yet";
    case "unavailable":
      return `payload unreadable · ${r.payload.reason}`;
  }
}

const SERVICE_WORD = { INTEGRITY_VERIFIED: "verified", INTEGRITY_FAILED: "failed", INTEGRITY_UNVERIFIABLE: "unverifiable" } as const;

/**
 * The run's evidence inventory. Stored availability and this browser's payload read are shown as
 * two separate facts; neither touches the verdict. With `integrity` (Phase 3A archived evidence) a
 * fourth fact is shown: the item's integrity, combining the Service's stored-byte statement and this
 * browser's own re-check (src/domain/integrity.ts). A payload whose SHA-256 is not reproduced is marked
 * on its own row in either mode (P2-AUD-001), so the affected reference is always identified.
 */
export function EvidenceLedger({ items, caption = "Evidence references", integrity = false }: { items: EvidenceReferenceView[]; caption?: string; integrity?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const scrollable = useScrollsHorizontally(scroller);
  return (
    // contain: inline-size keeps the table's 560px minimum from widening whatever grid it sits in.
    // When the table is wider than its column the wrapper becomes a named, focusable region, so keyboard
    // users can reach it and scroll it with the arrow keys (WebKit does not focus scroll containers on
    // its own). At full width it adds no Tab stop.
    <div
      ref={scroller}
      className="overflow-x-auto"
      style={{ contain: "inline-size" }}
      {...(scrollable ? { tabIndex: 0, role: "region", "aria-label": caption, onKeyDown: scrollByKey } : {})}
    >
      <table className={cn("w-full text-sm", integrity ? "min-w-[720px]" : "min-w-[560px]")}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-[1.5px] border-rule text-left">
            <th scope="col" className="kicker py-2 pr-4 font-normal">Role</th>
            <th scope="col" className="kicker py-2 pr-4 font-normal">Reference</th>
            <th scope="col" className="kicker py-2 pr-4 font-normal">Stored availability</th>
            <th scope="col" className={cn("kicker py-2 font-normal", integrity && "pr-4")}>This read</th>
            {integrity && (
              <th scope="col" className="kicker py-2 font-normal">
                Integrity
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="border-b border-line-subtle align-top last:border-0">
              <td className="py-3 pr-4 font-mono text-[11.5px] text-ink-2">{r.role.replace("_", " ")}</td>
              <td className="py-3 pr-4">
                <span className="mono-id block text-ink">{r.id}</span>
                <span className="font-mono text-[10.5px] text-ink-3">{r.sha256 ? `sha256 ${shortDigest(r.sha256)}` : "sha256 · none"}</span>
              </td>
              <td className="py-3 pr-4">
                <Availability a={r.availability} />
                {r.reason && <span className="mt-1 block text-xs text-ink-3">“{r.reason}”</span>}
              </td>
              <td className={cn("py-3 font-mono text-[11px]", r.payload.state === "unavailable" ? "text-ink" : "text-ink-3", integrity && "pr-4")}>
                {payloadWord(r)}
                {r.payload.state === "loaded" && r.payload.digest === "mismatch" && (
                  <span className="mt-1 block" data-digest-mismatch={r.id}>
                    <IntegrityTag state="failed">integrity failed</IntegrityTag>
                  </span>
                )}
              </td>
              {integrity && <IntegrityCell r={r} />}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IntegrityCell({ r }: { r: EvidenceReferenceView }) {
  const a = assessItem(r);
  return (
    <td className="py-3 align-top" data-integrity-item={r.id} data-i={a.state}>
      <IntegrityTag state={a.state}>{a.state === "pending" ? "not established" : a.state}</IntegrityTag>
      <span className="mt-1 block font-mono text-[10.5px] text-ink-3">
        service {r.serviceIntegrity ? SERVICE_WORD[r.serviceIntegrity.status] : "—"} · browser{" "}
        {a.browser === "reproduced" ? "reproduced" : a.browser === "mismatch" ? "not reproduced" : a.browser === "not_checkable" ? "cannot reproduce" : a.browser === "omitted" ? "not checked (omitted)" : a.browser === "not_available" ? "nothing to check" : "not read"}
      </span>
    </td>
  );
}

/**
 * Arrow keys, Home and End scroll the focused region. Chrome does this natively; WebKit does not scroll a
 * focused overflow container, so the region handles the keys itself (and prevents the native scroll so
 * Chrome does not move twice).
 */
export function scrollByKey(e: KeyboardEvent<HTMLDivElement>) {
  if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
  const el = e.currentTarget;
  const step = { ArrowLeft: -40, ArrowRight: 40, Home: -el.scrollWidth, End: el.scrollWidth }[e.key];
  if (step === undefined) return;
  e.preventDefault();
  el.scrollBy({ left: step });
}

/** True while the element's content is wider than its box. */
export function useScrollsHorizontally(ref: RefObject<HTMLElement | null>) {
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    measure();
    return () => ro.disconnect();
  }, [ref]);
  return scrolls;
}
