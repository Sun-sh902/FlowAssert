# FlowAssert 核对：规范

[English](verification.md) | 简体中文

版本 1.0。本文是规范性文件，规定 `flowassert-verify` 所做的核对，浏览器核对和打包的 JavaScript 核对函数也按它执行：输入是什么、怎样读取行、怎样判定记录、报告里有什么、哪些情况会拒绝，以及命令怎样退出。两种语言的版本内容相同；如有出入，以英文版为准，并请当作缺陷报告。

- [1. 约定](#1-约定)
- [2. 输入](#2-输入)
- [3. 读取 CSV 文件](#3-读取-csv-文件)
- [4. 键](#4-键)
- [5. 字段规则](#5-字段规则)
- [6. 前提和总数](#6-前提和总数)
- [7. 记录状态](#7-记录状态)
- [8. 批次状态](#8-批次状态)
- [9. 范围和只在目标中的记录](#9-范围和只在目标中的记录)
- [10. 报告](#10-报告)
- [11. 打印的摘要](#11-打印的摘要)
- [12. 拒绝](#12-拒绝)
- [13. 退出码](#13-退出码)
- [14. 由连接器读取的行](#14-由连接器读取的行)
- [15. 本规范没有定死的地方](#15-本规范没有定死的地方)

## 1. 约定

“必须”“不得”“应当”“不应”“可以”分别对应 RFC 2119 和 RFC 8174 里的 MUST、MUST NOT、SHOULD、SHOULD NOT、MAY，只有加粗时才有这层含义。

每条要求都有编号。带**必须**或**不得**的要求，至少列出一个检验它的核对样例。样例写成它所在的文件夹：`golden/NAME` 指 `offline/golden/NAME`，`golden-sheets/NAME` 指 `offline/golden-sheets/NAME`，`golden-hubspot/NAME` 指 `offline/golden-hubspot/NAME`，`conformance/NAME` 指 `offline/conformance/NAME.json`。[一致性](../conformance.zh-CN.md)说明一个实现怎样运行这些样例。如果某条要求没有列出样例，或者列出的样例不存在，测试（`scripts/dev/tests/test_spec.py`）就会失败。

参考实现是 `offline/flowassert_offline/`，运行在 CPython 上。本文和参考实现不一致时，说明其中一方有缺陷，需要报告并解决；任何一方都不会默认为准。

**唯一的原则。** 证据不足时，结果绝不是已验证。下面每条要求都是这个原则的应用：需要前提才能得出的结论，没有前提就不下；无法比较的值是未知，既不算相同，也不算不同。

## 2. 输入

一次核对包含：**来源**，一张有列名的表；**目标**，另一张这样的表；**核对内容**，指明键列和要比较的字段；以及调用者声明的**前提**。

- **R2.1** 一次核对**必须**恰好有一个来源和一个目标，各读取一次，先读来源。样例：`golden/example`、`golden/chunk-csv-error-before-later-decode-error`。
- **R2.2** 核对内容**必须**在两张表里各指明一个键列，并至少指明一个比较字段；每个字段由来源列、目标列和一条规则组成。样例：`golden/example`、`golden/refused-no-field`。
- **R2.3** 在命令行上，核对内容**必须**来自以下三者之一，且只能是其一：`--key` 加 `--field`（规则都是 `exact`）、`--mapping` 文件（规则都是 `exact`）、`--config` 文件（每个字段一条规则，还可以写范围）。样例：`golden/example`、`golden/mapping-file`、`golden/rules-pass`、`golden/refused-config-with-key`、`golden/refused-mapping-with-key`。
- **R2.4** `--key` 和 `--field` 的值是 `COLUMN` 或 `SOURCE:DESTINATION`，在第一个冒号处分开；列名里有冒号时，**必须**通过映射文件或配置文件给出。样例：`golden/example`、`golden/mapping-file`、`golden/refused-empty-key-column`。
- **R2.5** 同一个来源列**不得**比较两次。样例：`golden/refused-repeated-field`、`golden/refused-config-repeated-field`。
- **R2.6** 配置文件和映射文件**必须**是 UTF-8 编码的 JSON，开头可以有字节顺序标记；不是 UTF-8、不是 JSON、成员重复、有未知成员，或者缺少 `key` 或 `fields` 时，**必须**拒绝。样例：`golden/config-loaded-with-bom`、`golden/refused-config-not-utf8`、`golden/refused-config-not-json`、`golden/refused-config-duplicate-member`、`golden/refused-config-unknown-member`。
- **R2.7** 配置文件**不得**声明前提：成员名与完整性声明、总数或“允许内容相同”同名时（不分大小写，`-` 和 `_` 等同），拒绝。样例：`golden/refused-config-premise`。
- **R2.8** 两份输入**必须**相互独立。同一个文件给两次，拒绝；两个文件的字节完全相同，也拒绝，除非调用者声明它们来自不同系统（`--allow-identical-content`），报告会记下这项声明。样例：`golden/refused-same-file`、`golden/refused-identical-content`、`golden/identical-content-allowed`。

## 3. 读取 CSV 文件

读取 CSV 文件的方式，与 CPython 的 `csv.reader(strict=True)` 读取以 `newline=""` 打开的文本相同：逗号分隔，`"` 作引号，引号里的引号写两次，没有转义字符。

- **R3.1** 编码**必须**是声明的那一种：`utf-8`（默认）、`utf-16` 或 `gb18030`，**不得**猜测；其他名称拒绝。样例：`golden/encoding-gb18030`、`golden/encoding-cli-options`、`golden/refused-bad-encoding-name`、`golden/decode-wrong-encoding`。
- **R3.2** UTF-8 文件开头**可以**有字节顺序标记，它不属于第一个列名；UTF-16 文件开头**必须**有字节顺序标记，由它决定字节顺序。样例：`golden/encoding-utf8-bom`、`golden/encoding-utf16-le`、`golden/encoding-utf16-be`、`golden/decode-utf16-no-bom`。
- **R3.3** 文件里有按声明的编码无法解码的字节时，**必须**拒绝，绝不用替换字符读取。样例：`golden/decode-utf8-invalid`、`golden/decode-utf8-truncated`、`golden/decode-utf16-odd-length`、`golden/decode-utf16-lone-surrogate`、`golden/decode-gb18030-invalid`。
- **R3.4** GB18030 **必须**按 CPython 的 `gb18030` 编解码器解码，包括其他解码器映射不同的那些字节序列。样例：`golden/encoding-gb18030-python-mapping`。
- **R3.5** 一行以 LF、CR LF 或 CR 结束；引号内的换行属于值，**必须**原样保留。样例：`golden/quoted-line-breaks`。
- **R3.6** 第一行是表头。表头里列名重复时**必须**拒绝；文件缺少核对内容指明的列时，也**必须**拒绝；空文件没有任何列。样例：`golden/refused-repeated-column`、`golden/refused-missing-columns`、`golden/refused-empty-file`。
- **R3.7** 空行**不得**算作一行：跳过，不计数。样例：`golden/counts-zero`、`golden/quoted-line-breaks`。
- **R3.8** 其他每一行的字段数**必须**与表头相同；多了或少了都拒绝，并给出行号。行号统计读过的每一行，包括引号内的行。样例：`golden/refused-row-wider-than-header`、`golden/refused-row-narrower-than-header`、`golden/line-number-after-quoted-break`。
- **R3.9** 引号格式有误时**必须**拒绝：引号没有闭合，或者闭合的引号后面不是逗号或行尾。样例：`golden/refused-unexpected-end`、`golden/refused-quote-not-followed-by-comma`。
- **R3.10** 字段超过 131,072 个码点时**必须**拒绝；恰好这么长的字段可以读取。样例：`golden/refused-field-limit`、`golden/field-at-limit`。
- **R3.11** 文件超过字节上限（`--max-bytes`，默认 209,715,200）时，**必须**在读取之前拒绝；数据行超过行数上限（`--max-rows`，默认 1,000,000）时，**必须**在读取过程中拒绝；恰好等于上限的文件可以读取。样例：`golden/refused-max-bytes`、`golden/refused-max-rows`、`golden/max-rows-at-limit`。
- **R3.12** 一个文件里既有格式错误的行，又有无法解码的字节时，拒绝原因**必须**与 CPython 相同：CPython 每次解码 8,192 字节，只在 CSV 读取器需要下一行时才解码，按这个顺序先遇到哪个问题，就报告哪个。样例：`golden/chunk-csv-error-before-later-decode-error`、`golden/chunk-decode-error-in-first-chunk`。
- **R3.13** 只有核对内容指明的列参与核对。值就是字段的原文：不去空格，不改大小写，不做类型转换。样例：`golden/unsafe-values`、`golden/rules-fail`。
- **R3.14** 被拒绝的文件**不得**被部分使用：没有报告，也没有结果。样例：`golden/refused-row-wider-than-header`、`golden/refused-max-rows`。

## 4. 键

- **R4.1** 一行的键是它键列里的值。键为空或只有空白时，视为**没有键**；空白指 CPython 的 `str.isspace` 认可的字符。样例：`golden/keyless-rows`、`conformance/keyless-destination-row`。
- **R4.2** 键**必须**按原样的字符串比较：不去空格，不折叠大小写，不做 Unicode 规范化。样例：`golden/unsafe-values`、`golden/scope-exact-source-known`。
- **R4.3** 没有键的来源行，以及键与另一来源行相同的每一个来源行，**必须**判为未验证；每条规则的结果都是 `unknown`，原因是 `invalid or duplicate source key`。样例：`golden/duplicate-source-key`、`golden/keyless-rows`、`conformance/duplicate-source-key`。
- **R4.4** 没有键的目标行**必须**计入 `destination_rows_without_key`，并且**不得**与任何来源记录匹配。样例：`golden/keyless-rows`、`golden/scope-exact-keyless-destination`。
- **R4.5** 有多个目标行带着某条来源记录的键时，这条记录的 `uniqueness` **必须**不通过，它的字段都不比较：不挑选任何一行。样例：`golden/duplicate-destination-key`、`golden/example`、`conformance/duplicate-destination-key`。

## 5. 字段规则

每个字段有一条规则，由调用者选择，从不推断。

| 规则 | 比较什么 | 何时为未知 |
| --- | --- | --- |
| `exact` | 两个字符串的原样 | 任一值为空 |
| `trim` | 去掉首尾空白之后的字符串（`str.strip`） | 任一值为空，或去掉空白后为空 |
| `casefold` | 做完整 Unicode 大小写折叠之后的字符串（`str.casefold`） | 任一值为空 |
| `digits` | 每个字符串里的 `0` 到 `9`，按原顺序 | 任一值为空，或不含这些字符 |
| `date:FORMAT` | 两个值都用 `datetime.strptime(value, FORMAT)` 解析；带 UTC 偏移的值按 UTC 时刻比较 | 任一值为空、无法解析，或换算成 UTC 后超出公元 1 到 9999 年 |

- **R5.1** 比较的两个形式相等时，字段结果**必须**是 `pass`；不相等时是 `fail`；没有可比较的内容时是 `unknown`，如上表。样例：`golden/rules-pass`、`golden/rules-fail`、`golden/rules-unknown`。
- **R5.2** 空值在每条规则下都**必须**是 `unknown`：缺少的值不当作差异。样例：`golden/empty-values`、`golden/rules-unknown`、`conformance/empty-value`。
- **R5.3** `digits` **必须**只保留 ASCII 数字 `0` 到 `9`；其他文字里的数字不算。样例：`golden/rules-pass`、`conformance/rule-digits-unknown`。
- **R5.4** 带 UTC 偏移的日期**必须**先换算成 UTC 再比较，所以同一时刻的两种写法可以通过；换算结果超出公元 1 到 9999 年时，**必须**是 `unknown`。样例：`golden/rules-pass`、`golden/date-overflow-unknown`、`conformance/rule-date-offset-pass`。
- **R5.5** 以下情况**必须**在读取任何文件之前拒绝：规则不是这五种之一；`date:` 规则没有格式，或格式里没有指令；`strptime` 无法使用的格式；重复使用同一指令的格式。样例：`golden/refused-config-unknown-rule`、`golden/refused-config-malformed-date`、`golden/refused-config-stray-percent`、`golden/refused-config-no-directive`、`golden/refused-config-repeated-directive`。
- **R5.6** 规则不是 `exact` 时，结果**必须**记录这条规则，以及规则实际比较的两个值（`expected_normalized`、`actual_normalized`）；没有可比较的内容时为 `null`。样例：`golden/rules-fail`、`golden/rules-unknown`。
- **R5.7** 规则**不得**改变记录为 `expected` 或 `actual` 的值：它们是字段的原文。样例：`golden/rules-pass`、`golden/scope-exact-source-known`。

浏览器核对支持的 `strptime` 指令是 `%Y %m %d %H %M %S %f %z %b %B %y %p %I %j %%`。格式里有其他指令时，它会拒绝并说明原因，不会近似解析；命令行接受 CPython 认识的所有指令。

## 6. 前提和总数

前提是调用者的声明，核对无法验证它。报告会记录每项前提和它的来源，但从不认证。

| 前提 | 声明的内容 | 用途 |
| --- | --- | --- |
| `source_complete` | 来源行就是整个批次 | 批次要判为已验证，需要它 |
| `destination_complete` | 目标行覆盖整个对象 | 缺失的记录要判为不一致、单独一行要判为唯一，需要它 |
| `source_count` | 调用者在来源系统里看到的总数 | 没有正面作用：只可能撤销 `source_complete` |
| `destination_count` | 调用者在目标系统里看到的总数 | 没有正面作用：只可能撤销 `destination_complete` |
| `allow_identical_content` | 两份相同的输入来自不同系统 | 没有它，这两份输入根本不会核对 |

- **R6.1** 前提**必须**只在调用者明确声明时才算已声明；它从不由数据推断，配置文件也不能声明它。样例：`golden/example-without-premises`、`golden/refused-config-premise`、`conformance/unknown-source-population`。
- **R6.2** **来源总体已知**的条件是，也只是：声明了 `source_complete`，每个来源行都有键，没有重复的键，并且如果声明了 `source_count`，它等于读到的来源行数。样例：`golden/example`、`golden/count-source-mismatch`、`golden/duplicate-source-key`、`golden/keyless-rows`。
- **R6.3** **目标覆盖充分**的条件是，也只是：声明了 `destination_complete`，每个目标行都有键，并且如果声明了 `destination_count`，它等于读到的目标行数。样例：`golden/example`、`golden/count-destination-mismatch`、`golden/keyless-rows`。
- **R6.4** 声明的总数与读到的行数相等，**不得**代替完整性声明。样例：`golden/count-cli-forms`、`conformance/counts-match-without-completeness`。
- **R6.5** 声明的总数**必须**是从 0 起的整数，大小不限；其他写法拒绝。没有键的行算一行，空行不算。样例：`golden/counts-zero`、`golden/count-cli-forms`、`golden/refused-bad-count`、`golden/refused-negative-count`。
- **R6.6** 对每个总数，报告**必须**记录声明的值、读到的行数和两者是否相等；没有声明总数时也要记录。样例：`golden/example`、`golden/counts-match`、`golden/count-destination-mismatch-without-complete`。

## 7. 记录状态

每个来源行是一条记录，对 `existence`、`uniqueness` 和每个比较字段各有一个结果。每个结果是 `pass`、`fail` 或 `unknown`，并带有原因。

- **R7.1** 有任何结果不通过时，记录**必须**是**不一致**；所有结果都通过时是**已验证**；其余情况是**未验证**。样例：`golden/example`、`golden/rules-unknown`、`conformance/field-differs`。
- **R7.2** 键恰好对应一个目标行时：`existence` 通过；`uniqueness` 只在目标覆盖充分时通过，否则是 `unknown`；每个字段按它的规则比较。样例：`golden/example`、`golden/example-page-source-complete-only`。
- **R7.3** 字段不同，不论有没有前提，都**必须**判为不通过：一行确实存在的数据，本身就足以否定一条规则。样例：`golden/example-without-premises`、`conformance/field-differs-without-premises`。
- **R7.4** 键没有对应的目标行时：只有目标覆盖充分，`existence` 才不通过；否则是 `unknown`，记录是未验证，不是不一致。样例：`golden/example`、`golden/example-page-source-complete-only`、`conformance/missing-incomplete-destination`。
- **R7.5** 声明了 `destination_complete`，但声明的目标总数与读到的行数不同时，缺失记录的 `existence` **必须**是 `unknown`，原因里**必须**说明总数不同。样例：`golden/count-destination-mismatch`、`conformance/destination-count-mismatch`。
- **R7.6** 这种核对没有等待窗口，所以记录不会是待定，`Pending` 的计数始终是 0。样例：`golden/example`、`golden/no-rows`。

## 8. 批次状态

- **R8.1** 有任何记录不一致，或有任何只在目标中的记录不一致时，批次是**不一致**。样例：`golden/example`、`golden/scope-exact-source-known`。
- **R8.2** 否则，只有同时满足以下条件，批次才是**已验证**：至少有一个来源行，来源总体已知，每条记录都已验证。样例：`golden/rules-pass`、`golden/counts-match`、`conformance/all-verified`。
- **R8.3** 其余情况，批次是**未验证**。特别是：每条记录都已验证，批次仍可能是未验证，因为来源总体未知；没有任何行的核对也是未验证。样例：`golden/example-page-destination-complete-only`、`golden/no-rows`、`golden/counts-zero`、`conformance/v1-e-row-verified-cohort-unverified`。
- **R8.4** 来源总体已知时，`expected_total` **必须**是来源行数；否则是 `null`。样例：`golden/example`、`golden/example-without-premises`。
- **R8.5** 只有已验证的批次带有声明语句，内容是第 10 节里的固定句子；其他报告的 `claim` 都**必须**是 `null`。样例：`golden/rules-pass`、`golden/example`。

## 9. 范围和只在目标中的记录

范围是 `source`（默认：核对每条来源记录）或 `exact`（另外报告不在来源里的目标键）。

- **R9.1** 范围是 `source` 时，键不在来源里的目标行**不得**影响任何结果，报告里没有 `destination_only` 成员。样例：`golden/scope-source-cli`、`golden/unsafe-values`、`conformance/scope-source-extra`。
- **R9.2** 范围是 `exact` 时，没有任何来源行带着的每个目标键，**必须**成为一条只在目标中的记录，按它第一个目标行的顺序排列，记录这一行的位置和带这个键的行数。样例：`golden/scope-exact-keyless-destination`、`golden/scope-exact-source-known`。
- **R9.3** 来源总体已知时，只在目标中的记录**必须**是不一致；否则是未验证，因为这个键可能属于没有提供的来源行。目标覆盖是否充分与此无关：这一行确实存在。样例：`golden/scope-exact-source-known`、`golden/scope-exact-source-unknown`、`conformance/scope-exact-source-not-complete`。
- **R9.4** 没有键的目标行**不得**成为只在目标中的记录。样例：`golden/scope-exact-keyless-destination`、`conformance/scope-exact-keyless-destination-row`。
- **R9.5** 只在目标中的记录从不出现在 `records` 里，也不计入 `counts`；它计入 `destination_only_counts`。样例：`golden/scope-exact-source-known`、`golden/scope-exact-no-extra`。
- **R9.6** 范围不是 `source` 或 `exact` 时，**必须**拒绝。样例：`golden/refused-bad-scope`、`golden/refused-config-bad-scope`。

## 10. 报告

报告是一个 JSON 对象。[报告格式](../report-format.zh-CN.md)说明每个成员，[JSON Schema](../schema/) 按每个 `schema_version` 定义它们。

- **R10.1** 报告**必须**以 `schema_version` 开头，写入方**必须**使用报告所符合的那个版本：两个文件是 1，来源从 Google Sheets 读取是 2，目标从 HubSpot 读取是 3。样例：`golden/example`、`golden-sheets/sheet-verified`、`golden-hubspot/hubspot-verified`。
- **R10.2** `records` 里**必须**每个来源行有一条记录，按文件顺序排列，`source_row` 从 0 开始。样例：`golden/example`、`golden/duplicate-source-key`。
- **R10.3** 明细级别是 `problems`（默认）时，已验证的记录**必须**只有 `key`、`source_row` 和 `state`；是 `all` 时，每条记录都有全部成员。明细级别**不得**改变任何状态、计数或摘要。样例：`golden/example`、`golden/example-details-all`。
- **R10.4** 使用 `--redact-values` 时，每条记录的键和每个只在目标中的键都**必须**是 `[redacted]`，字段结果里没有 `expected`、`actual`、`expected_normalized` 和 `actual_normalized`；状态、原因和计数不变。样例：`golden/example-redacted`、`golden/rules-redacted`、`golden/scope-exact-cli`、`golden/unsafe-values-details-all`。
- **R10.5** `inputs` **必须**记录每份输入读到的字节的 SHA-256、两者是否相同，以及用到的映射文件或配置文件的 SHA-256。样例：`golden/example`、`golden/mapping-file`、`golden/rules-pass`、`golden/identical-content-allowed`。
- **R10.6** 只要明确选择了任一编码，就**必须**把两个编码一起记录。样例：`golden/encoding-cli-options`、`golden/example-page`。
- **R10.7** 每项前提不论是否声明，都**必须**记录声明的内容和来源。样例：`golden/example-without-premises`、`golden/example-page`。
- **R10.8** `obligation` **必须**记录键、按顺序排列的字段、规则是否全是 `exact`（`comparison`）、由配置文件给出时的规则，以及选择过的范围。样例：`golden/example`、`golden/rules-pass`、`golden/scope-source-cli`。
- **R10.9** 每份报告都**必须**带有 `limitations`；`workflow_execution`、`business_truth` 和 `existed_by_deadline` 为 `Not assessed`，`acquisition_authenticity` 为 `not_authenticated`：核对从不评估这些。样例：`golden/example`、`golden/rules-pass`。
- **R10.10** JSON 文本**必须**是 UTF-8，ASCII 以外的字符都写成 `\u` 转义；成员按码点排序，只有 `schema_version` 排在最前；缩进两个空格；右花括号后面没有换行。样例：`golden/unsafe-values`、`golden/scope-exact-source-known`。
- **R10.11** 写出 HTML 报告时，它**必须**显示与 JSON 报告相同的结果，对来自文件的每个值做转义，不含脚本，也不加载任何东西。样例：`golden/unsafe-values`、`golden/scope-exact-source-known`。
- **R10.12** 报告文件从不覆盖已有的文件；任何一份报告写不出来时，两份都不会留下。这是要求，但它在核对样例之外检验，因为核对样例总是写入新文件；见[第 15 节](#15-本规范没有定死的地方)。

已验证报告的声明语句固定为：“At this evaluation, under the stated premises, the supplied destination rows satisfy the rules for the supplied source rows.” 限制说明固定为：“Files and completeness statements are not authenticated. Not assessed: whether a workflow ran, whether the source is true, whether a record existed by a past deadline.”

## 11. 打印的摘要

核对没有被拒绝时，命令按下面的顺序把这些行打印到标准输出，每一行只在条件成立时出现：

| 行 | 条件 |
| --- | --- |
| `STATE: N rows of TOTAL` | 始终；`TOTAL` 是 `expected_total` 或 `unknown total` |
| `Verified A · Mismatch B · Unverified C` | 始终 |
| 连接器的行（[第 14 节](#14-由连接器读取的行)） | 来源或目标由连接器读取 |
| `Source and destination files were identical (--allow-identical-content).` | 两份输入相同 |
| `Source count stated S, file has N rows: the batch cannot be Verified.` | 声明的来源总数不同 |
| `Destination count stated S, file has N rows: absence and uniqueness stay unknown.` | 声明的目标总数不同 |
| `Source population unknown: the batch cannot be Verified.` | 来源总体未知 |
| `Destination coverage not established: absence and uniqueness stay unknown.` | 目标覆盖不充分 |
| `Destination-only: N records not in the source…` | 范围是 `exact`：结尾是 `0 records not in the source.`、`, each a Mismatch.` 或 `, listed without a conclusion.` |
| `  record R KEY: STATE`，然后每个没有通过的结果一行 `    RULE STATUS: REASON (VALUES)` | 每条不是已验证的记录，最多 `--max-details` 条（默认 50）；`R` 从 1 开始，没有键的记录打印 `(no key)` |
| `... N more records not shown; use --json for all of them.` | 这样的记录多于 `--max-details` |
| 限制说明 | 始终 |

- **R11.1** 摘要**必须**只有这些行，每行以换行符结束。样例：`golden/example`、`golden/scope-exact-source-known`、`golden/count-source-mismatch`。
- **R11.2** `--max-details` **必须**只限制摘要里的记录行：状态、计数和报告都不随它改变，0 表示一条也不打印。样例：`golden/example-max-details-1`、`golden/example-max-details-0`。
- **R11.3** 记录行里的值按 CPython 的 `repr` 写出，所以空字符串、空格和控制字符都看得见。样例：`golden/unsafe-values`、`golden/rules-fail`。

## 12. 拒绝

输入无法核对时，回答是拒绝。拒绝不下任何结论。

- **R12.1** 被拒绝的核对**必须**向标准错误打印一行 `refused: MESSAGE`，标准输出什么也不打印，不写报告，以退出码 2 结束。样例：`golden/refused-max-rows`、`golden/refused-identical-content`、`golden/decode-utf8-invalid`。
- **R12.2** 与某个文件有关的拒绝，**必须**以给出时的文件名开头。样例：`golden/refused-row-wider-than-header`、`golden/refused-config-not-json`。
- **R12.3** 在读取任何一份输入之前，**必须**先按下表的顺序检查每个选项并读取配置；有多个问题时，报告顺序最靠前的那个。样例：`golden/refused-bad-details`、`golden/refused-config-with-key`、`golden/refused-max-bytes`。

下表按可能出现的顺序列出拒绝信息。`FILE` 是文件名，`N` 是数字，`NAMES` 是用 `, ` 分隔的列表：

| 信息 | 出现的情况 |
| --- | --- |
| `--max-details must be a non-negative integer` | 摘要记录行的上限不是从 0 起的整数 |
| `--max-bytes must be a positive integer`、`--max-rows must be a positive integer` | 上限不是从 1 起的整数 |
| `--source-count must be a non-negative integer`、`--destination-count …` | R6.5 |
| `--details must be one of: problems, all` | 其他明细级别 |
| `--source-encoding must be one of: utf-8, utf-16, gb18030`、`--destination-encoding …` | R3.1 |
| `--config cannot be combined with NAMES` | `--config` 与 `--mapping`、`--key`、`--field` 或 `--scope` 同时使用 |
| `--scope must be one of: source, exact` | R9.6 |
| `--mapping cannot be combined with --key or --field` | R2.3 |
| `--key or --mapping is required`、`at least one --field is required` | R2.2 |
| `empty column name in 'TEXT'` | `--key` 或 `--field` 的冒号前面是空的 |
| 配置文件或映射文件的 `FILE: …` | R2.6、R2.7、R5.5、R9.6：`not UTF-8`；`invalid JSON (…)`；`duplicate member 'NAME'`；`configuration must be a JSON object`；`mapping must be a JSON object`；`NAMES cannot be set in a configuration file; completeness statements and counts are command-line options, chosen at each run`；`unknown member NAMES`；`missing member NAMES`；`key must be a two-item list of strings`；`empty column name in key`；`fields must be a non-empty list`；`each field must be an object with source, destination and an optional rule`；`unknown member NAMES in field`；`missing member NAMES in field`；`field source must be a string`；`empty column name in field`；`field rule must be a string`；`field 'NAME': …` 加规则的错误；`a source field is repeated`；`scope must be one of: source, exact` |
| `a source field is repeated` | R2.5 |
| `source and destination are the same file, so the check would not be independent` | R2.8 |
| `FILE: file size N bytes exceeds --max-bytes limit of N` | R3.11 |
| `FILE: repeated column name`、`FILE: missing column NAMES` | R3.6 |
| `FILE: line N does not match the header` | R3.8 |
| `FILE: exceeds --max-rows limit of N` | R3.11 |
| `FILE: not UTF-8`、`FILE: not UTF-16`、`FILE: not UTF-16 (no byte order mark)`、`FILE: not GB18030` | R3.2、R3.3 |
| `FILE: unexpected end of data`、`FILE: ',' expected after '"'`、`FILE: field larger than field limit (131072)`、`FILE: new-line character seen in unquoted field - do you need to open the file with newline=''?` | R3.9、R3.10；文字来自 CPython |
| `FILE: …` 加操作系统的信息 | 文件无法打开或读取 |
| `source and destination have identical content, so the check would not be independent; pass --allow-identical-content if they really come from different systems` | R2.8，在两份输入都读完之后 |

- **R12.4** 表里的文字是格式的一部分：实现**必须**一字不差地给出。样例：`golden/refused-bad-count`、`golden/refused-config-premise`、`golden/refused-field-limit`、`golden/decode-utf16-no-bom`。

## 13. 退出码

| 退出码 | 含义 |
| --- | --- |
| 0 | 批次已验证 |
| 1 | 批次不一致 |
| 3 | 批次未验证 |
| 2 | 输入被拒绝；什么也没有核对 |
| 4 | 核对程序内部出错；不能得出任何结论 |

- **R13.1** 退出码**必须**与批次状态对应：0、1 或 3。样例：`golden/rules-pass`、`golden/example`、`golden/example-without-premises`。
- **R13.2** 拒绝**必须**以 2 退出，它从不是某个结果的退出码。样例：`golden/refused-max-rows`、`golden/decode-wrong-encoding`。
- **R13.3** 内部出错时以 4 退出，并向标准错误打印 `failed: NAME`；绝不以 1 退出，否则会被读成不一致。核对样例无法引发内部错误；见[第 15 节](#15-本规范没有定死的地方)。

## 14. 由连接器读取的行

连接器自己读取一侧的行，不再接收文件。它只改变行的来处，不改变其他任何东西。

- **R14.1** 同样的行，不论由连接器读取还是放在 CSV 文件里，都**必须**得到同样的记录、规则结果、计数、批次状态和退出码。样例：`golden-sheets/sheet-mismatch`、`golden-sheets/sheet-config-rules-exact-redacted`、`golden-hubspot/hubspot-mismatch`、`golden-hubspot/hubspot-config-rules-exact-redacted`。
- **R14.2** 连接器**不得**声明前提。读到服务返回的每一行，并不说明这些行就是整个批次或整个对象：完整性仍然是调用者的声明，作用与文件相同。样例：`golden-sheets/sheet-unverified`、`golden-hubspot/hubspot-unverified`。
- **R14.3** 连接器**必须**只读取：只向文档写明的主机发 HTTPS `GET` 请求，验证 TLS，不跟随重定向，不用代理，不重试。样例：`golden-sheets/sheet-verified`（它的 `requests.json`）、`golden-sheets/sheet-refused-redirect`、`golden-hubspot/hubspot-many-pages`（它的 `requests.json`）、`golden-hubspot/hubspot-refused-redirect`。
- **R14.4** 读取失败或有疑问时，**必须**拒绝，不写报告：错误状态、限流、超时、重定向、响应不是文档描述的形状，或者来源在读取期间发生了变化。样例：`golden-sheets/sheet-refused-429`、`golden-sheets/sheet-refused-not-json`、`golden-sheets/sheet-refused-changed`、`golden-hubspot/hubspot-refused-429`、`golden-hubspot/hubspot-refused-repeated-record`、`golden-hubspot/hubspot-refused-archived`。
- **R14.5** 凭证**必须**来自环境变量，并且**不得**出现在摘要、报告、拒绝信息或错误信息里。样例：`golden-sheets/sheet-refused-401`、`golden-sheets/sheet-api-key`、`golden-hubspot/hubspot-refused-401`、`golden-hubspot/hubspot-verified`。
- **R14.6** 报告**必须**记录这些行在哪里、什么时候读取，并用它们的一种有文档说明的规范形式的摘要值，代替文件的摘要值。样例：`golden-sheets/sheet-verified`、`golden-hubspot/hubspot-verified`。
- **R14.7** 逐页读取的目标，在同一条记录出现两次、某一页给出之前给过的分页游标、或者某一页说有下一页却没有记录时，**必须**拒绝：这些都说明列表在读取期间变了，或者页面在重复。样例：`golden-hubspot/hubspot-refused-repeated-record`、`golden-hubspot/hubspot-refused-repeated-cursor`、`golden-hubspot/hubspot-refused-empty-page-with-next`。
- **R14.8** 目标记录在某个属性上没有值时，**必须**当作空值，与空单元格相同；记录根本没有这个属性时，**必须**拒绝，与缺少列相同。样例：`golden-hubspot/hubspot-null-values`、`golden-hubspot/hubspot-refused-missing-property`。

连接器的设计说明是本规范中关于该连接器的部分：[Google Sheets 来源](../connectors/google-sheets.zh-CN.md)和 [HubSpot 联系人目标](../connectors/hubspot.zh-CN.md)。它列出每个选项、请求、拒绝信息和报告成员。

## 15. 本规范没有定死的地方

这里列出参考实现里依赖运行平台的行为，以及本文有要求、但没有核对样例检验的地方。每一项都写明，免得有人自己去发现。

| 事项 | 现状 |
| --- | --- |
| **Unicode 版本。** `casefold`、`trim` 和空键所说的空白，以及摘要里 `repr` 转义哪些字符，都跟随所运行的 Python 的 Unicode 版本。 | 没有定死。核对样例只用了从 Unicode 13（Python 3.9）到 Unicode 17（Python 3.15）行为相同的字符。浏览器核对跟随 Python 3.15。如果值里有某个字符的大小写折叠或空白属性在不同版本间变过，它在两个 Python 上的比较结果可能不同 |
| **不同 Python 版本的 `strptime`。** Python 3.15 拒绝有 `%d` 而没有年份的格式，也接受缺少 `%z` 所要求的偏移的值；更早的版本不同。 | 没有定死，浏览器按 Python 3.15 的行为处理。在所有受支持的 Python 上解析结果相同的格式不受影响；核对样例只用这样的格式 |
| 拒绝信息里的**操作系统信息**（如 `No such file or directory`）来自运行平台。 | 没有定死：文件名后面的文字不属于格式 |
| **R10.12，不覆盖报告。** | 有要求，由 `scripts/dev/tests/test_offline_verify.py` 里的 `test_existing_report_is_not_overwritten`、`test_html_report_never_overwrites_and_leaves_no_partial_output` 和 `test_a_failed_html_write_removes_both_reports` 检验，不由核对样例检验：生成样例的程序总是写入新文件 |
| **R13.3，退出码 4。** | 有要求，由 `test_internal_failure_is_not_a_mismatch` 检验，不由核对样例检验：核对样例无法让核对程序内部出错 |
| **同一个文件给两次**：命令行按解析后的路径识别。浏览器看不到路径，两次选择的文件名、大小、修改时间和字节都相同时，视为同一个文件。 | 平台差异：两者都用同样的信息拒绝 |
| **`--mapping`** 只有命令行提供。 | 浏览器和打包的核对函数始终按 `--config` 运行 |
| **用法错误**（不存在的选项、没有 `--destination`）由参数解析器打印，以 2 退出。 | 它们的文字不属于格式 |
