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
import type { DragEvent } from "react";
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { PageHead, SectionHead } from "../components/ui/atelier";
import { buttonClass } from "../components/ui/primitives";
import { Notices, Premises, ResultExplanation, Value } from "../components/report/ReportParts";
import { RecordExplorer } from "../components/report/Explorer";
import { FeedbackLink } from "../components/report/Feedback";
import { Gloss, SummaryGlosses } from "../components/report/Gloss";
import { PagesOriginNotice, StorageProblem } from "../components/report/Storage";
import { Seal, StatusBadge, StatusGlyph } from "../components/ui/status";
import { canonicalConfig, readConfig, Refused } from "../offline/check";
import { ENCODINGS, type Encoding, type LineEndings } from "../offline/csv";
import { Abandoned, beforeYouCheck, type Bom, type FileProfile, type KeyProfileResult, type ProfileResult, type SideFacts, type Warning } from "../offline/profile";
import { TimeLeft, timeLeftText } from "../offline/eta";
import { EvaluatorError, parseRule, type Scope } from "../offline/evaluator";
import type { ChosenConfig } from "../offline/pageCheck";
import { SUPPORTED_DIRECTIVES } from "../offline/strptime";
import { Cancelled, inThreadRunner, workerRunner, type CheckRunner, type HeaderResult, type Progress, type Reading, type RunInput, type RunResult } from "../offline/runner";
import { HINT_BYTES, refusalHint, type Hint, type HintFile, type HintPart } from "../offline/refusalHint";
import { readReport } from "../offline/savedReport";
import { cn } from "../lib/cn";
import { useLocation, useReplaceParams } from "../lib/router";
import { ANY, EXPLORER_PARAMS, changesAddress, type RecordStore } from "../offline/explore";
import { saveBlob } from "../lib/download";
import { useAllFontFaces } from "../lib/fonts";
import { useReportStore } from "../lib/savedReports";
import exampleSource from "../../../offline/examples/source.csv?raw";
import exampleDestination from "../../../offline/examples/destination.csv?raw";
import { SCENARIOS, chosenOf, premisesText, type Scenario } from "./scenarios";

type Side = "source" | "destination";
type RuleKind = "exact" | "trim" | "casefold" | "digits" | "date";
type HeaderState = { kind: "none" } | { kind: "reading" } | { kind: "read"; result: HeaderResult };
/** The file profile (offline/profile.ts): read from the file as soon as it is chosen, never a result. */
type ProfileState = { kind: "none" } | { kind: "reading"; rows: number } | { kind: "read"; result: ProfileResult } | { kind: "failed"; message: string };

interface Choice {
  file: File | null;
  encoding: Encoding;
  header: HeaderState;
  profile: ProfileState;
}

