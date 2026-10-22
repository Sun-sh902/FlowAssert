/**
 * Exact Detail → Archive matching (product round 02). Given the live Detail result and this case's complete archive
 * list, it finds archived evaluations with EXACTLY the same identity (src/data/workspace/comparison.ts: verification ID,
 * workspace, input evidence, evaluator model and source, contract) — never by time or label — and then reads each
 * candidate's archived Detail (bounded) to report its retrieval and integrity, and whether its full result is
 * byte-identical to the live one.
 *
 *   zero matches     "No matching archived evaluation", with the case's other entries and which identity fields differ
 *   one match        navigation to it
 *   several matches  all listed in archive order, NONE chosen
 *   failures         the candidate's retrieval or integrity failure, as the Service reported it
 * Nothing here writes, re-evaluates or produces a verdict; a result difference is a diagnostic.
 */
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProviderResult } from "../../data/access";
import type { FlowAssertHistoryProvider } from "../../data/provider";
import { IDENTITY_LABEL, matchArchive, resultRelation, type ArchiveMatch } from "../../data/workspace/comparison";
import type { HistoryDetailView, HistorySummaryView } from "../../domain/history";
import type { RunView } from "../../domain/view";
import { cn } from "../../lib/cn";
import { formatDateTime, plural, shortDigest } from "../../lib/format";
import { href } from "../../lib/router";
import { boundedEach } from "../../lib/useLiveCases";
import { shortHistoryId } from "../history/HistoryRows";
import { IntegrityTag } from "../integrity/Integrity";
import { Panel } from "../ui/primitives";

/** Upper bound on archived Details read to check candidates; more candidates are listed, unchecked. */
export const MAX_CANDIDATE_READS = 4;

type Check =
  | { kind: "reading" }
  | { kind: "ok"; detail: HistoryDetailView; relation: "identical" | "different" | "not_checkable" }
  | { kind: "not_found" }
  | { kind: "failed"; code: string; integrity: string | null; message: string }
  | { kind: "unchecked" };

function checkOf(r: ProviderResult<HistoryDetailView>, live: RunView): Check {
  if (r.kind === "ready" || r.kind === "partial") return { kind: "ok", detail: r.data, relation: resultRelation(live, r.data.run) };
  if (r.kind === "not_found") return { kind: "not_found" };
  return { kind: "failed", code: r.code, integrity: r.integrity ?? null, message: r.message };
}

const candidateIds = (match: ArchiveMatch) => (match.kind === "one" ? [match.entry.historyId] : match.kind === "many" ? match.entries.map((e) => e.historyId) : []);

function useCandidateChecks(provider: Pick<FlowAssertHistoryProvider, "getHistory">, live: RunView, match: ArchiveMatch) {
  const ids = candidateIds(match);
  const key = ids.join(",");
  const [checks, setChecks] = useState<Record<string, Check>>({});
  useEffect(() => {
    const list = key ? key.split(",") : [];
    const read = list.slice(0, MAX_CANDIDATE_READS);
    const ctrl = new AbortController();
    setChecks(Object.fromEntries(list.map((id, i) => [id, i < MAX_CANDIDATE_READS ? ({ kind: "reading" } as Check) : ({ kind: "unchecked" } as Check)])));
    void boundedEach(read, 2, ctrl.signal, async (id) => {
      try {
        const r = await provider.getHistory(id, {}, ctrl.signal);
        if (!ctrl.signal.aborted) setChecks((c) => ({ ...c, [id]: checkOf(r, live) }));
      } catch {
        /* aborted: the Detail changed or unmounted */
      }
    });
    return () => ctrl.abort();
  }, [provider, live, key]);
  return checks;
}

function CheckLine({ check }: { check: Check | undefined }) {
  if (!check || check.kind === "reading") return <span className="fa-breathe font-mono text-[11px] text-ink-3">reading archived detail…</span>;
  if (check.kind === "unchecked") return <span className="font-mono text-[11px] text-ink-3">not read — more than {MAX_CANDIDATE_READS} candidates</span>;
  if (check.kind === "not_found") return <span className="font-mono text-[11px] text-ink-2">history_not_found — listed, but not retrievable now</span>;
  if (check.kind === "failed")
    return (
      <span className="grid gap-1">
        {check.integrity ? <IntegrityTag state={check.integrity === "INTEGRITY_FAILED" ? "failed" : "unverifiable"}>{check.integrity}</IntegrityTag> : null}
        <span className="font-mono text-[11px] text-ink-2">retrieval failed · {check.code}</span>
      </span>
    );
  const d = check.detail;
  return (
    <span className="grid gap-1">
      <IntegrityTag state={d.integrity.status === "INTEGRITY_VERIFIED" ? "verified" : "failed"}>{d.integrity.status === "INTEGRITY_VERIFIED" ? "record check · service" : d.integrity.status}</IntegrityTag>
      <span className={cn("font-mono text-[11px]", check.relation === "different" ? "text-brand-ink" : "text-ink-2")} data-result-relation={check.relation}>
        {check.relation === "identical"
          ? "full result byte-identical to the live result"
          : check.relation === "different"
            ? "≠ full result differs from the live result · diagnostic, not a verdict"
            : "full result not byte-checkable in this browser"}
      </span>
      <span className="font-mono text-[10.5px] text-ink-3">
        evaluated {d.run.local?.serviceExecutedAt ? formatDateTime(d.run.local.serviceExecutedAt) : "time not stated"} · archived {formatDateTime(d.archivedAt)}
      </span>
    </span>
  );
}

