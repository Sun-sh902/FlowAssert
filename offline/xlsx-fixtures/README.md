# Workbooks from independent writers

The .xlsx reader (`offline/flowassert_offline/xlsx.py` and `ui/src/offline/xlsx.ts`) is tested against workbooks that
this repository's own writer did not make. Each file here was written once by `make.mjs` with an exact version of
another program's spreadsheet writer, in a throwaway folder, and committed:

| File | Writer |
| --- | --- |
| `exceljs-4.4.0.xlsx` | exceljs 4.4.0 (JavaScript), npm, 2023-10-19 |
| `sheetjs-0.18.5-1904.xlsx`, `sheetjs-0.18.5-inline.xlsx` | SheetJS xlsx 0.18.5 (JavaScript), npm, 2022-03-24 |

`expected.json` holds, for each file, the rows FlowAssert must read, written by hand from
[the design note](../../docs/design/1.1-excel.md); `scripts/dev/tests/test_xlsx.py` and
`ui/src/test/offline/xlsx-fixtures.test.ts` require them from both readers. Neither writer is a dependency of
FlowAssert: nothing in this repository imports it, and `package.json` here is only the record of the versions used.
No spreadsheet application wrote any of these files.

To write them again (the files will differ in their timestamps):

```sh
mkdir /tmp/fx && cp package.json make.mjs /tmp/fx && cd /tmp/fx
npm install --ignore-scripts && node make.mjs OUT_FOLDER
```
