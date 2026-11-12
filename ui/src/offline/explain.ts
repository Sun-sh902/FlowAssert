/**
 * "What this result means": a short list of plain-language points about one report, shown next to the result on the
 * CSV check page and on an opened saved report. Every point is read from members of that report (cohort_state,
 * counts, premises, source_population_known, destination_coverage_sufficient, destination_rows_without_key, the rule
 * results and reasons of its records, destination_only, obligation); nothing is guessed about the data, nothing is
 * evaluated again, and the report is not changed.
 *
 * A premise is explained as what it means, how a person could find out whether it is true, and that FlowAssert cannot
 * check it. It is never offered as a way to reach Verified.
 *
 * A report whose source was read from a Google Sheets range (inputs.source_sheet, schema_version 2) gets the same points,
 * worded for a range instead of a file, and two more: where the rows were read, and whether the read is tied to a
 * revision. Reading the sheet is never offered as evidence that the range is the whole batch.
 *
 * A report whose destination was read from HubSpot (inputs.destination_hubspot, schema_version 3) gets one more point:
 * what the read listed, and the three things it does not show. Reading every page is never offered as evidence that the
 * object is complete.
 *
 * A report with a side read from an .xlsx workbook (inputs.source_workbook or inputs.destination_workbook,
 * schema_version 4) gets one point for each such side: which worksheet was read, and that each cell was read as it is
 * stored, not as a spreadsheet displays it, with what that means for numbers, percentages, dates and formulas.
 *
 * The text is English, in parts: a string is interface text; a { value } is something the report holds, such as a column name or a rule,
 * shown exactly as written.
 */
import type { Counts, DestinationOnlyRecord, Premise, RuleResult, SourceRecord, State } from "./evaluator";

export type Part = string | { value: string };

/** The members of inputs.source_workbook and inputs.destination_workbook this module reads. */
export interface WorkbookOrigin {
  worksheet: string;
  cells: { number: number; percentage: number; date_time: number; duration: number; boolean: number; formula: number };
  hidden_rows: number;
  hidden_columns: number;
  merged_ranges: number;
}

/** The members of inputs.source_sheet this module reads. */
export interface SheetOrigin {
  spreadsheet_id: string;
  range_returned: string;
  revision: { available: true; before: { version: string } } | { available: false; reason: string };
}

export interface Point {
  /** What the point is about, for tests and for the page's data-point attribute: "population-unknown", "unknown:empty:phone", … */
  id: string;
  text: Part[];
  /** What the point means and what kind of evidence would settle it. */
  detail?: Part[];
}

export interface Explanation {
  state: State;
  lead: string;
  points: Point[];
  /** Points left out to keep the list short; the records list has every reason. */
  more: number;
}

/** The members of a report this module reads: a check's Report (records with problems()) or a SavedReport (records as a list). */
export interface Explainable {
  cohort_state: State;
  counts: Counts;
  source_rows_observed: number;
  source_population_known: boolean;
  destination_coverage_sufficient: boolean;
  destination_rows_without_key: number;
  premises: Readonly<Record<string, Premise>>;
  records: readonly SourceRecord[] | { problems(): Iterable<SourceRecord> };
  destination_only?: readonly DestinationOnlyRecord[];
  obligation: { fields: readonly (readonly string[])[]; rules?: readonly string[]; scope?: string };
  /** Only these are read: reports from the command line's connectors have the first two, workbook reports the others. */
  inputs?: { source_sheet?: SheetOrigin; destination_hubspot?: { rows: number; pages: number }; source_workbook?: WorkbookOrigin; destination_workbook?: WorkbookOrigin };
  workflow_execution: string;
  business_truth: string;
  existed_by_deadline: string;
  acquisition_authenticity: string;
}

/** At most this many points; field groups beyond it are counted in `more`. */
export const MAX_POINTS = 14;

