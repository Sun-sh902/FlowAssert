// Writes the fixtures of offline/xlsx-fixtures/ with two independent spreadsheet writers, exceljs 4.4.0 and SheetJS
// xlsx 0.18.5 (docs/design/1.1-excel.md, "Test files"). Run in a throwaway folder, never in this repository:
//
//   mkdir /tmp/fx && cp package.json make.mjs /tmp/fx && cd /tmp/fx && npm install --ignore-scripts && node make.mjs OUT
//
// Each workbook's expected texts, as FlowAssert reads them, are in expected.json, written by hand from the design note:
// a test reads each fixture with both of FlowAssert's readers and requires exactly those rows.
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
if (!out) throw new Error("usage: node make.mjs OUT");

// exceljs: shared strings, rich text, numbers with formats, a date, a percentage, a boolean, a formula with its
// result, a merged range, a hidden row, a hidden sheet and a second visible one.
{
  const book = new ExcelJS.Workbook();
  book.creator = "FlowAssert test fixtures";
  book.created = new Date(Date.UTC(2026, 10, 12));
  book.modified = book.created;
  const sheet = book.addWorksheet("Contacts");
  sheet.addRow(["external_id", "name", "amount", "joined", "rate", "active", "total"]);
  sheet.addRow(["SYN-101", "Synthetic One", 1234.5, new Date(Date.UTC(2025, 10, 12)), 0.125, true, { formula: "C2*2", result: 2469 }]);
  sheet.addRow(["SYN-102", { richText: [{ text: "Rich " }, { font: { bold: true }, text: "Two" }] }, 7, new Date(Date.UTC(2024, 1, 29)), 0.5, false, { formula: "C3*2", result: 14 }]);
  sheet.addRow(["SYN-103", "名字 Zoë 😀", 0.1, new Date(Date.UTC(1999, 11, 31, 12, 30, 0)), 1, true, { formula: "C4*2", result: 0.2 }]);
  sheet.getColumn(3).numFmt = "#,##0.00";
  sheet.getColumn(4).numFmt = "yyyy-mm-dd";
  sheet.getCell("D4").numFmt = "yyyy-mm-dd hh:mm";
  sheet.getColumn(5).numFmt = "0.0%";
  sheet.getRow(3).hidden = true;
  sheet.mergeCells("H1:I1");
  sheet.getCell("H1").value = null;
  const hidden = book.addWorksheet("Archive", { state: "hidden" });
  hidden.addRow(["external_id"]);
  hidden.addRow(["SYN-999"]);
  book.addWorksheet("Notes").addRow(["synthetic note"]);
  writeFileSync(join(out, "exceljs-4.4.0.xlsx"), Buffer.from(await book.xlsx.writeBuffer()));
}

// SheetJS: a sheet of mixed types written from an array of arrays, with dates as serial numbers and a number format,
// in the 1904 date system, and a second workbook with inline strings and a gap row.
{
  const sheet = XLSX.utils.aoa_to_sheet([
    ["external_id", "phone", "count", "when", "ok"],
    ["SYN-201", "+1 212 555 0201", 42, 45973, true],
    ["SYN-202", "+1 212 555 0202", -3.75, 45973.25, false],
    ["SYN-203", "", 1e21, 0, true],
  ]);
  for (const ref of ["D2", "D3", "D4"]) sheet[ref].z = "yyyy-mm-dd hh:mm";
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Data");
  book.Workbook = { WBProps: { date1904: true } };
  writeFileSync(join(out, "sheetjs-0.18.5-1904.xlsx"), XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }));
}
{
  const sheet = XLSX.utils.aoa_to_sheet([["id", "note"], ["SYN-301", "line one\nline two"], [], ["SYN-302", " spaced "]]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Notes");
  writeFileSync(join(out, "sheetjs-0.18.5-inline.xlsx"), XLSX.write(book, { type: "buffer", bookType: "xlsx", bookSST: false, compression: true }));
}
