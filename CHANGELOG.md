# Changelog

## 0.3.0 (unreleased)

The offline check in the browser. The command-line checker is unchanged apart from its version number: the same verdicts, summaries, reports and exit statuses as 0.2.0. The Service, the frozen contracts, the pinned Evaluator v1 and the LOCAL_RESEARCH and MOCK pages are unchanged.

### Added

- A **CSV check** page in the web UI (`#/check`, Chinese: CSV 核对): choose a source file and a destination export with an encoding each, the key column, the compared fields with a rule each, the scope and the premises, and get the command line's result, summary, and JSON and HTML reports. Nothing is preselected or inferred; both completeness statements start unchecked. The files are read in a Web Worker and never leave the computer: the page makes no network request from choosing the files to downloading the reports. Nothing the user chooses or states is stored; the column and rule choices can be downloaded and loaded as a `--config` file.
- A TypeScript port of Evaluator v2, the CSV reader, the encodings and the report writers (`ui/src/offline/`), following Python where its behaviour depends on Unicode (casefold, whitespace, `repr`, case-insensitive matching) through tables generated from CPython 3.15 (`ui/scripts/offline/unicode_tables.py`).
- The premise origin `browser form`, recorded for every premise of a report made in the page. See `docs/report-format.md`.
- `offline/bench/golden.py` and `offline/golden/`: the CLI's outputs for 87 cases, which the browser check must reproduce byte for byte. A Python test fails when they are not current. `offline/bench/parity.py` runs random cases for the random parity test.
- A GitHub Pages build (`npm run build:pages`) with the CSV check as its home page, a Content Security Policy that allows no connection, and a "works only locally" notice in place of every page that needs the local Service; `.github/workflows/pages.yml` deploys it on manual dispatch only.
- CI: the golden check on every Python version, a parity job on Python 3.15, and the CSV check's browser tests in Chrome.

### Differences between the browser check and the command line

- Date formats may use only `%Y %m %d %H %M %S %f %z %b %B %y %p %I %j %%`; any other directive is refused as not supported in the browser.
- Where Python versions differ, the browser follows Python 3.15: `%d` needs a year directive, and `%z` may be absent from a value.
- A date format that repeats a directive is refused; the command line stops with exit status 4 because Python cannot compile it.
- The page always runs as `--config` with both encodings stated, so its reports record `config_file_sha256`, `obligation.rules`, `obligation.scope` and both encodings; it offers no `--mapping`, `--details all`, `--redact-values` or other limits.
- The browser does not reveal paths: two choices are refused as the same file when their name, size, modification time and bytes are all equal.

### Changed

- `flowassert_offline.__version__` is `0.3.0`. Nothing else in `offline/flowassert_offline/` changed.
- A production build of the UI uses relative asset paths, so it works from a sub-path.
- The UI's navigation rail scrolls when the window is too short for it.

## 0.2.0 (2026-11-02)

Configuration, comparison rules and trust for the offline CSV checker (`offline/`). The Service, UI, frozen contracts, and pinned Evaluator v1 are unchanged. With none of the new options, verdicts, record states, exit statuses and the printed summary are the same as in 0.1.1.

### Added

- `--source-count N` and `--destination-count N`: the totals seen in the original systems, compared with the data rows in each file. A source count that differs makes the source population unknown, even with `--source-complete`; a destination count that differs makes destination coverage insufficient, even with `--destination-complete`. Each mismatch prints one summary line. A matching count does not replace the completeness flags.
- `--config FILE`: a UTF-8 JSON file with `key`, `fields` (each with `source`, `destination` and an optional `rule`) and `scope`. A leading byte order mark is accepted. Completeness statements and counts are refused there, as are unknown or duplicate members, unknown rules, malformed date formats, repeated source fields, empty names and wrong types. It cannot be combined with `--mapping`, `--key`, `--field` or `--scope`. Its SHA-256 is recorded as `inputs.config_file_sha256`.
- Explicit comparison rules, set per field in the configuration file: `exact` (the default), `trim`, `casefold`, `digits` and `date:FORMAT`. A value without digits under `digits`, or that does not parse under `date:FORMAT`, is Unverified; under `date:FORMAT`, values with a UTC offset are compared in UTC; an empty value is Unverified under every rule. Field results under a rule other than `exact` record the rule and the normalized values, which `--redact-values` also removes. `--mapping` still always compares exactly.
- `--scope source|exact`. With `exact`, destination keys that are not in the source are reported as destination-only records, in a separate `destination_only` list with `destination_only_counts` and one summary line. They are a Mismatch only when the source population is known; otherwise they are listed without a conclusion.
- `--source-encoding` and `--destination-encoding`: `utf-8` (default), `utf-16` or `gb18030`. A file that does not decode is refused with its name and encoding. When either option is passed, both encodings are recorded in `inputs`.
- `--details problems|all` (default `problems`).
- `--html PATH`: a self-contained HTML report with no scripts and no external resources, escaping every value. Like `--json`, it refuses to overwrite a file. If one report cannot be written, no report is left behind.
- `docs/report-format.md`, describing every report member.
- `offline/bench/memory_check.py` and a CI job running it on Python 3.14: it fails if two files of 1,000,000 rows peak at 500 MB or more.
- Conformance cases for each rule, the count cross-check and `--scope exact`. The case format accepts a rule as the third item of a field, `scope` in `obligation`, and `source_count` and `destination_count` in `premises`; see `offline/conformance/README.md`.