/** Reasons the evaluator writes (offline/flowassert_offline/evaluator_v2.py), as this module reads them. */
const INVALID_KEY = "invalid or duplicate source key";
const MISSING = "key not found in stated complete destination";
const DUPLICATE = "more than one destination row carries this key";
const ABSENCE_UNKNOWN = ["destination not stated complete; absence not established", "destination row count differs from the stated count; absence not established"];
const INSUFFICIENT = "insufficient evidence";
const EMPTY = "empty value; a missing value is not assumed to be a difference";
const TRIM_EMPTY = "empty after trimming whitespace; a missing value is not assumed to be a difference";
const NO_DIGITS = "no digits to compare";
const DATE_UNKNOWN = "value does not match date format ";

const LEAD: Record<State, string> = {
  Verified: "Every source record was shown to meet every rule, under the premises that were stated.",
  Mismatch: "At least one rule is demonstrably false, and one such record is enough for the batch to be a Mismatch.",
  Unverified: "No rule was shown to be false, but there is not enough evidence to call the batch Verified.",
  Pending: "No conclusion yet.",
};

/** English with a singular and a plural sentence, so the catalogue can key each with "#". */
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many).replace("#", String(n));

function problemsOf(report: Explainable): Iterable<SourceRecord> {
  const records = report.records;
  return Array.isArray(records) ? (records as readonly SourceRecord[]).filter((r) => r.state !== "Verified") : (records as { problems(): Iterable<SourceRecord> }).problems();
}

type UnknownKind = "empty" | "trim" | "digits" | "date";

const UNKNOWN_TEXT: Record<UnknownKind, [string, string]> = {
  empty: ["# record has an empty value in column", "# records have an empty value in column"],
  trim: ["# record has a value that is empty after trimming spaces in column", "# records have a value that is empty after trimming spaces in column"],
  digits: ["# record has a value without digits in column", "# records have a value without digits in column"],
  date: ["# record has a value that does not match the date format in column", "# records have a value that does not match the date format in column"],
};

const UNKNOWN_DETAIL: Record<UnknownKind, (rule: string) => Part[]> = {
  empty: () => ["A CSV cannot show why a value is empty, so an empty value is never taken as a difference. What would settle it: the value, from the system that should hold it."],
  trim: () => ["After trimming spaces nothing is left to compare, and an empty value is never taken as a difference. What would settle it: the value, from the system that should hold it."],
  digits: () => ["The rule digits compares only the digits 0–9, so a value without them cannot be compared. The records list shows each value."],
  date: (rule) => ["The rule", " ", { value: rule }, " ", "reads both values as dates; a value that does not match its format cannot be compared. The records list shows each value."],
};

function unknownKind(reason: string): UnknownKind | null {
  if (reason === EMPTY) return "empty";
  if (reason === TRIM_EMPTY) return "trim";
  if (reason === NO_DIGITS) return "digits";
  if (reason.startsWith(DATE_UNKNOWN)) return "date";
  return null;
}

/** What the report shows about its records that are not Verified, grouped and counted. */
function tally(report: Explainable, redacted: boolean) {
  const t = {
    invalidKeys: 0,
    emptyKeys: 0,
    repeatedKeyRows: 0,
    missing: 0,
    duplicates: 0,
    notFound: 0,
    foundOnce: 0,
    fieldFails: new Map<string, number>(),
    unknown: new Map<string, { kind: UnknownKind; field: string; count: number }>(),
  };
  for (const record of problemsOf(report)) {
    const rules: Record<string, RuleResult> = record.rules ?? {};
    const existence = rules.existence;
    if (existence?.reason === INVALID_KEY) {
      // --redact-values writes "[redacted]" for every key, an empty one too, so the two cannot be told apart.
      if (redacted) t.invalidKeys++;
      else if (record.key === null) t.emptyKeys++;
      else t.repeatedKeyRows++;
      continue;
    }
    if (existence?.status === "fail" && existence.reason === MISSING) t.missing++;
    if (existence?.status === "unknown" && ABSENCE_UNKNOWN.includes(existence.reason)) t.notFound++;
    const uniqueness = rules.uniqueness;
    if (uniqueness?.status === "fail" && uniqueness.reason === DUPLICATE) t.duplicates++;
    if (existence?.status === "pass" && uniqueness?.status === "unknown" && uniqueness.reason === INSUFFICIENT) t.foundOnce++;
    for (const [name, rule] of Object.entries(rules)) {
      if (!name.startsWith("field:")) continue;
      const field = name.slice(6);
      if (rule.status === "fail") t.fieldFails.set(field, (t.fieldFails.get(field) ?? 0) + 1);
      const kind = rule.status === "unknown" ? unknownKind(rule.reason) : null;
      if (kind) {
        const id = `${kind}:${field}`;
        const entry = t.unknown.get(id) ?? { kind, field, count: 0 };
        entry.count++;
        t.unknown.set(id, entry);
      }
    }
  }
  return t;
}