function CandidateRow({ entry, check, live, single }: { entry: HistorySummaryView; check: Check | undefined; live: RunView; single: boolean }) {
  const sameSnapshot = live.local?.snapshotId === entry.originalSnapshotId;
  return (
    <li data-archive-candidate={entry.historyId} className="grid gap-3 border-b border-line-subtle px-4 py-3.5 last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:px-5">
      <div className="min-w-0">
        <a href={href(`/local/history/${entry.historyId}`)} className="mono-id fa-hit inline-flex items-center gap-1 rounded-xs text-[13px] font-semibold text-ink hover:text-brand" title={entry.historyId}>
          {single ? "Open matching archived evaluation" : shortHistoryId(entry.historyId)} <ArrowRight size={12} aria-hidden />
        </a>
        {single && <span className="mono-id block text-[10.5px] text-ink-3" title={entry.historyId}>{shortHistoryId(entry.historyId)}</span>}
        <span className="mt-1 block font-mono text-[10.5px] leading-[1.5] text-ink-3">
          input {shortDigest(entry.inputEvidenceSha256)} · evaluator {shortDigest(entry.evaluator.modelSha256).slice(0, 8)}
          <span className="block">snapshot {sameSnapshot ? "same Service publication" : "different Service publication"}</span>
        </span>
      </div>
      <CheckLine check={check} />
    </li>
  );
}

export function ArchiveMatchPanel({ live, entries, provider, className }: { live: RunView; entries: HistorySummaryView[]; provider: Pick<FlowAssertHistoryProvider, "getHistory">; className?: string }) {
  const match = matchArchive(live, entries);
  const checks = useCandidateChecks(provider, live, match);
  let title: string;
  if (match.kind === "one") title = "Matching archived evaluation";
  else if (match.kind === "many") title = `${plural(match.entries.length, "archived evaluation")} match this exact input`;
  else title = "No matching archived evaluation";
  return (
    <Panel
      title={title}
      description="Exact identity only — input evidence, evaluator model and source, contract, workspace. Never time or verdict label."
      className={className}
    >
      <div data-archive-match={match.kind} data-candidate-reads={candidateIds(match).some((id) => !checks[id] || checks[id].kind === "reading") ? "pending" : "settled"}>
        {match.kind === "many" && (
          <p className="border-b border-line-subtle px-4 py-3 text-sm text-ink-2 sm:px-5">
            <b className="font-semibold text-ink">None is chosen.</b> Each was evaluated from exactly this input; they are listed in archive order, newest first.
          </p>
        )}
        {match.kind === "none" ? (
          <div className="px-4 py-4 sm:px-5">
            <p className="text-sm text-ink-2">
              {match.considered === 0
                ? "The archive holds no evaluation of this case."
                : `${plural(match.considered, "archived evaluation")} of this case ${match.considered === 1 ? "was" : "were"} considered; none has this exact identity.`}
            </p>
            {match.nearest.length > 0 && (
              <ul className="mt-3 grid gap-1.5">
                {match.nearest.map(({ entry, differs }) => (
                  <li key={entry.historyId} className="font-mono text-[11px] text-ink-3">
                    <a href={href(`/local/history/${entry.historyId}`)} className="underline decoration-line-strong underline-offset-2 hover:text-ink" title={entry.historyId}>
                      {shortHistoryId(entry.historyId)}
                    </a>{" "}
                    · differs in {differs.map((f) => IDENTITY_LABEL[f]).join(", ")}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <ul>
            {(match.kind === "one" ? [match.entry] : match.entries).map((e) => (
              <CandidateRow key={e.historyId} entry={e} check={checks[e.historyId]} live={live} single={match.kind === "one"} />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