### Changed

- **Report shape:** with the default `--details problems`, a Verified record in the JSON report keeps only `key`, `source_row` and `state`. Non-Verified records are unchanged. Pass `--details all` for the 0.1.1 record shape.
- The JSON report starts with `"schema_version": 1` and adds `details` and `premises`. `premises` lists `source_complete`, `destination_complete`, `source_count`, `destination_count` and, when passed, `allow_identical_content`, each with what was stated and its origin, and, for counts, the rows read and whether they matched. Every 0.1.1 member, including all of `inputs`, is kept.
- The Verified claim now reads: "At this evaluation, under the stated premises, the supplied destination rows satisfy the rules for the supplied source rows."
- The source file is read once and kept only for the columns the check uses. The destination file is folded into an index while it is read, and no destination row is kept. The report is written one record at a time. On the memory check (two 1,000,000-row files, macOS, Python 3.14), peak memory fell from 2.3 GB to 0.4 GB, and the default JSON report from 750 MB to 95 MB.
- A report that fails while being written is removed rather than left partly written.

## 0.1.1 (2026-11-02)

Small hardening and usability release for the offline CSV checker (`offline/`). The Service, UI, frozen contracts, and pinned Evaluator v1 are unchanged.

### Added

- `--mapping FILE`: UTF-8 JSON file specifying `key` and `fields` column pairs so column names containing `:` can be selected; records `mapping_file_sha256` in report `inputs` and refuses combining `--mapping` with `--key` or `--field`. A leading byte order mark is accepted.
- `--allow-identical-content`: allows comparing two distinct files whose SHA-256 digests match when they genuinely come from separate systems, recording `identical_content` and `identical_content_allowed` in `inputs` and noting identical files in the printed summary. Paths resolving to the same file remain refused, and identical content remains refused by default.
- `--max-bytes N` (default `209715200`, 200 MiB, checked via `os.stat` before reading) and `--max-rows N` (default `1000000`, checked while reading CSV rows) to refuse oversized inputs cleanly with exit status 2.
- `--max-details N` (default `50`; `0` prints none) to cap non-Verified record details in the printed summary without affecting the `--json` report.
- Shared synthetic conformance suite in `offline/conformance/` for Evaluator v2, including the three cases shared with Evaluator v1.
- Step-by-step first-check guides in English (`docs/guides/first-check.md`) and Simplified Chinese (`docs/guides/first-check.zh-CN.md`).

### Changed

- Documented the Python support policy for `offline/`: Python 3.11+ is supported, while Python 3.9 and 3.10 are best-effort because macOS ships Python 3.9 (`requires-python = ">=3.9"` retained; CI offline matrix set to `3.9`, `3.11`, and `3.14`).

## 0.1.0 (2026-11-01)

Initial public release of FlowAssert:

- Installable offline CSV checker (`flowassert-verify` / `offline/verify.py`) and Evaluator v2 for exact-string comparison with explicit completeness premises, JSON reports, SHA-256 file digests, and value redaction.
- Local read-only FastAPI Service, pinned Evaluator v1, append-only SQLite history archive, and React UI (English and Simplified Chinese) operating on five reviewed synthetic cases.