/** The column as the report names it: the source column, and the destination column when it differs. */
function column(report: Explainable, field: string): string {
  const pair = report.obligation.fields.find((f) => f[0] === field);
  return pair && pair[1] !== undefined && pair[1] !== field ? `${field} → ${pair[1]}` : field;
}

function ruleOf(report: Explainable, field: string): string {
  const i = report.obligation.fields.findIndex((f) => f[0] === field);
  return (i >= 0 ? report.obligation.rules?.[i] : undefined) ?? "exact";
}

/** The reasons a batch was not Verified that are not a failed rule, in the order that matters. */
function notEstablished(report: Explainable, t: ReturnType<typeof tally>, room: number): { points: Point[]; more: number } {
  const points: Point[] = [];
  const premise = (name: string) => report.premises[name];
  const sourceRows = report.source_rows_observed;
  const sheet = sheetOf(report) !== null;

  if (!report.source_population_known) {
    points.push({
      id: "population-unknown",
      text: [
        sheet
          ? "The source population is unknown, so the batch cannot be Verified: records that belong to the batch but are not in the sheet range cannot be ruled out."
          : "The source population is unknown, so the batch cannot be Verified: records that belong to the batch but are not in the source file cannot be ruled out.",
      ],
    });
    if (premise("source_complete")?.stated !== true) {
      points.push({
        id: "source-not-stated",
        text: [sheet ? "It was not stated that the sheet range is the whole batch." : "It was not stated that the source file is the whole batch."],
        detail: [
          sheet
            ? plural(
                sourceRows,
                "That statement means the range holds every record that should have reached the destination, not a sample, a filtered view or part of them. Reading the sheet does not show that. One way to find out is to compare the range’s # row with the total the source system shows for this batch. FlowAssert cannot check the statement, and a wrong statement gives a wrong result.",
                "That statement means the range holds every record that should have reached the destination, not a sample, a filtered view or part of them. Reading the sheet does not show that. One way to find out is to compare the range’s # rows with the total the source system shows for this batch. FlowAssert cannot check the statement, and a wrong statement gives a wrong result.",
              )
            : plural(
                sourceRows,
                "That statement means the file holds every record that should have reached the destination, not a sample, a filtered view or one page of them. One way to find out is to compare the file’s # row with the total the source system shows for this batch. FlowAssert cannot check the statement, and a wrong statement gives a wrong result.",
                "That statement means the file holds every record that should have reached the destination, not a sample, a filtered view or one page of them. One way to find out is to compare the file’s # rows with the total the source system shows for this batch. FlowAssert cannot check the statement, and a wrong statement gives a wrong result.",
              ),
        ],
      });
    }
    if (t.emptyKeys) {
      points.push({
        id: "source-empty-keys",
        text: [plural(t.emptyKeys, "# source row has an empty key, so it cannot be matched with the destination.", "# source rows have an empty key, so they cannot be matched with the destination.")],
        detail: ["What would settle it: a key in every source row, from the system the rows come from."],
      });
    }
    if (t.invalidKeys) {
      points.push({
        id: "source-invalid-keys",
        text: [plural(t.invalidKeys, "# source row has an empty or repeated key, so it cannot be matched by its key.", "# source rows have an empty or repeated key, so they cannot be matched by their key.")],
        detail: ["The report was written without keys, so it does not say which. What would settle it: a source export in which every record has a key of its own."],
      });
    }
    if (t.repeatedKeyRows) {
      points.push({
        id: "source-repeated-keys",
        text: [plural(t.repeatedKeyRows, "# source row has a key that another source row has too, so it cannot be told apart by its key.", "# source rows have a key that another source row has too, so they cannot be told apart by their key.")],
        detail: ["What would settle it: a source export in which each record has a key of its own."],
      });
    }
    const count = premise("source_count");
    if (count?.matched === false) {
      points.push({
        id: "source-count-differs",
        text: [
          sheet
            ? `The source total stated (${String(count.stated)}) differs from the row count of the sheet range (${count.observed}).`
            : `The source total stated (${String(count.stated)}) differs from the row count of the file (${count.observed}).`,
        ],
        detail: [
          sheet
            ? "The range and the total do not describe the same records. Only the source system can show which is right; FlowAssert cannot."
            : "The file and the total do not describe the same records. Only the source system can show which is right; FlowAssert cannot.",
        ],
      });
    }
  }

  if (!report.destination_coverage_sufficient) {
    points.push({
      id: "coverage-not-established",
      text: ["Destination coverage is not established, so a record not found in the export is not called missing, and a record found once is not called unique."],
    });
    if (premise("destination_complete")?.stated !== true) {
      const rows = premise("destination_count")?.observed;
      points.push({
        id: "destination-not-stated",
        text: ["It was not stated that the destination export covers the whole object."],
        detail: [
          rows === undefined
            ? "That statement means the export holds every record of that object in the destination system, not a filtered view, one page, or an export cut off at a row limit. One way to find out is to compare the export’s row count with the total the destination system shows for that object. FlowAssert cannot check the statement, and a wrong statement gives a wrong result."
            : plural(
                rows,
                "That statement means the export holds every record of that object in the destination system, not a filtered view, one page, or an export cut off at a row limit. One way to find out is to compare the export’s # row with the total the destination system shows for that object. FlowAssert cannot check the statement, and a wrong statement gives a wrong result.",
                "That statement means the export holds every record of that object in the destination system, not a filtered view, one page, or an export cut off at a row limit. One way to find out is to compare the export’s # rows with the total the destination system shows for that object. FlowAssert cannot check the statement, and a wrong statement gives a wrong result.",
              ),
        ],
      });
    }
    const keyless = report.destination_rows_without_key;
    if (keyless) {
      points.push({
        id: "destination-keyless",
        text: [plural(keyless, "# destination row has an empty key; it could be a missing record or a duplicate.", "# destination rows have an empty key; any of them could be a missing record or a duplicate.")],
        detail: ["What would settle it: knowing what these rows are, from the destination system itself."],
      });
    }
    const count = premise("destination_count");
    if (count?.matched === false) {
      points.push({
        id: "destination-count-differs",
        text: [`The destination total stated (${String(count.stated)}) differs from the row count of the export (${count.observed}).`],
        detail: ["The export and the total do not describe the same records. Only the destination system can show which is right; FlowAssert cannot."],
      });
    }
    if (t.notFound) {
      points.push({
        id: "not-found",
        text: [plural(t.notFound, "# source record was not found in the export; without coverage, that does not show it is missing.", "# source records were not found in the export; without coverage, that does not show they are missing.")],
      });
    }
    if (t.foundOnce) {
      points.push({
        id: "found-once",
        text: [plural(t.foundOnce, "# source record was found once; without coverage, another row with its key could exist outside the export.", "# source records were found once; without coverage, another row with the same key could exist outside the export.")],
      });
    }
  }

  // Values a rule could not compare, grouped by kind and column; the first group of each kind says what it means.
  const groups = [...t.unknown.entries()];
  const explained = new Set<UnknownKind>();
  let more = 0;
  for (const [id, g] of groups) {
    if (points.length >= room) {
      more++;
      continue;
    }
    const [one, many] = UNKNOWN_TEXT[g.kind];
    const point: Point = { id: `unknown:${id}`, text: [plural(g.count, one, many), " ", { value: column(report, g.field) }] };
    if (!explained.has(g.kind)) {
      explained.add(g.kind);
      point.detail = UNKNOWN_DETAIL[g.kind](ruleOf(report, g.field));
    }
    points.push(point);
  }

  const unconcluded = report.destination_only?.filter((r) => r.state === "Unverified").length ?? 0;
  if (unconcluded) {
    points.push({
      id: "destination-only-unverified",
      text: [
        sheet
          ? plural(
              unconcluded,
              "# destination key is not in the source. It is listed without a conclusion: the source population is unknown, so it could belong to a source record that is not in the sheet range.",
              "# destination keys are not in the source. They are listed without a conclusion: the source population is unknown, so each could belong to a source record that is not in the sheet range.",
            )
          : plural(
              unconcluded,
              "# destination key is not in the source. It is listed without a conclusion: the source population is unknown, so it could belong to a source record that is not in the file.",
              "# destination keys are not in the source. They are listed without a conclusion: the source population is unknown, so each could belong to a source record that is not in the file.",
            ),
      ],
    });
  }
  return { points, more };
}

