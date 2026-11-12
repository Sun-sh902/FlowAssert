# Export the records to fix

From 1.1.0, after a check, FlowAssert can write the rows that need action as CSV files you can import again: the
records the destination lacks, the records whose values differ, the keys the destination holds twice, and, kept apart
with a plain warning, the records whose status is unknown. They are advice from the check, not a further conclusion:
they change no result, no report and no exit status. The [design note](../design/1.1-exports.md) defines every byte.

- [1. The files](#1-the-files)
- [2. Write them](#2-write-them)
- [3. Before you resend anything](#3-before-you-resend-anything)
- [4. Opening the files](#4-opening-the-files)

## 1. The files

Each file is written only when it has rows. Each row is the row exactly as it was read, every column, under its file's
own header, so the system it came from can import it again.

| File | Rows | What to do |
| --- | --- | --- |
| `missing-from-destination.csv` | Source | The destination, stated complete, has no row with this key: these records did not arrive. Resend them |
| `values-differ.csv` | Source | The destination has one row with this key, and a compared field differs. Correct the destination, or resend as an update |
| `duplicated-in-destination.csv` | Source | The destination holds this key more than once. Merge the duplicates; resending would add another |
| `unknown-status-resending-may-create-duplicates.csv` | Source | The check could not conclude: the record may already be in the destination. Find out before resending |
| `only-in-destination.csv` | Destination | Scope `exact`, the source stated complete: the destination has records whose key is not in the source |
| `only-in-destination-not-concluded.csv` | Destination | Scope `exact`, the source not stated complete: the same, without a conclusion |

**A destination that was not stated complete never gives `missing-from-destination.csv`.** A record not found in it
may be in the part you did not export, so it goes to the unknown file, and the summary says that absence is not
established.

## 2. Write them

- **Command line:** add `--export-dir DIR`, a directory that does not exist yet. The summary lists the files and their
  row counts after its last line.

  ```sh
  flowassert-verify --source offline/examples/source.csv --destination offline/examples/destination.csv \
    --key external_id --field phone --field email:hs_email \
    --source-complete --destination-complete --export-dir records-to-fix
  ```

  It is refused with `--redact-values` (the rows hold the values), and when a file changed between the check and the
  export. If any file cannot be written, nothing is left behind and no report is written.
- **In the browser:** under the result, "Export records to fix" lists each file with its rows and meaning, and a
  download button. Nothing is read again or downloaded until you press one.
- **In the GitHub Action:** `export-dir`, and upload the directory as an artifact
  ([scheduled checks](scheduled-checks.md)).
- **In the n8n node:** each file's rows come out on their own output, as items a following node can act on
  ([the node](../../integrations/n8n-nodes-flowassert/README.md)).

## 3. Before you resend anything

- The files say what the check showed with the files and statements you gave. A wrong completeness statement gives
  wrong files, as it gives a wrong result.
- The unknown file is not a list of missing records. Find each record in the destination first.
- A check is an observation at one moment. If the destination has changed since, check again.

## 4. Opening the files

The files are UTF-8 with a byte order mark and CR LF line endings. **FlowAssert does not change exported text.** A
field that begins with `=`, `+`, `-`, `@`, a tab or a carriage return may run as a formula if a spreadsheet program
opens the file, and changing it, for example with a leading `'`, would change the row you resend. So the summary, the
browser and the node count such fields, and the advice is the same everywhere: import the files into the system they
came from rather than opening them in a spreadsheet program.
