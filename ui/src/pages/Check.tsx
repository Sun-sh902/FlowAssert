/**
 * CSV check (#/check): the offline check of flowassert-verify, in this browser. The user chooses a source CSV and a
 * destination export, the columns and a rule per field, the scope and the premises; the check runs in a Web Worker on
 * this computer and the page shows the result with the four-state components, and offers the same JSON and HTML
 * reports as the command line, byte for byte (see ui/src/offline/).
 *
 * Nothing is preselected or inferred, and nothing is remembered: files, statements, counts and choices live in this
 * component's state only, never in storage or the address. Only a configuration file the user downloads keeps the
 * column and rule choices. Values from the files are marked data-no-translate, so the Chinese interface never alters them.
 *
 * A result's JSON report is kept in this browser only when the user presses "Keep this report in this browser", for
 * that one report (lib/savedReports.ts); the files are never kept. Nothing from a saved report fills in this page.
 */
import { Archive, Download, FileUp, Library, Play, Plus, Square, Trash2, Upload } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { PageHead, SectionHead } from "../components/ui/atelier";
import { buttonClass } from "../components/ui/primitives";
import { DestinationOnlyList, Notices, Premises, RecordCard, ResultExplanation, Value } from "../components/report/ReportParts";
import { FeedbackLink } from "../components/report/Feedback";
import { Gloss, SummaryGlosses } from "../components/report/Gloss";
import { PagesOriginNotice, StorageProblem } from "../components/report/Storage";
import { Seal, StatusBadge, StatusGlyph } from "../components/ui/status";
import { canonicalConfig, readConfig, Refused } from "../offline/check";
import { ENCODINGS, type Encoding } from "../offline/csv";
import { EvaluatorError, parseRule, type Scope } from "../offline/evaluator";
import type { ChosenConfig } from "../offline/pageCheck";
import { SUPPORTED_DIRECTIVES } from "../offline/strptime";
import { Cancelled, inThreadRunner, workerRunner, type CheckRunner, type HeaderResult, type Progress, type RunInput, type RunResult } from "../offline/runner";
import { HINT_BYTES, refusalHint, type Hint, type HintFile, type HintPart } from "../offline/refusalHint";
import { readReport } from "../offline/savedReport";
import { cn } from "../lib/cn";
import { saveBlob } from "../lib/download";
import { useAllFontFaces } from "../lib/fonts";
import { useReportStore } from "../lib/savedReports";
import exampleSource from "../../../offline/examples/source.csv?raw";
import exampleDestination from "../../../offline/examples/destination.csv?raw";
import { SCENARIOS, chosenOf, premisesText, type Scenario } from "./scenarios";

type Side = "source" | "destination";
type RuleKind = "exact" | "trim" | "casefold" | "digits" | "date";
type HeaderState = { kind: "none" } | { kind: "reading" } | { kind: "read"; result: HeaderResult };

interface Choice {
  file: File | null;
  encoding: Encoding;
  header: HeaderState;
}

interface FieldRow {
  id: number;
  source: string;
  destination: string;
  rule: RuleKind;
  format: string;
}

type RunState =
  | { kind: "idle" }
  | { kind: "running"; progress: Progress | null }
  | { kind: "done"; result: RunResult }
  | { kind: "failed"; message: string }
  | { kind: "cancelled"; changed?: boolean };

const ENCODING_LABEL: Record<Encoding, string> = {
  "utf-8": "UTF-8 (byte order mark optional)",
  "utf-16": "UTF-16 (byte order mark required)",
  gb18030: "GB18030",
};

const RULES: { value: RuleKind; label: string }[] = [
  { value: "exact", label: "exact — the strings as they are" },
  { value: "trim", label: "trim — without leading and trailing spaces" },
  { value: "casefold", label: "casefold — ignoring upper and lower case" },
  { value: "digits", label: "digits — only the digits 0–9" },
  { value: "date", label: "date — read with a date format" },
];

const PHASE: Record<Progress["phase"], string> = {
  "reading-source": "Reading the source file",
  "reading-destination": "Reading the destination file",
  evaluating: "Evaluating the records",
  "writing-reports": "Writing the reports",
};

const COUNT = /^[0-9]+$/;

const ruleText = (row: FieldRow) => (row.rule === "date" ? `date:${row.format}` : row.rule);

function ruleProblem(row: FieldRow): string | null {
  if (row.rule !== "date") return null;
  try {
    parseRule(ruleText(row));
    return null;
  } catch (e) {
    if (e instanceof EvaluatorError) return e.message;
    throw e;
  }
}

/** The page's choices as a configuration, or null while something is missing or invalid. */
function selectionOf(key: [string, string], fields: FieldRow[], scope: Scope): ChosenConfig | null {
  if (!key[0] || !key[1] || !fields.length) return null;
  if (fields.some((f) => !f.source || !f.destination || ruleProblem(f))) return null;
  if (new Set(fields.map((f) => f.source)).size !== fields.length) return null;
  return { key, fields: fields.map((f) => [f.source, f.destination, ruleText(f)] as const), scope };
}

/* ---------- Help after a refusal ---------- */

interface HintSource {
  file: File | null;
  encoding: Encoding;
  /** The columns the check needs from this file, when they are chosen. */
  columns?: readonly string[];
}