function verified(report: Explainable): Point[] {
  const points: Point[] = [];
  const n = report.counts.Verified;
  points.push({
    id: "verified-records",
    text: [plural(n, "The # source record was found exactly once in the destination export, and every compared field matched under its rule.", "All # source records were found exactly once in the destination export, and every compared field matched under its rule.")],
  });
  const source = report.premises.source_complete?.stated === true;
  const destination = report.premises.destination_complete?.stated === true;
  const sheet = sheetOf(report) !== null;
  if (source || destination) {
    points.push({
      id: "verified-premises",
      text: [
        source && destination
          ? sheet
            ? "This rests on two statements FlowAssert cannot check: that the sheet range is the whole batch, and that the destination export covers the whole object. Reading the sheet does not show the first. If either is wrong, this result is wrong."
            : "This rests on two statements FlowAssert cannot check: that the source file is the whole batch, and that the destination export covers the whole object. If either is wrong, this result is wrong."
          : source
            ? sheet
              ? "This rests on a statement FlowAssert cannot check: that the sheet range is the whole batch. Reading the sheet does not show it. If it is wrong, this result is wrong."
              : "This rests on a statement FlowAssert cannot check: that the source file is the whole batch. If it is wrong, this result is wrong."
            : "This rests on a statement FlowAssert cannot check: that the destination export covers the whole object. If it is wrong, this result is wrong.",
      ],
    });
  }
  const counts = ["source_count", "destination_count"].filter((name) => report.premises[name]?.matched === true);
  if (counts.length) {
    points.push({
      id: "verified-counts",
      text: [
        sheet
          ? counts.length === 2
            ? "The two totals stated from the original systems matched the rows read from the sheet range and the export. A matching total does not prove that either is complete."
            : "The total stated from the original system matched the rows read. A matching total does not prove that the rows are complete."
          : counts.length === 2
            ? "The two totals stated from the original systems matched the rows in the files. A matching total does not prove that a file is complete."
            : "The total stated from the original system matched the rows in its file. A matching total does not prove that a file is complete.",
      ],
    });
  }
  const loose = report.obligation.fields.map((f, i) => [f[0]!, report.obligation.rules?.[i] ?? "exact"] as const).filter(([, rule]) => rule !== "exact");
  if (loose.length) {
    points.push({
      id: "verified-rules",
      text: ["Some fields were compared under a rule that ignores part of the value, so values that differ only in that part count as equal:", " ", { value: loose.map(([f, r]) => `${f}: ${r}`).join(", ") }],
    });
  }
  return points;
}

