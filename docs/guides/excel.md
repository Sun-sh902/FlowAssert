# Check an Excel workbook

From 1.1.0 either side of a check can be one worksheet of an Excel workbook (`.xlsx`), on the command line, in the
browser, in the GitHub Action and in the n8n node. You no longer save it as CSV first. The result is the one the same
rows would give in a CSV file: reading a workbook never makes a result more Verified. The
[design note](../design/1.1-excel.md) defines the text of every cell and every refusal.

- [1. What is read](#1-what-is-read)
- [2. Run one check](#2-run-one-check)
- [3. The text of a cell: stored, not displayed](#3-the-text-of-a-cell-stored-not-displayed)
- [4. What the report and the summary add](#4-what-the-report-and-the-summary-add)
- [5. When a workbook is refused](#5-when-a-workbook-is-refused)

## 1. What is read

- **One worksheet.** A workbook with one sheet needs no name. With several, name the worksheet exactly as the workbook
  does (`--source-worksheet Orders`); in the browser, pick it under "Choose the worksheet to check". A hidden worksheet
  can be named and read; the summary says it is hidden.
- **Row 1 holds the column names**, from column A to its last non-empty cell. Each later row with a value is a record;
  an empty row is not one. A value to the right of the last column name is refused.
- **The stored value of each cell**, never what a spreadsheet program displays: see section 3.
- **Never anything else.** FlowAssert computes no formula, runs no macro, follows no link to another file, and reads only
  the parts of the archive it needs, within `--max-bytes` for the file and for what it inflates.

## 2. Run one check

```sh
flowassert-verify \
  --source orders-shop.xlsx --source-format xlsx --source-worksheet Orders \
  --destination orders-warehouse.csv \
  --key order_id --field quantity --field total \
  --source-complete --destination-complete
```

A workbook is read as a workbook only when you say so (`--source-format xlsx`, `--destination-format xlsx`), never
from a file's name. A workbook side has no encoding. Both sides can be workbooks.

- **In the browser**, choose or drop the `.xlsx` file: the page recognises a workbook, lists its sheets, profiles the
  worksheet (rows, columns, empty cells, cells read as numbers, dates or formulas, hidden rows and merged ranges), and
  checks it in the browser. Nothing is uploaded.
- **In the GitHub Action**, `source-format: xlsx` and `source-worksheet: Orders`
  ([example](../../examples/github-actions/workbooks.yml)).
- **In the n8n node**, set Source Format to "Excel Workbook (.xlsx)"
  ([the node](../../integrations/n8n-nodes-flowassert/README.md)).

## 3. The text of a cell: stored, not displayed

A spreadsheet stores a value and displays it through a format. FlowAssert reads what is stored, so the same workbook
gives the same text on every computer, in every language, whatever program wrote it.

| The cell | Displayed, for example | Read as |
| --- | --- | --- |
| A number with a format | `1,234.50` | `1234.5` |
| A percentage | `12.5%` | `0.125` |
| A date | `12/11/2025` or `12 Nov 2025` | `2025-11-12` |
| A date and time | `11/12/25 9:30 AM` | `2025-11-12T09:30:00` |
| A time | `9:30 AM` | `09:30:00` |
| A duration | `36:00:00` | `1.5` (days) |
| A boolean | `TRUE` | `TRUE` |
| A formula | its result | the result stored when the file was last saved |
| Text | `0042` | `0042`, white space and leading zeros kept |

So think of the other side's text. A date read from the workbook is `2025-11-12`: if the destination writes
`12/11/2025`, the two texts differ, and a `date:FORMAT` rule reads both sides with one format, so it cannot join them.
Export the destination's dates in ISO 8601, or compare a column that holds the same text on both sides. A number the
destination writes with a thousands separator (`1,234.50`) differs from the stored `1234.5` as text; the `digits` rule
compares the digits only, so it suits identifiers such as phone numbers, not amounts.

## 4. What the report and the summary add

The report has `schema_version` 4 and, for each side read from a workbook, `inputs.source_workbook` or
`inputs.destination_workbook`: the worksheet and whether it is hidden, the number of sheets, the date system, the file's
SHA-256 and size, and the cells by how they were read. `inputs.source_sha256` is then the digest of the rows read
(a canonical CSV form), so two workbooks holding the same cells have the same digest whichever program wrote them; a
workbook and a CSV file holding the same rows are identical content, refused without `--allow-identical-content`.
The summary says which worksheet was read, that cells were read as stored, not as displayed, and how many cells a
spreadsheet may display differently, how many rows and columns are hidden and how many ranges are merged. Hidden
rows are read like any other: a hidden row is still a record.

## 5. When a workbook is refused

A workbook FlowAssert cannot read with certainty is refused, with a message that says why and, where you can act, how:
a legacy `.xls` or password-protected file, a macro-enabled `.xlsm`, several sheets and no name, a formula without a
stored result, an error value such as `#N/A`, a number format whose text is not defined, and a damaged or oversized
archive. [When a check is refused](refusals.md#reading-an-excel-workbook) explains each message. When nothing else
helps, export the worksheet as CSV UTF-8 and check that.
