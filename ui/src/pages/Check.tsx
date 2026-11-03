/**
 * CSV check (#/check): the offline check of flowassert-verify, in this browser. The user chooses a source CSV and a
 * destination export, the columns and a rule per field, the scope and the premises; the check runs in a Web Worker on
 * this computer and the page shows the result with the four-state components, and offers the same JSON and HTML
 * reports as the command line, byte for byte (see ui/src/offline/).
 *
 * Nothing is preselected or inferred, and nothing is remembered: files, statements, counts and choices live in this
 * component's state only, never in storage or the address. Only a configuration file the user downloads keeps the
 * column and rule choices. Values from the files are marked data-no-translate, so the Chinese interface never alters them.
 */
import { Download, FileUp, Play, Plus, Square, Trash2, Upload } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { PageHead, SectionHead } from "../components/ui/atelier";
import { buttonClass } from "../components/ui/primitives";
import { RuleStatusIcon, RuleStatusLabel, Seal, StatusBadge, StatusGlyph } from "../components/ui/status";
import { canonicalConfig, readConfig, Refused } from "../offline/check";
import { ENCODINGS, type Encoding } from "../offline/csv";
import { EvaluatorError, parseRule, type Premise, type RuleResult, type Scope, type SourceRecord } from "../offline/evaluator";
import type { ChosenConfig } from "../offline/pageCheck";
import { pyRepr } from "../offline/pystr";
import { SUPPORTED_DIRECTIVES } from "../offline/strptime";
import { Cancelled, inThreadRunner, workerRunner, type CheckRunner, type HeaderResult, type Progress, type RunInput, type RunResult, type ResultView } from "../offline/runner";
import { cn } from "../lib/cn";
import { saveBlob } from "../lib/download";
import exampleSource from "../../../offline/examples/source.csv?raw";
import exampleDestination from "../../../offline/examples/destination.csv?raw";

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
  | { kind: "cancelled" };

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