/** The hint for a refusal (offline/refusalHint.ts), from the first bytes of the chosen files; null while none is justified. */
function useHint(message: string, sources: readonly HintSource[]): Hint | null {
  const [found, setFound] = useState<{ message: string; sources: readonly HintSource[]; hint: Hint | null } | null>(null);
  useEffect(() => {
    let live = true;
    const read = sources
      .filter((s): s is HintSource & { file: File } => s.file !== null)
      .map(async (s): Promise<HintFile> => ({ name: s.file.name, size: s.file.size, encoding: s.encoding, columns: s.columns, head: new Uint8Array(await s.file.slice(0, HINT_BYTES).arrayBuffer()) }));
    // Reading a chosen file is local; a file that can no longer be read gives no hint.
    Promise.all(read).then(
      (files) => live && setFound({ message, sources, hint: refusalHint(message, files) }),
      () => live && setFound({ message, sources, hint: null }),
    );
    return () => void (live = false);
  }, [message, sources]);
  return found && found.message === message && found.sources === sources ? found.hint : null;
}

function HintParts({ parts }: { parts: readonly HintPart[] }) {
  return (
    <>
      {parts.map((p, i) => (typeof p === "string" ? <span key={i}>{p}</span> : <Value key={i} className="text-[0.95em] text-ink">{p.value}</Value>))}
    </>
  );
}

/** A suggestion under a refusal, which the person may follow by changing a choice; it never acts by itself. */
function RefusalHelp({ message, sources }: { message: string; sources: readonly HintSource[] }) {
  const hint = useHint(message, sources);
  if (!hint) return null;
  return (
    <div className="mt-2 max-w-[72ch] rounded-md border border-dashed border-line-strong px-3 py-2 text-xs leading-[1.5] text-ink-2" data-testid="refusal-hint" data-hint={hint.kinds.join(" ")}>
      <p className="font-semibold text-ink">What might help</p>
      {hint.paragraphs.map((p, i) => (
        <p key={i} className="mt-1">
          <HintParts parts={p} />
        </p>
      ))}
      <p className="mt-1 text-ink-3">A suggestion only: nothing was changed, and the check was not tried again.</p>
    </div>
  );
}

/* ---------- Files ---------- */