function mismatch(report: Explainable, t: ReturnType<typeof tally>): Point[] {
  const points: Point[] = [];
  const failed = report.counts.Mismatch;
  const rows = report.source_rows_observed;
  if (failed) {
    points.push({
      id: "mismatch-records",
      text: [
        failed === 1
          ? `1 of ${rows} source records: Mismatch. At least one of its rules is demonstrably false.`
          : `${failed} of ${rows} source records: Mismatch. At least one rule is demonstrably false for each of them.`,
      ],
    });
  }
  for (const [field, count] of t.fieldFails) {
    points.push({
      id: `fail:${field}`,
      text: [plural(count, "# record differs in column", "# records differ in column"), " ", { value: column(report, field) }, " ", "under the rule", " ", { value: ruleOf(report, field) }],
    });
  }
  if (t.missing) {
    points.push({
      id: "fail-missing",
      text: [plural(t.missing, "# record has a key that is not in the destination export, which was stated to cover the whole object.", "# records have a key that is not in the destination export, which was stated to cover the whole object.")],
    });
  }
  if (t.duplicates) {
    points.push({
      id: "fail-duplicate",
      text: [plural(t.duplicates, "# record has a key that more than one destination row carries, so no row was picked to compare its fields.", "# records have a key that more than one destination row carries, so no row was picked to compare their fields.")],
    });
  }
  const extra = report.destination_only?.filter((r) => r.state === "Mismatch").length ?? 0;
  if (extra) {
    points.push({
      id: "fail-destination-only",
      text: [plural(extra, "# destination key is not in the source, and the source population is known, so it is a Mismatch.", "# destination keys are not in the source, and the source population is known, so each is a Mismatch.")],
    });
  }
  if (failed || extra) {
    points.push({ id: "see-records", text: [failed && extra ? "Each of them is listed below, under the records and the destination-only records." : extra ? "They are listed below, under the destination-only records." : "Each of them is listed below, with the result of every rule."] });
  }
  return points;
}

