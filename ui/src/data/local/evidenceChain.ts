/**
 * One evidence acquisition: the ordered pages read for one Detail, pinned to its snapshot.
 *
 * Rules (FROZEN_API_HANDOFF.md "Snapshot, reference and pagination rules"):
 *  - every page belongs to the Detail's snapshot, and limit / include_payload stay constant;
 *  - each request sends the previous page's opaque `next_cursor` unchanged (the first sends none);
 *  - concatenated references must equal the Detail's `evidence_references` exactly, in order —
 *    a cycle, duplicate, omission, reordering, changed metadata or foreign reference is refused;
 *  - only a null `next_cursor` ends the sequence; `page.total` is nullable and counts references,
 *    never records.
 * A refused page ends the acquisition with nothing merged. These are pure functions; the hook in
 * src/lib/useEvidenceAcquisition.ts drives them.
 */
import type { EvidencePageView, EvidenceReferenceView } from "../../domain/evidence";
import { LOCAL_LIMITS } from "./config";

export interface EvidenceChain {
  snapshotId: string;
  limit: number;
  includePayload: boolean;
  /** The Detail's references, in order: the only acceptable concatenation. */
  expected: EvidenceReferenceView[];
  /** References admitted so far, in order, with this read's payload outcome. */
  read: EvidenceReferenceView[];
  /** Cursors already sent (null = the first page). */
  sent: (string | null)[];
  /** Cursor for the next request: undefined before the first page, null once complete. */
  next: string | null | undefined;
  pages: number;
}

export type ChainStep = { ok: true; chain: EvidenceChain } | { ok: false; code: string; message: string };

export function startChain(expected: EvidenceReferenceView[], snapshotId: string, limit: number, includePayload: boolean): EvidenceChain {
  return { snapshotId, limit, includePayload, expected, read: [], sent: [], next: undefined, pages: 0 };
}

export const chainComplete = (c: EvidenceChain) => c.next === null;

/** The reference metadata that must match the Detail exactly; the payload outcome is not part of it. */
function sameReference(a: EvidenceReferenceView, b: EvidenceReferenceView): boolean {
  return (
    a.id === b.id &&
    a.role === b.role &&
    a.availability === b.availability &&
    a.reason === b.reason &&
    a.sha256 === b.sha256 &&
    a.acquisitionKind === b.acquisitionKind &&
    a.externalAuthenticity === b.externalAuthenticity &&
    a.mediaType === b.mediaType &&
    a.canonicalization === b.canonicalization
  );
}

const stop = (code: string, message: string): ChainStep => ({ ok: false, code, message });

/** Admit one page read with `cursor` (null for the first page). */
export function admitPage(chain: EvidenceChain, cursor: string | null, page: EvidencePageView): ChainStep {
  if (chain.next === null) return stop("chain_complete", "The evidence sequence had already ended; a further page was refused.");
  const expectedCursor = chain.next === undefined ? null : chain.next;
  if (cursor !== expectedCursor) return stop("cursor_out_of_sequence", "A page answered a cursor other than the one this acquisition sent next.");
  if (page.snapshotId !== chain.snapshotId)
    return stop("snapshot_mismatch", `Page belongs to snapshot ${page.snapshotId ?? "none"}, not the Detail's ${chain.snapshotId}. Nothing was merged.`);
  if (chain.pages + 1 > LOCAL_LIMITS.maxEvidencePages) return stop("page_limit_exceeded", `More than ${LOCAL_LIMITS.maxEvidencePages} pages for one run.`);
  if (page.items.length > chain.limit) return stop("page_too_large", `${page.items.length} items exceed the requested limit ${chain.limit}.`);
  if (page.nextCursor !== null && (page.nextCursor === cursor || chain.sent.includes(page.nextCursor)))
    return stop("cursor_cycle", "The service returned a cursor this acquisition already followed.");
  if (page.items.length === 0 && page.nextCursor !== null) return stop("no_progress", "An empty page asked to continue.");
  const seen = new Set(chain.read.map((r) => r.id));
  for (const [i, item] of page.items.entries()) {
    if (seen.has(item.id)) return stop("duplicate_reference", `Reference ${item.id} was already read.`);
    seen.add(item.id);
    const want = chain.expected[chain.read.length + i];
    if (!want) return stop("extra_reference", `Reference ${item.id} is beyond the Detail's ${chain.expected.length} references.`);
    if (!sameReference(item, want))
      return stop("reference_mismatch", `Reference ${item.id} at position ${chain.read.length + i + 1} does not match the Detail's ${want.id} (order or metadata differs).`);
  }
  const read = [...chain.read, ...page.items];
  if (page.total !== null && page.total !== chain.expected.length)
    return stop("total_conflict", `page.total is ${page.total}; the Detail lists ${chain.expected.length} references.`);
  if (page.nextCursor === null && read.length !== chain.expected.length)
    return stop("omitted_references", `The sequence ended after ${read.length} of ${chain.expected.length} references.`);
  return { ok: true, chain: { ...chain, read, sent: [...chain.sent, cursor], next: page.nextCursor, pages: chain.pages + 1 } };
}

/** The Detail's references with this acquisition's payload outcome where a page has been admitted. */
export function ledgerItems(chain: EvidenceChain | null, expected: EvidenceReferenceView[]): EvidenceReferenceView[] {
  if (!chain) return expected;
  return expected.map((ref, i) => chain.read[i] ?? ref);
}