function FilePicker({
  side,
  choice,
  onFile,
  onEncoding,
}: {
  side: Side;
  choice: Choice;
  onFile: (file: File | null) => void;
  onEncoding: (encoding: Encoding) => void;
}) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const title = side === "source" ? "Source file" : "Destination export";
  const hint =
    side === "source" ? "The records that should have reached the destination." : "An export from the system the records should have reached.";
  const header = choice.header;
  const sources = useMemo(() => [{ file: choice.file, encoding: choice.encoding }], [choice.file, choice.encoding]);
  return (
    <fieldset className="min-w-0 rounded-md border border-line px-4 pt-2 pb-4">
      <legend className="px-1 text-sm font-semibold text-ink">{title}</legend>
      <p className="text-xs text-ink-3">{hint}</p>
      <div className="fa-field">
        <span className="label" id={`${id}-file-label`}>
          CSV file
        </span>
      </div>
      {/* The browser draws a file input's own button and "no file" text in the system's language, whatever the
          interface language is, so the input stays hidden and this button, in the interface's words, opens it. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass("default", "sm")}
          aria-labelledby={`${id}-file-label ${id}-file-button`}
          id={`${id}-file-button`}
          onClick={() => fileInput.current?.click()}
          data-testid={`${side}-choose-file`}
        >
          <FileUp size={13} aria-hidden />
          Choose a file
        </button>
        {!choice.file && <span className="text-sm text-ink-3">No file chosen</span>}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid={`${side}-file`}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <label className="fa-field mt-2">
        <span className="label">Encoding</span>
        <select value={choice.encoding} onChange={(e) => onEncoding(e.target.value as Encoding)} data-testid={`${side}-encoding`}>
          {(Object.keys(ENCODINGS) as Encoding[]).map((e) => (
            <option key={e} value={e}>
              {ENCODING_LABEL[e]}
            </option>
          ))}
        </select>
      </label>
      <div role="status" className="mt-1 min-h-5 text-xs text-ink-2">
        {choice.file && (
          <>
            <span data-no-translate className="font-mono text-ink">
              {choice.file.name}
            </span>
            {" · "}
            {header.kind === "reading" && <span>Reading the header…</span>}
            {header.kind === "read" && header.result.ok && <span>{`${header.result.columns.length} columns`}</span>}
          </>
        )}
      </div>
      {header.kind === "read" && !header.result.ok && (
        <>
          <p className="mt-1 text-xs text-mismatch-ink">
            <span>Refused: </span>
            <Value className="text-mismatch-ink">{header.result.message}</Value>
            <Gloss text={header.result.message} />
          </p>
          <RefusalHelp message={header.result.message} sources={sources} />
        </>
      )}
    </fieldset>
  );
}

/* ---------- Scenarios ---------- */

/**
 * Small synthetic scenarios (./scenarios.ts): each says what to expect with which premises. Choosing one fills in its
 * files and configuration; the premises stay as they are, unstated until the person states them.
 */
function ScenarioPanel({ inUse, onUse }: { inUse: string | null; onUse: (s: Scenario) => void }) {
  const used = SCENARIOS.find((s) => s.id === inUse);
  return (
    <section aria-labelledby="scenarios-h" className="mt-4 rounded-md border border-line px-4 py-3" data-testid="scenarios">
      <h3 id="scenarios-h" className="text-sm font-semibold text-ink">
        No files at hand? Try a scenario
      </h3>
      <p className="mt-0.5 max-w-[78ch] text-xs leading-[1.5] text-ink-3">
        Each scenario is a pair of small synthetic files. Using one fills in its two files, its columns and its rules. It states nothing for you: the statements in step 3 are yours to make, and in these files they are true by construction.
      </p>
      <ul className="mt-2 grid gap-3 lg:grid-cols-2">
        {SCENARIOS.map((s) => (
          <li key={s.id} className="surface flex min-w-0 flex-col rounded-md px-3 py-2.5" data-scenario={s.id}>
            <p className="text-sm font-medium text-ink">{s.title}</p>
            <p className="mt-0.5 text-xs leading-[1.5] text-ink-2">{s.description}</p>
            <p className="mt-2 text-2xs font-semibold tracking-wide text-ink-3 uppercase">What to expect</p>
            <dl className="mt-1 grid gap-1.5 text-xs">
              {s.expect.map((e) => (
                <div key={premisesText(e.premises)} className="min-w-0">
                  <dt className="flex flex-wrap items-center gap-x-2 text-ink-2">
                    <span>{premisesText(e.premises)}</span>
                    <StatusBadge state={e.result} size="sm" />
                  </dt>
                  <dd className="mt-0.5 leading-[1.5] text-ink-3">{e.why}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-auto pt-2">
              <button type="button" className={buttonClass("default", "sm")} onClick={() => onUse(s)} data-testid={`scenario-${s.id}`}>
                <FileUp size={13} aria-hidden />
                <span>Use this scenario</span>
                <span className="sr-only">{`: ${s.title}`}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p role="status" className="mt-2 text-xs text-ink-2" data-testid="scenario-status">
        {used && (
          <>
            <span>Scenario in use:</span> <span>{used.title}</span>
            <span>. Its files and configuration are filled in, and nothing is stated.</span>
          </>
        )}
      </p>
    </section>
  );
}

/* ---------- Column choices ---------- */

function ColumnSelect({ label, value, columns, onChange, testId }: { label: string; value: string; columns: string[]; onChange: (v: string) => void; testId: string }) {
  // A column a loaded configuration names but the file does not have stays visible, so the check can refuse it.
  const options = value && !columns.includes(value) ? [...columns, value] : columns;
  return (
    <label className="fa-field min-w-0">
      <span className="label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} className="min-w-0">
        <option value="">Choose a column</option>
        {options.map((c) => (
          <option key={c} value={c} data-no-translate>
            {columns.includes(c) ? c : `${c} (not in the file)`}
          </option>
        ))}
      </select>
    </label>
  );
}

function FieldEditor({
  row,
  index,
  sourceColumns,
  destinationColumns,
  repeated,
  onChange,
  onRemove,
}: {
  row: FieldRow;
  index: number;
  sourceColumns: string[];
  destinationColumns: string[];
  repeated: boolean;
  onChange: (row: FieldRow) => void;
  onRemove: () => void;
}) {
  const problem = ruleProblem(row);
  const formatId = useId();
  return (
    <li className="grid gap-x-4 border-t border-line-subtle py-2 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:items-end" data-testid={`field-${index}`}>
      <ColumnSelect label="Source column" value={row.source} columns={sourceColumns} onChange={(source) => onChange({ ...row, source })} testId={`field-${index}-source`} />
      <ColumnSelect label="Destination column" value={row.destination} columns={destinationColumns} onChange={(destination) => onChange({ ...row, destination })} testId={`field-${index}-destination`} />
      <div className="min-w-0">
        <label className="fa-field">
          <span className="label">Rule</span>
          <select value={row.rule} onChange={(e) => onChange({ ...row, rule: e.target.value as RuleKind })} data-testid={`field-${index}-rule`}>
            {RULES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {row.rule === "date" && (
          <label className="fa-field" data-invalid={problem ? true : undefined}>
            <span className="label">Date format</span>
            <input
              value={row.format}
              onChange={(e) => onChange({ ...row, format: e.target.value })}
              placeholder="%Y-%m-%d"
              spellCheck={false}
              aria-invalid={problem ? true : undefined}
              aria-describedby={formatId}
              data-testid={`field-${index}-format`}
              className="font-mono"
            />
          </label>
        )}
      </div>
      <button type="button" onClick={onRemove} className={cn(buttonClass("ghost", "sm"), "mb-2 justify-self-start")} aria-label={`Remove field ${index + 1}`}>
        <Trash2 size={13} aria-hidden />
        <span className="sm:sr-only">Remove</span>
      </button>
      {(problem || repeated || row.rule === "date") && (
        <p id={formatId} className="pb-1 text-xs sm:col-span-4">
          {repeated && <span className="block text-mismatch-ink">This source column is already compared: a source field may appear once.</span>}
          {problem ? (
            <span className="block text-mismatch-ink">
              <Value className="text-mismatch-ink">{problem}</Value>
              <Gloss text={problem} />
            </span>
          ) : (
            row.rule === "date" && <span className="block text-ink-3">{`Python strptime directives: ${SUPPORTED_DIRECTIVES.map((d) => "%" + d).join(" ")}. A value with %z is compared in UTC.`}</span>
          )}
        </p>
      )}
    </li>
  );
}

/* ---------- Premises ---------- */

function Statement({ checked, onChange, title, body, testId, note }: { checked: boolean; onChange: (v: boolean) => void; title: string; body: string; testId: string; note?: string | null }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 py-2.5">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={note ? `${id}-b ${id}-n` : `${id}-b`} className="mt-1 size-4 shrink-0 accent-(--fa-ink)" data-testid={testId} />
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {title}
        </label>
        <p id={`${id}-b`} className="mt-0.5 text-xs leading-[1.5] text-ink-3">
          {body}
        </p>
        {note && (
          <p id={`${id}-n`} className="mt-1 text-xs font-medium leading-[1.5] text-ink-2" data-testid={`${testId}-note`}>
            {note}
          </p>
        )}
      </div>
    </div>
  );
}

function CountInput({ label, hint, value, onChange, testId, note }: { label: string; hint: string; value: string; onChange: (v: string) => void; testId: string; note?: string | null }) {
  const id = useId();
  const invalid = value !== "" && !COUNT.test(value);
  return (
    <label className="fa-field min-w-0 self-start" data-invalid={invalid || undefined}>
      <span className="label">{label}</span>
      <input inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={note ? `${id} ${id}-n` : id} data-testid={testId} autoComplete="off" />
      <span id={id} className={cn("text-xs", invalid ? "text-mismatch-ink" : "text-ink-3")}>
        {invalid ? "Write a whole number, with digits only, or leave it empty." : hint}
      </span>
      {note && (
        <span id={`${id}-n`} className="text-xs font-medium text-ink-2" data-testid={`${testId}-note`}>
          {note}
        </span>
      )}
    </label>
  );
}

/**
 * Where the last check found a stated total that differs from the rows it read, the notes shown beside that total and
 * its completeness statement: the checkbox stays ticked, but the check did not apply the statement. Read from that
 * check's report only; any change removes the result, and these notes with it.
 */
function countNotes(view: RunResult["view"] | undefined, side: Side): { statement: string | null; count: string | null } {
  const premises = new Map(view?.premises ?? []);
  const count = premises.get(`${side}_count`);
  if (!count || count.matched !== false) return { statement: null, count: null };
  const what = side === "source" ? "the file" : "the export";
  const stated = premises.get(`${side}_complete`)?.stated === true;
  return {
    statement: stated ? `Not applied in the last check: the total you entered (${String(count.stated)}) differs from the row count of ${what} (${count.observed}).` : null,
    count: stated
      ? `Not applied in the last check: this total differs from the row count of ${what} (${count.observed}), so the ${side} statement was withdrawn.`
      : `In the last check, this total differed from the row count of ${what} (${count.observed}).`,
  };
}

/* ---------- Result ---------- */

type KeepState = { kind: "idle" } | { kind: "keeping" } | { kind: "kept" } | { kind: "refused"; error: unknown };

/** Keep this one report in this browser, only when the user asks; a refusal leaves the result as it is. */
function KeepReport({ json }: { json: Blob }) {
  const store = useReportStore();
  const [state, setState] = useState<KeepState>({ kind: "idle" });
  const id = useId();
  const keep = async () => {
    setState({ kind: "keeping" });
    try {
      // The report is read back as any saved report is, so what is kept is a report the saved pages accept.
      const read = readReport(new Uint8Array(await json.arrayBuffer()), "flowassert-report.json");
      await store.add(read, { kind: "checked" });
      setState({ kind: "kept" });
    } catch (e) {
      // StorageUnavailable above all (blocked storage, a private window, no space); whatever it is, nothing was kept.
      setState({ kind: "refused", error: e });
    }
  };
  return (
    <div className="mt-5 max-w-[62ch] border-t border-line-subtle pt-4">
      <button
        type="button"
        className={buttonClass()}
        onClick={() => void keep()}
        disabled={state.kind === "keeping" || state.kind === "kept"}
        aria-describedby={`${id}-what`}
        data-testid="keep-report"
      >
        <Archive size={14} aria-hidden />
        Keep this report in this browser
      </button>
      <p id={`${id}-what`} className="mt-1.5 text-xs leading-[1.5] text-ink-3">
        The report holds the keys and compared values of the records. It stays in this browser profile until you delete it, and anyone using this browser profile can read it.
      </p>
      <PagesOriginNotice className="mt-1 text-xs leading-[1.5] text-ink-3" />
      <p role="status" className="mt-1.5 text-xs" data-testid="keep-status">
        {state.kind === "keeping" && <span className="text-ink-2">Keeping the report…</span>}
        {state.kind === "kept" && (
          <span className="text-ink-2">
            <span>This report is kept in this browser.</span>{" "}
            <a href="#/check/reports" className="font-medium text-ink underline decoration-line-strong underline-offset-[3px]">
              Open saved reports
            </a>
          </span>
        )}
        {state.kind === "refused" && (
          <span className="text-mismatch-ink" data-testid="keep-refused">
            <span>The report was not kept. </span>
            <StorageProblem error={state.error} />
            <span> The result on this page is unchanged.</span>
          </span>
        )}
      </p>
    </div>
  );
}

function Result({ result, headingRef }: { result: RunResult; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const view = result.view!;
  const [shown, setShown] = useState(100);
  const total = view.expectedTotal === null ? "unknown total" : String(view.expectedTotal);
  return (
    <section aria-labelledby="result-h" className="fade-in" data-result={view.cohort}>
      <SectionHead id="result-h" title="Result" aside="checked in this browser" />
      <h3 ref={headingRef} tabIndex={-1} className="sr-only">
        {`Result: ${view.cohort}`}
      </h3>
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
          <p className="mt-3 text-sm text-ink-2">{view.expectedTotal === null ? `${view.sourceRows} rows of unknown total` : `${view.sourceRows} rows of ${total}`}</p>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {(["Verified", "Mismatch", "Unverified"] as const).map((s) => (
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
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={buttonClass("primary")} onClick={() => saveBlob(result.json!, "flowassert-report.json")} data-testid="download-json">
              <Download size={14} aria-hidden />
              Download JSON report
            </button>
            <button type="button" className={buttonClass()} onClick={() => saveBlob(result.html!, "flowassert-report.html")} data-testid="download-html">
              <Download size={14} aria-hidden />
              Download HTML report
            </button>
          </div>
          <KeepReport json={result.json!} />
        </div>
        <Premises premises={view.premises} />
      </div>

      {result.explanation && <ResultExplanation explanation={result.explanation} />}

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
            <p className="mt-2 text-xs text-ink-3">{`The first ${view.problems.length} are listed here; the reports hold all ${view.problemCount}.`}</p>
          )}
        </>
      )}

      {view.destinationOnly && <DestinationOnlyList view={view} />}

      <h3 id="summary-h" className="serif mt-8 text-xl text-ink">
        Summary, as the command line prints it
      </h3>
      {/* Focusable, so a keyboard can scroll it where it is taller or wider than the screen. */}
      <pre data-testid="summary" tabIndex={0} role="region" aria-labelledby="summary-h" className="surface mt-2 max-h-96 overflow-auto rounded-md px-4 py-3 font-mono text-[12px] leading-[1.5] whitespace-pre-wrap text-ink">
        {result.summary}
      </pre>
      <SummaryGlosses summary={result.summary} />
    </section>
  );
}

/* ---------- Page ---------- */

function startWorker() {
  return new Worker(new URL("../offline/worker.ts", import.meta.url), { type: "module" });
}

const noHeader: HeaderState = { kind: "none" };

export function Check({ runner: given }: { runner?: CheckRunner }) {
  // Without Worker (jsdom) the same code runs in this thread.
  const [runner] = useState<CheckRunner>(() => given ?? (typeof Worker === "function" ? workerRunner(startWorker) : inThreadRunner()));
  useEffect(() => () => runner.dispose(), [runner]);
  // Load every font face now, so a check that shows new characters never fetches one.
  useAllFontFaces();

  const [choices, setChoices] = useState<Record<Side, Choice>>({
    source: { file: null, encoding: "utf-8", header: noHeader },
    destination: { file: null, encoding: "utf-8", header: noHeader },
  });
  const [key, setKey] = useState<[string, string]>(["", ""]);
  const nextId = useRef(1);
  const [fields, setFields] = useState<FieldRow[]>([{ id: 0, source: "", destination: "", rule: "exact", format: "" }]);
  const [scope, setScope] = useState<Scope>("source");
  const [loaded, setLoaded] = useState<{ name: string; bytes: Uint8Array; fingerprint: string } | null>(null);
  const [configMessage, setConfigMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [sourceComplete, setSourceComplete] = useState(false);
  const [destinationComplete, setDestinationComplete] = useState(false);
  const [sourceCount, setSourceCount] = useState("");
  const [destinationCount, setDestinationCount] = useState("");
  const [allowIdentical, setAllowIdentical] = useState(false);
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const [scenario, setScenario] = useState<string | null>(null);
  const headerReads = useRef<Record<Side, number>>({ source: 0, destination: 0 });
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const configInput = useRef<HTMLInputElement>(null);

  // Any change makes an earlier result stale: it is removed rather than shown beside choices it was not made with.
  // A change while a check runs stops that check, so its result never appears beside the new choices.
  /** The number of the check that is running, or 0. */
  const running = useRef(0);
  const runs = useRef(0);
  const lastView = run.kind === "done" ? run.result.view : null;
  const sourceNotes = countNotes(lastView, "source");
  const destinationNotes = countNotes(lastView, "destination");
  const changed = () => {
    if (!running.current) return setRun({ kind: "idle" });
    running.current = 0;
    runner.cancel();
    setRun({ kind: "cancelled", changed: true });
  };

  const readColumns = (side: Side, file: File | null, encoding: Encoding) => {
    const read = ++headerReads.current[side];
    // A statement was made about the file it was made for: another file needs it stated again.
    if (file !== choices[side].file) {
      if (side === "source") {
        setSourceComplete(false);
        setSourceCount("");
      } else {
        setDestinationComplete(false);
        setDestinationCount("");
      }
      setAllowIdentical(false);
    }
    setChoices((c) => ({ ...c, [side]: { file, encoding, header: file ? { kind: "reading" } : noHeader } }));
    changed();
    if (!file) return;
    const settle = (result: HeaderResult) => read === headerReads.current[side] && setChoices((c) => ({ ...c, [side]: { ...c[side], header: { kind: "read", result } } }));
    runner.header(file, encoding).then(settle, (e: unknown) => settle({ ok: false, message: e instanceof Error ? e.message : String(e) }));
  };

  const columns = (side: Side) => {
    const h = choices[side].header;
    return h.kind === "read" && h.result.ok ? h.result.columns : [];
  };
  const sourceColumns = columns("source");
  const destinationColumns = columns("destination");

  const selection = useMemo(() => selectionOf(key, fields, scope), [key, fields, scope]);
  // What a hint after a refused check may read: the chosen files, and the columns the check needed from each.
  const hintSources = useMemo<HintSource[]>(
    () => [
      { file: choices.source.file, encoding: choices.source.encoding, columns: selection ? [selection.key[0], ...selection.fields.map((f) => f[0])] : undefined },
      { file: choices.destination.file, encoding: choices.destination.encoding, columns: selection ? [selection.key[1], ...selection.fields.map((f) => f[1])] : undefined },
    ],
    [choices.source.file, choices.source.encoding, choices.destination.file, choices.destination.encoding, selection],
  );
  const fingerprint = selection ? JSON.stringify(selection) : null;
  const loadedUnchanged = loaded !== null && fingerprint === loaded.fingerprint;

  const missing: string[] = [];
  for (const side of ["source", "destination"] as const) {
    const c = choices[side];
    if (!c.file) missing.push(side === "source" ? "Choose the source file." : "Choose the destination export.");
    else if (c.header.kind !== "read" || !c.header.result.ok) missing.push(side === "source" ? "The source file must be readable." : "The destination export must be readable.");
  }
  if (!key[0] || !key[1]) missing.push("Choose the key column in both files.");
  if (fields.some((f) => !f.source || !f.destination)) missing.push("Choose both columns of every compared field.");
  if (!fields.length) missing.push("Add at least one compared field.");
  if (fields.some((f) => ruleProblem(f))) missing.push("Correct the date format.");
  if (new Set(fields.map((f) => f.source).filter(Boolean)).size !== fields.filter((f) => f.source).length) missing.push("Compare each source column once.");
  if ((sourceCount && !COUNT.test(sourceCount)) || (destinationCount && !COUNT.test(destinationCount))) missing.push("Write each count as a whole number, or leave it empty.");
  const ready = missing.length === 0 && selection !== null && run.kind !== "running";

  const updateField = (row: FieldRow) => {
    setFields((fs) => fs.map((f) => (f.id === row.id ? row : f)));
    changed();
  };

  const suggestPairs = () => {
    const used = new Set(fields.map((f) => f.source));
    const keep = fields.filter((f) => f.source || f.destination);
    const added = sourceColumns
      .filter((c) => destinationColumns.includes(c) && !used.has(c) && c !== key[0])
      .map((c) => ({ id: nextId.current++, source: c, destination: c, rule: "exact" as RuleKind, format: "" }));
    setFields([...keep, ...added]);
    changed();
  };

  const loadConfig = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const [chosen] = await readConfig({ name: file.name, size: file.size, read: () => bytes });
      const rows = chosen.fields.map(([source, destination, rule]) => ({
        id: nextId.current++,
        source,
        destination,
        rule: (rule.startsWith("date:") ? "date" : rule) as RuleKind,
        format: rule.startsWith("date:") ? rule.slice(5) : "",
      }));
      const nextScope = chosen.scope ?? "source";
      setKey(chosen.key);
      setFields(rows);
      setScope(nextScope);
      setLoaded({ name: file.name, bytes, fingerprint: JSON.stringify(selectionOf(chosen.key, rows, nextScope)) });
      setConfigMessage({ ok: true, text: file.name });
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      setConfigMessage({ ok: false, text: e.message });
    }
    changed();
  };

  const start = async () => {
    const source = choices.source.file;
    const destination = choices.destination.file;
    if (!ready || !source || !destination || !selection) return;
    const input: RunInput = {
      source,
      destination,
      sourceEncoding: choices.source.encoding,
      destinationEncoding: choices.destination.encoding,
      config: loadedUnchanged ? { loaded: { name: loaded.name, bytes: loaded.bytes } } : { chosen: selection },
      sourceComplete,
      destinationComplete,
      sourceCount: sourceCount || null,
      destinationCount: destinationCount || null,
      allowIdenticalContent: allowIdentical,
    };
    setRun({ kind: "running", progress: null });
    const id = ++runs.current;
    running.current = id;
    // A check that was stopped or replaced delivers nothing, whatever the runner still returns.
    try {
      const result = await runner.run(input, (progress) => setRun((r) => (r.kind === "running" ? { kind: "running", progress } : r)));
      if (running.current === id) setRun({ kind: "done", result });
    } catch (e) {
      if (e instanceof Cancelled || running.current !== id) return;
      setRun({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (running.current === id) running.current = 0;
    }
  };

  const cancel = () => {
    running.current = 0;
    runner.cancel();
    setRun({ kind: "cancelled" });
  };

  // A finished check moves focus to what it produced: the result, or the refusal or failure in its place.
  useEffect(() => {
    if (run.kind === "done" && run.result.view) resultHeading.current?.focus();
    else if (run.kind === "done" || run.kind === "failed" || run.kind === "cancelled") statusRef.current?.focus();
  }, [run]);

  /** Fill in a scenario's files and configuration; its files are UTF-8. Every statement starts unstated again. */
  const chooseScenario = (scenario: Scenario) => {
    readColumns("source", new File([scenario.source], "source.csv", { type: "text/csv" }), "utf-8");
    readColumns("destination", new File([scenario.destination], "destination.csv", { type: "text/csv" }), "utf-8");
    const chosen = chosenOf(scenario);
    setKey([chosen.key[0], chosen.key[1]]);
    setFields(chosen.fields.map(([source, destination, rule]) => ({ id: nextId.current++, source, destination, rule: (rule.startsWith("date:") ? "date" : rule) as RuleKind, format: rule.startsWith("date:") ? rule.slice(5) : "" })));
    setScope(chosen.scope);
    setLoaded(null);
    setConfigMessage(null);
    setScenario(scenario.id);
  };
  const sample = (text: string, name: string) => saveBlob(new Blob([text], { type: "text/csv" }), name);

  const progress = run.kind === "running" ? run.progress : null;
  const percent = progress && progress.total ? Math.round((progress.bytes / progress.total) * 100) : 0;

  return (
    <div className="grid gap-10">
      <PageHead
        kicker="Check in this browser · nothing is uploaded"
        title="CSV check"
        aside={
          <div className="rounded-md border border-line px-4 py-3 text-sm text-ink-2">
            <p className="font-semibold text-ink">Saved reports</p>
            <p className="mt-0.5 text-xs leading-[1.5] text-ink-3">Reports you chose to keep in this browser, or imported, and two of them compared.</p>
            <a href="#/check/reports" className={cn(buttonClass("default", "sm"), "mt-2")} data-testid="open-saved-reports">
              <Library size={13} aria-hidden />
              Open saved reports
            </a>
            <FeedbackLink className="mt-3 border-0 border-t border-line-subtle px-0 pb-0" />
          </div>
        }
        lede={
          <>
            <p>
              Compare a source CSV with an export from the destination system, with the rules, the result and the reports of the command-line flowassert-verify.
            </p>
            <p className="mt-2">
              <strong className="font-semibold text-ink">Your files stay on this computer.</strong> They are read in this browser and never sent anywhere. Nothing you choose here is
              stored: choose the files and state the premises again for every check.
            </p>
          </>
        }
      />

      <section aria-labelledby="files-h">
        <SectionHead id="files-h" title="1 · Files" aside="read on this computer" />
        <div className="grid gap-4 md:grid-cols-2">
          <FilePicker side="source" choice={choices.source} onFile={(f) => (setScenario(null), readColumns("source", f, choices.source.encoding))} onEncoding={(e) => readColumns("source", choices.source.file, e)} />
          <FilePicker
            side="destination"
            choice={choices.destination}
            onFile={(f) => (setScenario(null), readColumns("destination", f, choices.destination.encoding))}
            onEncoding={(e) => readColumns("destination", choices.destination.file, e)}
          />
        </div>
        <ScenarioPanel inUse={scenario} onUse={chooseScenario} />
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-2">
          <span>The files of the command line’s first example:</span>
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => sample(exampleSource, "source.csv")} data-testid="sample-source">
            <Download size={13} aria-hidden />
            <span data-no-translate>source.csv</span>
          </button>
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => sample(exampleDestination, "destination.csv")} data-testid="sample-destination">
            <Download size={13} aria-hidden />
            <span data-no-translate>destination.csv</span>
          </button>
        </div>
      </section>

      <section aria-labelledby="columns-h">
        <SectionHead id="columns-h" title="2 · Columns and rules" aside="chosen by you, never guessed" />
        <div className="surface rounded-lg px-4 pb-3 sm:px-6">
          <fieldset className="min-w-0 pt-3">
            <legend className="text-sm font-semibold text-ink">Key column</legend>
            <p className="text-xs text-ink-3">The stable record identifier, as each file names it.</p>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <ColumnSelect label="In the source file" value={key[0]} columns={sourceColumns} onChange={(v) => (setKey([v, key[1]]), changed())} testId="key-source" />
              <ColumnSelect label="In the destination export" value={key[1]} columns={destinationColumns} onChange={(v) => (setKey([key[0], v]), changed())} testId="key-destination" />
            </div>
          </fieldset>
          <fieldset className="min-w-0 border-t border-line pt-3">
            <legend className="sr-only">Compared fields</legend>
            <p aria-hidden className="text-sm font-semibold text-ink">
              Compared fields
            </p>
            <p className="text-xs text-ink-3">Each field is compared under the rule you choose. Rules are never inferred; exact is the default.</p>
            <ul className="mt-1">
              {fields.map((row, i) => (
                <FieldEditor
                  key={row.id}
                  row={row}
                  index={i}
                  sourceColumns={sourceColumns}
                  destinationColumns={destinationColumns}
                  repeated={!!row.source && fields.findIndex((f) => f.source === row.source) !== i}
                  onChange={updateField}
                  onRemove={() => (setFields((fs) => fs.filter((f) => f.id !== row.id)), changed())}
                />
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 py-2">
              <button
                type="button"
                className={buttonClass("default", "sm")}
                onClick={() => (setFields((fs) => [...fs, { id: nextId.current++, source: "", destination: "", rule: "exact", format: "" }]), changed())}
              >
                <Plus size={13} aria-hidden />
                Add a field
              </button>
              <button type="button" className={buttonClass("ghost", "sm")} onClick={suggestPairs} disabled={!sourceColumns.length || !destinationColumns.length} data-testid="suggest-pairs">
                Suggest: pair columns that have the same name
              </button>
            </div>
          </fieldset>
          <fieldset className="min-w-0 border-t border-line pt-3 pb-2">
            <legend className="text-sm font-semibold text-ink">Scope</legend>
            {(
              [
                ["source", "source", "Check each source record. The default."],
                ["exact", "exact", "Also report destination keys that are not in the source."],
              ] as const
            ).map(([value, title, body]) => (
              <label key={value} className="mt-1.5 flex items-start gap-3 text-sm">
                <input type="radio" name="scope" value={value} checked={scope === value} onChange={() => (setScope(value), changed())} className="mt-1 accent-(--fa-ink)" data-testid={`scope-${value}`} />
                <span>
                  <span className="font-mono text-ink">{title}</span>
                  <span className="text-ink-2"> — </span>
                  <span className="text-ink-2">{body}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <button
              type="button"
              className={buttonClass("default", "sm")}
              disabled={!selection}
              onClick={() => selection && saveBlob(new Blob([canonicalConfig(selection)], { type: "application/json" }), "flowassert-config.json")}
              data-testid="download-config"
            >
              <Download size={13} aria-hidden />
              Download configuration
            </button>
            <button type="button" className={buttonClass("default", "sm")} onClick={() => configInput.current?.click()} data-testid="load-config">
              <Upload size={13} aria-hidden />
              Load configuration
            </button>
            <input
              ref={configInput}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              data-testid="config-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void loadConfig(file);
              }}
            />
            <p role="status" className="w-full text-xs">
              {configMessage?.ok === true && (
                <span className="text-ink-2">
                  <span>{loadedUnchanged ? "Configuration loaded: " : "Configuration loaded, then changed: "}</span>
                  <Value>{configMessage.text}</Value>
                </span>
              )}
              {configMessage?.ok === false && (
                <span className="text-mismatch-ink">
                  <span>Configuration refused: </span>
                  <Value className="text-mismatch-ink">{configMessage.text}</Value>
                  <Gloss text={configMessage.text} />
                </span>
              )}
              {!configMessage && <span className="text-ink-3">The configuration file holds the key, the fields with their rules and the scope — never a premise.</span>}
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="premises-form-h">
        <SectionHead id="premises-form-h" title="3 · What you state" aside="not checked by FlowAssert" />
        <div className="surface rounded-lg px-4 py-2 sm:px-6">
          <p className="pt-2 text-sm text-ink-2">FlowAssert cannot check these statements. Each one you make is recorded in the report, with its origin, the browser form. A wrong statement gives a wrong result.</p>
          <Statement
            checked={sourceComplete}
            onChange={(v) => (setSourceComplete(v), changed())}
            title="The source file is the whole batch"
            body="Tick only if this file holds every record that should have reached the destination. Without this statement the batch can never be Verified."
            testId="source-complete"
            note={sourceNotes.statement}
          />
          <Statement
            checked={destinationComplete}
            onChange={(v) => (setDestinationComplete(v), changed())}
            title="The destination export covers the whole object"
            body="Tick only if the export holds every record of that object in the destination system, not a filtered view or one page of it. Without this statement, missing records and duplicates stay unknown."
            testId="destination-complete"
            note={destinationNotes.statement}
          />
          <div className="grid gap-x-6 border-t border-line-subtle sm:grid-cols-2">
            <CountInput
              label="Source total seen in the original system (optional)"
              hint="Compared with the rows in the file. A count that differs withdraws the source statement."
              value={sourceCount}
              onChange={(v) => (setSourceCount(v), changed())}
              testId="source-count"
              note={sourceNotes.count}
            />
            <CountInput
              label="Destination total seen in the original system (optional)"
              hint="Compared with the rows in the export. A count that differs withdraws the destination statement."
              value={destinationCount}
              onChange={(v) => (setDestinationCount(v), changed())}
              testId="destination-count"
              note={destinationNotes.count}
            />
          </div>
          <div className="border-t border-line-subtle">
            <Statement
              checked={allowIdentical}
              onChange={(v) => (setAllowIdentical(v), changed())}
              title="Allow identical content"
              body="Two files with exactly the same bytes are refused, because the check would not be independent. Tick only if they really come from different systems."
              testId="allow-identical"
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="run-h">
        <SectionHead id="run-h" title="4 · Check" aside="no request is made" />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={buttonClass("primary")} onClick={start} disabled={!ready} data-testid="run-check">
            <Play size={14} aria-hidden />
            Check
          </button>
          {run.kind === "running" && (
            <button type="button" className={buttonClass()} onClick={cancel} data-testid="cancel-check">
              <Square size={13} aria-hidden />
              Cancel
            </button>
          )}
        </div>
        {missing.length > 0 && run.kind !== "running" && (
          <ul className="mt-2 grid gap-0.5 text-xs text-ink-3" aria-label="Still to do">
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        {run.kind === "running" && (
          <div className="mt-3 max-w-xl" data-testid="progress">
            <div role="progressbar" aria-label="Check progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-sunken">
              <div className="h-full bg-brand transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-ink-2" aria-live="polite">
              <span>{progress ? PHASE[progress.phase] : "Starting the check"}</span>
              {progress && progress.rows > 0 && (
                <>
                  {" · "}
                  <span>{`${progress.rows} rows read`}</span>
                </>
              )}
            </p>
          </div>
        )}
        <p ref={statusRef} tabIndex={-1} role="status" className="mt-3 text-sm outline-none" data-testid="run-status">
          {run.kind === "cancelled" && (
            <span className="text-ink-2">{run.changed ? "The choices changed during the check, so it was stopped. No result is shown." : "Cancelled. No result is shown."}</span>
          )}
          {run.kind === "failed" && (
            <span className="text-mismatch-ink">
              <span>The check failed and no result is shown: </span>
              <Value className="text-mismatch-ink">{run.message}</Value>
            </span>
          )}
          {run.kind === "done" && !run.result.view && (
            <span className={run.result.exit === 2 ? "text-mismatch-ink" : "text-mismatch-ink"} data-testid="refusal">
              <span>{run.result.exit === 2 ? "Refused: nothing was checked. " : "The check failed and no result is shown. "}</span>
              <Value className="text-mismatch-ink">{run.result.message}</Value>
              <Gloss text={run.result.message} />
            </span>
          )}
        </p>
        {run.kind === "done" && !run.result.view && run.result.exit === 2 && <RefusalHelp message={run.result.message} sources={hintSources} />}
      </section>

      {run.kind === "done" && run.result.view && <Result result={run.result} headingRef={resultHeading} />}
    </div>
  );
}
