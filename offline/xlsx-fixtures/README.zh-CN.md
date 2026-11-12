# 独立写入程序生成的工作簿

[English](README.md) | 简体中文

.xlsx 读取器（`offline/flowassert_offline/xlsx.py` 和 `ui/src/offline/xlsx.ts`）不只用本仓库自己的写入程序生成的工作簿测试。这里的每个文件都由 `make.mjs` 在临时文件夹里，用另一个程序的表格写入库的确切版本生成一次，再提交进来：

| 文件 | 写入程序 |
| --- | --- |
| `exceljs-4.4.0.xlsx` | exceljs 4.4.0（JavaScript），npm，2023-10-19 |
| `sheetjs-0.18.5-1904.xlsx`、`sheetjs-0.18.5-inline.xlsx` | SheetJS xlsx 0.18.5（JavaScript），npm，2022-03-24 |

`expected.json` 按[设计说明](../../docs/design/1.1-excel.zh-CN.md)手写了每个文件 FlowAssert 必须读出的行；`scripts/dev/tests/test_xlsx.py` 和 `ui/src/test/offline/xlsx-fixtures.test.ts` 要求两个读取器都读出这些行。这两个写入库都不是 FlowAssert 的依赖：本仓库没有任何代码导入它们，这里的 `package.json` 只用来记录所用的版本。这些文件都不是由电子表格程序写的。

重新生成（文件里的时间戳会不同）：

```sh
mkdir /tmp/fx && cp package.json make.mjs /tmp/fx && cd /tmp/fx
npm install --ignore-scripts && node make.mjs OUT_FOLDER
```