const PREMISE_LABEL: Record<string, string> = {
  source_complete: "The source file is the whole batch",
  destination_complete: "The destination export covers the whole object",
  source_count: "Source total in the original system",
  destination_count: "Destination total in the original system",
  allow_identical_content: "The two identical files come from different systems",
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

function Value({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code data-no-translate className={cn("font-mono text-[12px] break-all whitespace-pre-wrap text-ink", className)}>
      {children}
    </code>
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
  const title = side === "source" ? "Source file" : "Destination export";
  const hint =
    side === "source" ? "The records that should have reached the destination." : "An export from the system the records should have reached.";
  const header = choice.header;
  return (
    <fieldset className="min-w-0 rounded-md border border-line px-4 pt-2 pb-4">
      <legend className="px-1 text-sm font-semibold text-ink">{title}</legend>
      <p className="text-xs text-ink-3">{hint}</p>
      <label className="fa-field" htmlFor={`${id}-file`}>
        <span className="label">CSV file</span>
      </label>
      <input
        id={`${id}-file`}
        type="file"
        accept=".csv,text/csv,text/plain"
        data-testid={`${side}-file`}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        className="block w-full max-w-full text-sm text-ink-2 file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink"
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
        <p className="mt-1 text-xs text-mismatch-ink">
          <span>Refused: </span>
          <Value className="text-mismatch-ink">{header.result.message}</Value>
        </p>
      )}
    </fieldset>
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

function Statement({ checked, onChange, title, body, testId }: { checked: boolean; onChange: (v: boolean) => void; title: string; body: string; testId: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 py-2.5">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={`${id}-b`} className="mt-1 size-4 shrink-0 accent-(--fa-ink)" data-testid={testId} />
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {title}
        </label>
        <p id={`${id}-b`} className="mt-0.5 text-xs leading-[1.5] text-ink-3">
          {body}
        </p>
      </div>
    </div>
  );
}

function CountInput({ label, hint, value, onChange, testId }: { label: string; hint: string; value: string; onChange: (v: string) => void; testId: string }) {
  const id = useId();
  const invalid = value !== "" && !COUNT.test(value);
  return (
    <label className="fa-field min-w-0" data-invalid={invalid || undefined}>
      <span className="label">{label}</span>
      <input inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={id} data-testid={testId} autoComplete="off" />
      <span id={id} className={cn("text-xs", invalid ? "text-mismatch-ink" : "text-ink-3")}>
        {invalid ? "Write a whole number, with digits only, or leave it empty." : hint}
      </span>
    </label>
  );
}

/* ---------- Result ---------- */

const yesNo = (v: boolean | number | bigint | null | undefined) => (v === null || v === undefined ? "none" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));

function Premises({ premises }: { premises: [string, Premise][] }) {
  return (
    <section aria-labelledby="premises-h" className="min-w-0 rounded-md border-2 border-unverified-line px-4 py-3">
      <h3 id="premises-h" className="text-sm font-semibold text-ink">
        Stated premises
      </h3>
      <p className="mt-0.5 text-xs text-ink-3">FlowAssert does not verify these statements. A wrong statement gives a wrong result.</p>
      <dl className="mt-2 grid gap-2">
        {premises.map(([name, p]) => (
          <div key={name} className="min-w-0 border-t border-line-subtle pt-2" data-premise={name}>
            <dt className="text-xs text-ink-2">
              {PREMISE_LABEL[name] ?? name} <span className="font-mono text-[10.5px] text-ink-4">{name}</span>
            </dt>
            <dd className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11.5px] text-ink">
              <span>
                <span className="text-ink-3">stated </span>
                {yesNo(p.stated)}
              </span>
              {"observed" in p && (
                <span>
                  <span className="text-ink-3">rows in file </span>
                  {String(p.observed)}
                </span>
              )}
              {"matched" in p && (
                <span>
                  <span className="text-ink-3">matched </span>
                  {yesNo(p.matched)}
                </span>
              )}
              <span>
                <span className="text-ink-3">origin </span>
                <span data-no-translate>{p.origin}</span>
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function RuleLine({ name, rule }: { name: string; rule: RuleResult }) {
  return (
    <li className="grid gap-1 border-t border-line-subtle py-2 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Value className="text-ink-2">{name}</Value>
        <span className="inline-flex items-center gap-1">
          <RuleStatusIcon status={rule.status} />
          <RuleStatusLabel status={rule.status} />
        </span>
        <span data-no-translate className="text-xs text-ink-3">
          {rule.reason}
        </span>
      </div>
      {"expected" in rule && (
        <div className="grid gap-0.5 text-xs sm:grid-cols-[90px_minmax(0,1fr)]">
          <span className="text-ink-3">Source value</span>
          <Value>{pyRepr(rule.expected)}</Value>
          <span className="text-ink-3">Destination value</span>
          <Value>{pyRepr(rule.actual)}</Value>
          {"expected_normalized" in rule && (
            <>
              <span className="text-ink-3">Compared as</span>
              <Value>{`${pyRepr(rule.expected_normalized)} vs ${pyRepr(rule.actual_normalized)}`}</Value>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function RecordCard({ record }: { record: SourceRecord }) {
  return (
    <li className="surface min-w-0 rounded-md px-4 py-3" data-record={record.source_row + 1}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-sm text-ink">
          <span>{`Record ${record.source_row + 1}`}</span>
          {" · "}
          {record.key === null ? <span className="text-ink-3">no key</span> : <Value>{record.key}</Value>}
        </p>
        <StatusBadge state={record.state} />
      </div>
      <ul className="mt-1.5">
        {Object.entries(record.rules ?? {}).map(([name, rule]) => (
          <RuleLine key={name} name={name} rule={rule} />
        ))}
      </ul>
    </li>
  );
}

function Notices({ view }: { view: ResultView }) {
  const lines: string[] = [];
  for (const [name, p] of view.premises) {
    if (p.matched !== false) continue;
    lines.push(
      name === "source_count"
        ? `Source count stated ${String(p.stated)}, file has ${p.observed} rows: the batch cannot be Verified.`
        : `Destination count stated ${String(p.stated)}, file has ${p.observed} rows: absence and uniqueness stay unknown.`,
    );
  }
  if (!view.populationKnown) lines.push("Source population unknown: the batch cannot be Verified.");
  if (!view.coverageSufficient) lines.push("Destination coverage not established: absence and uniqueness stay unknown.");
  if (view.destinationOnly) {
    const n = view.destinationOnlyCount;
    lines.push(
      !n
        ? "Destination-only: 0 records not in the source."
        : view.populationKnown
          ? `Destination-only: ${n} records not in the source, each a Mismatch.`
          : `Destination-only: ${n} records not in the source, listed without a conclusion.`,
    );
  }
  if (view.inputs.some(([k, v]) => k === "identical_content" && v === true)) lines.push("Source and destination files were identical (allowed in this check).");
  if (!lines.length) return null;
  return (
    <ul className="mt-3 grid gap-1 text-sm text-ink-2">
      {lines.map((line) => (
        <li key={line} className="flex gap-2">
          <span aria-hidden className="text-ink-4">
            —
          </span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
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
          <p className="mt-3 max-w-[60ch] text-md leading-[1.55] text-ink">{view.claim ?? "No claim is made: the result is not Verified."}</p>
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
          <p className="mt-4 max-w-[70ch] text-xs leading-[1.55] text-ink-3">{view.limitations}</p>
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
        </div>
        <Premises premises={view.premises} />
      </div>

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

      {view.destinationOnly && (
        <>
          <h3 className="serif mt-8 text-xl text-ink">{`Destination-only records (${view.destinationOnlyCount})`}</h3>
          {view.destinationOnly.length > 0 && (
            <ul className="mt-2 grid gap-2">
              {view.destinationOnly.map((r) => (
                <li key={r.key} className="surface flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span>{`Destination row ${r.destination_row + 1}`}</span>
                    {" · "}
                    <Value>{r.key}</Value>
                    {" · "}
                    <span className="text-ink-3">{`${r.rows} rows`}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge state={r.state} />
                    <span data-no-translate className="text-xs text-ink-3">
                      {r.reason}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <h3 id="summary-h" className="serif mt-8 text-xl text-ink">
        Summary, as the command line prints it
      </h3>
      {/* Focusable, so a keyboard can scroll it where it is taller or wider than the screen. */}
      <pre data-testid="summary" tabIndex={0} role="region" aria-labelledby="summary-h" className="surface mt-2 max-h-96 overflow-auto rounded-md px-4 py-3 font-mono text-[12px] leading-[1.5] whitespace-pre-wrap text-ink">
        {result.summary}
      </pre>
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
  useEffect(() => {
    if (typeof document !== "undefined" && document.fonts) document.fonts.forEach((face) => void face.load().catch(() => undefined));
  }, []);

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
  const headerReads = useRef<Record<Side, number>>({ source: 0, destination: 0 });
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const configInput = useRef<HTMLInputElement>(null);

  // Any change makes an earlier result stale: it is removed rather than shown beside choices it was not made with.
  const changed = () => setRun((r) => (r.kind === "running" ? r : { kind: "idle" }));

  const readColumns = (side: Side, file: File | null, encoding: Encoding) => {
    const read = ++headerReads.current[side];
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
    try {
      const result = await runner.run(input, (progress) => setRun((r) => (r.kind === "running" ? { kind: "running", progress } : r)));
      setRun({ kind: "done", result });
    } catch (e) {
      if (e instanceof Cancelled) return;
      setRun({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const cancel = () => {
    runner.cancel();
    setRun({ kind: "cancelled" });
  };

  // A finished check moves focus to what it produced: the result, or the refusal or failure in its place.
  useEffect(() => {
    if (run.kind === "done" && run.result.view) resultHeading.current?.focus();
    else if (run.kind === "done" || run.kind === "failed" || run.kind === "cancelled") statusRef.current?.focus();
  }, [run]);

  const useSamples = () => {
    readColumns("source", new File([exampleSource], "source.csv", { type: "text/csv" }), choices.source.encoding);
    readColumns("destination", new File([exampleDestination], "destination.csv", { type: "text/csv" }), choices.destination.encoding);
  };
  const sample = (text: string, name: string) => saveBlob(new Blob([text], { type: "text/csv" }), name);

  const progress = run.kind === "running" ? run.progress : null;
  const percent = progress && progress.total ? Math.round((progress.bytes / progress.total) * 100) : 0;

  return (
    <div className="grid gap-10">
      <PageHead
        kicker="Check in this browser · nothing is uploaded"
        title="CSV check"
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
          <FilePicker side="source" choice={choices.source} onFile={(f) => readColumns("source", f, choices.source.encoding)} onEncoding={(e) => readColumns("source", choices.source.file, e)} />
          <FilePicker
            side="destination"
            choice={choices.destination}
            onFile={(f) => readColumns("destination", f, choices.destination.encoding)}
            onEncoding={(e) => readColumns("destination", choices.destination.file, e)}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-2">
          <span>No files at hand? Sample files:</span>
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => sample(exampleSource, "source.csv")} data-testid="sample-source">
            <Download size={13} aria-hidden />
            <span data-no-translate>source.csv</span>
          </button>
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => sample(exampleDestination, "destination.csv")} data-testid="sample-destination">
            <Download size={13} aria-hidden />
            <span data-no-translate>destination.csv</span>
          </button>
          <button type="button" className={buttonClass("default", "sm")} onClick={useSamples} data-testid="use-samples">
            <FileUp size={13} aria-hidden />
            Use the sample files
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
          />
          <Statement
            checked={destinationComplete}
            onChange={(v) => (setDestinationComplete(v), changed())}
            title="The destination export covers the whole object"
            body="Tick only if the export holds every record of that object in the destination system, not a filtered view or one page of it. Without this statement, missing records and duplicates stay unknown."
            testId="destination-complete"
          />
          <div className="grid gap-x-6 border-t border-line-subtle sm:grid-cols-2">
            <CountInput
              label="Source total seen in the original system (optional)"
              hint="Compared with the rows in the file. A count that differs withdraws the source statement."
              value={sourceCount}
              onChange={(v) => (setSourceCount(v), changed())}
              testId="source-count"
            />
            <CountInput
              label="Destination total seen in the original system (optional)"
              hint="Compared with the rows in the export. A count that differs withdraws the destination statement."
              value={destinationCount}
              onChange={(v) => (setDestinationCount(v), changed())}
              testId="destination-count"
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
          {run.kind === "cancelled" && <span className="text-ink-2">Cancelled. No result is shown.</span>}
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
            </span>
          )}
        </p>
      </section>

      {run.kind === "done" && run.result.view && <Result result={run.result} headingRef={resultHeading} />}
    </div>
  );
}
