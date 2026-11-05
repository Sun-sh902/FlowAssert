# 报告格式

[English](report-format.md) | 简体中文

`flowassert-verify --json PATH` 把一个 JSON 对象写入一个新文件。本页说明 `schema_version` 1（FlowAssert 0.2.0 及以后版本写出）和 `schema_version` 2（从 0.7.0 起，只在来源是 Google 表格范围时写出，见[来自 Google 表格来源的报告](#来自-google-表格来源的报告)）。`--html PATH` 把同一份报告写成一个给人看的 HTML 页面，在本页末尾说明。

从 0.3.0 起，网页界面的 CSV 核对页面会根据同样的输入，逐字节写出同样的两份报告；它相当于使用 `--config` 并写明两个文件的编码运行。唯一的区别是每项前提的 `origin`：`browser form`（见 [`premises`](#premises)）。

从 0.4.0 起，打包的 JavaScript 核对函数（`flowassert-check.js` 中的 `checkCsv`，n8n 示例使用它）运行和页面相同的核对，写出同样的两份报告。它的前提的 `origin` 由调用方选择：`JavaScript call`（默认）或 `n8n Code node`。

从 0.5.0 起，网页界面可以在浏览器中保存报告，并比较同一项义务的两份报告；[比较两份报告](report-comparison.md)（英文）说明了比较时如何读取报告，以及比较给出什么。

报告从不声称超出证据的内容。FlowAssert 无法确立的成员是 `null`、`false` 或 `"unknown"`，从不猜测。

## 版本

`schema_version` 是第一个成员。成员被删除或改名，或者某个值的含义改变时，它就会改变。新增成员不改变版本，所以读取方应忽略它不认识的成员。

来源是 Google 表格范围的报告（`--source-sheet`，0.7.0 及以后）的 `schema_version` 是 2，因为对它来说，版本 1 中有三个成员的含义不同；其他所有报告都是版本 1。只认识版本 1 的读取方会拒绝版本 2 的报告，而不是把表格中的行当作文件显示。

FlowAssert 0.1.x 写出的报告没有 `schema_version`。它们的成员和 0.2.0 用 `--details all` 运行时的报告相同，只是没有 `schema_version`、`details` 和 `premises`，`claim` 的文字也更短。

## 取决于选项的成员

| 成员 | 何时出现 |
| --- | --- |
| `inputs.identical_content_allowed` | 两个文件内容完全相同，并且使用了 `--allow-identical-content` |
| `inputs.mapping_file_sha256` | 使用了 `--mapping` |
| `inputs.config_file_sha256` | 使用了 `--config` |
| `inputs.source_encoding`、`inputs.destination_encoding` | 使用了 `--source-encoding` 或 `--destination-encoding`。两者都会记录；来源是表格时，只记录 `destination_encoding` |
| `inputs.source_sheet` | 来源是 Google 表格范围（`--source-sheet`）；这时 `schema_version` 是 2 |
| `obligation.rules` | 使用了 `--config` |
| `obligation.scope` | 使用了 `--scope`，或者配置文件中有 `scope` |
| `premises.allow_identical_content` | 使用了 `--allow-identical-content` |
| `destination_only`、`destination_only_counts` | 范围是 `exact` |
| 字段结果中的 `rule`、`expected_normalized`、`actual_normalized` | 这个字段的规则不是 `exact` |
| Verified 记录的 `candidates` 和 `rules` | 使用了 `--details all` |

`--redact-values` 把每条记录的键和每个仅在目标中的键都替换为 `"[redacted]"`，并从每个字段结果中删除 `expected`、`actual`、`expected_normalized` 和 `actual_normalized`。

## 顶层成员

| 成员 | 类型 | 含义 |
| --- | --- | --- |
| `schema_version` | 整数 | `1`；来源是 Google 表格范围的报告为 `2` |
| `cohort_state` | 字符串 | 批次结果：`Verified`、`Mismatch` 或 `Unverified`。退出码随之而定：0、1、3 |
| `claim` | 字符串或 null | `cohort_state` 为 `Verified` 时是“At this evaluation, under the stated premises, the supplied destination rows satisfy the rules for the supplied source rows.”，否则为 `null` |
| `counts` | 对象 | 每种状态的记录数（见下） |
| `expected_total` | 整数或 null | 来源总体已知时，是来源记录数；否则为 `null` |
| `source_rows_observed` | 整数 | 从来源文件读到的数据行数 |
| `source_population_known` | 布尔值 | 只有在使用了 `--source-complete`、每个来源键都存在且唯一，并且 `--source-count`（如果声明了）与读到的行数相符时，才为 `true` |
| `destination_coverage_sufficient` | 布尔值 | 只有在使用了 `--destination-complete`、每个目标行都有键，并且 `--destination-count`（如果声明了）与读到的行数相符时，才为 `true`。判断缺失和唯一性都需要它 |
| `destination_rows_without_key` | 整数 | 键为空或只有空白的目标行数 |
| `records` | 数组 | 每个来源行一条记录，按文件顺序（见下） |
| `destination_only` | 数组 | 仅当范围为 `exact`：不在来源中的目标键（见下） |
| `destination_only_counts` | 对象 | 仅当范围为 `exact`：每种状态的仅在目标中的记录数，成员与 `counts` 相同 |
| `details` | 字符串 | `problems`（默认）或 `all`，来自 `--details` |
| `premises` | 对象 | 这次运行中声明或没有声明的每项前提（见下） |
| `inputs` | 对象 | 文件摘要以及文件是如何读取的（见下） |
| `obligation` | 对象 | 核对的是什么（见下） |
| `evaluator` | 字符串 | 评估器版本，`v2-current-state-1` |
| `evaluated_at` | 字符串 | 生成报告的时间，UTC 的 ISO 8601，例如 `2026-11-02T08:15:30.123456Z` |
| `limitations` | 字符串 | 结果不能确立的内容 |
| `workflow_execution` | 字符串 | 总是 `Not assessed`：工作流是否运行过 |
| `business_truth` | 字符串 | 总是 `Not assessed`：来源是否真实 |
| `existed_by_deadline` | 字符串 | 总是 `Not assessed`：记录是否在过去的截止时间前存在 |
| `acquisition_authenticity` | 字符串 | 总是 `not_authenticated`：文件和声明都未经认证 |

### `counts`

`Verified`、`Mismatch`、`Pending` 和 `Unverified`，各为一个整数。`Pending` 总是 0，因为这个工具没有等待窗口。

### `premises`

每项前提一个条目，以名称为键。FlowAssert 不核实其中任何一项。

| 条目 | 含义 |
| --- | --- |
| `source_complete` | `--source-complete`：来源文件是完整的一批 |
| `destination_complete` | `--destination-complete`：导出覆盖整个对象 |
| `source_count` | `--source-count N`：在原系统中看到的来源总数 |
| `destination_count` | `--destination-count N`：在原系统中看到的目标总数 |
| `allow_identical_content` | `--allow-identical-content`：两个完全相同的文件来自不同系统。只在使用了这个选项时出现 |

每个条目包含：

| 成员 | 含义 |
| --- | --- |
| `stated` | 声明的内容：选项为 `true` 或 `false`，总数为数字或 `null` |
| `origin` | 声明来自哪里：`flowassert-verify` 为 `command-line option`；网页界面的 CSV 核对页面为 `browser form`（0.3.0 及以后）；调用打包核对函数的程序为 `JavaScript call`，n8n 示例的 Code 节点为 `n8n Code node`（0.4.0 及以后；由调用方在这两者中选择）。配置文件不能声明前提 |
| `observed` | 仅总数：从那个文件读到的数据行数。空行不是数据行；没有键的行是 |
| `matched` | 仅总数：`stated` 是否等于 `observed`；没有声明总数时为 `null` |

不相符的总数会撤销对应的完整性声明：来源总体变为未知，或者目标覆盖变为不充分。相符的总数不能代替 `--source-complete` 或 `--destination-complete`。

### `inputs`

| 成员 | 含义 |
| --- | --- |
| `source_sha256`、`destination_sha256` | 每个文件读取时的字节的 SHA-256 |
| `source_complete_stated`、`destination_complete_stated` | 两个完整性选项，和 0.1.x 相同。`premises` 中有同样的信息 |
| `identical_content` | 两个文件的 SHA-256 是否相同 |
| `identical_content_allowed` | 使用 `--allow-identical-content` 允许了内容相同时为 `true` |
| `mapping_file_sha256` | `--mapping` 文件的 SHA-256 |
| `config_file_sha256` | `--config` 文件的 SHA-256 |
| `source_encoding`、`destination_encoding` | `utf-8`、`utf-16` 或 `gb18030` |

### `obligation`

| 成员 | 含义 |
| --- | --- |
| `type` | 总是 `current_state` |
| `key` | `[来源列, 目标列]` |
| `fields` | `[[来源列, 目标列], ...]`，按顺序 |
| `comparison` | 每个字段都精确比较时为 `exact-string`；有任何字段使用其他规则时为 `per-field-rule` |
| `rules` | `fields` 中每一项对应一条规则，顺序相同：`exact`、`trim`、`casefold`、`digits` 或 `date:FORMAT` |
| `scope` | `source` 或 `exact` |

## 记录

`records` 中的每一项是一个来源行。

| 成员 | 含义 |
| --- | --- |
| `key` | 来源键；为空时是 `null` |
| `source_row` | 这一行在来源数据行中的位置，从 0 开始。摘要中打印的是它加 1 |
| `state` | `Verified`、`Mismatch` 或 `Unverified` |
| `candidates` | 带有这个键的目标行数 |
| `rules` | 每条规则一个结果（见下） |

使用默认的 `--details problems` 时，Verified 记录只有 `key`、`source_row` 和 `state`。其他记录总是包含每个成员。使用 `--details all` 时，每条记录都包含每个成员。

### 规则结果

`rules` 包含 `existence`、`uniqueness`，以及每个比较字段的一个 `field:COLUMN` 条目，以来源列命名。每个结果包含：

| 成员 | 含义 |
| --- | --- |
| `status` | `pass`、`fail` 或 `unknown` |
| `reason` | 用文字说明原因 |
| `expected` | 比较了值时，来源值 |
| `actual` | 比较了值时，目标值 |
| `rule` | 这个字段的比较规则，不是 `exact` 时出现 |
| `expected_normalized` | 规则比较时的来源值；没有可比较的内容时（例如日期无法解析）为 `null` |
| `actual_normalized` | 目标值的同一内容 |

任何结果不通过，记录就是 Mismatch；每个结果都通过，记录就是 Verified；否则是 Unverified。空值在每条规则下都是 `unknown`。对于 `digits`，不含数字 0–9 的值是 `unknown`；对于 `date:FORMAT`，无法解析的值是 `unknown`，带 UTC 偏移的值会换算到 UTC。日期按 ISO 8601 规范化，例如 `2026-01-02T00:00:00`。

## 仅在目标中的记录

范围为 `exact` 时，每个不在来源中的目标键成为 `destination_only` 中的一项，按它第一次出现的目标行排序。没有键的目标行从不算作仅在目标中。这些项从不出现在 `records` 中。

| 成员 | 含义 |
| --- | --- |
| `key` | 目标键 |
| `destination_row` | 第一个带有这个键的目标数据行的位置，从 0 开始 |
| `rows` | 带有这个键的目标行数 |
| `state` | `source_population_known` 为 true 时是 `Mismatch`。否则是 `Unverified`：只列出，不下结论，因为这个键可能属于没有提供的来源行。目标覆盖不起作用：这一行确实存在 |
| `reason` | 用文字说明原因 |

仅在目标中的 Mismatch 会让 `cohort_state` 成为 Mismatch。仅在目标中的 Unverified 记录不改变 `cohort_state`。

## 来自 Google 表格来源的报告

从 0.7.0 起，`flowassert-verify --source-sheet ID --source-range RANGE` 以只读方式从 Google 表格的一个范围读取来源行，代替来源文件（见[设计说明](connectors/google-sheets.zh-CN.md)）。它的报告的 `schema_version` 是 2，包含版本 1 的每个成员，含义相同，只有以下不同：

| 成员 | 在版本 2 中 |
| --- | --- |
| `inputs.source_sha256` | 所读取的值的规范形式（`flowassert-sheet-csv-1`，见下）的 SHA-256，而不是文件字节的 SHA-256 |
| `source_rows_observed`、`premises.source_count.observed` | 范围中的数据行：第一行（表头）之后的每一行 |
| `premises.source_complete` | `--source-complete`：表格范围是完整的一批。仍然是 FlowAssert 不会核实的声明 |
| `inputs.source_encoding` | 从不出现；使用了 `--destination-encoding` 时，只出现 `inputs.destination_encoding` |
| `inputs.identical_content` | 规范形式和目标文件的 SHA-256 是否相同 |
| `inputs.source_sheet` | 这些行是从哪里读取的，见下。总是出现 |

读取表格去掉了导出这一步，所以没有任何导出过程能截断或改动这些行。它不能说明这个范围包含了应有的全部记录：这仍是前提 `source_complete`。同样的单元格值，会得到和放在 CSV 文件里的同样的行相同的记录、规则结果、计数和批次状态。

### `inputs.source_sheet`

| 成员 | 含义 |
| --- | --- |
| `read_by` | 总是 `FlowAssert`：这些行由 FlowAssert 读取，而不是由人导出。这不是关于完整性的声明 |
| `service` | 总是 `Google Sheets API v4` |
| `spreadsheet_id` | 传给 `--source-sheet` 的表格 ID |
| `range_requested` | 传给 `--source-range` 的范围，例如 `Leads!A1:F` |
| `range_returned` | API 所说读取的范围，例如 `Leads!A1:F1000` |
| `value_render_option` | 总是 `FORMATTED_VALUE`：每个单元格都是表格中显示的文本 |
| `date_time_render_option` | 总是 `FORMATTED_STRING`（使用 `FORMATTED_VALUE` 时 API 会忽略它，记录它是为了写明两个选项） |
| `major_dimension` | 总是 `ROWS` |
| `read_at` | 请求值的时间，UTC 的 ISO 8601，格式和 `evaluated_at` 相同 |
| `revision` | `{"available": true, "before": {"version": V, "modified_time": T}, "after": {...}}`：读取值之前和之后，Google 云端硬盘的 `version`（数字组成的字符串）和 `modifiedTime`（字符串，云端硬盘没有提供时为 `null`），两次相同；或者 `{"available": false, "reason": R}`，其中 `R` 是 `not requested (--skip-source-revision)` 或 `Google Drive returned no version`：这次读取无法对应到某个版本 |
| `canonical_form` | 总是 `flowassert-sheet-csv-1` |

报告从不记录凭据、账号或表格标题。`--redact-values` 保留表格 ID 和范围：它们不是值。

### 规范形式 `flowassert-sheet-csv-1`

UTF-8，没有字节顺序标记。先是表头，然后是每个数据行，用空字符串补齐到表头的宽度，每行后面跟一个换行符（最后一行也是）。单元格之间用逗号分隔。单元格包含 `,`、`"`、回车或换行时，或者它是所在行唯一的单元格并且为空时，写在双引号中，其中每个 `"` 写两次；其他单元格原样写出。`flowassert-verify --source` 读这份文本，得到的正是表格给出的那些行。

## HTML 报告

`--html PATH` 写出一个 HTML 文件，和 `--json` 一样，拒绝覆盖已有文件。如果任何一份报告无法写出，两份都不会留下。页面显示批次结果和声明、每项声明的前提、计数、限制、每条不是 Verified 的记录及其规则结果、每条仅在目标中的记录，以及输入。它遵循 `--redact-values`。

来自 Google 表格来源的报告，在输入之前多一节“Source read from Google Sheets”：`inputs.source_sheet` 的成员、版本，以及“这次读取不能说明这个范围包含了应有的全部记录”这句话（页面上是英文）。

文件中的每个值都经过转义。页面没有脚本，也不加载任何内容：样式写在页面内，内容安全策略阻止其他一切。离线打开也能使用。
