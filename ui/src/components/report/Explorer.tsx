/**
 * The result explorer (docs/design/1.0-browser.md): every record of one report, filtered, searched and sorted in a
 * virtualised list, with a panel for the record chosen and the character diff of each failed field. The CSV check
 * page, a saved report and a comparison all use it, over a RecordStore (offline/explore.ts).
 *
 * Everything here is a way of looking at the report and is labelled so: a filter selects records, a highlight shows
 * where two values differ. Neither is a result, and neither changes the report.
 *
 * The explorer's state is in the address (numbers and fixed words only, never a key, a value or a column name), so a
 * filtered view of a saved report can be linked. A search is never written there, because it is a piece of a key.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../../lib/cn";
import { align, codePoints, notes, pieces, type Run } from "../../offline/chardiff";
import type { RuleResult, SourceRecord, Status } from "../../offline/evaluator";
import { ANY, changesAddress, fromParams, toParams, type Facts, type Item, type Matched, type Query, type RecordStore, type StateFilter } from "../../offline/explore";
import { pyRepr } from "../../offline/pystr";
import { buttonClass } from "../ui/primitives";
import { RuleStatusIcon, RuleStatusLabel, StatusBadge } from "../ui/status";

/** The height of one row of the list, in CSS pixels; every row has it. */
const ROW = 40;
/** Rows in view at once. */
const VIEW_ROWS = 9;
/** Rows read beyond the view, so a short scroll shows rows at once. */
const OVERSCAN = 6;
/**
 * The tallest list drawn at its true height. Above it (about 200,000 rows) the scroll bar is scaled, so the list stays
 * within what browsers can lay out.
 */
const MAX_PX = 8_000_000;

const grouped = (n: number) => n.toLocaleString("en-US");

const STATE_OPTIONS: { value: StateFilter | ""; label: string }[] = [
  { value: "", label: "Any state" },
  { value: "not-verified", label: "Not Verified" },
  { value: "Verified", label: "Verified" },
  { value: "Mismatch", label: "Mismatch" },
  { value: "Unverified", label: "Unverified" },
];

const STATUS_OPTIONS: { value: Status | ""; label: string }[] = [
  { value: "", label: "Any result" },
  { value: "fail", label: "fail" },
  { value: "unknown", label: "unknown" },
  { value: "pass", label: "pass" },
];

/* ---------- The character diff ---------- */