const sheetOf = (report: Explainable): SheetOrigin | null => report.inputs?.source_sheet ?? null;

/** Where a sheet source was read, and whether the read is tied to a revision: from the report, after the other points. */
function sheetPoints(sheet: SheetOrigin): Point[] {
  const revision = sheet.revision;
  return [
    {
      id: "source-sheet",
      text: ["The source rows were read by FlowAssert from Google Sheets, read-only, from the range", " ", { value: sheet.range_returned }, " ", "of spreadsheet", " ", { value: sheet.spreadsheet_id }],
      detail: [
        "No export step could cut these rows short or edit them. That does not show that the range holds every record that should exist, and the same rows in a CSV file would give the same result.",
      ],
    },
    revision.available
      ? { id: "source-sheet-revision", text: ["Google Drive gave the same version before and after the values were read:", " ", { value: revision.before.version }] }
      : {
          id: "source-sheet-no-revision",
          text: ["The read cannot be tied to a revision:", " ", { value: revision.reason }],
          detail: ["Without a revision, the report cannot show that the values did not change while they were read."],
        },
  ];
}

/** What a HubSpot destination read listed, and what it does not show. */
function hubspotPoint(read: { rows: number; pages: number }): Point {
  return {
    id: "destination-hubspot",
    text: [
      read.rows === 1 && read.pages === 1
        ? "The destination record was listed by FlowAssert from HubSpot's contacts, read-only: 1 record in 1 page."
        : read.rows === 1
          ? `The destination record was listed by FlowAssert from HubSpot's contacts, read-only: 1 record in ${read.pages} pages.`
          : read.pages === 1
            ? `The destination records were listed by FlowAssert from HubSpot's contacts, read-only: ${read.rows} records in 1 page.`
            : `The destination records were listed by FlowAssert from HubSpot's contacts, read-only: ${read.rows} records in ${read.pages} pages.`,
    ],
    detail: [
      "That shows which contacts the API listed to this token at that time. It does not show that the object is complete: contacts the token cannot see, contacts changed during the read and archived contacts are not listed. That the records cover the whole object is the destination statement, which FlowAssert cannot check.",
    ],
  };
}