/** The key profile of the key column chosen for one file, with what it was read for. */
interface KeyRead {
  file: File;
  encoding: Encoding;
  column: string;
  result: KeyProfileResult;
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
  | { kind: "running"; progress: Progress | null; left: number | null }
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
/** A count as the page writes it: 1,000,000. */
const grouped = (n: number) => n.toLocaleString("en-US");

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

/** A size as the profile writes it: bytes, and above 1 KiB a rounded unit too. */
function sizeText(bytes: number): string {
  const exact = bytes === 1 ? "1 byte" : `${grouped(bytes)} bytes`;
  if (bytes < 1024) return exact;
  const [unit, value] = bytes < 1024 ** 2 ? ["KiB", bytes / 1024] : ["MiB", bytes / 1024 ** 2];
  return `${value.toFixed(1)} ${unit} · ${exact}`;
}

const BOM_TEXT: Record<Bom, string> = {
  none: "no byte order mark",
  "utf-8": "UTF-8 byte order mark",
  "utf-16-le": "byte order mark: little-endian",
  "utf-16-be": "byte order mark: big-endian",
  gb18030: "GB18030 byte order mark, kept in the first column name",
};

/** The line endings met, as the profile names them; a mix gives the count of each. */
function endingsText(e: LineEndings): string {
  const kinds = (
    [
      ["LF", e.lf],
      ["CRLF", e.crlf],
      ["CR", e.cr],
    ] as const
  ).filter(([, n]) => n > 0);
  if (!kinds.length) return "no line ending";
  if (kinds.length === 1) return kinds[0]![0];
  return `mixed: ${kinds.map(([k, n]) => `${k} ${grouped(n)}`).join(", ")}`;
}

/** How many columns are listed before the list scrolls inside its own box. */
const OPEN_COLUMNS = 12;

function ProfileView({ profile, testId, columnsLabel }: { profile: FileProfile; testId: string; columnsLabel: string }) {
  const empty = profile.columns.filter((c) => c.empty > 0).length;
  return (
    <div data-testid={testId} data-rows={profile.rows}>
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-ink-3">Data rows</dt>
        <dd className="font-mono tabular text-ink" data-profile="rows">
          {grouped(profile.rows)}
        </dd>
        <dt className="text-ink-3">Columns</dt>
        <dd className="text-ink-2">
          <span className="font-mono tabular text-ink">{grouped(profile.columns.length)}</span>
          {empty > 0 && (
            <>
              <span aria-hidden> · </span>
              <span>{`${grouped(empty)} with empty cells`}</span>
            </>
          )}
        </dd>
        <dt className="text-ink-3">Encoding</dt>
        <dd className="text-ink-2">
          <span>{ENCODINGS[profile.encoding]}</span>
          <span aria-hidden> · </span>
          <span>{BOM_TEXT[profile.bom]}</span>
        </dd>
        <dt className="text-ink-3">Line endings</dt>
        <dd className="font-mono text-[11.5px] text-ink-2" data-profile="endings">
          <span>{endingsText(profile.endings)}</span>
        </dd>
        <dt className="text-ink-3">Size</dt>
        <dd className="font-mono text-[11.5px] tabular text-ink-2">
          <span>{sizeText(profile.size)}</span>
        </dd>
      </dl>
      {profile.columns.length > 0 && (
        <details className="mt-1.5 text-xs">
          <summary className="cursor-pointer text-ink-2">Columns and empty cells</summary>
          <div className={cn("mt-1 rounded-sm border border-line-subtle", profile.columns.length > OPEN_COLUMNS && "max-h-64 overflow-y-auto")} tabIndex={profile.columns.length > OPEN_COLUMNS ? 0 : undefined} role={profile.columns.length > OPEN_COLUMNS ? "region" : undefined} aria-label={profile.columns.length > OPEN_COLUMNS ? columnsLabel : undefined}>
            <table className="w-full table-fixed text-left">
              <thead className="sr-only">
                <tr>
                  <th scope="col">Column</th>
                  <th scope="col">Empty cells</th>
                </tr>
              </thead>
              <tbody>
                {profile.columns.map((c, i) => (
                  <tr key={i} className="border-t border-line-subtle first:border-t-0">
                    <td className="px-2 py-0.5">
                      <Value className="text-[11.5px]">{c.name}</Value>
                    </td>
                    <td className={cn("w-28 px-2 py-0.5 text-right font-mono tabular", c.empty ? "text-ink" : "text-ink-3")}>{c.empty === 1 ? "1 empty" : `${grouped(c.empty)} empty`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

/** The profile of a chosen file, under its own label, or the refusal the check would give it. */
function ProfilePart({ side, profile, sources }: { side: Side; profile: ProfileState; sources: readonly HintSource[] }) {
  if (profile.kind === "none") return null;
  const refused = profile.kind === "read" && !profile.result.ok ? profile.result.message : null;
  return (
    <section aria-label={side === "source" ? "Profile of the source file" : "Profile of the destination export"} className="mt-3 border-t border-line-subtle pt-2" data-testid={`${side}-profile-part`} data-state={profile.kind === "read" ? (profile.result.ok ? "ready" : "refused") : profile.kind}>
      <p className="text-2xs font-semibold tracking-wide text-ink-3 uppercase">
        <span>File profile</span>
        <span aria-hidden> · </span>
        <span className="font-normal tracking-normal normal-case">read from the file, before any check</span>
      </p>
      <div aria-live="polite" className="min-h-4">
        {profile.kind === "reading" && <p className="mt-1 text-xs text-ink-2">{profile.rows ? `Reading the file… ${grouped(profile.rows)} rows so far` : "Reading the file…"}</p>}
        {profile.kind === "failed" && (
          <p className="mt-1 text-xs text-mismatch-ink">
            <span>The file could not be read: </span>
            <Value className="text-mismatch-ink">{profile.message}</Value>
          </p>
        )}
        {refused !== null && (
          <p className="mt-1 text-xs text-mismatch-ink" data-testid={`${side}-profile-refused`}>
            <span>A check would refuse this file: </span>
            <Value className="text-mismatch-ink">{refused}</Value>
            <Gloss text={refused} />
          </p>
        )}
      </div>
      {refused !== null && <RefusalHelp message={refused} sources={sources} />}
      {profile.kind === "read" && profile.result.ok && <ProfileView profile={profile.result.profile} testId={`${side}-profile`} columnsLabel={side === "source" ? "Columns and empty cells of the source file" : "Columns and empty cells of the destination export"} />}
    </section>
  );
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

function FilePicker({
  side,
  choice,
  onFile,
  onEncoding,
  keyReady,
}: {
  side: Side;
  choice: Choice;
  onFile: (file: File | null) => void;
  onEncoding: (encoding: Encoding) => void;
  /** Whether the key profile of the chosen key column is read (for the large-file test). */
  keyReady: boolean;
}) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dropNote, setDropNote] = useState<string | null>(null);
  const over = (e: DragEvent<HTMLFieldSetElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };
  const leave = (e: DragEvent<HTMLFieldSetElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
  };
  const drop = (e: DragEvent<HTMLFieldSetElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragging(false);
    const files = e.dataTransfer.files;
    if (files.length !== 1) return setDropNote(files.length ? "Drop one file: none was taken." : null);
    setDropNote(null);
    onFile(files[0]!);
  };
  const title = side === "source" ? "Source file" : "Destination export";
  const hint =
    side === "source" ? "The records that should have reached the destination." : "An export from the system the records should have reached.";
  const header = choice.header;
  const sources = useMemo(() => [{ file: choice.file, encoding: choice.encoding }], [choice.file, choice.encoding]);
  return (
    <fieldset
      className={cn("relative min-w-0 rounded-md border px-4 pt-2 pb-4", dragging ? "border-brand" : "border-line")}
      onDragEnter={over}
      onDragOver={over}
      onDragLeave={leave}
      onDrop={drop}
      data-testid={`${side}-panel`}
      data-dragging={dragging || undefined}
      data-key-profile={keyReady ? "ready" : undefined}
    >
      <legend className="px-1 text-sm font-semibold text-ink">{title}</legend>
      {dragging && (
        <div aria-hidden className="pointer-events-none absolute inset-1 z-10 grid place-items-center rounded-md border-2 border-dashed border-brand bg-brand-soft/90 text-sm font-medium text-brand-ink" data-testid={`${side}-drop-here`}>
          Drop the file here
        </div>
      )}
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
        {!choice.file && <span className="text-sm text-ink-3">No file chosen, or drop one on this panel</span>}
      </div>
      {dropNote && (
        <p role="status" className="mt-1 text-xs text-mismatch-ink" data-testid={`${side}-drop-note`}>
          {dropNote}
        </p>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid={`${side}-file`}
        onChange={(e) => {
          setDropNote(null);
          onFile(e.target.files?.[0] ?? null);
        }}
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
      {choice.file && !(header.kind === "read" && !header.result.ok) && <ProfilePart side={side} profile={choice.profile} sources={sources} />}
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

function WarningParts({ parts }: { parts: Warning["parts"] }) {
  return (
    <>
      {parts.map((p, i) => (typeof p === "string" ? <span key={i}>{p}</span> : <Value key={i} className="text-[0.95em]">{p.value}</Value>))}
    </>
  );
}

/** What a check started now would do with the files as profiled. Advisory: it changes nothing and is not a result. */
function BeforeYouCheck({ lines }: { lines: Warning[] }) {
  return (
    <div aria-live="polite">
      {lines.length > 0 && (
        <section aria-labelledby="before-check-h" className="my-2 rounded-md border border-dashed border-line-strong px-3 py-2" data-testid="before-check">
          <h3 id="before-check-h" className="text-2xs font-semibold tracking-wide text-ink-3 uppercase">
            <span>Before you check</span>
            <span aria-hidden> · </span>
            <span className="font-normal tracking-normal normal-case">read from the files</span>
          </h3>
          <ul className="mt-1 grid gap-1 text-xs leading-[1.5] text-ink">
            {lines.map((l) => (
              <li key={l.id} className="flex gap-2" data-warning={l.id.split(":")[0]}>
                <span aria-hidden className="text-ink-3">
                  —
                </span>
                <span className="min-w-0">
                  <WarningParts parts={l.parts} />
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-ink-3">These lines are read from the files. They change nothing you chose, and they are not a result.</p>
        </section>
      )}
    </div>
  );
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

function Result({ result, headingRef, store }: { result: RunResult; headingRef: RefObject<HTMLHeadingElement | null>; store: RecordStore }) {
  const view = result.view!;
  const { params } = useLocation();
  const replace = useReplaceParams("/check");
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

      <section aria-labelledby="explore-h" className="mt-8">
        <h3 id="explore-h" className="serif text-xl text-ink">
          Explore the records
        </h3>
        <p className="mt-1 max-w-[70ch] text-sm text-ink-2">
          {view.problemCount === 0 ? "Every source record is Verified." : view.problemCount === 1 ? "1 source record is not Verified." : `${grouped(view.problemCount)} source records are not Verified.`}{" "}
          <span className="text-ink-3">The filters choose which records of the report are listed; they change nothing in it.</span>
        </p>
        <RecordExplorer store={store} params={params} replace={replace} start={view.problemCount ? { ...ANY, state: "not-verified" } : ANY} label="Records of this result" />
      </section>

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
const noProfile: ProfileState = { kind: "none" };

export function Check({ runner: given }: { runner?: CheckRunner }) {
  // Without Worker (jsdom) the same code runs in this thread.
  const [runner] = useState<CheckRunner>(() => given ?? (typeof Worker === "function" ? workerRunner(startWorker) : inThreadRunner()));
  useEffect(() => () => runner.dispose(), [runner]);
  // Load every font face now, so a check that shows new characters never fetches one.
  useAllFontFaces();

  const [choices, setChoices] = useState<Record<Side, Choice>>({
    source: { file: null, encoding: "utf-8", header: noHeader, profile: noProfile },
    destination: { file: null, encoding: "utf-8", header: noHeader, profile: noProfile },
  });
  const profileReads = useRef<Record<Side, Reading<ProfileResult> | null>>({ source: null, destination: null });
  const [keyReads, setKeyReads] = useState<Record<Side, KeyRead | null>>({ source: null, destination: null });
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
  const eta = useRef<TimeLeft | null>(null);
  const clearExplorer = useReplaceParams("/check");

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
    setChoices((c) => ({ ...c, [side]: { file, encoding, header: file ? { kind: "reading" } : noHeader, profile: file ? { kind: "reading", rows: 0 } : noProfile } }));
    changed();
    profileReads.current[side]?.abandon();
    profileReads.current[side] = null;
    if (!file) return;
    const current = () => read === headerReads.current[side];
    const settle = (result: HeaderResult) => current() && setChoices((c) => ({ ...c, [side]: { ...c[side], header: { kind: "read", result } } }));
    runner.header(file, encoding).then(settle, (e: unknown) => settle({ ok: false, message: e instanceof Error ? e.message : String(e) }));
    // The profile reads the whole file in the other worker, so the column lists never wait for it.
    const setProfile = (profile: ProfileState) => current() && setChoices((c) => ({ ...c, [side]: { ...c[side], profile } }));
    const reading = runner.profile(file, encoding, (rows) => setProfile({ kind: "reading", rows }));
    profileReads.current[side] = reading;
    reading.result.then(
      (result) => setProfile({ kind: "read", result }),
      (e: unknown) => !(e instanceof Abandoned) && setProfile({ kind: "failed", message: e instanceof Error ? e.message : String(e) }),
    );
  };

  // The key profile of each key column, once its file's profile is ready; a change of file, encoding or column
  // gives up the read in progress.
  const keyFor = (side: Side) => {
    const c = choices[side];
    const column = key[side === "source" ? 0 : 1];
    const ready = c.profile.kind === "read" && c.profile.result.ok && c.profile.result.profile.columns.some((x) => x.name === column);
    return { file: ready ? c.file : null, encoding: c.encoding, column };
  };
  const sourceKeyFor = keyFor("source");
  const destinationKeyFor = keyFor("destination");
  const keyRead = (side: Side, want: { file: File | null; encoding: Encoding; column: string }) => {
    const { file, encoding, column } = want;
    if (!file) return;
    let live = true;
    const reading = runner.keyProfile(file, encoding, column);
    reading.result.then(
      (result) => live && setKeyReads((k) => ({ ...k, [side]: { file, encoding, column, result } })),
      () => undefined, // given up, or the file could no longer be read: no key profile is shown
    );
    return () => {
      live = false;
      reading.abandon();
    };
  };
  useEffect(() => keyRead("source", sourceKeyFor), [runner, sourceKeyFor.file, sourceKeyFor.encoding, sourceKeyFor.column]);
  useEffect(() => keyRead("destination", destinationKeyFor), [runner, destinationKeyFor.file, destinationKeyFor.encoding, destinationKeyFor.column]);
  /** The key profile read for exactly the current choice, or null. */
  const keyProfileOf = (side: Side) => {
    const want = side === "source" ? sourceKeyFor : destinationKeyFor;
    const got = keyReads[side];
    return got && want.file === got.file && want.encoding === got.encoding && want.column === got.column && got.result.ok ? got.result.key : null;
  };
  // A file dropped beside a panel is not opened by the browser in place of this page: only a panel takes a file.
  useEffect(() => {
    const guard = (e: globalThis.DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);
  useEffect(
    () => () => {
      profileReads.current.source?.abandon();
      profileReads.current.destination?.abandon();
    },
    [],
  );

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

  const factsOf = (side: Side): SideFacts => {
    const c = choices[side];
    const at = side === "source" ? 0 : 1;
    return {
      fileName: c.file?.name ?? null,
      profile: c.profile.kind === "read" && c.profile.result.ok ? c.profile.result.profile : null,
      key: keyProfileOf(side),
      columns: [key[at], ...fields.map((f) => (at === 0 ? f.source : f.destination))].filter(Boolean),
      complete: side === "source" ? sourceComplete : destinationComplete,
      count: side === "source" ? sourceCount : destinationCount,
    };
  };
  const warnings = beforeYouCheck(factsOf("source"), factsOf("destination"));
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
    setRun({ kind: "running", progress: null, left: null });
    // A new result opens on its own first view: what the address said of the last one does not apply to it.
    const cleared = Object.fromEntries(EXPLORER_PARAMS.map((p) => [p, null]));
    if (changesAddress(cleared)) clearExplorer(cleared);
    const id = ++runs.current;
    running.current = id;
    const timeLeft = new TimeLeft(performance.now());
    eta.current = timeLeft;
    // A check that was stopped or replaced delivers nothing, whatever the runner still returns.
    try {
      const result = await runner.run(input, (progress) =>
        setRun((r) => (r.kind === "running" && running.current === id ? { kind: "running", progress, left: timeLeft.update(progress.fraction, performance.now()) } : r)),
      );
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

  // Between two progress reports the time left keeps counting down with the clock.
  const isRunning = run.kind === "running";
  useEffect(() => {
    if (!isRunning) return;
    const tick = setInterval(() => {
      setRun((r) => (r.kind === "running" && r.progress && eta.current ? { ...r, left: eta.current.update(r.progress.fraction, performance.now()) } : r));
    }, 250);
    return () => clearInterval(tick);
  }, [isRunning]);

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

  // The records of the result, read from the check worker as the explorer asks for them.
  const store = useMemo(() => (run.kind === "done" && run.result.view ? runner.records(run.result.view.facts) : null), [run, runner]);
  const progress = run.kind === "running" ? run.progress : null;
  const percent = progress ? Math.round(progress.fraction * 100) : 0;

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
          <FilePicker side="source" choice={choices.source} keyReady={keyProfileOf("source") !== null} onFile={(f) => (setScenario(null), readColumns("source", f, choices.source.encoding))} onEncoding={(e) => readColumns("source", choices.source.file, e)} />
          <FilePicker
            side="destination"
            choice={choices.destination}
            keyReady={keyProfileOf("destination") !== null}
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
          <BeforeYouCheck lines={warnings} />
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
            <p className="mt-1.5 flex flex-wrap gap-x-1.5 text-xs text-ink-2">
              <span aria-live="polite">{progress ? PHASE[progress.phase] : "Starting the check"}</span>
              <span aria-hidden>·</span>
              <span data-testid="time-left">{timeLeftText(run.left)}</span>
            </p>
            <p className="mt-0.5 flex flex-wrap gap-x-1.5 font-mono text-[11.5px] tabular text-ink-3" data-testid="rows-read">
              <span>{`Source ${grouped(progress?.sourceRows ?? 0)} rows`}</span>
              <span aria-hidden>·</span>
              <span>{`Destination ${grouped(progress?.destinationRows ?? 0)} rows`}</span>
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

      {run.kind === "done" && run.result.view && store && <Result key={runs.current} result={run.result} headingRef={resultHeading} store={store} />}
    </div>
  );
}
