/**
 * Saved reports (#/check/reports) and one saved report (#/check/reports/:id): the JSON reports the user kept from the
 * CSV check or imported from a file (lib/savedReports.ts). The list shows what each entry's summary says; an opened
 * report is read again from its original bytes (offline/savedReport.ts) and shown as the CSV check shows a result.
 *
 * Nothing here is sent anywhere, and nothing from a saved report fills in the CSV check: not the files, the premises,
 * the counts or "allow identical content". Imported reports are not authenticated, and every view of one says so.
 */
import { ArrowLeft, Download, FileUp, GitCompareArrows, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { DestinationOnlyList, Notices, Premises, RecordCard, ResultExplanation, Value } from "../components/report/ReportParts";
import { FeedbackLink } from "../components/report/Feedback";
import { Gloss } from "../components/report/Gloss";
import { PagesOriginNotice, StorageProblem } from "../components/report/Storage";
import { PageHead, SectionHead } from "../components/ui/atelier";
import { buttonClass } from "../components/ui/primitives";
import { Seal, StatusBadge, StatusGlyph } from "../components/ui/status";
import type { Counts } from "../offline/evaluator";
import { explain } from "../offline/explain";
import { NotAReport, instant, readReport, readReportFile, viewOf, type ReadReport } from "../offline/savedReport";
import { cn } from "../lib/cn";
import { saveBlob } from "../lib/download";
import { useAllFontFaces } from "../lib/fonts";
import { useReportStore, type Obtained, type SavedEntry } from "../lib/savedReports";

type Load<T> = { kind: "loading" } | { kind: "ready"; value: T } | { kind: "failed"; error: unknown };

const SHOWN_STATES = ["Verified", "Mismatch", "Unverified"] as const;

export const obtainedText = (o: Obtained) => (o.kind === "checked" ? "Checked in this browser" : "Imported from a file");

/** A report's file name when it is downloaded: the imported file's own name, or the name the CSV check gives it. */
const downloadName = (o: Obtained) => (o.kind === "imported" ? o.fileName : "flowassert-report.json");

/** What a saved report is, and is not: imported reports are not authenticated, and no saved report is. */
export function Provenance({ obtained, compact = false }: { obtained: Obtained; compact?: boolean }) {
  if (obtained.kind === "imported") {
    return (
      <p className={cn("text-xs leading-[1.5] text-unverified-ink", !compact && "rounded-md border border-dashed border-unverified-line px-3 py-2")} data-provenance="imported">
        {compact
          ? "Not authenticated: imported from a file."
          : "Not authenticated: this report was imported from a file. FlowAssert did not make it here and cannot tell who wrote it or whether it was changed; its files, statements and numbers are what the file says."}
      </p>
    );
  }
  return (
    <p className="text-xs leading-[1.5] text-ink-3" data-provenance="checked">
      {compact
        ? "Kept from a check in this browser. Not authenticated."
        : "Kept from a check in this browser, when you asked. A saved report is not authenticated: anyone using this browser profile can read or change it."}
    </p>
  );
}

function CountList({ counts, label }: { counts: Counts; label?: string }) {
  const list = (
    <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {SHOWN_STATES.map((s) => (
        <div key={s} className="flex items-center gap-1.5">
          <StatusGlyph state={s} size={10} />
          <dt className="text-ink-2">{s}</dt>
          <dd className="font-mono tabular text-ink" data-count={s}>
            {counts[s]}
          </dd>
        </div>
      ))}
    </dl>
  );
  if (!label) return list;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span className="text-ink-3">{label}</span>
      {list}
    </div>
  );
}

const pair = ([s, d]: readonly [string, string]) => (s === d ? s : `${s} → ${d}`);

/* ---------- The list ---------- */