/** Which worksheet one side was read from, and what reading stored values means for it. */
function workbookPoint(side: "source" | "destination", book: WorkbookOrigin): Point {
  const c = book.cells;
  const differs = c.number + c.percentage + c.date_time + c.duration + c.boolean + c.formula;
  const detail = [
    differs
      ? "A number is read as the number itself, without its display format; a percentage as its fraction, so 12.5% is 0.125; a date or a time in ISO 8601, such as 2025-11-12; and a formula as the value the file last saved. If the other side holds the text a spreadsheet displays, the same value can differ only in its form."
      : "Every cell of this worksheet is text, so what was read is what a spreadsheet displays.",
  ];
  if (book.hidden_rows || book.hidden_columns || book.merged_ranges) {
    detail.push("Hidden rows and columns were read like any other, including rows a filter hid; in a merged range only the first cell holds the value.");
  }
  return {
    id: `${side}-workbook`,
    text: [side === "source" ? "The source rows were read from the worksheet" : "The destination rows were read from the worksheet", " ", { value: book.worksheet }, " ", "of an .xlsx workbook, each cell as it is stored, not as a spreadsheet displays it."],
    detail,
  };
}

/**
 * The points for one report, in the order a reader needs them. `redacted`: the report was written with
 * --redact-values, so its keys are all "[redacted]".
 */
export function explain(report: Explainable, { redacted = false }: { redacted?: boolean } = {}): Explanation {
  const state = report.cohort_state;
  const t = tally(report, redacted);
  let points: Point[] = [];
  let more = 0;
  const scope = report.obligation.scope ?? "source";
  const sheet = sheetOf(report);
  const crm = report.inputs?.destination_hubspot ?? null;
  const books = (["source", "destination"] as const).flatMap((side) => {
    const book = report.inputs?.[`${side}_workbook`];
    return book ? [workbookPoint(side, book)] : [];
  });
  const sheetRoom = (sheet ? 2 : 0) + (crm ? 1 : 0) + books.length;

  if (state === "Verified") {
    points = verified(report);
  } else {
    if (state === "Mismatch") points = mismatch(report, t);
    if (state === "Unverified" && report.source_rows_observed === 0) {
      points.push({
        id: "no-rows",
        text: [
          sheetOf(report)
            ? "The sheet range has no data rows, so there is no record to verify, and an empty batch is never Verified."
            : "The source file has no data rows, so there is no record to verify, and an empty batch is never Verified.",
        ],
      });
    } else if (state === "Unverified" && report.counts.Verified === report.source_rows_observed) {
      points.push({ id: "all-records-passed", text: [plural(report.counts.Verified, "The # source record passed every rule, but the batch is not Verified, for the reasons below.", "All # source records passed every rule, but the batch is not Verified, for the reasons below.")] });
    }
    const rest = notEstablished(report, t, MAX_POINTS - points.length - 1 - sheetRoom);
    if (rest.points.length) {
      if (state === "Mismatch") points.push({ id: "also", text: ["The report also shows what is not established:"] });
      points.push(...rest.points);
    }
    more = rest.more;
    if (state === "Unverified" && report.counts.Unverified) points.push({ id: "see-records", text: ["Each record that is not Verified is listed below, with the reason for every rule."] });
  }

  if (state === "Verified") {
    if (scope === "exact") {
      if (report.destination_only?.length === 0) points.push({ id: "scope-exact", text: ["The destination export has no key that is not in the source: the scope is exact."] });
    } else {
      points.push({ id: "scope-source", text: ["Destination records whose key is not in the source were not looked for: the scope is source."] });
    }
    const notAssessed = [report.workflow_execution, report.business_truth, report.existed_by_deadline].every((v) => v === "Not assessed");
    if (notAssessed && report.acquisition_authenticity === "not_authenticated") {
      points.push({
        id: "not-shown",
        text: ["It does not show that a workflow made these writes, that the source data is true, that a record existed by a past deadline, or that the files and statements are authentic."],
      });
    }
  }
  if (sheet) points.push(...sheetPoints(sheet));
  if (crm) points.push(hubspotPoint(crm));
  points.push(...books);
  return { state, lead: LEAD[state], points, more };
}

/** Every string part of an explanation, for the tests of its wording. */
export function textsOf(e: Explanation): string[] {
  const parts = [e.lead, ...e.points.flatMap((p) => [...p.text, ...(p.detail ?? [])])];
  return parts.filter((p): p is string => typeof p === "string" && p.trim() !== "");
}