function Drawn({ text, highlighted, start, end }: { text: string; highlighted: boolean; start: boolean; end: boolean }) {
  return (
    <>
      {pieces(text, highlighted, { start, end }).map((p, i) =>
        p.token ? (
          <span key={i} className="fa-tok" title={`U+${p.ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`}>
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** A value as runs, the runs that are not "same" marked by form as well as colour. */
function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((r, i) => {
        const inner = <Drawn text={r.text} highlighted={r.kind !== "same"} start={i === 0} end={i === runs.length - 1} />;
        if (r.kind === "deleted") return <del key={i}>{inner}</del>;
        if (r.kind === "inserted") return <ins key={i}>{inner}</ins>;
        return <span key={i}>{inner}</span>;
      })}
    </>
  );
}

/** A value drawn with its leading and trailing invisible characters made visible, and nothing highlighted. */
export function PlainValue({ value }: { value: string | null | undefined }) {
  if (typeof value !== "string") return <code className="font-mono text-[12px] text-ink-3">{pyRepr(value ?? null)}</code>;
  if (value === "") return <code className="font-mono text-[12px] text-ink-3">''</code>;
  return (
    <code className="fa-diff font-mono text-[12px] break-all whitespace-pre-wrap text-ink">
      <Drawn text={value} highlighted={false} start end />
    </code>
  );
}

const NOTE_TEXT = {
  nfc: "The two values are the same text after Unicode normalisation (NFC): the same characters are encoded differently.",
  nfkc: "The two values are the same text after compatibility normalisation (NFKC): a character is written in a compatible form.",
  case: "The two values differ only in upper and lower case.",
} as const;

/** Where two compared values differ. A display aid only: the rule's result is the conclusion. */
export function ValueDiff({ source, destination, label }: { source: string; destination: string; label: string }) {
  const a = useMemo(() => align(source, destination), [source, destination]);
  const sourcePoints = codePoints(a.source);
  const destinationPoints = codePoints(a.destination);
  return (
    <figure className="mt-1.5 rounded-sm border border-line-subtle bg-sunken/50 px-2.5 py-2" data-testid="value-diff">
      <figcaption className="text-2xs font-semibold tracking-wide text-ink-3 uppercase">{label}</figcaption>
      <dl className="mt-1 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[96px_minmax(0,1fr)]">
        <dt className="text-ink-3">Source</dt>
        <dd className="min-w-0">
          <code className="fa-diff font-mono text-[12.5px] break-all whitespace-pre-wrap text-ink" data-side="source">
            <Runs runs={a.source} />
          </code>
          {sourcePoints.length > 0 && (
            <p className="mt-0.5 font-mono text-[11px] text-ink-3">
              {sourcePoints.join(" · ")}
            </p>
          )}
        </dd>
        <dt className="text-ink-3">Destination</dt>
        <dd className="min-w-0">
          <code className="fa-diff font-mono text-[12.5px] break-all whitespace-pre-wrap text-ink" data-side="destination">
            <Runs runs={a.destination} />
          </code>
          {destinationPoints.length > 0 && (
            <p className="mt-0.5 font-mono text-[11px] text-ink-3">
              {destinationPoints.join(" · ")}
            </p>
          )}
        </dd>
      </dl>
      <p className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-ink-3" aria-hidden>
        <span>
          <del className="fa-key">abc</del> <span>only in the source value</span>
        </span>
        <span>
          <ins className="fa-key">abc</ins> <span>only in the destination value</span>
        </span>
        <span>
          <span className="fa-tok">·</span> <span>a space</span>
        </span>
      </p>
      {a.tooLong && <p className="mt-1 text-xs text-ink-2">The values are too long to align character by character, so the differing parts are shown as replaced whole.</p>}
      {notes(source, destination).map((n) => (
        <p key={n} className="mt-1 text-xs text-ink-2" data-note={n}>
          {NOTE_TEXT[n]}
        </p>
      ))}
      <p className="mt-1.5 text-xs text-ink-3">This highlights where the two values differ. The rule’s result above is the conclusion.</p>
    </figure>
  );
}

/* ---------- The record panel ---------- */

function RuleDetail({ name, rule }: { name: string; rule: RuleResult }) {
  const normalised = "expected_normalized" in rule;
  const compared: [unknown, unknown] = normalised ? [rule.expected_normalized, rule.actual_normalized] : [rule.expected, rule.actual];
  const diffable = rule.status === "fail" && typeof compared[0] === "string" && typeof compared[1] === "string";
  return (
    <li className="grid gap-1 border-t border-line-subtle py-2 first:border-t-0" data-rule={name.startsWith("field:") ? "field" : name}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <code className="font-mono text-[12px] text-ink-2">
          {name}
        </code>
        <span className="inline-flex items-center gap-1">
          <RuleStatusIcon status={rule.status} />
          <RuleStatusLabel status={rule.status} />
        </span>
        {rule.rule && (
          <code className="font-mono text-[11px] text-ink-3">
            {rule.rule}
          </code>
        )}
      </div>
      <p className="text-xs text-ink-3">
        {rule.reason}
      </p>
      {"expected" in rule && (
        <dl className="grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[96px_minmax(0,1fr)]">
          <dt className="text-ink-3">Source value</dt>
          <dd className="min-w-0">
            <PlainValue value={rule.expected} />
          </dd>
          <dt className="text-ink-3">Destination value</dt>
          <dd className="min-w-0">
            <PlainValue value={rule.actual} />
          </dd>
          {normalised && (
            <>
              <dt className="text-ink-3">Compared as</dt>
              <dd className="min-w-0">
                <PlainValue value={rule.expected_normalized} />
                <span className="px-1.5 text-ink-3">and</span>
                <PlainValue value={rule.actual_normalized} />
              </dd>
            </>
          )}
        </dl>
      )}
      {diffable && <ValueDiff source={compared[0] as string} destination={compared[1] as string} label={normalised ? "Where the compared values differ" : "Where the values differ"} />}
    </li>
  );
}

function RecordPanel({ item, facts, headingId, level }: { item: Item; facts: Facts; headingId: string; level: 3 | 4 }) {
  const H = level === 3 ? "h3" : "h4";
  if (item.kind === "destination-only") {
    const r = item.record;
    return (
      <div data-testid="record-panel" data-panel="destination-only">
        <H id={headingId} className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-ink">
          <span>{`Destination row ${grouped(r.destination_row + 1)}`}</span>
          <span aria-hidden>·</span>
          <code className="font-mono text-[12.5px] font-normal break-all">
            {r.key}
          </code>
        </H>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <StatusBadge state={r.state} size="sm" />
          <span className="text-xs text-ink-2">{r.rows === 1 ? "1 destination row has this key" : `${grouped(r.rows)} destination rows have this key`}</span>
        </div>
        <p className="mt-2 text-xs text-ink-3">
          {r.reason}
        </p>
      </div>
    );
  }
  const r: SourceRecord = item.record;
  return (
    <div data-testid="record-panel" data-panel="source" data-record-row={r.source_row + 1}>
      <H id={headingId} className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-ink">
        <span>{`Record ${grouped(r.source_row + 1)}`}</span>
        <span aria-hidden>·</span>
        {r.key === null ? (
          <span className="font-normal text-ink-3">no key</span>
        ) : (
          <code className="font-mono text-[12.5px] font-normal break-all">
            {r.key}
          </code>
        )}
      </H>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <StatusBadge state={r.state} size="sm" />
        {r.candidates !== undefined && <span className="text-xs text-ink-2">{r.candidates === 1 ? "1 destination row has this key" : `${grouped(r.candidates)} destination rows have this key`}</span>}
      </div>
      {r.rules ? (
        <ul className="mt-2">
          {facts.rules
            .filter((n) => r.rules![n])
            .map((n) => (
              <RuleDetail key={n} name={n} rule={r.rules![n]!} />
            ))}
        </ul>
      ) : (
        <p className="mt-2 max-w-[60ch] text-xs leading-[1.5] text-ink-2" data-testid="no-rule-results">
          This report was written with details: problems. It records that this record is Verified, but not its rule results or values.
        </p>
      )}
    </div>
  );
}

/* ---------- The list ---------- */

function ItemRow({ item }: { item: Item | undefined }) {
  if (!item) return <span className="text-xs text-ink-4">…</span>;
  const r = item.record;
  const row = item.kind === "source" ? item.record.source_row + 1 : item.record.destination_row + 1;
  return (
    <>
      <span className="w-16 shrink-0 text-right font-mono text-[11.5px] tabular text-ink-3">{grouped(row)}</span>
      <span className="min-w-0 flex-1 truncate">
        {r.key === null ? (
          <span className="text-xs text-ink-3">no key</span>
        ) : (
          <code className="font-mono text-[12px] text-ink">
            {r.key}
          </code>
        )}
      </span>
      <StatusBadge state={r.state} size="sm" className="shrink-0" />
    </>
  );
}

export interface ExplorerProps {
  store: RecordStore;
  /** The address parameters, and how to replace them (lib/router.ts). */
  params: URLSearchParams;
  replace: (params: Record<string, string | null>) => void;
  /** The view a report opens on when the address names none. */
  start?: Query;
  /** A name for the list, unique on the page. */
  label?: string;
  /** The level of the record panel's heading: one below the heading the explorer sits under. */
  level?: 3 | 4;
}

/** The scroll position for a list of `n` rows that shows row `first` at its top. */
const geometry = (n: number) => {
  const natural = n * ROW;
  const height = Math.max(Math.min(natural, MAX_PX), ROW);
  const scaled = natural > MAX_PX;
  const view = VIEW_ROWS * ROW;
  const span = Math.max(1, n - VIEW_ROWS);
  return {
    height,
    firstAt: (top: number) => (scaled ? Math.round((top / Math.max(1, height - view)) * span) : Math.floor(top / ROW)),
    topOf: (first: number) => (scaled ? (Math.min(first, span) / span) * (height - view) : first * ROW),
    scaled,
  };
};

export function RecordExplorer({ store, params, replace, start = ANY, label = "Records", level = 4 }: ExplorerProps) {
  const facts = store.facts;
  const id = useId();
  const initial = useMemo(() => fromParams(params, facts, start), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [query, setQuery] = useState<Query>(initial.query);
  const [search, setSearch] = useState("");
  const [matched, setMatched] = useState<Matched | null>(null);
  const [version, setVersion] = useState(0);
  const [items, setItems] = useState<Map<number, Item>>(new Map());
  const [active, setActive] = useState<number | null>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(initial.selected);
  const [first, setFirst] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const versionRef = useRef(0);

  // A search applies once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setQuery((q) => (q.search === search ? q : { ...q, search })), 200);
    return () => clearTimeout(t);
  }, [search]);

  // Every change of the view runs the query again, and finds the chosen record in the new list.
  useEffect(() => {
    let live = true;
    const v = ++versionRef.current;
    store
      .query(query)
      .then(async (m) => {
        if (!live) return;
        const at = selectedRow === null ? -1 : await store.indexOf(selectedRow);
        if (!live) return;
        setMatched(m);
        setItems(new Map());
        setVersion(v);
        setFailed(null);
        setActive(at >= 0 ? at : null);
        if (at < 0 && selectedRow !== null) setSelectedRow(null);
        const top = at >= 0 ? geometry(m.matches).topOf(Math.max(0, at - 2)) : 0;
        if (listRef.current) listRef.current.scrollTop = top;
        setFirst(geometry(m.matches).firstAt(top));
      })
      .catch((e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)));
    return () => void (live = false);
    // The chosen record is looked for only when the view changes, not when it is chosen.
  }, [store, query]); // eslint-disable-line react-hooks/exhaustive-deps

  // The rows in view are read a window at a time.
  const n = matched?.matches ?? 0;
  const want = useMemo(() => {
    const starts = [Math.max(0, first - OVERSCAN)];
    if (active !== null && (active < starts[0]! || active >= first + VIEW_ROWS + OVERSCAN)) starts.push(active);
    return starts;
  }, [first, active]);
  useEffect(() => {
    if (!matched || versionRef.current !== version) return;
    let live = true;
    for (const s of want) {
      const count = s === want[0] ? VIEW_ROWS + 2 * OVERSCAN : 1;
      if (Array.from({ length: Math.min(count, n - s) }, (_, i) => s + i).every((i) => items.has(i))) continue;
      store.window(s, count).then(
        (got) => {
          if (!live || versionRef.current !== version) return;
          setItems((m) => {
            const next = new Map(m);
            got.forEach((item, i) => next.set(s + i, item));
            // Keep the map small: only what is near the view and the chosen row.
            if (next.size > 400) for (const k of next.keys()) if (Math.abs(k - first) > 200 && k !== active) next.delete(k);
            return next;
          });
        },
        (e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)),
      );
    }
    return () => void (live = false);
  }, [store, matched, version, want, n]); // eslint-disable-line react-hooks/exhaustive-deps

  // The address follows the view; a search is never written there.
  useEffect(() => {
    const next = toParams(query, selectedRow, start);
    if (changesAddress(next)) replace(next);
  }, [query, selectedRow]); // eslint-disable-line react-hooks/exhaustive-deps

  const g = geometry(n);
  const onScroll = () => {
    const el = listRef.current;
    if (el) setFirst(g.firstAt(el.scrollTop));
  };

  const choose = useCallback(
    (index: number) => {
      if (!n) return;
      const i = Math.max(0, Math.min(n - 1, index));
      setActive(i);
      const el = listRef.current;
      if (el) {
        const shownFirst = g.firstAt(el.scrollTop);
        if (i < shownFirst || i >= shownFirst + VIEW_ROWS) {
          const top = g.topOf(i < shownFirst ? i : i - VIEW_ROWS + 1);
          el.scrollTop = top;
          setFirst(g.firstAt(top));
        }
      }
    },
    [n, g],
  );

  // The chosen row's record is named by its row in the address once it has been read.
  const activeItem = active === null ? undefined : items.get(active);
  useLayoutEffect(() => {
    if (!activeItem) return;
    const row = activeItem.kind === "source" ? activeItem.record.source_row : activeItem.index;
    setSelectedRow((r) => (r === row ? r : row));
  }, [activeItem]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: VIEW_ROWS - 1, PageUp: -(VIEW_ROWS - 1) };
    if (e.key in step) choose((active ?? (step[e.key]! > 0 ? -1 : n)) + step[e.key]!);
    else if (e.key === "Home") choose(0);
    else if (e.key === "End") choose(n - 1);
    else return;
    e.preventDefault();
  };

  const set = (patch: Partial<Query>) => setQuery((q) => ({ ...q, ...patch }));
  const clear = () => {
    setSearch("");
    setQuery({ ...ANY, list: query.list });
  };
  const onlyList = query.list === "destination-only";
  const firstShown = g.scaled ? first : Math.floor(first);
  const shown = Array.from({ length: Math.max(0, Math.min(n - firstShown, VIEW_ROWS + 1)) }, (_, i) => firstShown + i);
  const windowTop = g.scaled ? (listRef.current?.scrollTop ?? 0) : firstShown * ROW;
  const ofWhat = onlyList ? "destination-only records" : "records";

  return (
    <div className="mt-3" data-testid="explorer">
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))]">
        {facts.destinationOnlyTotal !== null && (
          <fieldset className="min-w-0 sm:col-span-2 lg:col-span-5">
            <legend className="text-xs font-medium text-ink-2">List</legend>
            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {(
                [
                  ["source", "Source records", facts.total],
                  ["destination-only", "Destination-only records", facts.destinationOnlyTotal],
                ] as const
              ).map(([value, text, count]) => (
                <label key={value} className="inline-flex items-center gap-2">
                  <input type="radio" name={`${id}-list`} checked={query.list === value} onChange={() => set({ list: value, rule: null, status: null })} className="accent-(--fa-ink)" data-testid={`explorer-list-${value}`} />
                  <span>{text}</span>
                  <span className="font-mono text-[11.5px] tabular text-ink-3">{grouped(count)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <label className="fa-field min-w-0">
          <span className="label">State</span>
          <select value={query.state ?? ""} onChange={(e) => set({ state: (e.target.value || null) as StateFilter | null })} data-testid="explorer-state">
            {STATE_OPTIONS.filter((o) => !onlyList || o.value !== "Verified").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="fa-field min-w-0">
          <span className="label">Rule</span>
          <select value={query.rule ?? ""} onChange={(e) => set({ rule: e.target.value === "" ? null : Number(e.target.value) })} disabled={onlyList} data-testid="explorer-rule">
            <option value="">Any rule</option>
            {facts.rules.map((r, i) => (
              <option key={r} value={i}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="fa-field min-w-0">
          <span className="label">Rule result</span>
          <select value={query.status ?? ""} onChange={(e) => set({ status: (e.target.value || null) as Status | null })} disabled={onlyList} data-testid="explorer-status">
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="fa-field min-w-0">
          <span className="label">Key contains</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={facts.redacted}
            spellCheck={false}
            autoComplete="off"
            aria-describedby={`${id}-search-note`}
            data-testid="explorer-search"
            className="font-mono"
          />
          <span id={`${id}-search-note`} className="text-[11px] text-ink-3">
            {facts.redacted ? "This report was written with --redact-values: it holds no keys to search." : "Exactly as written, case included. Never put in the address."}
          </span>
        </label>
        <label className="fa-field min-w-0">
          <span className="label">Order</span>
          <select value={query.order} onChange={(e) => set({ order: e.target.value as Query["order"] })} data-testid="explorer-order">
            <option value="asc">Row, first to last</option>
            <option value="desc">Row, last to first</option>
          </select>
        </label>
      </div>

      <p role="status" className="mt-2 text-sm text-ink-2" data-testid="explorer-count" data-matches={matched?.matches}>
        {failed !== null ? (
          <span className="text-mismatch-ink">{failed}</span>
        ) : matched === null ? (
          <span>Reading the records…</span>
        ) : (
          <>
            <span>{`${grouped(matched.matches)} of ${grouped(matched.of)} ${ofWhat} match`}</span>
            {matched.untestable > 0 && (
              <span className="block text-xs text-ink-3">
                {matched.untestable === 1
                  ? "1 Verified record holds no rule results in this report (details: problems), so the rule filter cannot test it."
                  : `${grouped(matched.untestable)} Verified records hold no rule results in this report (details: problems), so the rule filter cannot test them.`}
              </span>
            )}
          </>
        )}
      </p>

      <div className="mt-2 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="min-w-0">
          {matched !== null && n === 0 ? (
            <div className="grid place-items-start gap-2 rounded-md border border-dashed border-line-strong px-4 py-6" data-testid="explorer-empty">
              <p className="text-sm text-ink-2">No record matches these filters.</p>
              <button type="button" className={buttonClass("default", "sm")} onClick={clear}>
                Clear the filters
              </button>
            </div>
          ) : (
            <div
              ref={listRef}
              role="listbox"
              tabIndex={0}
              aria-label={label}
              aria-activedescendant={active !== null && items.has(active) ? `${id}-o${active}` : undefined}
              onKeyDown={onKey}
              onScroll={onScroll}
              className="relative overflow-y-auto overscroll-contain rounded-md border border-line bg-surface"
              style={{ height: VIEW_ROWS * ROW + 2 }}
              data-testid="explorer-list"
              data-scaled={g.scaled || undefined}
            >
              <div style={{ height: g.height }} aria-hidden />
              <div className="absolute inset-x-0" style={{ top: windowTop }}>
                {shown.map((i) => {
                  const item = items.get(i);
                  const row = item ? (item.kind === "source" ? item.record.source_row + 1 : item.record.destination_row + 1) : undefined;
                  return (
                    <div
                      key={i}
                      id={`${id}-o${i}`}
                      role="option"
                      aria-selected={i === active}
                      aria-posinset={i + 1}
                      aria-setsize={n}
                      onClick={() => choose(i)}
                      className={cn("flex cursor-pointer items-center gap-3 border-b border-line-subtle px-3 text-sm", i === active ? "bg-brand-soft" : "hover:bg-hover")}
                      style={{ height: ROW }}
                      data-record={item?.kind === "source" ? row : undefined}
                      data-destination-row={item?.kind === "destination-only" ? row : undefined}
                    >
                      <ItemRow item={item} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {n > 0 && <p className="mt-1 text-[11px] text-ink-3">Arrow keys, Page Up, Page Down, Home and End move through the list.</p>}
        </div>
        <section aria-labelledby={`${id}-panel-h`} className="min-w-0 rounded-md border border-line px-4 py-3" data-testid="explorer-panel">
          {activeItem ? (
            <RecordPanel item={activeItem} facts={facts} headingId={`${id}-panel-h`} level={level} />
          ) : (
            <>
              {level === 3 ? (
                <h3 id={`${id}-panel-h`} className="sr-only">
                  No record chosen
                </h3>
              ) : (
                <h4 id={`${id}-panel-h`} className="sr-only">
                  No record chosen
                </h4>
              )}
              <p className="text-sm text-ink-3">Choose a record in the list to see every rule result, its reason and both values.</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