function EntryCard({ entry, chosen, canChoose, onChoose, onDelete }: { entry: SavedEntry; chosen: boolean; canChoose: boolean; onChoose: (v: boolean) => void; onDelete: () => void }) {
  const store = useReportStore();
  const id = useId();
  const s = entry.summary;
  const [problem, setProblem] = useState<unknown>(null);
  const download = async () => {
    try {
      const bytes = await store.bytes(entry.id);
      if (bytes) saveBlob(new Blob([bytes as BlobPart], { type: "application/json" }), downloadName(entry.obtained));
    } catch (e) {
      setProblem(e);
    }
  };
  return (
    <li className="surface min-w-0 rounded-md px-4 py-3" data-entry={entry.id} data-testid="saved-entry">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
            <StatusBadge state={s.cohortState} />
            <span id={`${id}-time`} className="min-w-0">
              <span className="text-ink-3">evaluated at </span>
              <Value>{s.evaluatedAt}</Value>
            </span>
          </p>
          <p className="mt-1 text-xs text-ink-2">
            <span>{obtainedText(entry.obtained)}</span>
            {entry.obtained.kind === "imported" && (
              <>
                {" · "}
                <Value className="text-ink-2">{entry.obtained.fileName}</Value>
              </>
            )}
            {" · "}
            <span className="text-ink-3">saved at </span>
            <Value className="text-ink-2">{entry.savedAt}</Value>
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-ink-2">
          <input
            type="checkbox"
            checked={chosen}
            disabled={!chosen && !canChoose}
            onChange={(e) => onChoose(e.target.checked)}
            aria-labelledby={`${id}-choose ${id}-time`}
            className="size-4 accent-(--fa-ink)"
            data-testid="choose-entry"
          />
          <span id={`${id}-choose`}>Choose for comparison</span>
        </label>
      </div>
      <div className="mt-2 grid gap-1">
        <CountList counts={s.counts} />
        {s.destinationOnlyCounts && <CountList counts={s.destinationOnlyCounts} label="Destination-only" />}
      </div>
      <dl className="mt-2 grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[110px_minmax(0,1fr)]">
        <dt className="text-ink-3">Key</dt>
        <dd className="min-w-0">
          <Value>{pair(s.key)}</Value>
        </dd>
        <dt className="text-ink-3">Fields</dt>
        <dd className="min-w-0">
          <Value>{s.fields.map(pair).join(", ")}</Value>
        </dd>
        <dt className="text-ink-3">Redacted</dt>
        <dd className="text-ink-2">{s.redacted ? "yes: keys and values are not in the report" : "no: the report holds keys and compared values"}</dd>
        <dt className="text-ink-3">Details</dt>
        <dd className="font-mono text-ink-2" data-no-translate>
          {s.details}
        </dd>
      </dl>
      {entry.obtained.kind === "imported" && (
        <div className="mt-2">
          <Provenance obtained={entry.obtained} compact />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={`#/check/reports/${encodeURIComponent(entry.id)}`} className={buttonClass("default", "sm")} aria-describedby={`${id}-time`} data-testid="open-entry">
          Open
        </a>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={() => void download()} aria-describedby={`${id}-time`} data-testid="download-entry">
          <Download size={13} aria-hidden />
          Download
        </button>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={onDelete} aria-describedby={`${id}-time`} data-testid="delete-entry">
          <Trash2 size={13} aria-hidden />
          Delete
        </button>
      </div>
      {problem !== null && (
        <p role="status" className="mt-1 text-xs text-mismatch-ink">
          <StorageProblem error={problem} />
        </p>
      )}
    </li>
  );
}

type Message = { tone: "ok" | "refused"; body: ReactNode } | null;

export function SavedReportsPage() {
  useAllFontFaces();
  const store = useReportStore();
  const [entries, setEntries] = useState<Load<SavedEntry[]>>({ kind: "loading" });
  const [chosen, setChosen] = useState<string[]>([]);
  const [message, setMessage] = useState<Message>(null);
  const [confirming, setConfirming] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const reload = useCallback(async () => {
    try {
      const list = await store.list();
      setEntries({ kind: "ready", value: list });
      setChosen((c) => c.filter((id) => list.some((e) => e.id === id)));
    } catch (e) {
      setEntries({ kind: "failed", error: e });
    }
  }, [store]);
  useEffect(() => void reload(), [reload]);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  // The message is a status region: a screen reader reads it without focus moving there.
  const say = (m: Message) => setMessage(m);

  const importFile = async (file: File) => {
    let read: ReadReport;
    try {
      read = await readReportFile(file);
    } catch (e) {
      if (!(e instanceof NotAReport)) throw e;
      return say({
        tone: "refused",
        body: (
          <>
            <span>Refused, and nothing was kept: the file is not a valid FlowAssert report. </span>
            <Value className="text-inherit">{e.message}</Value>
          </>
        ),
      });
    }
    try {
      await store.add(read, { kind: "imported", fileName: file.name });
    } catch (e) {
      return say({
        tone: "refused",
        body: (
          <>
            <span>The report was not kept. </span>
            <StorageProblem error={e} />
          </>
        ),
      });
    }
    say({
      tone: "ok",
      body: (
        <>
          <span>Imported:</span> <Value className="text-inherit">{file.name}</Value> <span>An imported report is not authenticated.</span>
        </>
      ),
    });
    await reload();
  };

  const remove = async (entry: SavedEntry) => {
    try {
      await store.remove(entry.id);
      say({ tone: "ok", body: <span>The report was deleted from this browser.</span> });
    } catch (e) {
      say({ tone: "refused", body: <StorageProblem error={e} /> });
    }
    await reload();
  };

  const removeAll = async () => {
    setConfirming(false);
    try {
      await store.removeAll();
      setChosen([]);
      say({ tone: "ok", body: <span>Every saved report was deleted from this browser.</span> });
    } catch (e) {
      say({ tone: "refused", body: <StorageProblem error={e} /> });
    }
    await reload();
  };

  const list = entries.kind === "ready" ? entries.value : [];
  const pairChosen = chosen.length === 2 ? chosen.map((id) => list.find((e) => e.id === id)!).filter(Boolean) : [];
  // Earlier first, by evaluated_at; the comparison page lets the user swap them.
  const ordered = pairChosen.length === 2 ? [...pairChosen].sort((a, b) => (instant(a.summary.evaluatedAt) < instant(b.summary.evaluatedAt) ? -1 : instant(a.summary.evaluatedAt) > instant(b.summary.evaluatedAt) ? 1 : 0)) : [];
  const size = list.reduce((n, e) => n + e.summary.size, 0);

  return (
    <div className="grid gap-10">
      <PageHead
        kicker="Check in this browser · kept only when you ask"
        title="Saved reports"
        aside={<FeedbackLink />}
        lede={
          <>
            <p>Reports you chose to keep from the CSV check, and reports you imported from the command line, the GitHub Action or n8n. Nothing here was uploaded, and nothing is sent.</p>
            <p className="mt-2">A saved report records the premises that were stated for it. They are shown with it and never reused: a new check starts with nothing stated.</p>
          </>
        }
      />

      <section aria-labelledby="storage-h">
        <SectionHead id="storage-h" title="Where they are kept" aside="this browser profile only" />
        <div className="surface grid gap-2 rounded-lg px-4 py-3 text-sm text-ink-2 sm:px-6">
          <p>
            <span>{store.where}</span>
            {typeof location !== "undefined" && (
              <>
                {" · "}
                <Value className="text-ink-2">{location.origin}</Value>
              </>
            )}
          </p>
          {entries.kind === "ready" && <p data-testid="storage-use">{list.length === 1 ? `1 report, ${size} bytes.` : `${list.length} reports, ${size} bytes.`}</p>}
          <p className="text-xs leading-[1.5] text-ink-3">
            Anyone using this browser profile can read them. They stay until you delete them here, or clear this site’s data in the browser.
          </p>
          <PagesOriginNotice className="rounded-md border border-dashed border-unverified-line px-3 py-2 text-xs leading-[1.5] text-unverified-ink" />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" className={buttonClass("default", "sm")} onClick={() => importInput.current?.click()} data-testid="import-report">
              <FileUp size={13} aria-hidden />
              Import a JSON report
            </button>
            <input
              ref={importInput}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              data-testid="import-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importFile(file);
              }}
            />
            {list.length > 0 && !confirming && (
              <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setConfirming(true)} data-testid="delete-all">
                <Trash2 size={13} aria-hidden />
                Delete all saved reports
              </button>
            )}
          </div>
          <p className="text-xs text-ink-3">An imported report is checked as a FlowAssert report before it is kept. It is not authenticated.</p>
          {confirming && (
            <div role="group" aria-labelledby="confirm-h" className="rounded-md border border-mismatch-line px-3 py-2.5">
              <p id="confirm-h" className="text-sm text-ink">
                {list.length === 1 ? "Delete the 1 saved report from this browser? This cannot be undone." : `Delete all ${list.length} saved reports from this browser? This cannot be undone.`}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button ref={confirmRef} type="button" className={buttonClass("primary", "sm")} onClick={() => void removeAll()} data-testid="confirm-delete-all">
                  Delete all
                </button>
                <button type="button" className={buttonClass("default", "sm")} onClick={() => setConfirming(false)}>
                  Keep them
                </button>
              </div>
            </div>
          )}
          <p role="status" className="text-sm" data-testid="saved-message">
            {message && <span className={message.tone === "refused" ? "text-mismatch-ink" : "text-ink-2"}>{message.body}</span>}
          </p>
        </div>
      </section>

      <section aria-labelledby="list-h">
        <SectionHead id="list-h" title="Reports" aside="the most recently saved first" />
        {entries.kind === "loading" && (
          <p role="status" className="text-sm text-ink-3">
            Reading the saved reports…
          </p>
        )}
        {entries.kind === "failed" && (
          <p role="status" className="text-sm text-mismatch-ink" data-testid="storage-unavailable">
            <span>Saved reports are not available in this browser. </span>
            <StorageProblem error={entries.error} />
            <span> The CSV check still works; its reports can be downloaded.</span>
          </p>
        )}
        {entries.kind === "ready" && list.length === 0 && (
          <p className="text-sm text-ink-3" data-testid="no-saved-reports">
            No report is kept in this browser. Keep one from a result of the CSV check, or import a JSON report.
          </p>
        )}
        {list.length > 0 && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              {ordered.length === 2 ? (
                <a
                  href={`#/check/compare?earlier=${encodeURIComponent(ordered[0]!.id)}&later=${encodeURIComponent(ordered[1]!.id)}`}
                  className={buttonClass("primary", "sm")}
                  data-testid="compare-chosen"
                >
                  <GitCompareArrows size={13} aria-hidden />
                  Compare the two chosen reports
                </a>
              ) : (
                <span className="text-xs text-ink-3">{list.length < 2 ? "Two saved reports can be compared." : "Choose two reports to compare them."}</span>
              )}
            </div>
            <ul className="grid gap-2" aria-label="Saved reports">
              {list.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  chosen={chosen.includes(entry.id)}
                  canChoose={chosen.length < 2}
                  onChoose={(v) => setChosen((c) => (v ? [...c, entry.id] : c.filter((x) => x !== entry.id)))}
                  onDelete={() => void remove(entry)}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

/* ---------- One saved report ---------- */

export type Opened = { entry: SavedEntry; read: ReadReport } | { entry: SavedEntry; refused: NotAReport } | null;

/** Read a saved entry again from its bytes: null when there is no such entry. */
export async function openEntry(store: ReturnType<typeof useReportStore>, id: string): Promise<Opened> {
  const [entry, bytes] = await Promise.all([store.entry(id), store.bytes(id)]);
  if (!entry || !bytes) return null;
  try {
    return { entry, read: readReport(bytes, entry.obtained.kind === "imported" ? entry.obtained.fileName : "saved report") };
  } catch (e) {
    if (e instanceof NotAReport) return { entry, refused: e };
    throw e;
  }
}

export function BackToSaved() {
  return (
    <a href="#/check/reports" className={cn(buttonClass("ghost", "sm"), "-ml-2.5")}>
      <ArrowLeft size={13} aria-hidden />
      Saved reports
    </a>
  );
}

export function SavedReportPage({ id }: { id: string }) {
  useAllFontFaces();
  const store = useReportStore();
  const [opened, setOpened] = useState<Load<Opened>>({ kind: "loading" });
  const [deleted, setDeleted] = useState<{ ok: boolean; error?: unknown } | null>(null);
  const [shown, setShown] = useState(100);

  useEffect(() => {
    let live = true;
    openEntry(store, id).then(
      (value) => live && setOpened({ kind: "ready", value }),
      (error: unknown) => live && setOpened({ kind: "failed", error }),
    );
    return () => void (live = false);
  }, [store, id]);

  const remove = async () => {
    try {
      await store.remove(id);
      setDeleted({ ok: true });
    } catch (error) {
      setDeleted({ ok: false, error });
    }
  };

  const head = (lede: ReactNode) => <PageHead kicker="Check in this browser · saved report" title="Saved report" lede={lede} />;

  if (opened.kind === "loading")
    return (
      <div className="grid gap-6">
        {head(<p>Reading the saved report…</p>)}
      </div>
    );
  if (opened.kind === "failed")
    return (
      <div className="grid gap-6">
        {head(
          <p className="text-mismatch-ink" data-testid="storage-unavailable">
            <span>Saved reports are not available in this browser. </span>
            <StorageProblem error={opened.error} />
          </p>,
        )}
        <BackToSaved />
      </div>
    );
  const value = opened.value;
  if (!value || deleted?.ok)
    return (
      <div className="grid gap-6">
        {head(<p data-testid="no-such-report">{deleted?.ok ? "The report was deleted from this browser." : "No saved report has this address. It may have been deleted."}</p>)}
        <BackToSaved />
      </div>
    );

  const { entry } = value;
  const actions = (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClass("primary")} onClick={() => void store.bytes(id).then((b) => b && saveBlob(new Blob([b as BlobPart], { type: "application/json" }), downloadName(entry.obtained)))} data-testid="download-saved">
        <Download size={14} aria-hidden />
        Download the original report
      </button>
      <button type="button" className={buttonClass()} onClick={() => void remove()} data-testid="delete-saved">
        <Trash2 size={14} aria-hidden />
        Delete from this browser
      </button>
    </div>
  );
  const facts = (
    <dl className="mt-3 grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[130px_minmax(0,1fr)]">
      <dt className="text-ink-3">Obtained</dt>
      <dd className="text-ink-2">
        <span>{obtainedText(entry.obtained)}</span>
        {entry.obtained.kind === "imported" && (
          <>
            {" · "}
            <Value className="text-ink-2">{entry.obtained.fileName}</Value>
          </>
        )}
      </dd>
      <dt className="text-ink-3">Saved</dt>
      <dd>
        <Value className="text-ink-2">{entry.savedAt}</Value>
      </dd>
    </dl>
  );

  if ("refused" in value)
    return (
      <div className="grid gap-6">
        {head(
          <>
            <p className="text-mismatch-ink" data-testid="saved-refused">
              <span>This saved entry is not a valid FlowAssert report any more, so nothing of it is shown. </span>
              <Value className="text-inherit">{value.refused.message}</Value>
            </p>
            {facts}
          </>,
        )}
        {actions}
        <BackToSaved />
      </div>
    );

  const { report, redacted } = value.read;
  const view = viewOf(report);
  const total = view.expectedTotal === null ? "unknown total" : String(view.expectedTotal);
  return (
    <div className="grid gap-8">
      {head(
        <>
          <Provenance obtained={entry.obtained} />
          {facts}
        </>,
      )}
      <section aria-labelledby="saved-result-h" data-result={view.cohort}>
        <SectionHead id="saved-result-h" title="Result" aside="as the report records it" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <Seal state={view.cohort} size="lg" />
            <p className="mt-3 max-w-[60ch] text-md leading-[1.55] text-ink">
              {view.claim === null ? (
                "No claim is made: the result is not Verified."
              ) : (
                <>
                  <span data-no-translate lang="en">
                    {view.claim}
                  </span>
                  <Gloss text={view.claim} className="text-sm" />
                </>
              )}
            </p>
            <p className="mt-2 text-xs text-ink-3">
              <span>evaluated at </span>
              <Value className="text-ink-3">{report.evaluated_at}</Value>
              {" · "}
              <span>details </span>
              <Value className="text-ink-3">{report.details}</Value>
              {redacted && (
                <>
                  {" · "}
                  <span>redacted</span>
                </>
              )}
            </p>
            <p className="mt-3 text-sm text-ink-2">{view.expectedTotal === null ? `${view.sourceRows} rows of unknown total` : `${view.sourceRows} rows of ${total}`}</p>
            <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {SHOWN_STATES.map((s) => (
                <div key={s} className="flex items-center gap-1.5">
                  <StatusGlyph state={s} size={11} />
                  <dt>{s}</dt>
                  <dd className="font-mono tabular text-ink" data-count={s}>
                    {view.counts[s]}
                  </dd>
                </div>
              ))}
            </dl>
            <Notices view={view} />
            <p className="mt-4 max-w-[70ch] text-xs leading-[1.55] text-ink-3">
              <span data-no-translate lang="en">
                {view.limitations}
              </span>
              <Gloss text={view.limitations} />
            </p>
            <dl className="mt-3 grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[130px_minmax(0,1fr)]">
              <dt className="text-ink-3">Key</dt>
              <dd className="min-w-0">
                <Value>{pair(report.obligation.key)}</Value>
              </dd>
              <dt className="text-ink-3">Fields</dt>
              <dd className="min-w-0">
                <Value>{report.obligation.fields.map((f, i) => `${pair(f)} (${report.obligation.rules?.[i] ?? "exact"})`).join(", ")}</Value>
              </dd>
              <dt className="text-ink-3">Source file</dt>
              <dd className="min-w-0">
                <Value className="text-ink-2">{report.inputs.source_sha256}</Value>
              </dd>
              <dt className="text-ink-3">Destination file</dt>
              <dd className="min-w-0">
                <Value className="text-ink-2">{report.inputs.destination_sha256}</Value>
              </dd>
            </dl>
            <div className="mt-4">{actions}</div>
            {deleted && !deleted.ok && (
              <p role="status" className="mt-2 text-xs text-mismatch-ink">
                <StorageProblem error={deleted.error} />
              </p>
            )}
          </div>
          <Premises premises={view.premises} />
        </div>

        <ResultExplanation explanation={explain(report, { redacted })} />

        <h3 className="serif mt-8 text-xl text-ink">{`Records that are not Verified (${view.problemCount})`}</h3>
        {view.problemCount === 0 ? (
          <p className="mt-1 text-sm text-ink-3">Every source record is Verified.</p>
        ) : (
          <>
            <ul className="mt-2 grid gap-2">
              {view.problems.slice(0, shown).map((r) => (
                <RecordCard key={r.source_row} record={r} />
              ))}
            </ul>
            {shown < view.problems.length && (
              <button type="button" className={cn(buttonClass(), "mt-2")} onClick={() => setShown((n) => n + 100)}>
                Show more records
              </button>
            )}
            {view.problemCount > view.problems.length && shown >= view.problems.length && (
              <p className="mt-2 text-xs text-ink-3">{`The first ${view.problems.length} are listed here; the report holds all ${view.problemCount}.`}</p>
            )}
          </>
        )}
        <DestinationOnlyList view={view} />
      </section>
      <BackToSaved />
    </div>
  );
}
